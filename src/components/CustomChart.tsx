import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import { getCandlestickData } from '../utils/api';
import type { Kline, SupportResistance, StopLossInfo, DivergenceAnalysis, ADXResult } from '../types';
import './CustomChart.css';

// 타입 정의
type Time = number; // UTC timestamp in seconds

interface CandlestickData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface LineData {
  time: Time;
  value: number;
}

interface VolumeData {
  time: Time;
  value: number;
  color?: string;
}

type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1분' },
  { value: '3m', label: '3분' },
  { value: '5m', label: '5분' },
  { value: '15m', label: '15분' },
  { value: '30m', label: '30분' },
  { value: '1h', label: '1시간' },
  { value: '2h', label: '2시간' },
  { value: '4h', label: '4시간' },
  { value: '6h', label: '6시간' },
  { value: '8h', label: '8시간' },
  { value: '12h', label: '12시간' },
  { value: '1d', label: '1일' },
  { value: '3d', label: '3일' },
  { value: '1w', label: '1주' },
  { value: '1M', label: '1개월' },
];

// 차트에서 봉 간격(픽셀). 화면 사이즈 기반 limit 계산에 사용.
const DEFAULT_BAR_SPACING_PX = 6;

// 화면(컨테이너 가로폭) 기반으로 "한 화면에 들어갈 만큼"의 봉 개수 계산
function getVisibleDataCountByWidth(
  containerWidthPx: number,
  barSpacingPx: number = DEFAULT_BAR_SPACING_PX
): number {
  const safeWidth = Number.isFinite(containerWidthPx) && containerWidthPx > 0 ? containerWidthPx : 800;
  const safeSpacing = Number.isFinite(barSpacingPx) && barSpacingPx > 0 ? barSpacingPx : DEFAULT_BAR_SPACING_PX;

  // 여유분(스크롤/줌/축 표시)을 위해 버퍼 추가
  const buffer = 30;
  const approxVisible = Math.ceil(safeWidth / safeSpacing) + buffer;

  // 너무 작거나 큰 값 방지
  return Math.min(Math.max(approxVisible, 80), 1500);
}

// 하이브리드 방식 설정
const DEBOUNCE_DELAY_MS = 1000; // 드래그/줌 종료 후 1초 뒤 로드
const BUFFER_CANDLES = 100; // 화면 범위 앞뒤 여유분
const MAX_CANDLE_COUNT = Number.MAX_SAFE_INTEGER; // 최대 제한 해제
const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 캐시 유지 시간: 5분

// 캐시 엔트리 타입
interface CacheEntry {
  data: CandlestickData[];
  timestamp: number;
  timeRange: { from: Time; to: Time };
}

// 타임프레임에 따른 최대 데이터 limit (스크롤 시 추가 로드용)
function getMaxLimitForTimeframe(timeframe: Timeframe): number {
  const maxLimits: Record<Timeframe, number> = {
    '1m': 500,
    '3m': 500,
    '5m': 500,
    '15m': 500,
    '30m': 500,
    '1h': 500,
    '2h': 400,
    '4h': 300,
    '6h': 300,
    '8h': 300,
    '12h': 300,
    '1d': 200,
    '3d': 200,
    '1w': 100,
    '1M': 50,
  };
  return maxLimits[timeframe] || 500;
}

interface CustomChartProps {
  symbol: string;
  height?: number;
  width?: string;
  supportResistance?: SupportResistance;
  stopLossInfo?: StopLossInfo;
  divergenceAnalysis?: DivergenceAnalysis;
  adxResult?: ADXResult;
}

