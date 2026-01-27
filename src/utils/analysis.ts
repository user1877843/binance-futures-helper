import type { Kline, TrendAnalysis, SupportResistance, StopLossInfo, Ticker, ADXResult, FundingInfo, VPVRPOC } from '../types';
import type { WeeklyPattern, DayKey } from '../utils/weeklyPattern';
import type { DayHourPattern } from '../utils/hourlyPattern';

/**
 * RSI(Relative Strength Index) 계산 (단일 값)
 * 암호화폐 최적화: 기본 period를 9로 변경 (고변동성 대응)
 */
export function calculateRSI(prices: number[], period: number = 9): number {
  if (prices.length < period + 1) {
    return 50.0; // 데이터 부족 시 중립값 반환
  }
  
  const deltas = prices.slice(1).map((price, i) => price - prices[i]);
  const gains = deltas.map(d => d > 0 ? d : 0);
  const losses = deltas.map(d => d < 0 ? -d : 0);
  
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  
  if (avgLoss === 0) {
    return 100.0;
  }
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  return rsi;
}


/**
 * ATR (Average True Range) 계산
 * 변동성을 측정하여 리스크 관리에 사용
 */
export function calculateATR(klines: Kline[], period: number = 14): number {
  if (!klines || klines.length < period + 1) {
    return 0;
  }

  const trueRanges: number[] = [];
  
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i][2]);
    const low = parseFloat(klines[i][3]);
    const prevClose = parseFloat(klines[i - 1][4]);
    
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    
    const trueRange = Math.max(tr1, tr2, tr3);
    trueRanges.push(trueRange);
  }
  
  if (trueRanges.length < period) {
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }
  
  // 최근 period개의 True Range 평균
  const recentTRs = trueRanges.slice(-period);
  return recentTRs.reduce((a, b) => a + b, 0) / period;
}

/**
 * 이동평균선(SMA) 계산
 * @param prices 종가 배열
 * @param period 이동평균 기간 (기본값: 200)
 * @returns 이동평균선 값 배열 (데이터 부족 시 null 반환)
 */
export function calculateMA(prices: number[], period: number = 200): (number | null)[] {
  if (!prices || prices.length < period) {
    return prices.map(() => null);
  }

  const maValues: (number | null)[] = [];
  
  // 초기 period-1개는 계산 불가
  for (let i = 0; i < period - 1; i++) {
    maValues.push(null);
  }
  
  // period번째부터 이동평균 계산
  for (let i = period - 1; i < prices.length; i++) {
    const periodPrices = prices.slice(i - period + 1, i + 1);
    const ma = periodPrices.reduce((sum, price) => sum + price, 0) / period;
    maValues.push(ma);
  }
  
  return maValues;
}

/**
 * 이동평균선 배열을 시간 정보와 함께 반환
 * @param klines 캔들 데이터
 * @param period 이동평균 기간 (기본값: 200)
 * @returns { time: number, value: number } 배열 (유효한 값만)
 */
export function calculateMAWithTime(klines: Kline[], period: number = 200): Array<{ time: number; value: number }> {
  if (!klines || klines.length < period) {
    return [];
  }

  const closes = klines.map(k => parseFloat(k[4]));
  const maValues = calculateMA(closes, period);
  
  const result: Array<{ time: number; value: number }> = [];
  
  for (let i = 0; i < maValues.length; i++) {
    if (maValues[i] !== null) {
      result.push({
        time: Math.floor(klines[i][0] / 1000), // 밀리초를 초로 변환
        value: maValues[i]!
      });
    }
  }
  
  return result;
}

/**
 * VWMA (Volume Weighted Moving Average) 계산
 * 거래량 가중 이동평균선
 * @param klines 캔들 데이터
 * @param period 이동평균 기간 (기본값: 100)
 * @returns { time: number, value: number } 배열 (유효한 값만)
 */
export function calculateVWMAWithTime(klines: Kline[], period: number = 100): Array<{ time: number; value: number }> {
  if (!klines || klines.length < period) {
    return [];
  }

  const result: Array<{ time: number; value: number }> = [];
  
  // 초기 period-1개는 계산 불가
  for (let i = 0; i < period - 1; i++) {
    // 빈 배열에 추가하지 않음 (유효한 값만 반환)
  }
  
  // period번째부터 VWMA 계산
  for (let i = period - 1; i < klines.length; i++) {
    let priceVolumeSum = 0;
    let volumeSum = 0;
    
    // 최근 period개의 캔들에 대해 계산
    for (let j = i - period + 1; j <= i; j++) {
      const close = parseFloat(klines[j][4]);
      const volume = parseFloat(klines[j][5]);
      
      priceVolumeSum += close * volume;
      volumeSum += volume;
    }
    
    // VWMA = Σ(가격 × 거래량) / Σ(거래량)
    if (volumeSum > 0) {
      const vwma = priceVolumeSum / volumeSum;
      result.push({
        time: Math.floor(klines[i][0] / 1000), // 밀리초를 초로 변환
        value: vwma
      });
    }
  }
  
  return result;
}

