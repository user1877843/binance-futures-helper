import { useEffect, useState } from 'react';
import type { HourlyPattern } from '../utils/hourlyPattern';
import './HourlyPatternChart.css';

interface HourlyPatternChartProps {
  pattern: HourlyPattern;
}

export function HourlyPatternChart({ pattern }: HourlyPatternChartProps) {
  const [chartWidth, setChartWidth] = useState(1000);
  
  useEffect(() => {
    const updateWidth = () => {
      const w = window.innerWidth;
      const width = Math.min(Math.floor(w * 0.85), 1200);
      setChartWidth(Math.max(800, width));
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const hours = pattern.hours;
  // 최대/최소 변화량을 고려한 Y축 범위 계산
  const allMaxChanges = hours.flatMap(h => [h.maxChange, h.minChange]);
  const maxAbsChange = Math.max(...allMaxChanges.map(Math.abs), 0.1);
  const chartHeight = 350;
  const candlestickWidth = chartWidth / 24 * 0.6; // 캔들 너비
  const gap = (chartWidth - 24 * candlestickWidth) / 23; // 캔들 사이 간격
  const padding = 50;
  const bottomPadding = 20;

  // Y축 스케일 계산 (0% 기준)
  const yScale = (value: number) => {
    const range = maxAbsChange * 2;
    if (range === 0) return padding + chartHeight / 2;
    return padding + chartHeight - ((value + maxAbsChange) / range) * chartHeight;
  };

  // 캔들 색상 결정 (평균 변화량 기준)
  const getCandleColor = (avgChange: number) => {
    return avgChange >= 0 ? '#26a69a' : '#ef5350'; // 상승: 초록, 하락: 빨강
  };

  return (
    <div className="hourly-pattern-chart-container">
      <div className="chart-header">
        <div className="chart-legend">
          <div className="legend-item">
            <span className="legend-color" style={{ background: '#26a69a' }}></span>
            <span>상승 (9:00 대비 양수)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ background: '#ef5350' }}></span>
            <span>하락 (9:00 대비 음수)</span>
          </div>
        </div>
      </div>
      <div className="chart-wrapper">
        <svg 
          width={chartWidth + padding * 2} 
          height={chartHeight + padding + bottomPadding} 
          className="hourly-chart-svg"
          style={{ userSelect: 'none', touchAction: 'none' }}
        >
          {/* 배경 그리드 */}
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#e0e0e0" strokeWidth="0.5"/>
            </pattern>
          </defs>
          <rect width={chartWidth + padding * 2} height={chartHeight + padding * 2} fill="url(#grid)" />
          
          {/* 0% 기준선 (9:00 기준) */}
          <line
            x1={padding}
            y1={padding + chartHeight / 2}
            x2={padding + chartWidth}
            y2={padding + chartHeight / 2}
            stroke="#666"
            strokeWidth="2"
            strokeDasharray="5,5"
          />
          
          {/* 캔들스틱 차트: 해당 시간대만 사용. Open=avg-std, Close=avg+std, 몸통=분산 */}
          {hours.map((hourPattern, index) => {
            const candleX = padding + index * (candlestickWidth + gap);
            const candleCenterX = candleX + candlestickWidth / 2;
            
            const high = hourPattern.maxChange;
            const low = hourPattern.minChange;
            const avg = hourPattern.avgChange;
            const std = hourPattern.stdChange ?? 0;
            
            // 몸통: avg ± std. 상승봉은 open < close, 하락봉은 open > close
            const spread = Math.max(std * 2, (high - low) * 0.15, 0.02);
            const half = spread / 2;
            let openVal: number;
            let closeVal: number;
            if (avg >= 0) {
              openVal = avg - half;
              closeVal = avg + half;
            } else {
              openVal = avg + half;
              closeVal = avg - half;
            }
            openVal = Math.max(low, Math.min(high, openVal));
            closeVal = Math.max(low, Math.min(high, closeVal));
            if (openVal === closeVal) {
              const eps = 0.01;
              openVal = avg >= 0 ? Math.max(low, avg - eps) : Math.min(high, avg + eps);
              closeVal = avg >= 0 ? Math.min(high, avg + eps) : Math.max(low, avg - eps);
            }
            
            const highY = yScale(high);
            const lowY = yScale(low);
            const openY = yScale(openVal);
            const closeY = yScale(closeVal);
            
            const bodyTop = Math.min(openY, closeY);
            const bodyBottom = Math.max(openY, closeY);
            const bodyHeight = Math.max(bodyBottom - bodyTop, 2);
            
            const candleColor = getCandleColor(avg);
            
            return (
              <g key={hourPattern.hour}>
                {/* 위꼬리 (High) */}
                <line
                  x1={candleCenterX}
                  y1={highY}
                  x2={candleCenterX}
                  y2={bodyTop}
                  stroke={candleColor}
                  strokeWidth="1.5"
                />
                
                {/* 캔들 body */}
                <rect
                  x={candleX}
                  y={bodyTop}
                  width={candlestickWidth}
                  height={bodyHeight}
                  fill={candleColor}
                  stroke={candleColor}
                  strokeWidth="1"
                  opacity={0.8}
                />
                
                {/* 아래꼬리 (Low) */}
                <line
                  x1={candleCenterX}
                  y1={bodyBottom}
                  x2={candleCenterX}
                  y2={lowY}
                  stroke={candleColor}
                  strokeWidth="1.5"
                />
                
                {/* 시간 라벨 (상단) */}
                <text
                  x={candleCenterX}
                  y={padding - 10}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#333"
                  fontWeight="600"
                  className="hour-label-top"
                >
                  {hourPattern.hour}시
                </text>
                
                {/* 툴팁 */}
                <title>
                  {hourPattern.hour}:00 (9:00 기준){'\n'}
                  평균 변화량: {avg > 0 ? '+' : ''}{avg.toFixed(2)}%{'\n'}
                  최대: {high > 0 ? '+' : ''}{high.toFixed(2)}%{'\n'}
                  최소: {low > 0 ? '+' : ''}{low.toFixed(2)}%{'\n'}
                  데이터 수: {hourPattern.totalCount}일
                </title>
              </g>
            );
          })}
          
          {/* Y축 라벨 */}
          <text
            x={padding - 10}
            y={padding + chartHeight / 2 + 4}
            textAnchor="end"
            fontSize="12"
            fill="#666"
            fontWeight="600"
          >
            0% (9:00 기준)
          </text>
          <text
            x={padding - 10}
            y={padding + 10}
            textAnchor="end"
            fontSize="12"
            fill="#666"
          >
            +{maxAbsChange.toFixed(2)}%
          </text>
          <text
            x={padding - 10}
            y={padding + chartHeight - 10}
            textAnchor="end"
            fontSize="12"
            fill="#666"
          >
            -{maxAbsChange.toFixed(2)}%
          </text>
        </svg>
      </div>
      <div className="chart-footer">
        <div className="chart-summary">
          <div className="summary-item">
            <span className="summary-label">최대 하락 시간대:</span>
            <span className="summary-value best">
              {pattern.bestHour}:00
            </span>
            <span className="summary-detail">
              (평균: {pattern.hours[pattern.bestHour]?.avgChange > 0 ? '+' : ''}{pattern.hours[pattern.bestHour]?.avgChange.toFixed(2) || '0.00'}%)
            </span>
          </div>
          <div className="summary-item">
            <span className="summary-label">최대 상승 시간대:</span>
            <span className="summary-value worst">
              {pattern.worstHour}:00
            </span>
            <span className="summary-detail">
              (평균: {pattern.hours[pattern.worstHour]?.avgChange > 0 ? '+' : ''}{pattern.hours[pattern.worstHour]?.avgChange.toFixed(2) || '0.00'}%)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
