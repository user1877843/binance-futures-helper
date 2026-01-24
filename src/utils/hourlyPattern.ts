import type { Kline } from '../types';

/**
 * 시간대별 가격 변화량 분석 결과
 */
export interface HourlyPattern {
  hours: HourPattern[]; // 0시~23시
  bestHour: number; // 가장 하락이 많은 시간대 (Short에 유리)
  worstHour: number; // 가장 상승이 많은 시간대 (Short에 불리)
}

/**
 * 요일+시간대별 가격 변화량 분석 결과 (9:00 기준)
 */
export interface DayHourPattern {
  data: DayHourData[][]; // [요일][시간대] - 월요일부터 시작: [월(1), 화(2), 수(3), 목(4), 금(5), 토(6), 일(0)]
  dayNames: string[]; // ['월', '화', '수', '목', '금', '토', '일']
}

export interface DayHourData {
  dayOfWeek: number; // 0=일, 1=월, ..., 6=토
  hour: number; // 0~23
  avgChange: number; // 9:00 대비 평균 변화량 (%)
  totalCount: number; // 데이터 수
}

export interface HourPattern {
  hour: number; // 0~23
  avgChange: number; // 평균 변화량 (%)
  stdChange: number; // 표준편차 (캔들 몸통 표현용)
  positiveCount: number; // 상승한 횟수
  negativeCount: number; // 하락한 횟수
  totalCount: number; // 전체 횟수
  winRate: number; // 하락 확률 (Short에 유리할 확률)
  maxChange: number; // 최대 변화량
  minChange: number; // 최소 변화량
}

/**
 * 시간봉 데이터에서 시간대별 패턴 분석
 * 한국시간 9:00 시작 가격을 기준(0%)으로 각 시간대별 평균 변화량 계산
 */
export function analyzeHourlyPattern(klines: Kline[]): HourlyPattern | null {
  if (!klines || klines.length < 24) {
    return null;
  }

  // 날짜별로 그룹화 (한국시간 기준)
  const dayGroups: Map<string, Array<{ hour: number; price: number; timestamp: number }>> = new Map();

  // 각 봉을 날짜별로 그룹화하고 한국시간 추출
  for (let i = 0; i < klines.length; i++) {
    const openTime = Math.floor(klines[i][0] / 1000);
    const date = new Date(openTime * 1000);
    const utcHour = date.getUTCHours();
    const kstHour = (utcHour + 9) % 24; // UTC+9 = 한국 시간
    
    // 한국시간 기준 날짜 키 생성 (UTC 시간에 9시간 더한 후 날짜 추출)
    const kstTime = openTime + 9 * 60 * 60; // UTC + 9시간
    const kstDate = new Date(kstTime * 1000);
    const year = kstDate.getUTCFullYear();
    const month = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kstDate.getUTCDate()).padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;
    
    const price = parseFloat(klines[i][4]); // 종가 사용
    
    if (!dayGroups.has(dateKey)) {
      dayGroups.set(dateKey, []);
    }
    dayGroups.get(dateKey)!.push({
      hour: kstHour,
      price,
      timestamp: openTime
    });
  }

  // 시간대별로 9:00 대비 변화량 수집 (0시~23시)
  const hourGroups: Record<number, number[]> = {};
  for (let i = 0; i < 24; i++) {
    hourGroups[i] = [];
  }

  // 각 날의 9:00 가격을 기준으로 다른 시간대 변화량 계산
  for (const [dateKey, dayData] of dayGroups.entries()) {
    // 해당 날의 9:00 가격 찾기
    const nineAM = dayData.find(d => d.hour === 9);
    if (!nineAM) continue; // 9:00 데이터가 없으면 스킵
    
    const basePrice = nineAM.price;
    
    // 해당 날의 모든 시간대를 9:00 대비로 계산 (9:00 제외)
    for (const data of dayData) {
      if (data.hour >= 0 && data.hour <= 23 && data.hour !== 9) {
        const changeFrom9AM = ((data.price - basePrice) / basePrice) * 100;
        hourGroups[data.hour].push(changeFrom9AM);
      }
    }
  }

  // 시간대별 패턴 계산
  const hourPatterns: HourPattern[] = [];

  for (let hour = 0; hour < 24; hour++) {
    // 9:00은 항상 기준점이므로 0%
    if (hour === 9) {
      hourPatterns.push({
        hour: 9,
        avgChange: 0,
        stdChange: 0,
        positiveCount: 0,
        negativeCount: 0,
        totalCount: dayGroups.size,
        winRate: 0.5,
        maxChange: 0,
        minChange: 0,
      });
      continue;
    }

    const changes = hourGroups[hour];
    if (changes.length === 0) {
      hourPatterns.push({
        hour,
        avgChange: 0,
        stdChange: 0,
        positiveCount: 0,
        negativeCount: 0,
        totalCount: 0,
        winRate: 0.5,
        maxChange: 0,
        minChange: 0,
      });
      continue;
    }

    const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
    const variance = changes.reduce((s, c) => s + (c - avgChange) ** 2, 0) / changes.length;
    const stdChange = Math.sqrt(variance);
    const positiveCount = changes.filter(c => c > 0).length;
    const negativeCount = changes.filter(c => c < 0).length;
    const totalCount = changes.length;
    const winRate = totalCount > 0 ? negativeCount / totalCount : 0.5;
    const maxChange = Math.max(...changes);
    const minChange = Math.min(...changes);

    hourPatterns.push({
      hour,
      avgChange,
      stdChange,
      positiveCount,
      negativeCount,
      totalCount,
      winRate,
      maxChange,
      minChange,
    });
  }

  // 가장 하락이 많은 시간대 (평균 변화량이 가장 음수, Short에 유리)
  const bestHour = hourPatterns
    .filter(p => p.totalCount > 0)
    .sort((a, b) => a.avgChange - b.avgChange)[0]?.hour ?? 0;

  // 가장 상승이 많은 시간대 (평균 변화량이 가장 양수, Short에 불리)
  const worstHour = hourPatterns
    .filter(p => p.totalCount > 0)
    .sort((a, b) => b.avgChange - a.avgChange)[0]?.hour ?? 0;

  return {
    hours: hourPatterns,
    bestHour,
    worstHour,
  };
}