/**
 * ADX (Average Directional Index) 계산
 * 트렌드 강도를 측정 (0-100, 높을수록 강한 트렌드)
 */
export function calculateADX(klines: Kline[], period: number = 14): ADXResult {
  if (!klines || klines.length < period * 2) {
    return {
      adx: 0,
      plusDI: 0,
      minusDI: 0,
      trend_strength: 'weak',
      trend_direction: 'neutral'
    };
  }

  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));

  // +DM과 -DM 계산
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  const trueRanges: number[] = [];

  for (let i = 1; i < klines.length; i++) {
    const highDiff = highs[i] - highs[i - 1];
    const lowDiff = lows[i - 1] - lows[i];
    
    const plusDM = (highDiff > lowDiff && highDiff > 0) ? highDiff : 0;
    const minusDM = (lowDiff > highDiff && lowDiff > 0) ? lowDiff : 0;
    
    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
    
    // True Range 계산
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    
    trueRanges.push(Math.max(tr1, tr2, tr3));
  }

  // Wilder's Smoothing 적용
  let smoothedPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);

  for (let i = period; i < plusDMs.length; i++) {
    smoothedPlusDM = (smoothedPlusDM * (period - 1) + plusDMs[i]) / period;
    smoothedMinusDM = (smoothedMinusDM * (period - 1) + minusDMs[i]) / period;
    smoothedTR = (smoothedTR * (period - 1) + trueRanges[i]) / period;
  }

  // +DI와 -DI 계산
  const plusDI = (smoothedTR > 0) ? (smoothedPlusDM / smoothedTR) * 100 : 0;
  const minusDI = (smoothedTR > 0) ? (smoothedMinusDM / smoothedTR) * 100 : 0;

  // DX 계산
  const diSum = plusDI + minusDI;
  const dx = (diSum > 0) ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;

  // ADX는 DX의 Wilder's Smoothing (간단화: 최근 period개의 DX 평균)
  const dxValues: number[] = [];
  let tempSmoothedPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let tempSmoothedMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let tempSmoothedTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);

  for (let i = period; i < plusDMs.length; i++) {
    tempSmoothedPlusDM = (tempSmoothedPlusDM * (period - 1) + plusDMs[i]) / period;
    tempSmoothedMinusDM = (tempSmoothedMinusDM * (period - 1) + minusDMs[i]) / period;
    tempSmoothedTR = (tempSmoothedTR * (period - 1) + trueRanges[i]) / period;

    const tempPlusDI = (tempSmoothedTR > 0) ? (tempSmoothedPlusDM / tempSmoothedTR) * 100 : 0;
    const tempMinusDI = (tempSmoothedTR > 0) ? (tempSmoothedMinusDM / tempSmoothedTR) * 100 : 0;
    const tempDISum = tempPlusDI + tempMinusDI;
    const tempDX = (tempDISum > 0) ? (Math.abs(tempPlusDI - tempMinusDI) / tempDISum) * 100 : 0;
    dxValues.push(tempDX);
  }

  // ADX는 DX의 평균 (실제로는 Wilder's Smoothing이지만 간단화)
  const adx = dxValues.length > 0 
    ? dxValues.reduce((a, b) => a + b, 0) / dxValues.length 
    : dx;

  // 트렌드 강도 분류
  let trendStrength: 'strong' | 'moderate' | 'weak';
  if (adx >= 25) {
    trendStrength = 'strong';
  } else if (adx >= 20) {
    trendStrength = 'moderate';
  } else {
    trendStrength = 'weak';
  }

  // 트렌드 방향
  let trendDirection: 'up' | 'down' | 'neutral';
  if (plusDI > minusDI + 5) {
    trendDirection = 'up';
  } else if (minusDI > plusDI + 5) {
    trendDirection = 'down';
  } else {
    trendDirection = 'neutral';
  }

  return {
    adx,
    plusDI,
    minusDI,
    trend_strength: trendStrength,
    trend_direction: trendDirection
  };
}

/**
 * 차트 트렌드 분석
 */
