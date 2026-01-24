import { useEffect, useRef, useState } from 'react';
import './TradingViewChart.css';

interface TradingViewChartProps {
  symbol: string;
  height?: number;
  width?: string;
}

export function TradingViewChart({ symbol, height = 300, width = '100%' }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // TradingView 스크립트가 로드되었는지 확인
    if (!(window as any).TradingView) {
      setError('TradingView 스크립트를 로드할 수 없습니다.');
      setIsLoading(false);
      return;
    }

    // 기존 위젯이 있으면 제거
    if (widgetRef.current) {
      widgetRef.current.remove();
    }

    // 바이낸스 선물 심볼 형식으로 변환 (예: BTCUSDT -> BINANCE:BTCUSDT.P)
    // TradingView에서 바이낸스 선물은 .P 확장자를 사용합니다
    const tradingViewSymbol = `BINANCE:${symbol}.P`;

    setIsLoading(true);
    setError(null);

    // TradingView 위젯 생성
    widgetRef.current = new (window as any).TradingView.widget({
      autosize: true,
      symbol: tradingViewSymbol,
      interval: '15',
      timezone: 'Asia/Seoul',
      theme: 'light',
      style: '1',
      locale: 'kr',
      toolbar_bg: '#f1f3f6',
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      container_id: containerRef.current.id,
      height: height,
      width: width,
      studies: [
        'RSI@tv-basicstudies',
        'MACD@tv-basicstudies'
      ],
      onready: () => {
        setIsLoading(false);
      },
      onerror: (error: any) => {
        console.error('TradingView chart error:', error);
        setIsLoading(false);
        setError('차트를 로드할 수 없습니다. 바이낸스 링크를 사용해주세요.');
      }
    });

    return () => {
      if (widgetRef.current) {
        widgetRef.current.remove();
        widgetRef.current = null;
      }
    };
  }, [symbol, height, width]);

  return (
    <div className="tradingview-chart-container" style={{ width, height }}>
      {isLoading && !error && (
        <div className="chart-loading">
          <div className="spinner-small"></div>
          <p>차트 로딩 중...</p>
        </div>
      )}
      {error && (
        <div className="chart-error">
          <p>{error}</p>
          <a
            href={`https://www.binance.com/en/futures/${symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="chart-error-link"
          >
            바이낸스에서 차트 보기
          </a>
        </div>
      )}
      <div 
        id={`tradingview_${symbol}`} 
        ref={containerRef}
        className="tradingview-widget-container"
        style={{ width: '100%', height: `${height}px`, display: error ? 'none' : 'block' }}
      />
    </div>
  );
}