/**
 * 여러 코인의 시간대별 패턴을 종합하여 전체 시장 패턴 분석
 */
export function analyzeMarketHourlyPattern(
  symbolPatterns: Array<{ symbol: string; pattern: HourlyPattern | null }>
): HourlyPattern | null {
  const validPatterns = symbolPatterns.filter(p => p.pattern !== null);
  
  if (validPatterns.length === 0) {
    return null;
  }

  const aggregatedHours: HourPattern[] = [];

  for (let hour = 0; hour < 24; hour++) {
    const hourData = validPatterns
      .map(p => p.pattern!.hours[hour])
      .filter(h => h.totalCount > 0);

    if (hourData.length === 0) {
      aggregatedHours.push({
        hour,
        avgChange: 0,
        stdChange: 0,
        positiveCount: 0,
        negativeCount: 0,
        totalCount: 0,
        winRate: 0.5,
        maxChange: 0,
        minChange: 0,
      });
      continue;
    }

    const avgChange = hourData.reduce((sum, h) => sum + h.avgChange, 0) / hourData.length;
    const stdChange = hourData.reduce((sum, h) => sum + h.stdChange, 0) / hourData.length;
    const totalPositive = hourData.reduce((sum, h) => sum + h.positiveCount, 0);
    const totalNegative = hourData.reduce((sum, h) => sum + h.negativeCount, 0);
    const totalCount = totalPositive + totalNegative;
    const winRate = totalCount > 0 ? totalNegative / totalCount : 0.5;
    const maxChange = Math.max(...hourData.map(h => h.maxChange));
    const minChange = Math.min(...hourData.map(h => h.minChange));

    aggregatedHours.push({
      hour,
      avgChange,
      stdChange,
      positiveCount: totalPositive,
      negativeCount: totalNegative,
      totalCount,
      winRate,
      maxChange,
      minChange,
    });
  }

  // 가장 하락이 많은 시간대 (평균 변화량이 가장 음수)
  const bestHour = aggregatedHours
    .filter(h => h.totalCount > 0)
    .sort((a, b) => a.avgChange - b.avgChange)[0]?.hour ?? 0;

  // 가장 상승이 많은 시간대 (평균 변화량이 가장 양수)
  const worstHour = aggregatedHours
    .filter(h => h.totalCount > 0)
    .sort((a, b) => b.avgChange - a.avgChange)[0]?.hour ?? 0;

  return {
    hours: aggregatedHours,
    bestHour,
    worstHour,
  };
}

/**
 * 요일+시간대별 패턴 분석 (9:00 기준)
 * 한국시간 9:00 시작 가격을 기준으로 각 요일+시간대별 평균 변화량 계산
 */
