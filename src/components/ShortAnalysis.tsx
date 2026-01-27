import { useState, useEffect } from 'react';
import { getTradingSymbols, getTicker24hr, getFundingRates, getCandlestickData } from '../utils/api';
import {
  calculateRSI,
  calculateShortScore,
  computeTimingScore,
  dayHourDataIndex,
  analyzeChartTrend,
  calculateSupportResistance,
  calculateStopLoss,
  formatVolume,
  getFundingSymbol,
  calculateHourlyFundingRate,
  calculateFundingPeriod,
  calculateADX,
  calculateATR,
  calculateMAWithTime,
  calculateVWMAWithTime,
  calculateVPVRPOC,
  calculateVPVRScore
} from '../utils/analysis';
import type { VPVRPOC } from '../types';
import { analyzeWeeklyPattern, analyzeMarketWeeklyPattern, type WeeklyPattern, type DayKey } from '../utils/weeklyPattern';
import { analyzeDayHourPattern, analyzeMarketDayHourPattern, type DayHourPattern } from '../utils/hourlyPattern';
import type { CoinScore } from '../types';
import { CustomChart } from './CustomChart';
import { DayHourHeatmap } from './DayHourHeatmap';
import './ShortAnalysis.css';

interface ShortAnalysisProps {
  maxCoins?: number;
}

/**
 * VPVR POC 정보를 계산하는 헬퍼 함수
 */
function getVPVRInfo(
  currentPrice: number,
  vpvrPOC: VPVRPOC | null | undefined,
  atr?: number
): {
  position: string; // "POC 위" / "POC 아래" / "POC 근처"
  distance: string; // "-3.2%" 또는 "+2.5%"
  signal: string; // "매우 유리" / "유리" / "약간 유리" / "중립" / "약간 불리" / "불리" / "매우 불리"
  score: number; // 0-100
  atrMultiplier: string; // "1.2x ATR" 또는 "-"
  confidence: string; // "높음" / "보통" / "낮음"
  positionClass: string; // CSS 클래스용
  signalClass: string; // CSS 클래스용
} {
  if (!vpvrPOC || !vpvrPOC.poc) {
    return {
      position: '-',
      distance: '-',
      signal: '데이터 없음',
      score: 50,
      atrMultiplier: '-',
      confidence: '-',
      positionClass: '',
      signalClass: ''
    };
  }

  const poc = vpvrPOC.poc;
  const priceDiff = currentPrice - poc;
  const priceDiffPercent = (priceDiff / poc) * 100;
  const absPriceDiffPercent = Math.abs(priceDiffPercent);

  // 현재가 vs POC 위치
  let position: string;
  let distance: string;
  let positionClass: string;

  if (absPriceDiffPercent < 0.5) {
    position = 'POC 근처';
    distance = `${priceDiffPercent >= 0 ? '+' : ''}${priceDiffPercent.toFixed(2)}%`;
    positionClass = '';
  } else if (priceDiff < 0) {
    position = 'POC 아래';
    distance = `${priceDiffPercent.toFixed(2)}%`;
    positionClass = '';
  } else {
    position = 'POC 위';
    distance = `+${priceDiffPercent.toFixed(2)}%`;
    positionClass = '';
  }

  // ATR 배수 계산
  let atrMultiplier = '-';
  if (atr && atr > 0) {
    const multiplier = Math.abs(priceDiff) / atr;
    atrMultiplier = `${multiplier.toFixed(2)}x ATR`;
  }

  // 신뢰도 계산
  let confidence = '높음';
  if (atr && atr > 0) {
    const atrPercent = (atr / currentPrice) * 100;
    if (atrPercent > 5) {
      confidence = '낮음';
    } else if (atrPercent > 3) {
      confidence = '보통';
    }
  }

  // VPVR 점수 계산
  const score = calculateVPVRScore(currentPrice, vpvrPOC, atr) * 100;

  // VPVR 신호 판단
  let signal: string;
  let signalClass: string;

  if (score >= 85) {
    signal = '매우 유리';
    signalClass = '';
  } else if (score >= 70) {
    signal = '유리';
    signalClass = '';
  } else if (score >= 55) {
    signal = '약간 유리';
    signalClass = '';
  } else if (score >= 45) {
    signal = '중립';
    signalClass = '';
  } else if (score >= 30) {
    signal = '약간 불리';
    signalClass = '';
  } else if (score >= 15) {
    signal = '불리';
    signalClass = '';
  } else {
    signal = '매우 불리';
    signalClass = '';
  }

  return {
    position,
    distance,
    signal,
    score,
    atrMultiplier,
    confidence,
    positionClass,
    signalClass
  };
}

