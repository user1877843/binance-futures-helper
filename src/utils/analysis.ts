import type { Kline, TrendAnalysis, SupportResistance, StopLossInfo, Ticker, DivergenceAnalysis, ADXResult } from '../types';
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
 * RSI 배열 계산 (전체 기간)
 * 암호화폐 최적화: 기본 period를 9로 변경
 */
export function calculateRSIArray(prices: number[], period: number = 9): number[] {
  if (prices.length < period + 1) {
    return prices.map(() => 50.0);
  }
  
  const rsiArray: number[] = [];
  const deltas = prices.slice(1).map((price, i) => price - prices[i]);
  const gains = deltas.map(d => d > 0 ? d : 0);
  const losses = deltas.map(d => d < 0 ? -d : 0);
  
  // 초기 period개는 계산 불가하므로 중립값
  for (let i = 0; i < period; i++) {
    rsiArray.push(50.0);
  }
  
  // 나머지 기간에 대해 RSI 계산
  for (let i = period; i < prices.length; i++) {
    const periodGains = gains.slice(i - period, i);
    const periodLosses = losses.slice(i - period, i);
    
    const avgGain = periodGains.reduce((a, b) => a + b, 0) / period;
    const avgLoss = periodLosses.reduce((a, b) => a + b, 0) / period;
    
    if (avgLoss === 0) {
      rsiArray.push(100.0);
    } else {
      const rs = avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      rsiArray.push(rsi);
    }
  }
  
  return rsiArray;
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
      current_price: 0,
      short_term_resistance: 0,
      short_term_support: 0
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
  
  // 단기 지지선/저항선 계산 (최근 5-10개 봉 기준)
  const shortTermPeriod = Math.min(10, klines.length);
  const shortTermKlines = klines.slice(-shortTermPeriod);
  const shortTermHighs = shortTermKlines.map(k => parseFloat(k[2]));
  const shortTermLows = shortTermKlines.map(k => parseFloat(k[3]));
  
  // 단기 저항선: 최근 고가의 최대값
  const shortTermResistance = Math.max(...shortTermHighs);
  
  // 단기 지지선: 최근 저가의 최소값
  const shortTermSupport = Math.min(...shortTermLows);

  return {
    resistance,
    support,
    pivot,
    resistance_strength: resistanceStrength,
    support_strength: supportStrength,
    current_price: currentPrice,
    short_term_resistance: shortTermResistance,
    short_term_support: shortTermSupport
  };
}

/**
 * 손절가와 목표가 계산
 */