export function analyzeChartTrend(klines: Kline[]): TrendAnalysis {
  if (!klines || klines.length < 2) {
    return {
      price_change: 0,
      volatility: 0,
      trend: '중립',
      trend_score: 0.5
    };
  }
  
  const closes = klines.map(k => parseFloat(k[4]));
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  
  // 가격 변동률 계산
  const firstPrice = closes[0];
  const lastPrice = closes[closes.length - 1];
  const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;
  
  // 변동성 계산 (고가-저가의 평균)
  const priceRanges = closes.map((close, i) => 
    ((highs[i] - lows[i]) / close) * 100
  );
  const volatility = priceRanges.reduce((a, b) => a + b, 0) / priceRanges.length;
  
  // 트렌드 판단
  let trend: string;
  let trendScore: number;
  
  if (priceChange > 5) {
    trend = '강한 상승';
    trendScore = 0.2; // Short에 불리
  } else if (priceChange > 2) {
    trend = '상승';
    trendScore = 0.4;
  } else if (priceChange > -2) {
    trend = '중립';
    trendScore = 0.5;
  } else if (priceChange > -5) {
    trend = '하락';
    trendScore = 0.7;
  } else {
    trend = '강한 하락';
    trendScore = 0.9; // Short에 유리
  }
  
  return {
    price_change: priceChange,
    volatility,
    trend,
    trend_score: trendScore
  };
}

/**
 * 저항선과 지지선 계산
 */
export function calculateSupportResistance(
  klines: Kline[],
  lookbackPeriod: number = 20
): SupportResistance {
  if (!klines || klines.length < lookbackPeriod) {
    return {
      resistance: 0,
      support: 0,
      pivot: 0,
      resistance_strength: 0,
      support_strength: 0,
      current_price: 0
    };
  }
  
  // 최근 데이터만 사용
  const recentKlines = klines.slice(-lookbackPeriod);
  
  const highs = recentKlines.map(k => parseFloat(k[2]));
  const lows = recentKlines.map(k => parseFloat(k[3]));
  const closes = recentKlines.map(k => parseFloat(k[4]));
  
  // 현재 가격
  const currentPrice = closes[closes.length - 1];
  
  // 저항선: 최근 고가들의 평균과 최대값 고려
  const maxHigh = Math.max(...highs);
  const avgHigh = highs.reduce((a, b) => a + b, 0) / highs.length;
  
  // 고가가 여러 번 터치된 레벨 찾기 (저항선 강도)
  const resistanceCandidates = highs.filter(h => h > avgHigh * 0.98);
  
  let resistance: number;
  let resistanceStrength: number;
  
  if (resistanceCandidates.length > 0) {
    resistance = Math.max(...resistanceCandidates);
    resistanceStrength = (resistanceCandidates.length / highs.length) * 100;
  } else {
    resistance = maxHigh;
    resistanceStrength = 50;
  }
  
  // 지지선: 최근 저가들의 평균과 최소값 고려
  const minLow = Math.min(...lows);
  const avgLow = lows.reduce((a, b) => a + b, 0) / lows.length;
  
  // 저가가 여러 번 터치된 레벨 찾기 (지지선 강도)
  const supportCandidates = lows.filter(l => l < avgLow * 1.02);
  
  let support: number;
  let supportStrength: number;
  
  if (supportCandidates.length > 0) {
    support = Math.min(...supportCandidates);
    supportStrength = (supportCandidates.length / lows.length) * 100;
  } else {
    support = minLow;
    supportStrength = 50;
  }
  
  // 피벗 포인트 계산 (전일 고가, 저가, 종가의 평균)
  let pivot: number;
  if (recentKlines.length >= 2) {
    const prevHigh = parseFloat(recentKlines[recentKlines.length - 2][2]);
    const prevLow = parseFloat(recentKlines[recentKlines.length - 2][3]);
    const prevClose = parseFloat(recentKlines[recentKlines.length - 2][4]);
    pivot = (prevHigh + prevLow + prevClose) / 3;
  } else {
    pivot = currentPrice;
  }

  return {
    resistance,
    support,
    pivot,
    resistance_strength: resistanceStrength,
    support_strength: supportStrength,
    current_price: currentPrice
  };
}

/**
 * 손절가와 목표가 계산
 * 손절선은 ATR 하이브리드 방식 사용 (저항선 기반 + ATR 기반 중 더 안전한 값 선택)
 */
