import type { Kline } from '../types';

/**
 * 요일별 가격 변화량 분석 결과
 */
export type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface WeeklyPattern {
  monday: DayPattern;
  tuesday: DayPattern;
  wednesday: DayPattern;
  thursday: DayPattern;
  friday: DayPattern;
  saturday: DayPattern;
  sunday: DayPattern;
  bestDay: string; // 가장 하락이 많은 요일 (Short에 유리)
  worstDay: string; // 가장 상승이 많은 요일 (Short에 불리)
}

export interface DayPattern {
  day: string;
  positiveCount: number; // 상승한 횟수
  negativeCount: number; // 하락한 횟수
  totalCount: number; // 전체 횟수
  winRate: number; // 하락 확률 (Short에 유리할 확률)
  maxChange: number; // 최대 변화량
  minChange: number; // 최소 변화량
  avgAtrPct: number; // 해당 요일 평균 ATR(14) % (종가 대비)
}

/**
 * 일봉 데이터에서 요일별 패턴 분석 (한국시간 기준)
 */
export function analyzeWeeklyPattern(klines: Kline[]): WeeklyPattern | null {
  if (!klines || klines.length < 7) {
    return null;
  }

  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

  // 요일별로 데이터 그룹화 (종가→종가 변화율)
  const dayGroups: Record<number, number[]> = {
    0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [],
  };
  // 요일별 ATR(14)% 수집
  const dayGroupsAtr: Record<number, number[]> = {
    0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [],
  };

  // True Range: max(고-저, |고-전종가|, |저-전종가|)
  const TR: number[] = [0];
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i][2]);
    const low = parseFloat(klines[i][3]);
    const prevClose = parseFloat(klines[i - 1][4]);
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    TR.push(tr);
  }

  const period = 14;
  const atrPct: number[] = new Array(klines.length).fill(0);
  let atr = 0;
  for (let i = 1; i <= period && i < TR.length; i++) atr += TR[i];
  atr /= period;
  for (let i = period; i < klines.length; i++) {
    if (i > period) atr = (atr * (period - 1) + TR[i]) / period;
    const close = parseFloat(klines[i][4]);
    atrPct[i] = close > 0 ? (atr / close) * 100 : 0;
  }

  // 각 봉의 종가→종가 변화율 및 ATR% 요일별 수집 (한국시간 9:00 기준)
  for (let i = 1; i < klines.length; i++) {
    const prevClose = parseFloat(klines[i - 1][4]);
    const currentClose = parseFloat(klines[i][4]);
    const change = ((currentClose - prevClose) / prevClose) * 100;

    const openTime = Math.floor(klines[i][0] / 1000);
    const kstTime = openTime + 9 * 60 * 60;
    const kstDate = new Date(kstTime * 1000);
    const dayOfWeek = kstDate.getUTCDay(); // 한국시간 기준 요일 (0=일..6=토)

    dayGroups[dayOfWeek].push(change);
    if (i >= period && atrPct[i] > 0) {
      dayGroupsAtr[dayOfWeek].push(atrPct[i]);
    }
  }

  const patterns: Record<string, DayPattern> = {};

  for (let day = 0; day < 7; day++) {
    const changes = dayGroups[day];
    const atrs = dayGroupsAtr[day];
    const avgAtrPct = atrs.length > 0
      ? atrs.reduce((a, b) => a + b, 0) / atrs.length
      : 0;

    if (changes.length === 0) {
      patterns[dayNames[day]] = {
        day: dayNames[day],
        positiveCount: 0,
        negativeCount: 0,
        totalCount: 0,
        winRate: 0.5,
        maxChange: 0,
        minChange: 0,
        avgAtrPct,
      };
      continue;
    }

    const positiveCount = changes.filter(c => c > 0).length;
    const negativeCount = changes.filter(c => c < 0).length;
    const totalCount = changes.length;
    const winRate = negativeCount / totalCount;
    const maxChange = Math.max(...changes);
    const minChange = Math.min(...changes);

    patterns[dayNames[day]] = {
      day: dayNames[day],
      positiveCount,
      negativeCount,
      totalCount,
      winRate,
      maxChange,
      minChange,
      avgAtrPct,
    };
  }

  // 가장 하락이 많은 요일 (Short에 유리)
  const bestDay = Object.entries(patterns)
    .filter(([_, p]) => p.totalCount > 0)
    .sort(([_, a], [__, b]) => b.winRate - a.winRate)[0]?.[0] || '없음';

  // 가장 상승이 많은 요일 (Short에 불리)
  const worstDay = Object.entries(patterns)
    .filter(([_, p]) => p.totalCount > 0)
    .sort(([_, a], [__, b]) => a.winRate - b.winRate)[0]?.[0] || '없음';

  return {
    monday: patterns['월요일'],
    tuesday: patterns['화요일'],
    wednesday: patterns['수요일'],
    thursday: patterns['목요일'],
    friday: patterns['금요일'],
    saturday: patterns['토요일'],
    sunday: patterns['일요일'],
    bestDay,
    worstDay,
  };
}

