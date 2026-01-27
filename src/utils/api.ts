import type { Ticker, FundingInfo, Kline } from '../types';

const BINANCE_FUTURES_API = 'https://fapi.binance.com/fapi/v1';

/**
 * 거래 가능한 심볼 목록 가져오기
 */
export async function getTradingSymbols(): Promise<Set<string>> {
  const response = await fetch(`${BINANCE_FUTURES_API}/exchangeInfo`);
  if (!response.ok) {
    throw new Error('거래 심볼 정보를 가져오는데 실패했습니다.');
  }
  const data = await response.json();
  
  return new Set(
    data.symbols
      .filter((symbol: any) => symbol.status === 'TRADING')
      .map((symbol: any) => symbol.symbol)
  );
}

/**
 * 24시간 티커 데이터 가져오기
 */
export async function getTicker24hr(): Promise<Ticker[]> {
  const response = await fetch(`${BINANCE_FUTURES_API}/ticker/24hr`);
  if (!response.ok) {
    throw new Error('티커 데이터를 가져오는데 실패했습니다.');
  }
  return response.json();
}

/**
 * 펀딩비 데이터 가져오기
 */
export async function getFundingRates(): Promise<Record<string, FundingInfo>> {
  const [premiumResponse, fundingInfoResponse] = await Promise.all([
    fetch(`${BINANCE_FUTURES_API}/premiumIndex`),
    fetch(`${BINANCE_FUTURES_API}/fundingInfo`)
  ]);
  
  if (!premiumResponse.ok) {
    throw new Error('펀딩비 데이터를 가져오는데 실패했습니다.');
  }
  
  const premiumData = await premiumResponse.json();
  
  // fundingInfo는 실패해도 계속 진행 (선택적)
  let fundingInfoData: any[] = [];
  if (fundingInfoResponse.ok) {
    try {
      fundingInfoData = await fundingInfoResponse.json();
    } catch (e) {
      console.warn('펀딩 주기 정보를 가져오는데 실패했습니다:', e);
    }
  }
  
  // fundingInfo를 심볼별로 매핑
  const fundingInfoMap: Record<string, number> = {};
  fundingInfoData.forEach((item: any) => {
    if (item.symbol && item.fundingIntervalHours) {
      fundingInfoMap[item.symbol] = item.fundingIntervalHours;
    }
  });
  
  const fundingDict: Record<string, FundingInfo> = {};
  premiumData.forEach((item: any) => {
    fundingDict[item.symbol] = {
      lastFundingRate: parseFloat(item.lastFundingRate || '0'),
      nextFundingTime: parseInt(item.nextFundingTime || '0', 10),
      fundingIntervalHours: fundingInfoMap[item.symbol]
    };
  });
  
  return fundingDict;
}

/**
 * 캔들스틱 데이터 가져오기
 */
export async function getCandlestickData(
  symbol: string,
  interval: string = '1h',
  limit: number = 24,
  startTime?: number,
  endTime?: number,
  signal?: AbortSignal
): Promise<Kline[] | null> {
  try {
    const params = new URLSearchParams({
      symbol,
      interval,
      limit: limit.toString()
    });
    
    if (startTime) {
      params.append('startTime', startTime.toString());
    }
    if (endTime) {
      params.append('endTime', endTime.toString());
    }
    
    const response = await fetch(`${BINANCE_FUTURES_API}/klines?${params}`, {
      signal // AbortSignal 전달
    });
    
    if (!response.ok) {
      throw new Error(`캔들스틱 데이터를 가져오는데 실패했습니다: ${symbol}`);
    }
    return response.json();
  } catch (error) {
    // AbortError는 정상적인 취소이므로 로그 출력 안 함
    if (error instanceof Error && error.name === 'AbortError') {
      return null;
    }
    console.error(`[오류] ${symbol} 캔들스틱 데이터 가져오기 실패:`, error);
    return null;
  }
}

/**
 * 재시도 로직이 포함된 fetch 함수
 */
export async function fetchWithRetry(url: string, maxRetries: number = 3, delay: number = 2000): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      
      // 성공적인 응답
      if (response.ok) {
        return response;
      }
      
      // 재시도 가능한 오류 (429, 500, 502, 503, 504)
      const retryableStatuses = [429, 500, 502, 503, 504];
      if (retryableStatuses.includes(response.status)) {
        if (i < maxRetries - 1) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay * Math.pow(2, i); // 지수 백오프
          console.warn(`[${response.status} 오류] ${waitTime}ms 후 재시도... (${i + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
      }
      
      // 재시도 불가능한 오류 또는 마지막 시도
      const errorText = await response.text().catch(() => '응답을 읽을 수 없습니다');
      throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // 네트워크 오류인 경우 재시도
      if (i < maxRetries - 1 && (error instanceof TypeError || error instanceof Error)) {
        const waitTime = delay * Math.pow(2, i); // 지수 백오프
        console.warn(`[네트워크 오류] ${waitTime}ms 후 재시도... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // 마지막 시도 실패
      if (i === maxRetries - 1) {
        throw lastError;
      }
    }
  }
  
  throw lastError || new Error('최대 재시도 횟수 초과');
}

// 경제 캘린더 함수 제거됨 - iframe으로 대체