export function calculateStopLoss(
  supportResistance: SupportResistance,
  positionType: 'short' | 'long' = 'short',
  atr: number = 0
): StopLossInfo {
  const { current_price, resistance, support } = supportResistance;
  
  let stopLoss: number;
  let targetPrice: number;
  let risk: number;
  let reward: number;
  
  if (positionType === 'short') {
    // Short 포지션: ATR 하이브리드 방식으로 손절가 설정
    // 1. 기존 방식: 저항선 위에 2% 여유
    const baseStopLoss = resistance * 1.02;
    
    // 2. ATR 기반: 현재가 + ATR × 1.5 (변동성 고려)
    const atrBasedStopLoss = current_price + (atr * 1.5);
    
    // 3. 둘 중 더 먼 것을 선택 (더 안전한 쪽)
    stopLoss = Math.max(baseStopLoss, atrBasedStopLoss);
    
    // 목표가: 지지선 근처 (변경 없음)
    targetPrice = support * 1.01; // 지지선 약간 위
    
    // 리스크/리워드 비율 계산
    risk = stopLoss - current_price;
    reward = current_price - targetPrice;
  } else {
    // Long 포지션 (참고용)
    // 1. 기존 방식: 지지선 아래에 2% 여유
    const baseStopLoss = support * 0.98;
    
    // 2. ATR 기반: 현재가 - ATR × 1.5
    const atrBasedStopLoss = current_price - (atr * 1.5);
    
    // 3. 둘 중 더 먼 것을 선택 (더 안전한 쪽)
    stopLoss = Math.min(baseStopLoss, atrBasedStopLoss);
    
    targetPrice = resistance * 0.99;
    
    risk = current_price - stopLoss;
    reward = targetPrice - current_price;
  }
  
  const riskRewardRatio = (risk > 0 && reward > 0) ? reward / risk : 0;
  
  const riskPercentCalc = positionType === 'short'
    ? ((stopLoss - current_price) / current_price) * 100
    : ((current_price - stopLoss) / current_price) * 100;
    
  const rewardPercentCalc = positionType === 'short'
    ? ((current_price - targetPrice) / current_price) * 100
    : ((targetPrice - current_price) / current_price) * 100;
  
  return {
    stop_loss: stopLoss,
    target_price: targetPrice,
    risk_reward_ratio: riskRewardRatio,
    risk_percent: riskPercentCalc,
    reward_percent: rewardPercentCalc
  };
}


/**
 * 펀딩 주기 계산 (시간 단위)
 * fundingIntervalHours가 제공되면 그것을 사용하고,
 * 없으면 nextFundingTime을 기반으로 펀딩 주기를 추정합니다.
 * 
 * Binance의 펀딩 주기:
 * - 대부분의 코인: 8시간 (00:00, 08:00, 16:00 UTC)
 * - 일부 코인: 4시간, 1시간 등
 */
export function calculateFundingPeriod(
  nextFundingTime: number,
  fundingIntervalHours?: number
): number {
  // API에서 제공하는 정확한 펀딩 주기 정보가 있으면 사용
  if (fundingIntervalHours && fundingIntervalHours > 0) {
    return fundingIntervalHours;
  }
  
  // fundingIntervalHours가 없으면 nextFundingTime을 기반으로 추정
  if (!nextFundingTime) {
    return 8; // 기본값: 8시간
  }
  
  const now = Date.now();
  const timeUntilNext = nextFundingTime - now;
  const hoursUntilNext = timeUntilNext / (60 * 60 * 1000);
  
  // 다음 펀딩까지 남은 시간을 기반으로 주기 추정
  // 일반적인 주기: 1h, 4h, 8h
  if (hoursUntilNext > 0 && hoursUntilNext <= 1.5) {
    return 1; // 1시간 주기
  } else if (hoursUntilNext > 1.5 && hoursUntilNext <= 4.5) {
    return 4; // 4시간 주기
  } else {
    return 8; // 8시간 주기 (기본값)
  }
}

/**
 * 시간당 펀딩비 계산
 * 펀딩 시간을 고려하여 시간당 펀딩비를 계산합니다.
 * 예: 8시간에 -1% 펀딩비 = 시간당 -0.125%
 * 예: 4시간에 -0.5% 펀딩비 = 시간당 -0.125% (같은 양)
 */
export function calculateHourlyFundingRate(
  lastFundingRate: number,
  nextFundingTime: number,
  fundingIntervalHours?: number
): number {
  if (!lastFundingRate) {
    return 0;
  }
  
  const fundingPeriod = calculateFundingPeriod(nextFundingTime, fundingIntervalHours);
  // 시간당 펀딩비 = 펀딩비 / 펀딩 주기
  return lastFundingRate / fundingPeriod;
}

/**
 * 이동평균선 기반 점수 계산
 * @param currentPrice 현재가
 * @param ma50Data MA50 데이터
 * @param ma200Data MA200 데이터
 * @returns 0-1 점수 (높을수록 Short에 유리)
 */