export function CustomChart({ 
  symbol, 
  height = 400, 
  width = '100%',
  supportResistance,
  stopLossInfo,
  divergenceAnalysis,
  adxResult
}: CustomChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const volumePriceScaleRef = useRef<any>(null); // 거래량 price scale 참조
  const lineSeriesRefs = useRef<any[]>([]);
  const allCandlestickDataRef = useRef<CandlestickData[]>([]);
  const allVolumeDataRef = useRef<VolumeData[]>([]);
  const isLoadingMoreRef = useRef<boolean>(false);
  const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const barSpacingRef = useRef<number>(DEFAULT_BAR_SPACING_PX);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataCacheRef = useRef<Map<string, CacheEntry>>(new Map()); // 캐시: key = "fromTime-toTime"
  const isInitialLoadRef = useRef<boolean>(true); // 초기 로드 플래그
  const abortControllerRef = useRef<AbortController | null>(null); // 요청 취소용
  const currentPriceLineRef = useRef<any>(null); // 현재가 라인 참조
  const lastCurrentPriceRef = useRef<number | null>(null); // 마지막 현재가 (깜빡임 방지용)
  const lastLoadCheckTimeRef = useRef<Time | null>(null); // 마지막 로드 체크 시간 (중복 로드 방지)
  const updateVolumeScaleRef = useRef<(() => void) | null>(null); // 거래량 스케일 업데이트 함수 참조
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [dataLimit, setDataLimit] = useState<number>(150);

  // 차트 초기화 (한 번만 실행)
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 컨테이너 크기 확인
    const containerWidth = chartContainerRef.current.clientWidth || chartContainerRef.current.offsetWidth || 800;
    
    // 한국시간(KST) 포맷터: UTC Unix timestamp(초) → KST 문자열
    const formatTimeKST = (time: number): string => {
      const date = new Date(time * 1000);
      return date.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    };

    // 차트 생성 (시간축 공간을 고려하여 높이 조정)
    const chart = createChart(chartContainerRef.current, {
      width: containerWidth,
      height: height - 25, // 시간축 공간 확보를 위해 25px 빼기
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#333',
      },
      grid: {
        vertLines: { color: '#e0e0e0' },
        horzLines: { color: '#e0e0e0' },
      },
      localization: {
        locale: 'ko-KR',
        timeFormatter: formatTimeKST,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        barSpacing: barSpacingRef.current,
        borderVisible: true,
        visible: true,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      rightPriceScale: {
        borderColor: '#e0e0e0',
        scaleMargins: {
          top: 0.1,
          bottom: 0.4, // 거래량 영역을 위해 bottom 공간 확보
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: false,
        },
        axisDoubleClickReset: {
          time: true,
          price: true,
        },
        mouseWheel: true,
        pinch: true,
      },
    });

    chartRef.current = chart;

    // 캔들스틱 시리즈 추가 (v5 API)
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      priceFormat: {
        type: 'price',
        precision: 6,
        minMove: 0.000001,
      },
    });

    candlestickSeriesRef.current = candlestickSeries;

    // 거래량 히스토그램 시리즈 추가 (별도 price scale 사용)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: 'volume', // 별도 price scale ID 지정
      scaleMargins: {
        top: 0.7, // 상단 70%는 캔들 차트
        bottom: 0,
      },
    });

    volumeSeriesRef.current = volumeSeries;

    // 거래량 price scale 설정
    const volumePriceScale = chart.priceScale('volume');
    volumePriceScaleRef.current = volumePriceScale;
    volumePriceScale.applyOptions({
      autoScale: false, // 자동 스케일 비활성화
      scaleMargins: {
        top: 0.7,
        bottom: 0,
      },
    });

    // 화면에 보이는 범위의 최대 거래량을 기준으로 Y축 조정하는 함수
    const updateVolumeScale = () => {
      if (!chartRef.current || !volumeSeriesRef.current || !volumePriceScaleRef.current || !allVolumeDataRef.current.length) return;
      
      const timeScale = chartRef.current.timeScale();
      const visibleRange = timeScale.getVisibleRange();
      
      if (!visibleRange) return;
      
      // 화면에 보이는 범위의 거래량 데이터 필터링
      const visibleVolumeData = allVolumeDataRef.current.filter(vol => {
        return vol.time >= (visibleRange.from as number) && vol.time <= (visibleRange.to as number);
      });
      
      if (visibleVolumeData.length === 0) return;
      
      // 최대 거래량 계산
      const maxVolume = Math.max(...visibleVolumeData.map(v => v.value));
      
      if (maxVolume > 0) {
        // Y축을 최대 거래량의 120%로 설정 (여유 공간 확보)
        volumePriceScaleRef.current.setVisibleRange({
          from: 0,
          to: maxVolume * 1.2, // 20% 여유
        });
      }
    };

    // 함수를 ref에 저장하여 다른 useEffect에서도 접근 가능하도록 함
    updateVolumeScaleRef.current = updateVolumeScale;

    // 컨테이너 폭 기반으로 초기 데이터 limit 계산
    setDataLimit(prev => {
      const next = getVisibleDataCountByWidth(containerWidth, barSpacingRef.current);
      return prev === next ? prev : next;
    });

    // 리사이즈 핸들러
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        const containerWidth = chartContainerRef.current.clientWidth || chartContainerRef.current.offsetWidth || 800;
        chartRef.current.applyOptions({
          width: containerWidth,
          height: height - 25, // 시간축 공간 확보
        });

        // 화면 크기 변경 시에도 limit 재계산 (자동으로 "화면만큼" 로드)
        setDataLimit(prev => {
          const next = getVisibleDataCountByWidth(containerWidth, barSpacingRef.current);
          return prev === next ? prev : next;
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [height]);

  // 타임프레임 변경 시 데이터 limit 초기화 및 실시간 업데이트 주기 재설정
  useEffect(() => {
    // 타임프레임 변경 시에도 현재 컨테이너 폭 기준으로 limit 재계산
    const containerWidth =
      chartContainerRef.current?.clientWidth ||
      chartContainerRef.current?.offsetWidth ||
      800;
    setDataLimit(getVisibleDataCountByWidth(containerWidth, barSpacingRef.current));
    
    // 타임프레임 변경 시 초기 로드 플래그 리셋
    isInitialLoadRef.current = true;
    
    // 기존 인터벌 정리
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }
  }, [timeframe]);

  // 데이터 로드 및 라인 시리즈 업데이트
  useEffect(() => {
    if (!chartRef.current || !candlestickSeriesRef.current) return;

    // 라인 시리즈 업데이트 함수
    const updateLineSeries = (candlestickData: CandlestickData[]) => {
      // 기존 라인 시리즈 제거
      lineSeriesRefs.current.forEach(series => {
        if (chartRef.current && series) {
          chartRef.current.removeSeries(series);
        }
      });
      lineSeriesRefs.current = [];

      if (!chartRef.current) return;
      
      // candlestickData가 비어있거나 유효하지 않으면 리턴
      if (!candlestickData || candlestickData.length === 0) return;
      
      // 모든 캔들의 time이 유효한지 확인
      const hasValidTimes = candlestickData.every(candle => 
        candle && typeof candle.time === 'number' && !isNaN(candle.time)
      );
      if (!hasValidTimes) return;

      // 저항선 추가
      if (supportResistance && typeof supportResistance.resistance === 'number' && !isNaN(supportResistance.resistance) && isFinite(supportResistance.resistance)) {
        const resistanceLine = chartRef.current.addSeries(LineSeries, {
          color: '#ff6b6b',
          lineWidth: 2,
          lineStyle: 2,
          title: '저항선',
          priceLineVisible: true,
          lastValueVisible: true,
        });

        const resistanceData: LineData[] = candlestickData
          .filter(candle => candle && typeof candle.time === 'number' && !isNaN(candle.time))
          .map(candle => ({
            time: candle.time as Time,
            value: supportResistance.resistance,
          }));

        if (resistanceData.length > 0) {
          try {
            resistanceLine.setData(resistanceData as any);
            lineSeriesRefs.current.push(resistanceLine);
          } catch (e) {
            console.error('저항선 setData 에러:', e);
            try {
              chartRef.current.removeSeries(resistanceLine);
            } catch (removeError) {
              // 무시
            }
          }
        } else {
          chartRef.current.removeSeries(resistanceLine);
        }
      }

      // 지지선 추가
      if (supportResistance && typeof supportResistance.support === 'number' && !isNaN(supportResistance.support) && isFinite(supportResistance.support)) {
        const supportLine = chartRef.current.addSeries(LineSeries, {
          color: '#4ecdc4',
          lineWidth: 2,
          lineStyle: 2,
          title: '지지선',
          priceLineVisible: true,
          lastValueVisible: true,
        });

        const supportData: LineData[] = candlestickData
          .filter(candle => candle && typeof candle.time === 'number' && !isNaN(candle.time))
          .map(candle => ({
            time: candle.time as Time,
            value: supportResistance.support,
          }));

        if (supportData.length > 0) {
          try {
            supportLine.setData(supportData as any);
            lineSeriesRefs.current.push(supportLine);
          } catch (e) {
            console.error('지지선 setData 에러:', e);
            try {
              chartRef.current.removeSeries(supportLine);
            } catch (removeError) {
              // 무시
            }
          }
        } else {
          chartRef.current.removeSeries(supportLine);
        }
      }

      // 단기 저항선 추가
      if (supportResistance && typeof supportResistance.short_term_resistance === 'number' && !isNaN(supportResistance.short_term_resistance) && isFinite(supportResistance.short_term_resistance)) {
        const shortTermResistanceLine = chartRef.current.addSeries(LineSeries, {
          color: '#ff9999',
          lineWidth: 1,
          lineStyle: 1, // 점선
          title: '단기 저항선',
          priceLineVisible: true,
          lastValueVisible: true,
        });

        const shortTermResistanceData: LineData[] = candlestickData
          .filter(candle => candle && typeof candle.time === 'number' && !isNaN(candle.time))
          .map(candle => ({
            time: candle.time as Time,
            value: supportResistance.short_term_resistance,
          }));

        if (shortTermResistanceData.length > 0) {
          try {
            shortTermResistanceLine.setData(shortTermResistanceData as any);
            lineSeriesRefs.current.push(shortTermResistanceLine);
          } catch (e) {
            console.error('단기 저항선 setData 에러:', e);
            try {
              chartRef.current.removeSeries(shortTermResistanceLine);
            } catch (removeError) {
              // 무시
            }
          }
        } else {
          chartRef.current.removeSeries(shortTermResistanceLine);
        }
      }

      // 단기 지지선 추가
      if (supportResistance && typeof supportResistance.short_term_support === 'number' && !isNaN(supportResistance.short_term_support) && isFinite(supportResistance.short_term_support)) {
        const shortTermSupportLine = chartRef.current.addSeries(LineSeries, {
          color: '#7dd3c0',
          lineWidth: 1,
          lineStyle: 1, // 점선
          title: '단기 지지선',
          priceLineVisible: true,
          lastValueVisible: true,
        });

        const shortTermSupportData: LineData[] = candlestickData
          .filter(candle => candle && typeof candle.time === 'number' && !isNaN(candle.time))
          .map(candle => ({
            time: candle.time as Time,
            value: supportResistance.short_term_support,
          }));

        if (shortTermSupportData.length > 0) {
          try {
            shortTermSupportLine.setData(shortTermSupportData as any);
            lineSeriesRefs.current.push(shortTermSupportLine);
          } catch (e) {
            console.error('단기 지지선 setData 에러:', e);
            try {
              chartRef.current.removeSeries(shortTermSupportLine);
            } catch (removeError) {
              // 무시
            }
          }
        } else {
          chartRef.current.removeSeries(shortTermSupportLine);
        }
      }

      // 손절선 추가
      if (stopLossInfo && typeof stopLossInfo.stop_loss === 'number' && !isNaN(stopLossInfo.stop_loss) && isFinite(stopLossInfo.stop_loss)) {
        const stopLossLine = chartRef.current.addSeries(LineSeries, {
          color: '#ff4757',
          lineWidth: 2,
          lineStyle: 0,
          title: '손절선',
          priceLineVisible: true,
          lastValueVisible: true,
        });

        const stopLossData: LineData[] = candlestickData
          .filter(candle => candle && typeof candle.time === 'number' && !isNaN(candle.time))
          .map(candle => ({
            time: candle.time as Time,
            value: stopLossInfo.stop_loss,
          }));

        if (stopLossData.length > 0) {
          try {
            stopLossLine.setData(stopLossData as any);
            lineSeriesRefs.current.push(stopLossLine);
          } catch (e) {
            console.error('손절선 setData 에러:', e);
            try {
              chartRef.current.removeSeries(stopLossLine);
            } catch (removeError) {
              // 무시
            }
          }
        } else {
          chartRef.current.removeSeries(stopLossLine);
        }
      }

      // 익절선 추가
      if (stopLossInfo && typeof stopLossInfo.target_price === 'number' && !isNaN(stopLossInfo.target_price) && isFinite(stopLossInfo.target_price)) {
        const targetLine = chartRef.current.addSeries(LineSeries, {
          color: '#2ed573',
          lineWidth: 2,
          lineStyle: 0,
          title: '익절선',
          priceLineVisible: true,
          lastValueVisible: true,
        });

        const targetData: LineData[] = candlestickData
          .filter(candle => candle && typeof candle.time === 'number' && !isNaN(candle.time))
          .map(candle => ({
            time: candle.time as Time,
            value: stopLossInfo.target_price,
          }));

        if (targetData.length > 0) {
          try {
            targetLine.setData(targetData as any);
            lineSeriesRefs.current.push(targetLine);
          } catch (e) {
            console.error('익절선 setData 에러:', e);
            try {
              chartRef.current.removeSeries(targetLine);
            } catch (removeError) {
              // 무시
            }
          }
        } else {
          chartRef.current.removeSeries(targetLine);
        }
      }

      // 다이버전스 마커 추가 (1시간봉)
      const chart = chartRef.current;
      if (divergenceAnalysis && divergenceAnalysis.peaks && divergenceAnalysis.peaks.length > 0 && chart) {
        const markerColor = divergenceAnalysis.divergence_type === 'bearish' ? '#dc3545' : 
                           divergenceAnalysis.divergence_type === 'bullish' ? '#28a745' : '#666';
        
        // 각 고점에 마커 시리즈 추가 (원형 마커로 표시)
        divergenceAnalysis.peaks.forEach((peak, index) => {
          try {
            // 각 고점에 하나의 데이터 포인트만 있는 마커 시리즈 생성
            const markerSeries = chart.addSeries(LineSeries, {
              color: markerColor,
              lineWidth: 1,
              pointMarkersVisible: true,
              pointMarkersRadius: 6,
              title: index === divergenceAnalysis.peaks!.length - 1 
                ? (divergenceAnalysis.divergence_type === 'bearish' ? '🔻 하락 다이버전스 (1h)' : 
                   divergenceAnalysis.divergence_type === 'bullish' ? '🔺 상승 다이버전스' : '다이버전스')
                : `다이버전스 고점 ${index + 1}`,
            });

            // 해당 시간에만 데이터 포인트 추가
            const markerData: LineData[] = [{
              time: peak.time as Time,
              value: peak.price
            }];

            markerSeries.setData(markerData as any);
            lineSeriesRefs.current.push(markerSeries);
          } catch (e) {
            console.error('다이버전스 마커 추가 에러:', e);
          }
        });
      }

      // 일치(Convergence) 마커 추가 (다이버전스가 아닌 경우)
      if (divergenceAnalysis && divergenceAnalysis.convergence_peaks && divergenceAnalysis.convergence_peaks.length > 0 && chart) {
        const convergenceColor = '#666'; // 회색
        
        // 각 일치 고점에 마커 시리즈 추가 (원형 마커로 표시)
        divergenceAnalysis.convergence_peaks.forEach((peak, index) => {
          try {
            const markerSeries = chart.addSeries(LineSeries, {
              color: convergenceColor,
              lineWidth: 1,
              pointMarkersVisible: true,
              pointMarkersRadius: 6,
              title: index === divergenceAnalysis.convergence_peaks!.length - 1 
                ? '일치(Convergence) 고점'
                : `일치 고점 ${index + 1}`,
            });

            const markerData: LineData[] = [{
              time: peak.time as Time,
              value: peak.price
            }];

            markerSeries.setData(markerData as any);
            lineSeriesRefs.current.push(markerSeries);
          } catch (e) {
            console.error('일치 마커 추가 에러:', e);
          }
        });
      }

      // 5분봉 하락 다이버전스 마커 추가
      if (divergenceAnalysis && divergenceAnalysis.peaks_5m && divergenceAnalysis.peaks_5m.length > 0 && chart) {
        // 5분봉 하락 다이버전스는 다른 색상으로 표시 (더 진한 빨간색)
        const markerColor5m = '#b91c1c';
        
        divergenceAnalysis.peaks_5m.forEach((peak, index) => {
          try {
            const markerSeries5m = chart.addSeries(LineSeries, {
              color: markerColor5m,
              lineWidth: 1,
              pointMarkersVisible: true,
              pointMarkersRadius: 5,
              title: index === divergenceAnalysis.peaks_5m!.length - 1 
                ? '🔻 하락 다이버전스 (5m)'
                : `다이버전스 고점 5m ${index + 1}`,
            });

            const markerData5m: LineData[] = [{
              time: peak.time as Time,
              value: peak.price
            }];

            markerSeries5m.setData(markerData5m as any);
            lineSeriesRefs.current.push(markerSeries5m);
          } catch (e) {
            console.error('5분봉 다이버전스 마커 추가 에러:', e);
          }
        });
      }

      // 현재가 라인 추가 (실제 최신 캔들의 close 가격 사용)
      // 화면 범위와 관계없이 항상 최신 가격을 표시하기 위해 넓은 시간 범위로 설정
      if (candlestickData.length > 0) {
        const latestCandle = candlestickData[candlestickData.length - 1];
        
        // latestCandle이 유효한지 확인
        if (!latestCandle || typeof latestCandle !== 'object') return;
        
        const latestClose = latestCandle.close;
        const firstCandle = candlestickData[0];
        
        // latestClose와 firstCandle이 유효한지 확인
        if (typeof latestClose !== 'number' || isNaN(latestClose) || !isFinite(latestClose)) return;
        if (!firstCandle || typeof firstCandle !== 'object') return;
        
        const firstTime = firstCandle.time;
        const lastTime = latestCandle.time;
        
        // time이 유효한지 확인
        if (typeof firstTime !== 'number' || isNaN(firstTime) || !isFinite(firstTime)) return;
        if (typeof lastTime !== 'number' || isNaN(lastTime) || !isFinite(lastTime)) return;
        
        lastCurrentPriceRef.current = latestClose;
        
        // 기존 현재가 라인이 있으면 제거
        if (currentPriceLineRef.current && chartRef.current) {
          try {
            chartRef.current.removeSeries(currentPriceLineRef.current);
          } catch (e) {
            // 이미 제거된 경우 무시
          }
          const index = lineSeriesRefs.current.indexOf(currentPriceLineRef.current);
          if (index > -1) {
            lineSeriesRefs.current.splice(index, 1);
          }
          currentPriceLineRef.current = null;
        }
        
        if (!chartRef.current) return;
        
        const currentPriceLine = chartRef.current.addSeries(LineSeries, {
          color: '#5352ed',
          lineWidth: 2,
          lineStyle: 0, // 실선
          title: '현재가',
          priceLineVisible: true,
          lastValueVisible: true,
        });

        // 현재 데이터의 시간 범위를 확장하여 화면에 보이지 않아도 표시되도록 함
        const timeRange = lastTime - firstTime;
        
        // 과거와 미래로 충분히 확장 (현재 데이터 범위의 10배)
        const extendedFrom = firstTime - (timeRange * 5);
        const extendedTo = lastTime + (timeRange * 5);

        // 확장된 시간 범위에 현재가 라인 데이터 생성
        const currentPriceData: LineData[] = [
          { time: extendedFrom, value: latestClose },
          { time: extendedTo, value: latestClose }
        ];

        // 모든 값이 유효한지 최종 확인
        const isValidData = currentPriceData.every(
          item => typeof item.time === 'number' && !isNaN(item.time) && isFinite(item.time) &&
                  typeof item.value === 'number' && !isNaN(item.value) && isFinite(item.value)
        );

        if (isValidData) {
          try {
            currentPriceLine.setData(currentPriceData as any);
            currentPriceLineRef.current = currentPriceLine;
            lineSeriesRefs.current.push(currentPriceLine);
          } catch (e) {
            // setData 실패 시 시리즈 제거
            try {
              chartRef.current.removeSeries(currentPriceLine);
            } catch (removeError) {
              // 무시
            }
          }
        } else {
          try {
            chartRef.current.removeSeries(currentPriceLine);
          } catch (e) {
            // 무시
          }
        }
      }
    };

    // 과거 데이터 추가 로드 함수 (1500개씩)
    const loadMoreHistoricalData = async (_oldestVisibleTime: Time) => {
      if (isLoadingMoreRef.current) return;
      
      // 이전 요청이 있으면 취소
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      
      try {
        isLoadingMoreRef.current = true;

        const currentData = allCandlestickDataRef.current;
        if (currentData.length === 0) {
          isLoadingMoreRef.current = false;
          return;
        }

        // 현재 데이터의 가장 오래된 시간 (연속성을 위해 이 시간 이전으로 로드)
        const currentOldestTime = currentData[0].time;
        
        // 1500개를 과거로 확장하기 위한 시간 계산
        // 바이낸스 API 최대 limit은 1500이므로 한 번의 요청으로 충분
        const intervalMs = getIntervalMs(timeframe);
        const loadCount = 1500; // 바이낸스 API 최대 limit
        
        // 현재 가장 오래된 시간 이전으로 1500개 로드
        const endTimeMs = (currentOldestTime * 1000) - intervalMs; // 현재 데이터 바로 이전까지
        const startTimeMs = endTimeMs - (loadCount * intervalMs);
        
        // 데이터 로드 (현재 데이터와 연속되도록)
        const klines = await getCandlestickData(
          symbol,
          timeframe,
          loadCount,
          Math.max(startTimeMs, 0),
          endTimeMs,
          abortController.signal
        );

        if (abortController.signal.aborted) {
          isLoadingMoreRef.current = false;
          return;
        }

        if (!klines || klines.length === 0) {
          isLoadingMoreRef.current = false;
          return;
        }

        // 데이터 변환
        const candlestickData: CandlestickData[] = klines.map((kline: Kline) => ({
          time: (Math.floor(kline[0] / 1000) as Time),
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
        }));

        // 거래량 데이터 변환
        const volumeData: VolumeData[] = klines.map((kline: Kline) => {
          const time = Math.floor(kline[0] / 1000) as Time;
          const open = parseFloat(kline[1]);
          const close = parseFloat(kline[4]);
          const volume = parseFloat(kline[5]);
          const color = close >= open ? '#26a69a' : '#ef5350';
          return {
            time,
            value: volume,
            color,
          };
        });

        if (abortController.signal.aborted) {
          isLoadingMoreRef.current = false;
          return;
        }

        // 기존 데이터와 병합 (시간순 정렬 및 중복 제거)
        // 새로 로드한 데이터가 앞에 오도록 병합
        const mergedData = [...candlestickData, ...currentData];
        const sortedData = mergedData.sort((a, b) => a.time - b.time);
        const uniqueData = sortedData.filter((item, index, self) =>
          index === self.findIndex((t) => t.time === item.time)
        );

        // 거래량 데이터도 병합
        const currentVolumeData = allVolumeDataRef.current;
        const mergedVolumeData = [...volumeData, ...currentVolumeData];
        const sortedVolumeData = mergedVolumeData.sort((a, b) => a.time - b.time);
        const uniqueVolumeData = sortedVolumeData.filter((item, index, self) =>
          index === self.findIndex((t) => t.time === item.time)
        );

        // 연속성 확인: 정렬 후 인접한 데이터 간 시간 간격이 타임프레임 간격과 일치하는지 확인
        // (약간의 오차는 허용)
        const intervalSeconds = intervalMs / 1000;
        for (let i = 1; i < uniqueData.length; i++) {
          const timeDiff = uniqueData[i].time - uniqueData[i - 1].time;
          // 간격이 타임프레임 간격의 2배를 넘으면 경고 (데이터 누락 가능성)
          if (timeDiff > intervalSeconds * 2) {
            console.warn(`데이터 간격이 큽니다: ${timeDiff}초 (예상: ${intervalSeconds}초)`);
          }
        }

        // 상한 체크 (최신 데이터 우선 유지)
        const trimmedData = uniqueData.length > MAX_CANDLE_COUNT
          ? uniqueData.slice(-MAX_CANDLE_COUNT)
          : uniqueData;

        const trimmedVolumeData = uniqueVolumeData.length > MAX_CANDLE_COUNT
          ? uniqueVolumeData.slice(-MAX_CANDLE_COUNT)
          : uniqueVolumeData;

        if (abortController.signal.aborted) {
          isLoadingMoreRef.current = false;
          return;
        }

        allCandlestickDataRef.current = trimmedData;
        allVolumeDataRef.current = trimmedVolumeData;
        candlestickSeriesRef.current.setData(trimmedData);
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData(trimmedVolumeData);
        }
        updateLineSeries(trimmedData);
        
        // 거래량 스케일 업데이트
        setTimeout(() => {
          if (updateVolumeScaleRef.current) {
            updateVolumeScaleRef.current();
          }
        }, 100);
        
        isLoadingMoreRef.current = false;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          isLoadingMoreRef.current = false;
          return;
        }
        console.error('과거 데이터 추가 로드 에러:', err);
        isLoadingMoreRef.current = false;
      }
    };

    // 화면 범위 기반 데이터 로드 함수 (하이브리드 방식) - 현재 사용되지 않음
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _loadDataForVisibleRange = async (visibleFrom: Time, visibleTo: Time) => {
      // 이전 요청이 있으면 취소 (최신 조작만 처리)
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // 새로운 AbortController 생성
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      
      try {
        isLoadingMoreRef.current = true;

        // 캐시 키 생성
        const cacheKey = `${visibleFrom}-${visibleTo}`;
        const now = Date.now();

        // 캐시 확인
        const cached = dataCacheRef.current.get(cacheKey);
        if (cached && (now - cached.timestamp) < CACHE_EXPIRY_MS) {
          // 캐시 히트: 캐시된 데이터 사용
          // 취소되었는지 확인
          if (abortController.signal.aborted) {
            isLoadingMoreRef.current = false;
            return;
          }
          
          allCandlestickDataRef.current = cached.data;
          candlestickSeriesRef.current.setData(cached.data);
          updateLineSeries(cached.data);
          isLoadingMoreRef.current = false;
          return;
        }

        // 화면 범위 + 여유분 계산
        const containerWidth = chartContainerRef.current?.clientWidth || chartContainerRef.current?.offsetWidth || 800;
        const visibleCount = getVisibleDataCountByWidth(containerWidth, barSpacingRef.current);
        const totalNeeded = visibleCount + (BUFFER_CANDLES * 2); // 앞뒤 여유분

        // 타임프레임별 최대 limit 적용
        const effectiveLimit = Math.min(totalNeeded, getMaxLimitForTimeframe(timeframe));

        // 시작 시간과 종료 시간 계산 (여유분 포함)
        // Binance API는 startTime과 endTime을 밀리초로 받음
        const startTimeMs = (visibleFrom * 1000) - (BUFFER_CANDLES * getIntervalMs(timeframe));
        const endTimeMs = (visibleTo * 1000) + (BUFFER_CANDLES * getIntervalMs(timeframe));

        // 데이터 로드 (AbortSignal 전달)
        const klines = await getCandlestickData(
          symbol,
          timeframe,
          effectiveLimit,
          Math.max(startTimeMs, 0), // 음수 방지
          endTimeMs,
          abortController.signal // AbortSignal 전달
        );

        // 취소되었는지 확인
        if (abortController.signal.aborted) {
          isLoadingMoreRef.current = false;
          return;
        }

        if (!klines || klines.length === 0) {
          isLoadingMoreRef.current = false;
          return;
        }

        // 취소되었는지 다시 확인 (데이터 처리 전)
        if (abortController.signal.aborted) {
          isLoadingMoreRef.current = false;
          return;
        }

        // 데이터 변환
        const candlestickData: CandlestickData[] = klines.map((kline: Kline) => ({
          time: (Math.floor(kline[0] / 1000) as Time),
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
        }));

        // 거래량 데이터 변환
        const volumeData: VolumeData[] = klines.map((kline: Kline) => {
          const time = Math.floor(kline[0] / 1000) as Time;
          const open = parseFloat(kline[1]);
          const close = parseFloat(kline[4]);
          const volume = parseFloat(kline[5]);
          const color = close >= open ? '#26a69a' : '#ef5350';
          return {
            time,
            value: volume,
            color,
          };
        });

        // 취소되었는지 다시 확인 (데이터 처리 중)
        if (abortController.signal.aborted) {
          isLoadingMoreRef.current = false;
          return;
        }

        // 시간순 정렬 및 중복 제거
        const sortedData = candlestickData.sort((a, b) => a.time - b.time);
        const uniqueData = sortedData.filter((item, index, self) =>
          index === self.findIndex((t) => t.time === item.time)
        );

        // 거래량 데이터도 정렬 및 중복 제거
        const sortedVolumeData = volumeData.sort((a, b) => a.time - b.time);
        const uniqueVolumeData = sortedVolumeData.filter((item, index, self) =>
          index === self.findIndex((t) => t.time === item.time)
        );

        // 상한 체크
        const trimmedData = uniqueData.length > MAX_CANDLE_COUNT
          ? uniqueData.slice(-MAX_CANDLE_COUNT)
          : uniqueData;

        const trimmedVolumeData = uniqueVolumeData.length > MAX_CANDLE_COUNT
          ? uniqueVolumeData.slice(-MAX_CANDLE_COUNT)
          : uniqueVolumeData;

        // 취소되었는지 최종 확인 (차트 업데이트 전)
        if (abortController.signal.aborted) {
          isLoadingMoreRef.current = false;
          return;
        }

        // 캐시 저장
        dataCacheRef.current.set(cacheKey, {
          data: trimmedData,
          timestamp: now,
          timeRange: { from: visibleFrom, to: visibleTo }
        });

        // 오래된 캐시 정리 (5개 이상이면 가장 오래된 것 제거)
        if (dataCacheRef.current.size > 5) {
          const oldestKey = Array.from(dataCacheRef.current.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
          dataCacheRef.current.delete(oldestKey);
        }

        allCandlestickDataRef.current = trimmedData;
        allVolumeDataRef.current = trimmedVolumeData;
        candlestickSeriesRef.current.setData(trimmedData);
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData(trimmedVolumeData);
        }
        updateLineSeries(trimmedData);
        
        // 거래량 스케일 업데이트
        setTimeout(() => {
          if (updateVolumeScaleRef.current) {
            updateVolumeScaleRef.current();
          }
        }, 100);
        
        isLoadingMoreRef.current = false;
      } catch (err) {
        // AbortError는 정상적인 취소이므로 로그 출력 안 함
        if (err instanceof Error && err.name === 'AbortError') {
          isLoadingMoreRef.current = false;
          return;
        }
        console.error('화면 범위 데이터 로드 에러:', err);
        isLoadingMoreRef.current = false;
      }
    };

    // 타임프레임별 간격(밀리초) 계산
    const getIntervalMs = (tf: Timeframe): number => {
      const intervals: Record<Timeframe, number> = {
        '1m': 60 * 1000,
        '3m': 3 * 60 * 1000,
        '5m': 5 * 60 * 1000,
        '15m': 15 * 60 * 1000,
        '30m': 30 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '2h': 2 * 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '8h': 8 * 60 * 60 * 1000,
        '12h': 12 * 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '3d': 3 * 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000,
        '1M': 30 * 24 * 60 * 60 * 1000,
      };
      return intervals[tf] || 60 * 60 * 1000;
    };

    const loadData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // 기존 라인 시리즈 제거
        lineSeriesRefs.current.forEach(series => {
          if (chartRef.current && series) {
            chartRef.current.removeSeries(series);
          }
        });
        lineSeriesRefs.current = [];

        // 타임프레임별 과도한 로드 방지
        const effectiveLimit = Math.min(dataLimit, getMaxLimitForTimeframe(timeframe));
        const klines = await getCandlestickData(symbol, timeframe, effectiveLimit);

        if (!klines || klines.length === 0) {
          throw new Error('차트 데이터를 가져올 수 없습니다.');
        }

        // 캔들스틱 데이터 변환
        const candlestickData: CandlestickData[] = klines.map((kline: Kline) => ({
          time: (Math.floor(kline[0] / 1000) as Time),
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
        }));

        // 거래량 데이터 변환
        const volumeData: VolumeData[] = klines.map((kline: Kline) => {
          const time = Math.floor(kline[0] / 1000) as Time;
          const open = parseFloat(kline[1]);
          const close = parseFloat(kline[4]);
          const volume = parseFloat(kline[5]);
          // 상승봉이면 초록, 하락봉이면 빨강
          const color = close >= open ? '#26a69a' : '#ef5350';
          return {
            time,
            value: volume,
            color,
          };
        });

        // 시간순 정렬 및 중복 제거 (Binance API는 최신부터 반환하므로 정렬 필요)
        const sortedData = candlestickData.sort((a, b) => a.time - b.time);
        const uniqueData = sortedData.filter((item, index, self) =>
          index === self.findIndex((t) => t.time === item.time)
        );

        // 상한 체크: 최대 개수를 넘으면 가장 오래된 데이터부터 제거 (최신 데이터 우선 유지)
        const trimmedInitialData = uniqueData.length > MAX_CANDLE_COUNT
          ? uniqueData.slice(-MAX_CANDLE_COUNT) // 가장 최신 MAX_CANDLE_COUNT개만 유지
          : uniqueData;

        // 거래량 데이터도 정렬 및 중복 제거
        const sortedVolumeData = volumeData.sort((a, b) => a.time - b.time);
        const uniqueVolumeData = sortedVolumeData.filter((item, index, self) =>
          index === self.findIndex((t) => t.time === item.time)
        );
        const trimmedVolumeData = uniqueVolumeData.length > MAX_CANDLE_COUNT
          ? uniqueVolumeData.slice(-MAX_CANDLE_COUNT)
          : uniqueVolumeData;

        // 데이터 저장 및 업데이트
        allCandlestickDataRef.current = trimmedInitialData;
        allVolumeDataRef.current = trimmedVolumeData;
        candlestickSeriesRef.current.setData(trimmedInitialData);
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData(trimmedVolumeData);
        }

        // 라인 시리즈 업데이트
        updateLineSeries(trimmedInitialData);

        // 초기 로드 후 거래량 스케일 업데이트
        setTimeout(() => {
          if (updateVolumeScaleRef.current) {
            updateVolumeScaleRef.current();
          }
        }, 100);

        // 차트 뷰 설정 - 전체 데이터 표시
        if (chartRef.current && trimmedInitialData.length > 0) {
          const timeScale = chartRef.current.timeScale();
          
          // 시간축 표시 설정 강제 적용
          timeScale.applyOptions({
            timeVisible: true,
            secondsVisible: false,
            borderVisible: true,
            visible: true,
          });
          
          // 전체 데이터를 차트에 맞춰 표시
          timeScale.fitContent();

          // visible range 변경 감지 - 가장 오래된 봉이 화면에 보였을 때만 로드
          timeScale.subscribeVisibleTimeRangeChange((timeRange) => {
            if (!timeRange) return;

            // 거래량 스케일 업데이트 (화면에 보이는 범위의 최대 거래량 기준)
            if (updateVolumeScaleRef.current) {
              updateVolumeScaleRef.current();
            }

            // 초기 로드 시에는 무시 (fitContent() 호출로 인한 트리거 방지)
            if (isInitialLoadRef.current) {
              isInitialLoadRef.current = false;
              return;
            }

            // 기존 디바운스 타이머 취소
            if (debounceTimerRef.current) {
              clearTimeout(debounceTimerRef.current);
            }

            // 디바운스: 드래그/줌 종료 후 1초 뒤에 체크
            debounceTimerRef.current = setTimeout(() => {
              if (isLoadingMoreRef.current) return;

              const visibleFrom = timeRange.from as number;
              const currentData = allCandlestickDataRef.current;

              if (currentData.length === 0) return;

              // 현재 데이터의 가장 오래된 봉의 시간
              const dataOldestTime = currentData[0].time;
              
              // 가장 오래된 봉이 화면에 보이는지 확인 (화면 범위에 포함되어 있는지)
              // visibleFrom이 dataOldestTime보다 작거나 같으면 가장 오래된 봉이 화면에 보임
              if (visibleFrom <= dataOldestTime) {
                // 마지막 로드 체크 시간과 비교하여 중복 방지
                if (!lastLoadCheckTimeRef.current || 
                    Math.abs(visibleFrom - lastLoadCheckTimeRef.current) > 60) { // 1분 이상 차이날 때만
                  lastLoadCheckTimeRef.current = visibleFrom;
                  // 1500개 추가 로드
                  loadMoreHistoricalData(visibleFrom);
                }
              }
            }, DEBOUNCE_DELAY_MS);
          });

          // cleanup 함수에 디바운스 타이머 정리 추가
          return () => {
            if (debounceTimerRef.current) {
              clearTimeout(debounceTimerRef.current);
              debounceTimerRef.current = null;
            }
          };
        }

        setIsLoading(false);
      } catch (err) {
        console.error('차트 로드 에러:', err);
        const errorMessage = err instanceof Error ? err.message : '차트를 로드할 수 없습니다.';
        setError(errorMessage);
        setIsLoading(false);
      }
    };

    loadData();

    // 실시간 업데이트 함수 (최신 캔들만 업데이트)
    const updateLatestCandle = async () => {
      if (!chartRef.current || !candlestickSeriesRef.current || isLoadingMoreRef.current) return;

      try {
        // 최신 1개 캔들만 가져오기
        const klines = await getCandlestickData(symbol, timeframe, 1);
        
        if (!klines || klines.length === 0) return;

        const latestKline = klines[0];
        const latestCandle: CandlestickData = {
          time: (Math.floor(latestKline[0] / 1000) as Time),
          open: parseFloat(latestKline[1]),
          high: parseFloat(latestKline[2]),
          low: parseFloat(latestKline[3]),
          close: parseFloat(latestKline[4]),
        };

        const latestVolume: VolumeData = {
          time: (Math.floor(latestKline[0] / 1000) as Time),
          value: parseFloat(latestKline[5]),
          color: latestCandle.close >= latestCandle.open ? '#26a69a' : '#ef5350',
        };

        const currentData = allCandlestickDataRef.current;
        const currentVolumeData = allVolumeDataRef.current;
        
        if (currentData.length === 0) return;

        const lastCandle = currentData[currentData.length - 1];
        
        // 같은 시간대면 업데이트, 새로운 시간대면 추가
        if (lastCandle.time === latestCandle.time) {
          // 마지막 캔들 업데이트
          const updatedData = [...currentData];
          updatedData[updatedData.length - 1] = latestCandle;
          allCandlestickDataRef.current = updatedData;
          candlestickSeriesRef.current.update(latestCandle);
          
          // 거래량도 업데이트
          if (currentVolumeData.length > 0 && volumeSeriesRef.current) {
            const updatedVolumeData = [...currentVolumeData];
            updatedVolumeData[updatedVolumeData.length - 1] = latestVolume;
            allVolumeDataRef.current = updatedVolumeData;
            volumeSeriesRef.current.update(latestVolume);
          }
          
          // 현재가 라인 업데이트 (최신 close 가격)
          // 가격이 실제로 변경되었을 때만 업데이트하여 깜빡임 방지
          if (currentPriceLineRef.current && lastCurrentPriceRef.current !== latestCandle.close) {
            lastCurrentPriceRef.current = latestCandle.close;
            
            const firstTime = updatedData[0].time;
            const lastTime = updatedData[updatedData.length - 1].time;
            const timeRange = lastTime - firstTime;
            
            // 과거와 미래로 충분히 확장 (현재 데이터 범위의 10배)
            const extendedFrom = firstTime - (timeRange * 5);
            const extendedTo = lastTime + (timeRange * 5);

            // 가격이 변경되었을 때만 전체 라인 업데이트
            const currentPriceData: LineData[] = [
              { time: extendedFrom, value: latestCandle.close },
              { time: extendedTo, value: latestCandle.close }
            ];
            currentPriceLineRef.current.setData(currentPriceData);
          }
        } else if (latestCandle.time > lastCandle.time) {
          // 새로운 캔들 추가
          const newData = [...currentData, latestCandle];
          const newVolumeData = [...currentVolumeData, latestVolume];
          
          // 상한 체크: 최대 개수를 넘으면 가장 오래된 데이터부터 제거 (최신 데이터 우선 유지)
          const trimmedNewData = newData.length > MAX_CANDLE_COUNT
            ? newData.slice(-MAX_CANDLE_COUNT) // 가장 최신 MAX_CANDLE_COUNT개만 유지
            : newData;
          
          const trimmedNewVolumeData = newVolumeData.length > MAX_CANDLE_COUNT
            ? newVolumeData.slice(-MAX_CANDLE_COUNT)
            : newVolumeData;
          
          allCandlestickDataRef.current = trimmedNewData;
          allVolumeDataRef.current = trimmedNewVolumeData;
          candlestickSeriesRef.current.update(latestCandle);
          if (volumeSeriesRef.current) {
            volumeSeriesRef.current.update(latestVolume);
          }
          
          // 현재가 라인 업데이트 (최신 close 가격)
          // 가격이 실제로 변경되었을 때만 업데이트하여 깜빡임 방지
          if (currentPriceLineRef.current && lastCurrentPriceRef.current !== latestCandle.close) {
            lastCurrentPriceRef.current = latestCandle.close;
            
            const firstTime = trimmedNewData[0].time;
            const lastTime = trimmedNewData[trimmedNewData.length - 1].time;
            const timeRange = lastTime - firstTime;
            
            // 과거와 미래로 충분히 확장 (현재 데이터 범위의 10배)
            const extendedFrom = firstTime - (timeRange * 5);
            const extendedTo = lastTime + (timeRange * 5);

            // 가격이 변경되었을 때만 전체 라인 업데이트
            const currentPriceData: LineData[] = [
              { time: extendedFrom, value: latestCandle.close },
              { time: extendedTo, value: latestCandle.close }
            ];
            currentPriceLineRef.current.setData(currentPriceData);
          }
          
          // 라인 시리즈도 업데이트
          updateLineSeries(trimmedNewData);
        }
      } catch (err) {
        console.error('실시간 업데이트 에러:', err);
      }
    };

    // 모든 타임프레임에서 3초마다 업데이트
    const getUpdateInterval = (): number => {
      return 3000; // 3초
    };

    // 실시간 업데이트 시작 (현재 보고 있는 타임프레임만 업데이트)
    const interval = getUpdateInterval();
    updateIntervalRef.current = setInterval(updateLatestCandle, interval);

    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, dataLimit]);

  return (
    <div className="custom-chart-container" style={{ width, height }}>
      <div className="chart-controls">
        <div className="timeframe-selector">
          <label>타임프레임:</label>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
            className="timeframe-select"
          >
            {TIMEFRAMES.map(tf => (
              <option key={tf.value} value={tf.value}>
                {tf.label}
              </option>
            ))}
          </select>
        </div>
        <div className="chart-hint">
          💡 차트를 마우스로 좌우로 드래그하여 과거 데이터를 탐색할 수 있습니다
        </div>
      </div>
      {error && (
        <div className="chart-error">
          <p>{error}</p>
        </div>
      )}
      <div 
        ref={chartContainerRef}
        className="custom-chart-wrapper"
        style={{ width: '100%', height: `${height - 25}px`, display: error ? 'none' : 'block' }}
      />
      {!isLoading && !error && (
        <div className="chart-legend">
          <div className="legend-item">
            <span className="legend-color" style={{ background: '#ff6b6b' }}></span>
            <span>저항선</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ background: '#4ecdc4' }}></span>
            <span>지지선</span>
          </div>
          {stopLossInfo && (
            <>
              <div className="legend-item">
                <span className="legend-color" style={{ background: '#ff4757' }}></span>
                <span>손절선</span>
              </div>
              <div className="legend-item">
                <span className="legend-color" style={{ background: '#2ed573' }}></span>
                <span>익절선</span>
              </div>
            </>
          )}
          <div className="legend-item">
            <span className="legend-color" style={{ background: '#5352ed' }}></span>
            <span>현재가</span>
          </div>
          {adxResult && (
            <div className="legend-item adx-info">
              <span className="adx-label">ADX:</span>
              <span className={`adx-value ${
                adxResult.trend_strength === 'strong' ? 'strong' : 
                adxResult.trend_strength === 'moderate' ? 'moderate' : 'weak'
              }`}>
                {adxResult.adx.toFixed(1)}
              </span>
              <span className="adx-trend">
                ({adxResult.trend_strength === 'strong' ? '강함' : adxResult.trend_strength === 'moderate' ? '보통' : '약함'}, 
                {adxResult.trend_direction === 'down' ? '하락' : adxResult.trend_direction === 'up' ? '상승' : '중립'})
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