export function calculateStopLoss(
  supportResistance: SupportResistance,
  positionType: 'short' | 'long' = 'short',
  riskPercent: number = 2.0
): StopLossInfo {
  const { current_price, resistance, support } = supportResistance;
  
  let stopLoss: number;
  let targetPrice: number;
  let risk: number;
  let reward: number;
  
  if (positionType === 'short') {
    // Short 포지션: 저항선 위에 손절가 설정
    stopLoss = resistance * (1 + riskPercent / 100);
    
    // 목표가: 지지선 근처
    targetPrice = support * 1.01; // 지지선 약간 위
    
    // 리스크/리워드 비율 계산
    risk = stopLoss - current_price;
    reward = current_price - targetPrice;
  } else {
    // Long 포지션 (참고용)
    stopLoss = support * (1 - riskPercent / 100);
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
 * 하락 다이버전스 분석
 * 가격은 상승하지만 RSI는 하락하는 패턴 감지 (Short에 유리)
 */
export function analyzeDivergence(klines: Kline[], rsiValues: number[]): DivergenceAnalysis {
  if (!klines || klines.length < 30 || !rsiValues || rsiValues.length < 30) {
    return {
      has_divergence: false,
      divergence_type: 'none',
      strength: 0,
      description: '데이터 부족',
      divergence_score: 0.5
    };
  }

  const highs = klines.map(k => parseFloat(k[2]));
  
  // 최근 50개 봉에서 고점 찾기 (피크 감지)
  const lookbackPeriod = Math.min(50, klines.length);
  const recentHighs = highs.slice(-lookbackPeriod);
  const recentRSI = rsiValues.slice(-lookbackPeriod);

  // 고점 찾기 (주변 3개 봉보다 높은 지점)
  const peaks: Array<{ index: number; price: number; rsi: number }> = [];
  
  for (let i = 2; i < recentHighs.length - 2; i++) {
    const isPeak = 
      recentHighs[i] > recentHighs[i - 1] &&
      recentHighs[i] > recentHighs[i - 2] &&
      recentHighs[i] > recentHighs[i + 1] &&
      recentHighs[i] > recentHighs[i + 2];
    
    if (isPeak) {
      const actualIndex = klines.length - lookbackPeriod + i;
      peaks.push({
        index: actualIndex,
        price: recentHighs[i],
        rsi: recentRSI[i]
      });
    }
  }

  // 최소 2개의 고점이 있어야 다이버전스 판단 가능
  if (peaks.length < 2) {
    return {
      has_divergence: false,
      divergence_type: 'none',
      strength: 0,
      description: '고점 부족',
      divergence_score: 0.5
    };
  }

  // 고점에 시간 정보 추가
  const peaksWithTime: Array<{ time: number; price: number; rsi: number }> = peaks.map(peak => {
    const kline = klines[peak.index];
    return {
      time: Math.floor(kline[0] / 1000), // 밀리초를 초로 변환
      price: peak.price,
      rsi: peak.rsi
    };
  });

  // 최근 2개 고점 비교
  const lastPeak = peaks[peaks.length - 1];
  const prevPeak = peaks[peaks.length - 2];

  const priceChange = ((lastPeak.price - prevPeak.price) / prevPeak.price) * 100;
  const rsiChange = lastPeak.rsi - prevPeak.rsi;

  // 하락 다이버전스: 가격은 상승하지만 RSI는 하락
  if (priceChange > 1 && rsiChange < -2) {
    const strength = Math.min(Math.abs(rsiChange) / 10, 1.0); // RSI 차이가 클수록 강도 높음
    return {
      has_divergence: true,
      divergence_type: 'bearish',
      strength: strength,
      description: `하락 다이버전스 감지 (가격 +${priceChange.toFixed(2)}%, RSI ${rsiChange.toFixed(1)})`,
      divergence_score: 0.5 + (strength * 0.4), // 0.5 ~ 0.9
      peaks: peaksWithTime.slice(-2) // 최근 2개 고점만 반환
    };
  }

  // 상승 다이버전스: 가격은 하락하지만 RSI는 상승 (Short에 불리)
  if (priceChange < -1 && rsiChange > 2) {
    const strength = Math.min(rsiChange / 10, 1.0);
    return {
      has_divergence: true,
      divergence_type: 'bullish',
      strength: strength,
      description: `상승 다이버전스 감지 (가격 ${priceChange.toFixed(2)}%, RSI +${rsiChange.toFixed(1)})`,
      divergence_score: 0.5 - (strength * 0.3), // 0.2 ~ 0.5
      peaks: peaksWithTime.slice(-2) // 최근 2개 고점만 반환
    };
  }

  // 다이버전스 없음 - 일치(Convergence) 고점 반환
  return {
    has_divergence: false,
    divergence_type: 'none',
    strength: 0,
    description: '일치(Convergence) - 다이버전스 없음',
    divergence_score: 0.5,
    convergence_peaks: peaksWithTime.slice(-2) // 일치 고점 정보 반환 (차트 표시용)
  };
}

/**
 * 펀딩 주기 계산 (시간 단위)
 * nextFundingTime을 기반으로 펀딩 주기를 계산합니다.
 * 대부분의 코인은 8시간 주기이지만, 일부는 4시간 주기를 가질 수 있습니다.
 * 
 * Binance의 펀딩 주기:
 * - 대부분의 코인: 8시간 (00:00, 08:00, 16:00 UTC)
 * - 일부 코인: 4시간 또는 다른 주기
 * 
 * nextFundingTime에서 현재 시간을 빼면 다음 펀딩까지 남은 시간을 알 수 있습니다.
 * 이 시간을 기반으로 펀딩 주기를 추정합니다.
 */
export function calculateFundingPeriod(nextFundingTime: number): number {
  if (!nextFundingTime) {
    return 8; // 기본값: 8시간
  }
  
  const now = Date.now();
  const timeUntilNext = nextFundingTime - now;
  
  // 다음 펀딩까지 남은 시간이 0-4시간 사이면 4시간 주기로 간주
  // 4시간 이상이면 8시간 주기로 간주 (일반적인 경우)
  // 정확한 주기를 알기 위해서는 이전 펀딩 시간도 필요하지만,
  // API에서 제공하지 않으므로 추정값을 사용합니다.
  const hoursUntilNext = timeUntilNext / (60 * 60 * 1000);
  
  if (hoursUntilNext > 0 && hoursUntilNext <= 4) {
    return 4;
  } else {
    // 8시간 주기가 일반적이지만, 정확한 주기를 모르므로
    // lastFundingRate가 주어진 경우, 일반적으로 8시간 주기를 가정합니다.
    return 8;
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
  nextFundingTime: number
): number {
  if (!lastFundingRate) {
    return 0;
  }
  
  const fundingPeriod = calculateFundingPeriod(nextFundingTime);
  // 시간당 펀딩비 = 펀딩비 / 펀딩 주기
  return lastFundingRate / fundingPeriod;
}

/**
 * Short 적합도 종합 점수 계산
 */
export function calculateShortScore(
  symbol: string,
  ticker: Ticker,
  fundingDict: Record<string, { lastFundingRate: number; nextFundingTime: number }>,
  klines: Kline[],
  rsi: number,
  divergenceAnalysis?: DivergenceAnalysis,
  adxResult?: ADXResult,
  atr?: number
): number {
  // 펀딩비 점수 (0-1, 높을수록 좋음)
  // 시간당 펀딩비를 기준으로 계산하여 펀딩 주기와 무관하게 동일한 펀딩비는 동일한 점수를 받도록 함
  const fundingInfo = fundingDict[symbol] || { lastFundingRate: 0, nextFundingTime: 0 };
  const hourlyFundingRate = calculateHourlyFundingRate(
    fundingInfo.lastFundingRate,
    fundingInfo.nextFundingTime
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
  
  // 다이버전스 점수 (0-1, 하락 다이버전스일수록 높음)
  // ADX 필터 적용: ADX > 25일 때만 신뢰 (강한 트렌드에서만 다이버전스 신호 사용)
  let divergenceScore = divergenceAnalysis?.divergence_score ?? 0.5;
  if (adxResult && adxResult.adx < 25) {
    // 약한 트렌드에서는 다이버전스 신뢰도 감소
    divergenceScore = divergenceScore * 0.6;
  }
  
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
  
  // ATR 리스크 점수 (0-1, 변동성이 적을수록 높음 - 리스크 관리 관점)
  // 변동성이 너무 높으면 리스크가 크므로 점수 감소
  let atrScore = 0.5;
  if (atr && klines.length > 0) {
    const currentPrice = parseFloat(klines[klines.length - 1][4]);
    const atrPercent = (atr / currentPrice) * 100;
    // ATR이 현재가의 2% 이하면 좋음, 5% 이상이면 리스크 큼
    if (atrPercent <= 2) {
      atrScore = 1.0;
    } else if (atrPercent <= 3) {
      atrScore = 0.8;
    } else if (atrPercent <= 4) {
      atrScore = 0.6;
    } else if (atrPercent <= 5) {
      atrScore = 0.4;
    } else {
      atrScore = 0.2; // 변동성 너무 높음
    }
  }
  
  // 가중 평균 계산 (가격 변동률 제거, 비중 재조정)
  // 가격 변동률(8%) 제거: ADX와 중복되므로 ADX가 더 정교함
  // 타이밍 25%를 위해 base 점수 비중을 75%로 조정: ADX 트렌드: 18%, RSI: 18%, 펀딩비: 17%, 다이버전스: 8%, 거래량: 7%, ATR: 7%
  const totalScore = (
    adxScore * 0.18 +
    rsiScore * 0.18 +
    fundingScore * 0.17 +
    divergenceScore * 0.08 +
    volumeScore * 0.07 +
    atrScore * 0.07
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