export function analyzeDayHourPattern(klines: Kline[]): DayHourPattern | null {
  if (!klines || klines.length < 24) {
    return null;
  }

  // 날짜별로 그룹화 (한국시간 기준)
  const dayGroups: Map<string, Array<{ hour: number; price: number; dayOfWeek: number; timestamp: number }>> = new Map();

  // 각 봉을 날짜별로 그룹화하고 한국시간 추출
  for (let i = 0; i < klines.length; i++) {
    const openTime = Math.floor(klines[i][0] / 1000);
    const date = new Date(openTime * 1000);
    const utcHour = date.getUTCHours();
    const kstHour = (utcHour + 9) % 24;
    
    // 한국시간 기준 날짜 키 생성
    const kstTime = openTime + 9 * 60 * 60;
    const kstDate = new Date(kstTime * 1000);
    const year = kstDate.getUTCFullYear();
    const month = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kstDate.getUTCDate()).padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;
    
    // 한국시간 기준 요일 (0=일, 1=월, ..., 6=토)
    const kstDayOfWeek = kstDate.getUTCDay();
    
    const price = parseFloat(klines[i][4]);
    
    if (!dayGroups.has(dateKey)) {
      dayGroups.set(dateKey, []);
    }
    dayGroups.get(dateKey)!.push({
      hour: kstHour,
      price,
      dayOfWeek: kstDayOfWeek,
      timestamp: openTime
    });
  }

  // 요일+시간대별로 9:00 대비 변화량 수집
  // [요일][시간대] = 변화량 배열
  const dayHourGroups: Record<number, Record<number, number[]>> = {};
  for (let day = 0; day < 7; day++) {
    dayHourGroups[day] = {};
    for (let hour = 0; hour < 24; hour++) {
      dayHourGroups[day][hour] = [];
    }
  }

  // 각 날의 9:00 가격을 기준으로 다른 시간대 변화량 계산
  for (const [dateKey, dayData] of dayGroups.entries()) {
    const nineAM = dayData.find(d => d.hour === 9);
    if (!nineAM) continue;
    
    const basePrice = nineAM.price;
    const dayOfWeek = nineAM.dayOfWeek;
    
    // 해당 날의 모든 시간대를 9:00 대비로 계산
    for (const data of dayData) {
      if (data.hour >= 0 && data.hour <= 23) {
        const changeFrom9AM = ((data.price - basePrice) / basePrice) * 100;
        dayHourGroups[dayOfWeek][data.hour].push(changeFrom9AM);
      }
    }
  }

  // 요일+시간대별 패턴 계산
  const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
  const data: DayHourData[][] = [];

  for (let day = 0; day < 7; day++) {
    const hourData: DayHourData[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const changes = dayHourGroups[day][hour];
      if (changes.length === 0) {
        hourData.push({
          dayOfWeek: day,
          hour,
          avgChange: hour === 9 ? 0 : 0, // 9:00는 항상 0
          totalCount: 0,
        });
      } else {
        const avgChange = hour === 9 ? 0 : changes.reduce((a, b) => a + b, 0) / changes.length;
        hourData.push({
          dayOfWeek: day,
          hour,
          avgChange,
          totalCount: changes.length,
        });
      }
    }
    data.push(hourData);
  }

  // 월요일부터 표시하도록 재정렬: [월(1), 화(2), 수(3), 목(4), 금(5), 토(6), 일(0)]
  const reorderedData = [
    data[1], // 월요일
    data[2], // 화요일
    data[3], // 수요일
    data[4], // 목요일
    data[5], // 금요일
    data[6], // 토요일
    data[0], // 일요일
  ];

  return {
    data: reorderedData,
    dayNames,
  };
}

/**
 * 여러 코인의 요일+시간대별 패턴을 종합
 */
export function analyzeMarketDayHourPattern(
  symbolPatterns: Array<{ symbol: string; pattern: DayHourPattern | null }>
): DayHourPattern | null {
  const validPatterns = symbolPatterns.filter(p => p.pattern !== null);
  
  if (validPatterns.length === 0) {
    return null;
  }

  const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
  const aggregatedData: DayHourData[][] = [];

  for (let day = 0; day < 7; day++) {
    const hourData: DayHourData[] = [];
    for (let hour = 0; hour < 24; hour++) {
      // 각 패턴의 data는 이미 재정렬되어 있으므로 (월요일부터), 같은 인덱스로 접근
      const dayHourData = validPatterns
        .map(p => p.pattern!.data[day][hour])
        .filter(d => d.totalCount > 0);

      if (dayHourData.length === 0) {
        // 원래 요일 인덱스 계산: day=0(월) -> 1, day=1(화) -> 2, ..., day=6(일) -> 0
        const originalDayOfWeek = day === 6 ? 0 : day + 1;
        hourData.push({
          dayOfWeek: originalDayOfWeek,
          hour,
          avgChange: hour === 9 ? 0 : 0,
          totalCount: 0,
        });
      } else {
        // 가중 평균 (데이터 수 기준)
        const totalCount = dayHourData.reduce((sum, d) => sum + d.totalCount, 0);
        const weightedSum = dayHourData.reduce((sum, d) => sum + d.avgChange * d.totalCount, 0);
        const avgChange = hour === 9 ? 0 : (totalCount > 0 ? weightedSum / totalCount : 0);
        
        // 원래 요일 인덱스 계산: day=0(월) -> 1, day=1(화) -> 2, ..., day=6(일) -> 0
        const originalDayOfWeek = day === 6 ? 0 : day + 1;
        hourData.push({
          dayOfWeek: originalDayOfWeek,
          hour,
          avgChange,
          totalCount,
        });
      }
    }
    aggregatedData.push(hourData);
  }

  return {
    data: aggregatedData,
    dayNames,
  };
}