function calculateMAScore(
  currentPrice: number,
  ma50Data?: Array<{ time: number; value: number }>,
  ma200Data?: Array<{ time: number; value: number }>
): number {
  // 데이터가 없으면 중립 점수 반환
  if (!ma50Data || !ma200Data || ma50Data.length === 0 || ma200Data.length === 0) {
    return 0.5;
  }

  // 최신 이동평균선 값 가져오기
  const latestMA50 = ma50Data[ma50Data.length - 1]?.value;
  const latestMA200 = ma200Data[ma200Data.length - 1]?.value;

  if (!latestMA50 || !latestMA200 || isNaN(latestMA50) || isNaN(latestMA200)) {
    return 0.5;
  }

  let score = 0.5; // 기본 점수

  // 1. 이동평균선 배열 상태 (MA50 < MA200 = 하락 추세)
  if (latestMA50 < latestMA200) {
    // 하락 추세: MA50과 MA200의 차이가 클수록 강한 하락 추세
    const maDiff = ((latestMA200 - latestMA50) / latestMA200) * 100; // 차이를 퍼센트로
    if (maDiff > 5) {
      score += 0.2; // 강한 하락 추세
    } else if (maDiff > 2) {
      score += 0.15; // 중간 하락 추세
    } else {
      score += 0.1; // 약한 하락 추세
    }
  } else if (latestMA50 > latestMA200) {
    // 상승 추세: Short에 불리
    const maDiff = ((latestMA50 - latestMA200) / latestMA200) * 100;
    if (maDiff > 5) {
      score -= 0.2; // 강한 상승 추세
    } else if (maDiff > 2) {
      score -= 0.15; // 중간 상승 추세
    } else {
      score -= 0.1; // 약한 상승 추세
    }
  }

  // 2. 현재가와 이동평균선의 관계
  if (currentPrice > latestMA50 && latestMA50 > latestMA200) {
    // 현재가 > MA50 > MA200: 과매수 상태 (Short에 유리)
    const priceDiff = ((currentPrice - latestMA50) / latestMA50) * 100;
    if (priceDiff > 5) {
      score += 0.15; // 강한 과매수
    } else if (priceDiff > 2) {
      score += 0.1; // 중간 과매수
    } else {
      score += 0.05; // 약한 과매수
    }
  } else if (currentPrice < latestMA50 && latestMA50 < latestMA200) {
    // 현재가 < MA50 < MA200: 하락 추세 (Short에 유리)
    const priceDiff = ((latestMA50 - currentPrice) / latestMA50) * 100;
    if (priceDiff > 5) {
      score += 0.1; // 강한 하락
    } else if (priceDiff > 2) {
      score += 0.05; // 중간 하락
    }
  } else if (currentPrice < latestMA200 && latestMA50 > latestMA200) {
    // 현재가 < MA200 < MA50: 상승 추세에서 하락 시작 (약간 유리)
    score += 0.05;
  } else if (currentPrice > latestMA200 && latestMA50 < latestMA200) {
    // 현재가 > MA200 > MA50: 하락 추세에서 반등 (불리)
    score -= 0.1;
  }

  // 점수를 0-1 범위로 제한
  return Math.max(0, Math.min(1, score));
}

/**
 * Short 적합도 종합 점수 계산
 */
