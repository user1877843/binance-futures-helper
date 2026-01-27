import type { DayHourPattern } from '../utils/hourlyPattern';
import './DayHourHeatmap.css';

interface DayHourHeatmapProps {
  pattern: DayHourPattern;
}

/** 9시부터 표시하는 시간 순서: 9, 10, ..., 23, 0, 1, ..., 8, 9(다음날) */
const HOUR_ORDER = [
  ...Array.from({ length: 15 }, (_, i) => i + 9), // 9~23
  ...Array.from({ length: 9 }, (_, i) => i),      // 0~8
  24                                              // 다음날 9시 (인덱스 24에 저장됨)
];

export function DayHourHeatmap({ pattern }: DayHourHeatmapProps) {
  const { data, dayNames } = pattern;

  // 모든 변화량을 수집하여 최대/최소값 계산 (색상 스케일용)
  const allChanges = data.flatMap(day => day.map(h => h.avgChange));
  const maxChange = Math.max(...allChanges.map(Math.abs), 0.1);
  const minChange = -maxChange;

  // 색상 계산 (9:00 기준 변화량)
  const getColor = (avgChange: number) => {
    if (avgChange === 0) return '#f0f0f0'; // 9:00는 회색
    
    // 정규화: -maxChange ~ +maxChange -> 0 ~ 1
    const normalized = (avgChange - minChange) / (maxChange - minChange);
    
    if (avgChange > 0) {
      // 상승: 초록색 계열 (밝은 초록 -> 진한 초록)
      const intensity = Math.min(normalized * 1.5, 1); // 더 진하게
      return `rgba(38, 166, 154, ${0.3 + intensity * 0.7})`; // #26a69a
    } else {
      // 하락: 빨간색 계열 (밝은 빨강 -> 진한 빨강)
      const intensity = Math.min((1 - normalized) * 1.5, 1);
      return `rgba(239, 83, 80, ${0.3 + intensity * 0.7})`; // #ef5350
    }
  };

  // 텍스트 색상 (배경에 따라 가독성 확보)
  const getTextColor = (avgChange: number) => {
    if (avgChange === 0) return '#999';
    const absChange = Math.abs(avgChange);
    return absChange > maxChange * 0.3 ? '#fff' : '#333';
  };

  return (
    <div className="day-hour-heatmap-container">
      <div className="heatmap-header">
        <div className="heatmap-legend">
          <div className="legend-item">
            <span className="legend-color" style={{ background: 'rgba(38, 166, 154, 1)' }}></span>
            <span>상승 (9:00 대비 양수)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ background: 'rgba(239, 83, 80, 1)' }}></span>
            <span>하락 (9:00 대비 음수)</span>
          </div>
        </div>
      </div>
      <div className="heatmap-wrapper">
        <table className="day-hour-table">
          <thead>
            <tr>
              <th className="day-header">요일</th>
              {HOUR_ORDER.map((h) => (
                <th key={h} className="hour-header">
                  {h === 24 ? '9' : h}시
                  {h === 24 && <span className="next-day-label">(익)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((dayData, dayIndex) => (
              <tr key={dayIndex}>
                <td className="day-label">{dayNames[dayIndex]}</td>
                {HOUR_ORDER.map((hour) => {
                  const hourData = dayData[hour];
                  const color = getColor(hourData.avgChange);
                  const textColor = getTextColor(hourData.avgChange);
                  return (
                    <td
                      key={hour}
                      className="heatmap-cell"
                      style={{
                        backgroundColor: color,
                        color: textColor,
                      }}
                      title={`${dayNames[dayIndex]} ${hour === 24 ? '다음날 9' : hour}:00 (9:00 기준)\n평균 변화량: ${hourData.avgChange > 0 ? '+' : ''}${hourData.avgChange.toFixed(2)}%\n데이터 수: ${hourData.totalCount}일`}
                    >
                      {hourData.avgChange !== 0 && (
                        <span className="cell-value">
                          {hourData.avgChange > 0 ? '+' : ''}
                          {hourData.avgChange.toFixed(1)}%
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
