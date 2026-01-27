// 타입 정의
export interface Ticker {
  symbol: string;
  priceChangePercent: string;
  quoteVolume: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  count: string;
}

export interface FundingInfo {
  lastFundingRate: number;
  nextFundingTime: number;
  fundingIntervalHours?: number; // 펀딩 주기 (시간)
}

export interface Kline {
  0: number; // Open time
  1: string; // Open
  2: string; // High
  3: string; // Low
  4: string; // Close
  5: string; // Volume
  6: number; // Close time
  7: string; // Quote asset volume
  8: number; // Number of trades
  9: string; // Taker buy base asset volume
  10: string; // Taker buy quote asset volume
  11: string; // Ignore
}

export interface TrendAnalysis {
  price_change: number;
  volatility: number;
  trend: string;
  trend_score: number;
}

export interface DivergencePeak {
  time: number; // UTC timestamp in seconds
  price: number;
  rsi: number;
}

export interface DivergenceAnalysis {
  has_divergence: boolean;
  divergence_type: 'bearish' | 'bullish' | 'none';
  strength: number; // 0-1, 다이버전스 강도
  description: string;
  divergence_score: number; // 0-1, Short에 유리할수록 높음
  peaks?: DivergencePeak[]; // 다이버전스 관련 고점들
  peaks_5m?: DivergencePeak[]; // 5분봉 기준 다이버전스 고점들 (하락 다이버전스만)
  convergence_peaks?: DivergencePeak[]; // 일치(Convergence) 고점들 - 다이버전스가 아닌 경우
}

export interface SupportResistance {
  resistance: number;
  support: number;
  pivot: number;
  resistance_strength: number;
  support_strength: number;
  current_price: number;
  short_term_resistance: number; // 단기 저항선
  short_term_support: number; // 단기 지지선
}

export interface StopLossInfo {
  stop_loss: number;
  target_price: number;
  risk_reward_ratio: number;
  risk_percent: number;
  reward_percent: number;
}

export interface ADXResult {
  adx: number; // 트렌드 강도 (0-100)
  plusDI: number; // +DI (상승 방향 지표)
  minusDI: number; // -DI (하락 방향 지표)
  trend_strength: 'strong' | 'moderate' | 'weak'; // 트렌드 강도 분류
  trend_direction: 'up' | 'down' | 'neutral'; // 트렌드 방향
}

export interface CoinScore {
  symbol: string;
  ticker: Ticker;
  short_score: number;
  rsi: number;
  funding_rate: number;
  hourly_funding_rate: number; // 시간당 펀딩비 (%)
  funding_period: number; // 펀딩 주기 (시간)
  adx: ADXResult; // ADX 트렌드 분석
  atr: number; // ATR (변동성)
  trend_analysis: TrendAnalysis;
  support_resistance: SupportResistance;
  stop_loss_info: StopLossInfo;
  divergence_analysis: DivergenceAnalysis;
  ma50Data?: Array<{ time: number; value: number }>; // MA50 이동평균선 데이터
  ma200Data?: Array<{ time: number; value: number }>; // MA200 이동평균선 데이터
}

export interface TopGainer {
  symbol: string;
  priceChangePercent: number;
  quoteVolume: number;
  lastPrice: number;
  highPrice: number;
  lowPrice: number;
  count: number;
  fundingRate: number;
  fundingSymbol: string;
  nextFundingTime: number;
  fundingPeriod: number;
}

// EconomicEvent 타입 제거됨 - iframe으로 대체