export function calculateShortScore(
  symbol: string,
  ticker: Ticker,
  fundingDict: Record<string, FundingInfo>,
  klines: Kline[],
  rsi: number,
  adxResult?: ADXResult,
  atr?: number,
  ma50Data?: Array<{ time: number; value: number }>,
  ma200Data?: Array<{ time: number; value: number }>,
  vpvrPOC?: VPVRPOC | null
): number {
  // 펀딩비 점수 (0-1, 높을수록 좋음)
  // 시간당 펀딩비를 기준으로 계산하여 펀딩 주기와 무관하게 동일한 펀딩비는 동일한 점수를 받도록 함
  const fundingInfo = fundingDict[symbol] || { lastFundingRate: 0, nextFundingTime: 0 };
  const hourlyFundingRate = calculateHourlyFundingRate(
    fundingInfo.lastFundingRate,
    fundingInfo.nextFundingTime,
    fundingInfo.fundingIntervalHours
  );
  // 시간당 펀딩비를 퍼센트로 변환 (예: -0.00125 -> -0.125%)
  const hourlyFundingRatePercent = hourlyFundingRate * 100;
  // 기준 강화: -0.1% → -0.15% (더 강한 신호만)
  // 시간당 펀딩비가 -0.15% 이상이면 최고점 (1.0), +0.15% 이상이면 최저점 (0.0)
  const fundingScore = Math.min(Math.max((hourlyFundingRatePercent + 0.15) / 0.3, 0), 1);
  
  // RSI 점수 (0-1, 높을수록 과매수, Short에 유리)
  // 기준 조정: 30-70 → 25-75 (더 강한 신호만)
  const rsiScore = Math.min(Math.max((rsi - 25) / 50, 0), 1);
  
  // 거래량 점수 (0-1, 높을수록 좋음)
  const quoteVolume = parseFloat(ticker.quoteVolume || '0');
  const volumeScore = Math.min(quoteVolume / 10_000_000_000, 1.0);
  
  // ADX 트렌드 점수 (0-1, 하락 트렌드이고 강할수록 높음)
  let adxScore = 0.5;
  if (adxResult) {
    if (adxResult.trend_direction === 'down' && adxResult.trend_strength === 'strong') {
      adxScore = 0.9; // 강한 하락 트렌드
    } else if (adxResult.trend_direction === 'down' && adxResult.trend_strength === 'moderate') {
      adxScore = 0.7; // 중간 하락 트렌드
    } else if (adxResult.trend_direction === 'down') {
      adxScore = 0.6; // 약한 하락 트렌드
    } else if (adxResult.trend_direction === 'up' && adxResult.trend_strength === 'strong') {
      adxScore = 0.1; // 강한 상승 트렌드 (Short에 불리)
    } else if (adxResult.trend_direction === 'up') {
      adxScore = 0.3; // 상승 트렌드 (Short에 불리)
    } else if (adxResult.trend_strength === 'weak') {
      adxScore = 0.4; // 횡보장 (Short에 불리)
    }
  }
  
  // 이동평균선 점수 (0-1, 하락 추세일수록 높음)
  const currentPrice = klines.length > 0 ? parseFloat(klines[klines.length - 1][4]) : parseFloat(ticker.lastPrice);
  const maScore = calculateMAScore(currentPrice, ma50Data, ma200Data);
  
  // VPVR POC 점수 (0-1, 현재가가 POC보다 낮을수록 높음)
  // ATR을 전달하여 동적 임계값과 신뢰도 조정 적용
  const vpvrScore = calculateVPVRScore(currentPrice, vpvrPOC, atr);
  
  // 가중 평균 계산 (ATR 점수 제거, 비중 재조정)
  // VPVR POC: 11%, ADX 트렌드: 15%, RSI: 15%, 펀딩비: 14%, 이동평균선: 15%, 거래량: 5%
  // 나머지 25%는 타이밍 점수로 사용
  // ATR은 손절선 계산에만 사용 (점수 계산에서는 제외)
  const totalScore = (
    vpvrScore * 0.11 +
    adxScore * 0.15 +
    rsiScore * 0.15 +
    fundingScore * 0.14 +
    maScore * 0.15 +
    volumeScore * 0.05
  );
  
  return totalScore * 100;
}

/** getUTCDay() 0=일..6=토 → dayHour data 인덱스 (0=월..6=일) */
export function dayHourDataIndex(utcDay: number): number {
  return utcDay === 0 ? 6 : utcDay - 1;
}

/**
 * 요일별 + 요일+시간대별 패턴으로 타이밍 점수 계산 (0~1)
 * 한국시간 기준. 높을수록 Short 유리.
 */
export function computeTimingScore(
  weeklyPattern: WeeklyPattern | null,
  dayHourPattern: DayHourPattern | null,
  kstNow?: Date
): number {
  if (!weeklyPattern || !dayHourPattern) return 0.5;

  const now = kstNow ?? new Date();
  // 한국 시간(UTC+9) 계산
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay();
  const kstHour = (utcHour + 9) % 24;
  // 한국 시간으로 요일 계산 (UTC+9 시간대에서 하루가 넘어가는 경우 고려)
  const kstDayOffset = utcHour + 9 >= 24 ? 1 : 0;
  const currentDay = (utcDay + kstDayOffset) % 7;
  const currentHour = kstHour;

  const dayMap: Record<number, DayKey> = {
    0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
    4: 'thursday', 5: 'friday', 6: 'saturday',
  };
  const dayKey = dayMap[currentDay];
  const dayPattern = weeklyPattern[dayKey];
  const dayWinRate = dayPattern?.winRate ?? 0.5;
  const dayScore = dayWinRate;

  const di = dayHourDataIndex(currentDay);
  const hourData = dayHourPattern.data[di]?.[currentHour];
  const avgChange = hourData?.avgChange ?? 0;
  const hourScore = Math.max(0, Math.min(1, 0.5 - 0.25 * Math.max(-2, Math.min(2, avgChange))));

  return 0.5 * dayScore + 0.5 * hourScore;
}

/**
 * 거래량 포맷팅
 */
export function formatVolume(volume: number): string {
  if (volume >= 1_000_000_000) {
    return `${(volume / 1_000_000_000).toFixed(2)}B`;
  } else if (volume >= 1_000_000) {
    return `${(volume / 1_000_000).toFixed(2)}M`;
  } else if (volume >= 1_000) {
    return `${(volume / 1_000).toFixed(2)}K`;
  } else {
    return volume.toFixed(2);
  }
}