/**
 * 여러 코인의 요일별 패턴을 종합하여 전체 시장 패턴 분석
 */
export function analyzeMarketWeeklyPattern(
  symbolPatterns: Array<{ symbol: string; pattern: WeeklyPattern | null }>
): WeeklyPattern | null {
  const validPatterns = symbolPatterns.filter(p => p.pattern !== null);
  
  if (validPatterns.length === 0) {
    return null;
  }

  const dayNames = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
  const dayKeys: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  const aggregatedPatterns: Record<string, DayPattern> = {};

  for (let i = 0; i < dayNames.length; i++) {
    const dayName = dayNames[i];
    const dayKey = dayKeys[i];

    const dayData = validPatterns
      .map(p => p.pattern![dayKey])
      .filter(d => d.totalCount > 0);

    if (dayData.length === 0) {
      aggregatedPatterns[dayName] = {
        day: dayName,
        positiveCount: 0,
        negativeCount: 0,
        totalCount: 0,
        winRate: 0.5,
        maxChange: 0,
        minChange: 0,
        avgAtrPct: 0,
      };
      continue;
    }

    const totalPositive = dayData.reduce((sum, d) => sum + d.positiveCount, 0);
    const totalNegative = dayData.reduce((sum, d) => sum + d.negativeCount, 0);
    const totalCount = totalPositive + totalNegative;
    const winRate = totalCount > 0 ? totalNegative / totalCount : 0.5;
    const maxChange = Math.max(...dayData.map(d => d.maxChange));
    const minChange = Math.min(...dayData.map(d => d.minChange));
    const avgAtrPct = dayData.reduce((sum, d) => sum + d.avgAtrPct, 0) / dayData.length;

    aggregatedPatterns[dayName] = {
      day: dayName,
      positiveCount: totalPositive,
      negativeCount: totalNegative,
      totalCount,
      winRate,
      maxChange,
      minChange,
      avgAtrPct,
    };
  }

  // 가장 하락이 많은 요일
  const bestDay = Object.entries(aggregatedPatterns)
    .filter(([_, p]) => p.totalCount > 0)
    .sort(([_, a], [__, b]) => b.winRate - a.winRate)[0]?.[0] || '없음';

  // 가장 상승이 많은 요일
  const worstDay = Object.entries(aggregatedPatterns)
    .filter(([_, p]) => p.totalCount > 0)
    .sort(([_, a], [__, b]) => a.winRate - b.winRate)[0]?.[0] || '없음';

  return {
    monday: aggregatedPatterns['월요일'],
    tuesday: aggregatedPatterns['화요일'],
    wednesday: aggregatedPatterns['수요일'],
    thursday: aggregatedPatterns['목요일'],
    friday: aggregatedPatterns['금요일'],
    saturday: aggregatedPatterns['토요일'],
    sunday: aggregatedPatterns['일요일'],
    bestDay,
    worstDay,
  };
}