export function ShortAnalysis({ maxCoins: initialMaxCoins = 10 }: ShortAnalysisProps) {
  const [maxCoins, setMaxCoins] = useState<number>(initialMaxCoins);
  const [coinScores, setCoinScores] = useState<CoinScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 10 });
  const [expandedChart, setExpandedChart] = useState<string | null>(null);
  const [searchSymbol, setSearchSymbol] = useState('');
  const [searchResult, setSearchResult] = useState<CoinScore | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [filteredSymbols, setFilteredSymbols] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [marketWeeklyPattern, setMarketWeeklyPattern] = useState<WeeklyPattern | null>(null);
  const [marketDayHourPattern, setMarketDayHourPattern] = useState<DayHourPattern | null>(null);
  const [currentTimeFavorable, setCurrentTimeFavorable] = useState<{
    isFavorable: boolean;
    dayWinRate: number;
    hourAvgChange: number;
    message: string;
  } | null>(null);
  const [coinCountInput, setCoinCountInput] = useState<string>(initialMaxCoins.toString());
  const [analysisDays, setAnalysisDays] = useState<number>(60);
  const [analysisDaysInput, setAnalysisDaysInput] = useState<string>('60');
  const [showCoinList, setShowCoinList] = useState<boolean>(false);

  const fetchData = async (coinCount?: number, days?: number) => {
    const targetCount = coinCount ?? maxCoins;
    const targetDays = days ?? analysisDays;
    try {
      setLoading(true);
      setError(null);
      setProgress({ current: 0, total: targetCount });

      const [tradingSymbols, tickers, fundingDict] = await Promise.all([
        getTradingSymbols(),
        getTicker24hr(),
        getFundingRates()
      ]);

      // 거래 가능한 심볼 목록 저장 (자동완성용)
      const symbolsArray = Array.from(tradingSymbols).sort();
      setAvailableSymbols(symbolsArray);

      // 상승률 상위 코인 필터링
      const validTickers = tickers
        .filter(ticker =>
          tradingSymbols.has(ticker.symbol) &&
          parseFloat(ticker.priceChangePercent) > 0
        )
        .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
        .slice(0, targetCount);

      const scores: CoinScore[] = [];

      for (let i = 0; i < validTickers.length; i++) {
        const ticker = validTickers[i];
        setProgress({ current: i + 1, total: validTickers.length });

        try {
          // 1시간봉 500개 가져오기
          const klines = await getCandlestickData(ticker.symbol, '1h', 500);

          if (!klines || klines.length < 14) {
            continue;
          }

          // 종가 추출
          const closes = klines.map(k => parseFloat(k[4]));

          // RSI 계산 (암호화폐 최적화: period 9)
          const rsi = calculateRSI(closes, 9);
          
          // ADX 계산 (트렌드 강도 측정)
          const adxResult = calculateADX(klines, 14);
          
          // ATR 계산 (변동성 측정)
          const atr = calculateATR(klines, 14);

          // 이동평균선 계산
          const ma50Data = calculateMAWithTime(klines, 50);
          const ma200Data = calculateMAWithTime(klines, 200);
          
          // VWMA100 계산 (거래량 가중 이동평균선)
          const vwma100Data = calculateVWMAWithTime(klines, 100);

          // VPVR POC 계산 (화면에 보이는 범위의 거래량 프로파일)
          const vpvrPOC = calculateVPVRPOC(klines, 50);

          // Short 점수 계산 (ADX, ATR, 이동평균선, VWMA100, VPVR POC 추가)
          const shortScore = calculateShortScore(
            ticker.symbol,
            ticker,
            fundingDict,
            klines,
            rsi,
            adxResult,
            atr,
            ma50Data,
            ma200Data,
            vwma100Data,
            vpvrPOC
          );

          // 차트 트렌드 분석
          const trendAnalysis = analyzeChartTrend(klines);

          // 저항선/지지선 계산
          const supportResistance = calculateSupportResistance(klines, 200);

          // 손절가/목표가 계산 (ATR 하이브리드 방식)
          const stopLossInfo = calculateStopLoss(supportResistance, 'short', atr);

          // 펀딩비 정보 계산
          const fundingInfo = fundingDict[ticker.symbol] || { lastFundingRate: 0, nextFundingTime: 0 };
          const fundingRate = fundingInfo.lastFundingRate * 100;
          const fundingPeriod = calculateFundingPeriod(fundingInfo.nextFundingTime, fundingInfo.fundingIntervalHours);
          const hourlyFundingRate = calculateHourlyFundingRate(
            fundingInfo.lastFundingRate,
            fundingInfo.nextFundingTime,
            fundingInfo.fundingIntervalHours
          ) * 100; // 퍼센트로 변환

          scores.push({
            symbol: ticker.symbol,
            ticker,
            short_score: shortScore,
            rsi,
            funding_rate: fundingRate,
            hourly_funding_rate: hourlyFundingRate,
            funding_period: fundingPeriod,
            adx: adxResult,
            atr: atr,
            trend_analysis: trendAnalysis,
            support_resistance: supportResistance,
            stop_loss_info: stopLossInfo,
            ma50Data: ma50Data,
            ma200Data: ma200Data,
            vwma100Data: vwma100Data,
            vpvrPOC: vpvrPOC || undefined
          });
        } catch (err) {
          console.error(`Error processing ${ticker.symbol}:`, err);
        }
      }

      // Short 점수 기준 정렬 (타이밍 반영 전)
      scores.sort((a, b) => b.short_score - a.short_score);

      // 거래량 TOP10 코인 (요일별·요일+시간대별 패턴 분석에서 제외)
      const top10ByVolume = tickers
        .filter(ticker => tradingSymbols.has(ticker.symbol))
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, 10)
        .map(ticker => ticker.symbol);
      const altcoinsForPattern = scores.filter(coin => !top10ByVolume.includes(coin.symbol));

      let marketWeeklyPatternLocal: WeeklyPattern | null = null;
      let marketDayHourPatternLocal: DayHourPattern | null = null;

      // 요일별 패턴 분석 (일봉 데이터 사용)
      try {
        const weeklyPatternPromises = altcoinsForPattern.map(async (coin) => {
          try {
            const dailyKlines = await getCandlestickData(coin.symbol, '1d', targetDays);
            if (dailyKlines && dailyKlines.length >= 7) {
              const pattern = analyzeWeeklyPattern(dailyKlines);
              return { symbol: coin.symbol, pattern };
            }
            return { symbol: coin.symbol, pattern: null };
          } catch (err) {
            console.error(`요일별 패턴 분석 실패 ${coin.symbol}:`, err);
            return { symbol: coin.symbol, pattern: null };
          }
        });

        const weeklyPatterns = await Promise.all(weeklyPatternPromises);
        marketWeeklyPatternLocal = analyzeMarketWeeklyPattern(weeklyPatterns);
        setMarketWeeklyPattern(marketWeeklyPatternLocal);
      } catch (err) {
        console.error('요일별 패턴 분석 실패:', err);
      }

      // 요일+시간대별 패턴 분석 (1시간봉 데이터 사용)
      try {
        const dayHourPatternPromises = altcoinsForPattern.map(async (coin) => {
          try {
            // 설정된 일수만큼 1시간봉 데이터 가져오기 (일수 × 24시간)
            const hourlyKlines = await getCandlestickData(coin.symbol, '1h', targetDays * 24);
            if (hourlyKlines && hourlyKlines.length >= 24) {
              const pattern = analyzeDayHourPattern(hourlyKlines);
              return { symbol: coin.symbol, pattern };
            }
            return { symbol: coin.symbol, pattern: null };
          } catch (err) {
            console.error(`요일+시간대별 패턴 분석 실패 ${coin.symbol}:`, err);
            return { symbol: coin.symbol, pattern: null };
          }
        });

        const dayHourPatterns = await Promise.all(dayHourPatternPromises);
        marketDayHourPatternLocal = analyzeMarketDayHourPattern(dayHourPatterns);
        setMarketDayHourPattern(marketDayHourPatternLocal);

        // 현재 시간이 Short에 유리한지 체크
        if (marketDayHourPatternLocal && marketWeeklyPatternLocal) {
          const now = new Date();
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
          const dayPattern = marketWeeklyPatternLocal[dayKey];
          const dayWinRate = dayPattern?.winRate ?? 0.5;

          const di = dayHourDataIndex(currentDay);
          const hourData = marketDayHourPatternLocal.data[di]?.[currentHour];
          const hourAvgChange = hourData?.avgChange ?? 0;

          const isFavorable = dayWinRate > 0.5 && hourAvgChange < 0;
          const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
          const message = isFavorable
            ? `✅ 현재 시간대(${dayNames[currentDay]} ${currentHour}시)는 Short에 유리합니다 (요일 하락 확률: ${(dayWinRate * 100).toFixed(1)}%, 시간대 평균: ${hourAvgChange.toFixed(2)}%)`
            : `⚠️ 현재 시간대(${dayNames[currentDay]} ${currentHour}시)는 Short에 불리할 수 있습니다 (요일 하락 확률: ${(dayWinRate * 100).toFixed(1)}%, 시간대 평균: ${hourAvgChange.toFixed(2)}%)`;

          setCurrentTimeFavorable({
            isFavorable,
            dayWinRate,
            hourAvgChange,
            message,
          });
        }

        // 점수에 요일별·요일+시간대별 타이밍 반영 (비중 20%)
        const timingScore = computeTimingScore(marketWeeklyPatternLocal, marketDayHourPatternLocal);
        for (const c of scores) {
          const base = c.short_score; // base는 이미 0~80 범위
          c.short_score = Math.min(100, base + 0.20 * (timingScore * 100));
        }
        scores.sort((a, b) => b.short_score - a.short_score);
      } catch (err) {
        console.error('요일+시간대별 패턴 분석 실패:', err);
      }

      setCoinScores([...scores]);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터를 가져오는데 실패했습니다.');
    } finally {
      setLoading(false);
      setProgress({ current: 0, total: 10 });
    }
  };

  const analyzeCoin = async (symbol: string): Promise<CoinScore | null> => {
    try {
      const [tradingSymbols, tickers, fundingDict] = await Promise.all([
        getTradingSymbols(),
        getTicker24hr(),
        getFundingRates()
      ]);

      // 심볼이 거래 가능한지 확인
      if (!tradingSymbols.has(symbol)) {
        throw new Error(`거래 가능한 코인이 아닙니다: ${symbol}`);
      }

      // 티커 데이터 찾기
      const ticker = tickers.find(t => t.symbol === symbol);
      if (!ticker) {
        throw new Error(`티커 데이터를 찾을 수 없습니다: ${symbol}`);
      }

      // 1시간봉 500개 가져오기
      const klines = await getCandlestickData(symbol, '1h', 500);

      if (!klines || klines.length < 14) {
        throw new Error(`충분한 차트 데이터가 없습니다: ${symbol}`);
      }

      // 종가 추출
      const closes = klines.map(k => parseFloat(k[4]));

      // RSI 계산 (암호화폐 최적화: period 9)
      const rsi = calculateRSI(closes, 9);
      
      // ADX 계산 (트렌드 강도 측정)
      const adxResult = calculateADX(klines, 14);
      
      // ATR 계산 (변동성 측정)
      const atr = calculateATR(klines, 14);

      // 이동평균선 계산
      const ma50Data = calculateMAWithTime(klines, 50);
      const ma200Data = calculateMAWithTime(klines, 200);
      
      // VWMA100 계산 (거래량 가중 이동평균선)
      const vwma100Data = calculateVWMAWithTime(klines, 100);

      // VPVR POC 계산 (화면에 보이는 범위의 거래량 프로파일)
      const vpvrPOC = calculateVPVRPOC(klines, 50);

      // Short 점수 계산 (ADX, ATR, 이동평균선, VWMA100, VPVR POC 추가)
      const shortScore = calculateShortScore(
        symbol,
        ticker,
        fundingDict,
        klines,
        rsi,
        adxResult,
        atr,
        ma50Data,
        ma200Data,
        vwma100Data,
        vpvrPOC
      );

      // 차트 트렌드 분석
      const trendAnalysis = analyzeChartTrend(klines);

      // 저항선/지지선 계산
      const supportResistance = calculateSupportResistance(klines, 200);

      // 손절가/목표가 계산 (ATR 하이브리드 방식)
      const stopLossInfo = calculateStopLoss(supportResistance, 'short', atr);

      // 펀딩비 정보 계산
      const fundingInfo = fundingDict[symbol] || { lastFundingRate: 0, nextFundingTime: 0 };
      const fundingRate = fundingInfo.lastFundingRate * 100;
      const fundingPeriod = calculateFundingPeriod(fundingInfo.nextFundingTime, fundingInfo.fundingIntervalHours);
      const hourlyFundingRate = calculateHourlyFundingRate(
        fundingInfo.lastFundingRate,
        fundingInfo.nextFundingTime,
        fundingInfo.fundingIntervalHours
      ) * 100; // 퍼센트로 변환

      return {
        symbol,
        ticker,
        short_score: shortScore,
        rsi,
        funding_rate: fundingRate,
        hourly_funding_rate: hourlyFundingRate,
        funding_period: fundingPeriod,
        adx: adxResult,
        atr: atr,
        trend_analysis: trendAnalysis,
        support_resistance: supportResistance,
        stop_loss_info: stopLossInfo,
        ma50Data: ma50Data,
        ma200Data: ma200Data,
        vwma100Data: vwma100Data,
        vpvrPOC: vpvrPOC || undefined
      };
    } catch (err) {
      throw err;
    }
  };

  const handleSearchInputChange = (value: string) => {
    setSearchSymbol(value);
    setSearchError(null);
    
    if (value.trim().length > 0) {
      const upperValue = value.toUpperCase();
      const filtered = availableSymbols
        .filter(symbol => symbol.includes(upperValue))
        .slice(0, 10); // 최대 10개만 표시
      setFilteredSymbols(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setFilteredSymbols([]);
      setShowSuggestions(false);
    }
  };

  const handleSymbolSelect = (symbol: string) => {
    setSearchSymbol(symbol);
    setShowSuggestions(false);
    setFilteredSymbols([]);
    // 자동으로 검색 실행
    handleSearch(symbol);
  };

  const handleSearch = async (symbolToSearch?: string) => {
    const symbol = (symbolToSearch || searchSymbol).trim().toUpperCase();
    
    if (!symbol) {
      setSearchError('코인 심볼을 입력해주세요.');
      return;
    }

    setSearchLoading(true);
    setSearchError(null);
    setSearchResult(null);
    setShowSuggestions(false);

    try {
      const result = await analyzeCoin(symbol);
      setSearchResult(result);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : '코인 분석에 실패했습니다.');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleApplyCoinCount = () => {
    const coinValue = parseInt(coinCountInput, 10);
    const daysValue = parseInt(analysisDaysInput, 10);
    
    let validCoinCount = maxCoins;
    let validDays = analysisDays;
    
    if (!isNaN(coinValue) && coinValue > 0 && coinValue <= 100) {
      setMaxCoins(coinValue);
      validCoinCount = coinValue;
    }
    
    if (!isNaN(daysValue) && daysValue >= 7 && daysValue <= 365) {
      setAnalysisDays(daysValue);
      validDays = daysValue;
    }
    
    fetchData(validCoinCount, validDays);
  };

  // props가 변경되면 내부 상태도 업데이트
  useEffect(() => {
    setMaxCoins(initialMaxCoins);
    setCoinCountInput(initialMaxCoins.toString());
    setAnalysisDays(60);
    setAnalysisDaysInput('60');
  }, [initialMaxCoins]);

  useEffect(() => {
    fetchData();
  }, []);

  if (loading && coinScores.length === 0) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>바이낸스 선물 시장 데이터 수집 중...</p>
        {progress.total > 0 && (
          <p>
            상위 {maxCoins}개 코인 분석 중... ({progress.current}/{progress.total})
          </p>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <p>오류: {error}</p>
        <button onClick={() => fetchData()}>다시 시도</button>
      </div>
    );
  }

  return (
    <div className="short-analysis">
      <div className="header">
        <h1>Short 적합도 분석 (상위 {maxCoins}개 코인)</h1>
        <div className="daytrader-mode-info">
          <span className="mode-badge">⭐ 데이트레이더 모드</span>
        </div>
        {lastUpdate && (
          <p className="update-time">
            업데이트 시간: {lastUpdate.toLocaleString('ko-KR')}
          </p>
        )}
        <div className="coin-list-section">
          <div className="coin-list-header">
            <strong>분석 중인 코인 목록 ({coinScores.length}/{maxCoins}개)</strong>
          </div>
          <div className="coin-list-settings">
            <div className="coin-list-settings-row">
              <div className="coin-list-settings-top-row">
                <div className="coin-count-field-wrapper">
                  <div className="coin-count-field-row">
                    <div className="coin-count-label-row">
                      <label htmlFor="coin-count-input" className="coin-count-label">
                        분석 코인 개수:
                      </label>
                      <div className="coin-count-input-group">
                        <input
                          id="coin-count-input"
                          type="text"
                          value={coinCountInput}
                          onChange={(e) => {
                            const value = e.target.value;
                            // 숫자만 입력 가능하도록 필터링
                            if (value === '' || /^\d+$/.test(value)) {
                              setCoinCountInput(value);
                            }
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              handleApplyCoinCount();
                            }
                          }}
                          className="coin-count-input"
                          disabled={loading}
                          placeholder="1~100"
                        />
                        <span>개</span>
                      </div>
                      <span className="coin-count-hint-inline">코인 개수: 1~100</span>
                    </div>
                  </div>
                </div>
                <div className="coin-count-field-wrapper">
                  <div className="coin-count-field-row">
                    <div className="coin-count-label-row">
                      <label htmlFor="analysis-days-input" className="coin-count-label">
                        분석 일수:
                      </label>
                      <div className="coin-count-input-group">
                        <input
                          id="analysis-days-input"
                          type="text"
                          value={analysisDaysInput}
                          onChange={(e) => {
                            const value = e.target.value;
                            // 숫자만 입력 가능하도록 필터링
                            if (value === '' || /^\d+$/.test(value)) {
                              setAnalysisDaysInput(value);
                            }
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              handleApplyCoinCount();
                            }
                          }}
                          className="coin-count-input"
                          disabled={loading}
                          placeholder="7~365"
                        />
                        <span>일</span>
                      </div>
                      <span className="coin-count-hint-inline">분석 일수: 7~365</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleApplyCoinCount}
                  className="apply-coin-count-btn"
                  disabled={
                    loading || 
                    !coinCountInput || 
                    parseInt(coinCountInput, 10) < 1 || 
                    parseInt(coinCountInput, 10) > 100 ||
                    !analysisDaysInput ||
                    parseInt(analysisDaysInput, 10) < 7 ||
                    parseInt(analysisDaysInput, 10) > 365
                  }
                >
                  {loading ? '분석 중...' : '분석 시작'}
                </button>
              </div>
            </div>
            {coinScores.length > 0 && (
              <button
                onClick={() => setShowCoinList(!showCoinList)}
                className="toggle-coin-list-btn"
                title={showCoinList ? '코인 목록 숨기기' : '코인 목록 보기'}
              >
                {showCoinList ? '▲ 코인 목록 숨기기' : '▼ 코인 목록 보기'}
              </button>
            )}
          </div>
          {showCoinList && coinScores.length > 0 && (
            <div className="coin-list-content">
              {coinScores.map((coin, idx) => (
                <div key={coin.symbol} className="coin-list-item">
                  <span className="coin-rank-badge">#{idx + 1}</span>
                  <span className="coin-symbol-text">{coin.symbol}</span>
                  <span className="coin-score-text">
                    점수: {coin.short_score.toFixed(2)}
                  </span>
                  <span className={`coin-change-text ${parseFloat(coin.ticker.priceChangePercent) > 0 ? 'positive' : 'negative'}`}>
                    {parseFloat(coin.ticker.priceChangePercent) > 0 ? '+' : ''}
                    {parseFloat(coin.ticker.priceChangePercent).toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          )}
          {coinScores.length === 0 && !loading && (
            <div className="coin-list-empty">
              분석된 코인이 없습니다.
            </div>
          )}
        </div>
      </div>

      <div className="search-section">
        <h3>코인 검색</h3>
        <div className="search-container">
          <div className="search-input-wrapper">
            <input
              type="text"
              value={searchSymbol}
              onChange={(e) => handleSearchInputChange(e.target.value)}
              onKeyPress={handleKeyPress}
              onFocus={() => {
                if (filteredSymbols.length > 0) {
                  setShowSuggestions(true);
                }
              }}
              onBlur={() => {
                // 약간의 지연을 두어 클릭 이벤트가 먼저 실행되도록
                setTimeout(() => setShowSuggestions(false), 200);
              }}
              placeholder="코인 심볼 입력 (예: BTCUSDT)"
              className="search-input"
            />
            {showSuggestions && filteredSymbols.length > 0 && (
              <div className="suggestions-dropdown">
                {filteredSymbols.map((symbol) => (
                  <div
                    key={symbol}
                    className="suggestion-item"
                    onClick={() => handleSymbolSelect(symbol)}
                    onMouseDown={(e) => e.preventDefault()} // onBlur보다 먼저 실행되도록
                  >
                    {symbol}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => handleSearch()}
            disabled={searchLoading || !searchSymbol.trim()}
            className="search-btn"
          >
            {searchLoading ? '분석 중...' : '검색'}
          </button>
        </div>
        {searchError && (
          <div className="search-error">
            {searchError}
          </div>
        )}
      </div>

      {searchResult && (
        <div className="search-result-section">
          <h2>검색 결과: {searchResult.symbol}</h2>
          <div className="coin-score-card search-result-card">
            <div className="coin-score-header">
              <div className="coin-rank">검색</div>
              <div className="coin-symbol">
                <a 
                  href={`https://www.binance.com/en/futures/${searchResult.symbol}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="coin-link"
                  title="바이낸스 선물 거래 페이지에서 보기"
                >
                  {searchResult.symbol}
                </a>
              </div>
              <div className="short-score">
                Short 점수: <strong>{searchResult.short_score.toFixed(2)}/100</strong>
              </div>
              <div className="chart-buttons">
                <button
                  onClick={() => {
                    if (expandedChart === searchResult.symbol) {
                      setExpandedChart(null);
                    } else {
                      setExpandedChart(searchResult.symbol);
                    }
                  }}
                  className="chart-toggle-btn"
                  title="차트 토글"
                >
                  {expandedChart === searchResult.symbol ? '📉 차트 숨기기' : '📈 차트 보기'}
                </button>
                <a
                  href={`https://www.binance.com/en/futures/${searchResult.symbol}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="chart-btn"
                  title="바이낸스에서 보기"
                >
                  🔗 바이낸스
                </a>
              </div>
            </div>

            {expandedChart === searchResult.symbol && (
              <div className="chart-section">
                <CustomChart 
                  symbol={searchResult.symbol} 
                  height={400}
                  supportResistance={searchResult.support_resistance}
                  stopLossInfo={searchResult.stop_loss_info}
                  adxResult={searchResult.adx}
                  ma50Data={searchResult.ma50Data}
                  ma200Data={searchResult.ma200Data}
                  vwma100Data={searchResult.vwma100Data}
                  vpvrPOC={searchResult.vpvrPOC}
                />
              </div>
            )}

            <div className="coin-details">
              <div className="detail-section">
                <h4>기본 정보</h4>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">펀딩비({searchResult.funding_period}h):</span>
                    <span className={`detail-value ${searchResult.funding_rate > 0.01 ? 'long-fee' : searchResult.funding_rate < -0.01 ? 'short-fee' : ''}`}>
                      {searchResult.funding_rate.toFixed(4)}% {getFundingSymbol(searchResult.funding_rate)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">시간당 펀딩비:</span>
                    <span className={`detail-value ${searchResult.hourly_funding_rate > 0.01 ? 'long-fee' : searchResult.hourly_funding_rate < -0.01 ? 'short-fee' : ''}`}>
                      {searchResult.hourly_funding_rate.toFixed(4)}%
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">RSI:</span>
                    <span className={`detail-value ${searchResult.rsi > 75 ? 'overbought' : searchResult.rsi < 25 ? 'oversold' : ''}`}>
                      {searchResult.rsi.toFixed(1)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">ADX (트렌드 강도):</span>
                    <span className={`detail-value ${
                      searchResult.adx.trend_strength === 'strong' ? 'strong-trend' : 
                      searchResult.adx.trend_strength === 'moderate' ? 'moderate-trend' : 'weak-trend'
                    }`}>
                      {searchResult.adx.adx.toFixed(1)} ({searchResult.adx.trend_strength === 'strong' ? '강함' : searchResult.adx.trend_strength === 'moderate' ? '보통' : '약함'}, {searchResult.adx.trend_direction === 'down' ? '하락' : searchResult.adx.trend_direction === 'up' ? '상승' : '중립'})
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">ATR (변동성):</span>
                    <span className="detail-value">
                      ${searchResult.atr.toFixed(4)} ({(searchResult.atr / parseFloat(searchResult.ticker.lastPrice) * 100).toFixed(2)}%)
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">차트 트렌드:</span>
                    <span className="detail-value">
                      {searchResult.trend_analysis.trend} ({searchResult.trend_analysis.price_change > 0 ? '+' : ''}{searchResult.trend_analysis.price_change.toFixed(2)}%)
                    </span>
                  </div>
                  <div className="detail-item">
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">현재가:</span>
                    <span className="detail-value">
                      ${parseFloat(searchResult.ticker.lastPrice).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">24h 변동률:</span>
                    <span className={`detail-value ${parseFloat(searchResult.ticker.priceChangePercent) > 0 ? 'positive' : 'negative'}`}>
                      {parseFloat(searchResult.ticker.priceChangePercent) > 0 ? '+' : ''}{parseFloat(searchResult.ticker.priceChangePercent).toFixed(2)}%
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">거래량:</span>
                    <span className="detail-value">{formatVolume(parseFloat(searchResult.ticker.quoteVolume))} USDT</span>
                  </div>
                  {searchResult.vpvrPOC && (() => {
                    const vpvrInfo = getVPVRInfo(
                      parseFloat(searchResult.ticker.lastPrice),
                      searchResult.vpvrPOC,
                      searchResult.atr
                    );
                    return (
                      <>
                        <div className="detail-item">
                          <span className="detail-label">현재가 vs POC:</span>
                          <span className={`detail-value ${vpvrInfo.positionClass}`}>
                            {vpvrInfo.position} ({vpvrInfo.distance})
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">VPVR 신호:</span>
                          <span className={`detail-value ${vpvrInfo.signalClass}`}>
                            {vpvrInfo.signal}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="detail-section">
                <h4>지지/저항선</h4>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">저항선:</span>
                    <span className="detail-value">
                      ${searchResult.support_resistance.resistance.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">지지선:</span>
                    <span className="detail-value">
                      ${searchResult.support_resistance.support.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="detail-section stop-loss-section">
                <h4>손절선/익절선</h4>
                <div className="stop-loss-grid">
                  <div className="stop-loss-item">
                    <span className="stop-loss-label">손절선</span>
                    <span className="stop-loss-value">
                      ${searchResult.stop_loss_info.stop_loss.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                    </span>
                    <span className="stop-loss-percent">
                      (현재가 대비 {searchResult.stop_loss_info.risk_percent > 0 ? '+' : ''}{searchResult.stop_loss_info.risk_percent.toFixed(2)}%)
                    </span>
                  </div>
                  <div className="stop-loss-item">
                    <span className="stop-loss-label">익절선</span>
                    <span className="stop-loss-value">
                      ${searchResult.stop_loss_info.target_price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                    </span>
                    <span className="stop-loss-percent">
                      (현재가 대비 {searchResult.stop_loss_info.reward_percent > 0 ? '+' : ''}{searchResult.stop_loss_info.reward_percent.toFixed(2)}%)
                    </span>
                  </div>
                  <div className="risk-reward">
                    <span className="risk-reward-label">리스크/리워드 비율:</span>
                    <span className="risk-reward-value">1:{searchResult.stop_loss_info.risk_reward_ratio.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {currentTimeFavorable && (
        <div className={`time-favorable-banner ${currentTimeFavorable.isFavorable ? 'favorable' : 'unfavorable'}`}>
          <div className="banner-content">
            <span className="banner-icon">{currentTimeFavorable.isFavorable ? '✅' : '⚠️'}</span>
            <span className="banner-message">{currentTimeFavorable.message}</span>
          </div>
        </div>
      )}

      <div className="score-info">
        <h3>점수 계산 기준:</h3>
        <ul>
          <li>요일·시간대 타이밍: 20% (현재 요일·시간대가 Short에 유리할수록 가산)</li>
          <li>펀딩비: 20% (시간당 펀딩비 기준, 높을수록 Short에 유리)</li>
          <li>ADX 트렌드: 18% (하락 트렌드이고 강할수록 유리, 횡보장 필터링)</li>
          <li>이동평균선: 18% (MA50, MA200, VWMA100 통합 - 거래량 가중 이동평균선 포함)</li>
          <li>RSI: 14% (높을수록 과매수, Short에 유리, period 9 최적화)</li>
          <li>VPVR POC: 10% (현재가가 POC보다 낮을수록 Short에 유리)</li>
        </ul>
      </div>

      {marketWeeklyPattern && (
        <div className="weekly-pattern-section">
          <h3>요일별 알트코인 변화량 패턴 (한국시간 기준, 최근 {analysisDays}일 분석)</h3>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
            ※ 거래량 TOP10 코인(BTC, ETH, BNB, XRP 등)은 제외하고 계산됩니다.
          </p>
          <div className="weekly-pattern-summary">
            <div className="pattern-highlight">
              <span className="highlight-label">Short에 가장 유리한 요일:</span>
              <span className="highlight-value best">{marketWeeklyPattern.bestDay}</span>
              <span className="highlight-detail">
                {(() => {
                  const dayMap: Record<string, DayKey> = {
                    '월요일': 'monday',
                    '화요일': 'tuesday',
                    '수요일': 'wednesday',
                    '목요일': 'thursday',
                    '금요일': 'friday',
                    '토요일': 'saturday',
                    '일요일': 'sunday',
                  };
                  const pattern = marketWeeklyPattern[dayMap[marketWeeklyPattern.bestDay] ?? 'monday'];
                  return `(하락 확률: ${((pattern?.winRate ?? 0) * 100).toFixed(1)}%)`;
                })()}
              </span>
            </div>
            <div className="pattern-highlight">
              <span className="highlight-label">Short에 가장 불리한 요일:</span>
              <span className="highlight-value worst">{marketWeeklyPattern.worstDay}</span>
              <span className="highlight-detail">
                {(() => {
                  const dayMap: Record<string, DayKey> = {
                    '월요일': 'monday',
                    '화요일': 'tuesday',
                    '수요일': 'wednesday',
                    '목요일': 'thursday',
                    '금요일': 'friday',
                    '토요일': 'saturday',
                    '일요일': 'sunday',
                  };
                  const pattern = marketWeeklyPattern[dayMap[marketWeeklyPattern.worstDay] ?? 'monday'];
                  return `(하락 확률: ${((pattern?.winRate ?? 0) * 100).toFixed(1)}%)`;
                })()}
              </span>
            </div>
          </div>
          <div className="weekly-pattern-grid">
            {[
              { key: 'monday', label: '월요일', pattern: marketWeeklyPattern.monday },
              { key: 'tuesday', label: '화요일', pattern: marketWeeklyPattern.tuesday },
              { key: 'wednesday', label: '수요일', pattern: marketWeeklyPattern.wednesday },
              { key: 'thursday', label: '목요일', pattern: marketWeeklyPattern.thursday },
              { key: 'friday', label: '금요일', pattern: marketWeeklyPattern.friday },
              { key: 'saturday', label: '토요일', pattern: marketWeeklyPattern.saturday },
              { key: 'sunday', label: '일요일', pattern: marketWeeklyPattern.sunday },
            ].map(({ key, label, pattern }) => {
              // 하락에 유리하면 빨간색, 상승에 유리하면 초록색
              const isFavorableForShort = pattern.winRate > 0.5; // 하락 확률이 50% 초과면 Short 유리
              const colorClass = isFavorableForShort ? 'favorable-short' : 'favorable-long';
              const bestWorstClass = key === marketWeeklyPattern.bestDay.toLowerCase() ? 'best-day' : key === marketWeeklyPattern.worstDay.toLowerCase() ? 'worst-day' : '';
              
              return (
              <div key={key} className={`weekly-pattern-card ${colorClass} ${bestWorstClass}`}>
                <div className="pattern-day">{label}</div>
                <div className="pattern-stats">
                  <div className="stat-item">
                    <span className="stat-label">하락 확률:</span>
                    <span className={`stat-value ${pattern.winRate > 0.5 ? 'good' : 'bad'}`}>
                      {(pattern.winRate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">ATR(14) 평균:</span>
                    <span className="stat-value">
                      {pattern.avgAtrPct > 0 ? pattern.avgAtrPct.toFixed(2) : '-'}%
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">상승/하락:</span>
                    <span className="stat-value">
                      {pattern.positiveCount}회 / {pattern.negativeCount}회
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">변화 범위:</span>
                    <span className="stat-value">
                      {pattern.minChange.toFixed(2)}% ~ {pattern.maxChange.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {marketDayHourPattern && (
        <div className="hourly-pattern-section">
          <h3>요일+시간대별 알트코인 변화량 패턴 (한국시간 9:00 기준, 최근 {analysisDays}일 분석)</h3>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
            ※ 거래량 TOP10 코인(BTC, ETH, BNB, XRP 등)은 제외하고 계산됩니다.
          </p>
          <DayHourHeatmap pattern={marketDayHourPattern} />
        </div>
      )}

      <div className="coin-scores-list">
        {coinScores.map((coin, idx) => {
          const priceChange = parseFloat(coin.ticker.priceChangePercent);
          const quoteVolume = parseFloat(coin.ticker.quoteVolume);
          const lastPrice = parseFloat(coin.ticker.lastPrice);
          const isTop3 = idx < 3; // 상위 3개 강조

          return (
            <div key={coin.symbol} className={`coin-score-card ${isTop3 ? 'top-3-highlight' : ''}`}>
              <div className="coin-score-header">
                <div className="coin-rank">#{idx + 1}</div>
                <div className="coin-symbol">
                  <a 
                    href={`https://www.binance.com/en/futures/${coin.symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="coin-link"
                    title="바이낸스 선물 거래 페이지에서 보기"
                  >
                    {coin.symbol}
                  </a>
                </div>
                <div className="short-score">
                  Short 점수: <strong>{coin.short_score.toFixed(2)}/100</strong>
                </div>
                <div className="chart-buttons">
                  <button
                    onClick={() => {
                      if (expandedChart === coin.symbol) {
                        setExpandedChart(null);
                      } else {
                        setExpandedChart(coin.symbol);
                      }
                    }}
                    className="chart-toggle-btn"
                    title="차트 토글"
                  >
                    {expandedChart === coin.symbol ? '📉 차트 숨기기' : '📈 차트 보기'}
                  </button>
                  <a
                    href={`https://www.binance.com/en/futures/${coin.symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chart-btn"
                    title="바이낸스에서 보기"
                  >
                    🔗 바이낸스
                  </a>
                </div>
              </div>

              {expandedChart === coin.symbol && (
                <div className="chart-section">
                  <CustomChart 
                    symbol={coin.symbol} 
                    height={400}
                    supportResistance={coin.support_resistance}
                    stopLossInfo={coin.stop_loss_info}
                    adxResult={coin.adx}
                    ma50Data={coin.ma50Data}
                    ma200Data={coin.ma200Data}
                    vwma100Data={coin.vwma100Data}
                    vpvrPOC={coin.vpvrPOC}
                  />
                </div>
              )}

              <div className="coin-details">
                <div className="detail-section">
                  <h4>기본 정보</h4>
                  <div className="detail-grid">
                    <div className="detail-item">
                      <span className="detail-label">펀딩비({coin.funding_period}h):</span>
                      <span className={`detail-value ${coin.funding_rate > 0.01 ? 'long-fee' : coin.funding_rate < -0.01 ? 'short-fee' : ''}`}>
                        {coin.funding_rate.toFixed(4)}% {getFundingSymbol(coin.funding_rate)}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">시간당 펀딩비:</span>
                      <span className={`detail-value ${coin.hourly_funding_rate > 0.01 ? 'long-fee' : coin.hourly_funding_rate < -0.01 ? 'short-fee' : ''}`}>
                        {coin.hourly_funding_rate.toFixed(4)}%
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">RSI:</span>
                      <span className={`detail-value ${coin.rsi > 75 ? 'overbought' : coin.rsi < 25 ? 'oversold' : ''}`}>
                        {coin.rsi.toFixed(1)}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">ADX (트렌드 강도):</span>
                      <span className={`detail-value ${
                        coin.adx.trend_strength === 'strong' ? 'strong-trend' : 
                        coin.adx.trend_strength === 'moderate' ? 'moderate-trend' : 'weak-trend'
                      }`}>
                        {coin.adx.adx.toFixed(1)} ({coin.adx.trend_strength === 'strong' ? '강함' : coin.adx.trend_strength === 'moderate' ? '보통' : '약함'}, {coin.adx.trend_direction === 'down' ? '하락' : coin.adx.trend_direction === 'up' ? '상승' : '중립'})
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">ATR (변동성):</span>
                      <span className="detail-value">
                        ${coin.atr.toFixed(4)} ({(coin.atr / lastPrice * 100).toFixed(2)}%)
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">차트 트렌드:</span>
                      <span className="detail-value">
                        {coin.trend_analysis.trend} ({coin.trend_analysis.price_change > 0 ? '+' : ''}{coin.trend_analysis.price_change.toFixed(2)}%)
                      </span>
                    </div>
                    <div className="detail-item">
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">현재가:</span>
                      <span className="detail-value">
                        ${lastPrice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">24h 변동률:</span>
                      <span className={`detail-value ${priceChange > 0 ? 'positive' : 'negative'}`}>
                        {priceChange > 0 ? '+' : ''}{priceChange.toFixed(2)}%
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">거래량:</span>
                      <span className="detail-value">{formatVolume(quoteVolume)} USDT</span>
                    </div>
                    {coin.vpvrPOC && (() => {
                      const vpvrInfo = getVPVRInfo(
                        lastPrice,
                        coin.vpvrPOC,
                        coin.atr
                      );
                      return (
                        <>
                          <div className="detail-item">
                            <span className="detail-label">현재가 vs POC:</span>
                            <span className={`detail-value ${vpvrInfo.positionClass}`}>
                              {vpvrInfo.position} ({vpvrInfo.distance})
                            </span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">VPVR 신호:</span>
                            <span className={`detail-value ${vpvrInfo.signalClass}`}>
                              {vpvrInfo.signal}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="detail-section">
                  <h4>지지/저항선</h4>
                  <div className="detail-grid">
                    <div className="detail-item">
                      <span className="detail-label">저항선:</span>
                      <span className="detail-value">
                        ${coin.support_resistance.resistance.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">지지선:</span>
                      <span className="detail-value">
                        ${coin.support_resistance.support.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="detail-section stop-loss-section">
                  <h4>손절선/익절선</h4>
                  <div className="stop-loss-grid">
                    <div className="stop-loss-item">
                      <span className="stop-loss-label">손절선</span>
                      <span className="stop-loss-value">
                        ${coin.stop_loss_info.stop_loss.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                      </span>
                      <span className="stop-loss-percent">
                        (현재가 대비 {coin.stop_loss_info.risk_percent > 0 ? '+' : ''}{coin.stop_loss_info.risk_percent.toFixed(2)}%)
                      </span>
                    </div>
                    <div className="stop-loss-item">
                      <span className="stop-loss-label">익절선</span>
                      <span className="stop-loss-value">
                        ${coin.stop_loss_info.target_price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                      </span>
                      <span className="stop-loss-percent">
                        (현재가 대비 {coin.stop_loss_info.reward_percent > 0 ? '+' : ''}{coin.stop_loss_info.reward_percent.toFixed(2)}%)
                      </span>
                    </div>
                    <div className="risk-reward">
                      <span className="risk-reward-label">리스크/리워드 비율:</span>
                      <span className="risk-reward-value">1:{coin.stop_loss_info.risk_reward_ratio.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