/**
 * 펀딩비 표시용 심볼
 */
export function getFundingSymbol(fundingRate: number): string {
  if (fundingRate > 0.01) {
    return '[LONG 수수료]';
  } else if (fundingRate < -0.01) {
    return '[SHORT 수수료]';
  } else {
    return '[중립]';
  }
}

/**
 * VPVR POC 기반 점수 계산 (0-1, 높을수록 Short에 유리)
 * 
 * 판단 기준:
 * 1. 현재가 < POC: 약세, Short에 유리
 * 2. 현재가 > POC: 강세, Short에 불리
 * 3. 차이가 클수록 더 강한 신호
 * 
 * ATR 기반 동적 임계값 적용:
 * - 고변동성 시장: ATR이 크면 더 큰 거리도 정상 범위로 판단
 * - 저변동성 시장: ATR이 작으면 작은 거리도 의미 있게 판단
 * 
 * 신뢰도 조정:
 * - 극단적 변동성(ATR > 5%)에서는 신호 신뢰도 감소
 * - 안정적 시장(ATR < 3%)에서는 신호 신뢰도 유지
 * 
 * @param currentPrice 현재가
 * @param vpvrPOC VPVR POC 데이터
 * @param atr ATR (Average True Range) - 변동성 측정
 * @returns 0-1 점수 (높을수록 Short에 유리)
 */
export function calculateVPVRScore(
  currentPrice: number,
  vpvrPOC: VPVRPOC | null | undefined,
  atr?: number
): number {
  // VPVR POC 데이터가 없으면 중립 점수 반환
  if (!vpvrPOC || !vpvrPOC.poc || isNaN(vpvrPOC.poc) || !isFinite(vpvrPOC.poc)) {
    return 0.5;
  }

  const poc = vpvrPOC.poc;
  const priceDiff = currentPrice - poc;
  const priceDiffPercent = (priceDiff / poc) * 100;
  
  // ATR이 있으면 동적 임계값 사용
  if (atr && atr > 0 && !isNaN(atr) && isFinite(atr)) {
    const atrPercent = (atr / currentPrice) * 100;
    const atrMultiplier = Math.abs(priceDiff) / atr;
    
    // 신뢰도 조정: ATR이 너무 높으면 신뢰도 감소
    let confidence = 1.0;
    if (atrPercent > 5) {
      confidence = 0.7; // 극단적 변동성 - 신뢰도 감소
    } else if (atrPercent > 3) {
      confidence = 0.85; // 높은 변동성 - 신뢰도 약간 감소
    }
    // ATR이 3% 이하면 신뢰도 1.0 유지
    
    // ATR 기반 동적 임계값으로 기본 점수 계산
    let baseScore = 0.5;
    
    if (priceDiff < 0) {
      // 현재가 < POC (Short에 유리)
      if (atrMultiplier >= 1.5) {
        baseScore = 0.9; // ATR × 1.5 이상 차이: 매우 유리
      } else if (atrMultiplier >= 1.0) {
        baseScore = 0.75; // ATR × 1.0 ~ 1.5: 유리
      } else if (atrMultiplier >= 0.5) {
        baseScore = 0.6; // ATR × 0.5 ~ 1.0: 약간 유리
      } else {
        baseScore = 0.5; // ATR × 0.5 미만: 중립
      }
    } else {
      // 현재가 > POC (Short에 불리)
      if (atrMultiplier >= 1.5) {
        baseScore = 0.1; // ATR × 1.5 이상 차이: 매우 불리
      } else if (atrMultiplier >= 1.0) {
        baseScore = 0.25; // ATR × 1.0 ~ 1.5: 불리
      } else if (atrMultiplier >= 0.5) {
        baseScore = 0.4; // ATR × 0.5 ~ 1.0: 약간 불리
      } else {
        baseScore = 0.5; // ATR × 0.5 미만: 중립
      }
    }
    
    // 신뢰도 적용하여 최종 점수 반환
    return baseScore * confidence;
  }
  
  // ATR이 없으면 기존 방식 사용 (고정 퍼센트 기준)
  // 현재가가 POC보다 낮으면 Short에 유리 (약세)
  if (priceDiffPercent < 0) {
    // 차이가 클수록 더 유리
    // -5% 이상 차이: 매우 유리 (0.9)
    // -3% ~ -5%: 유리 (0.75)
    // -1% ~ -3%: 약간 유리 (0.6)
    // -1% 미만: 중립 (0.5)
    if (priceDiffPercent <= -5) {
      return 0.9;
    } else if (priceDiffPercent <= -3) {
      return 0.75;
    } else if (priceDiffPercent <= -1) {
      return 0.6;
    } else {
      return 0.5;
    }
  } 
  // 현재가가 POC보다 높으면 Short에 불리 (강세)
  else {
    // 차이가 클수록 더 불리
    // +5% 이상 차이: 매우 불리 (0.1)
    // +3% ~ +5%: 불리 (0.25)
    // +1% ~ +3%: 약간 불리 (0.4)
    // +1% 미만: 중립 (0.5)
    if (priceDiffPercent >= 5) {
      return 0.1;
    } else if (priceDiffPercent >= 3) {
      return 0.25;
    } else if (priceDiffPercent >= 1) {
      return 0.4;
    } else {
      return 0.5;
    }
  }
}

/**
 * VPVR POC (Volume Profile Visible Range - Point of Control) 계산
 * 화면에 보이는 범위의 캔들 데이터를 기반으로 가격대별 거래량을 분석하여
 * 가장 거래량이 많은 가격대(POC)를 계산합니다.
 * 
 * @param klines 캔들 데이터 배열
 * @param bins 가격대 개수 (기본값: 50)
 * @returns VPVRPOC 객체 (POC 가격, Value Area 등)
 */
export function calculateVPVRPOC(klines: Kline[], bins: number = 50): VPVRPOC | null {
  if (!klines || klines.length === 0) {
    return null;
  }

  // 가격 범위 계산
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  let totalVolume = 0;

  for (const kline of klines) {
    const high = parseFloat(kline[2]);
    const low = parseFloat(kline[3]);
    const volume = parseFloat(kline[5]);

    if (isNaN(high) || isNaN(low) || isNaN(volume)) continue;

    minPrice = Math.min(minPrice, low);
    maxPrice = Math.max(maxPrice, high);
    totalVolume += volume;
  }

  if (minPrice >= maxPrice || totalVolume === 0) {
    return null;
  }

  // 가격대(bin) 크기 계산
  const priceRange = maxPrice - minPrice;
  const binSize = priceRange / bins;

  // 각 가격대별 거래량 집계
  const volumeProfile: Array<{ price: number; volume: number }> = [];

  for (let i = 0; i < bins; i++) {
    const binLow = minPrice + (i * binSize);
    const binHigh = minPrice + ((i + 1) * binSize);
    const binPrice = (binLow + binHigh) / 2; // 가격대 중간값
    let binVolume = 0;

    // 각 캔들의 거래량을 가격대에 분배
    for (const kline of klines) {
      const high = parseFloat(kline[2]);
      const low = parseFloat(kline[3]);
      const volume = parseFloat(kline[5]);

      if (isNaN(high) || isNaN(low) || isNaN(volume)) continue;

      // 캔들이 이 가격대와 겹치는지 확인
      if (high >= binLow && low <= binHigh) {
        // 겹치는 비율 계산
        const overlapLow = Math.max(low, binLow);
        const overlapHigh = Math.min(high, binHigh);
        const overlapRange = overlapHigh - overlapLow;
        const candleRange = high - low;

        if (candleRange > 0) {
          // 거래량을 겹치는 비율만큼 분배
          const volumeRatio = overlapRange / candleRange;
          binVolume += volume * volumeRatio;
        } else {
          // 캔들 범위가 0인 경우 (high === low)
          if (low >= binLow && low <= binHigh) {
            binVolume += volume;
          }
        }
      }
    }

    volumeProfile.push({
      price: binPrice,
      volume: binVolume,
    });
  }

  // POC (Point of Control) 찾기 - 가장 거래량이 많은 가격대
  let maxVolume = 0;
  let poc = 0;

  for (const bin of volumeProfile) {
    if (bin.volume > maxVolume) {
      maxVolume = bin.volume;
      poc = bin.price;
    }
  }

  // Value Area 계산 (상위 70% 거래량이 포함된 가격 범위)
  // 거래량을 내림차순으로 정렬
  const sortedProfile = [...volumeProfile].sort((a, b) => b.volume - a.volume);
  const targetVolume = totalVolume * 0.7; // 70% 거래량
  let accumulatedVolume = 0;
  const valueAreaPrices: number[] = [];

  for (const bin of sortedProfile) {
    accumulatedVolume += bin.volume;
    valueAreaPrices.push(bin.price);
    if (accumulatedVolume >= targetVolume) {
      break;
    }
  }

  const valueAreaHigh = Math.max(...valueAreaPrices);
  const valueAreaLow = Math.min(...valueAreaPrices);

  return {
    poc,
    value_area_high: valueAreaHigh,
    value_area_low: valueAreaLow,
    total_volume: totalVolume,
  };
}
