import { useState, useEffect } from 'react';
import { getTradingSymbols, getTicker24hr, getFundingRates } from '../utils/api';
import { formatVolume, getFundingSymbol, calculateFundingPeriod } from '../utils/analysis';
import type { TopGainer } from '../types';
import { CustomChart } from './CustomChart';
import './TopGainers.css';

export function TopGainers() {
  const [gainers, setGainers] = useState<TopGainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [expandedChart, setExpandedChart] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    avgChange: number;
    totalVolume: number;
    maxGainer: TopGainer | null;
    minGainer: TopGainer | null;
    avgFunding: number;
    positiveFundingCount: number;
    negativeFundingCount: number;
  } | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [tradingSymbols, tickers, fundingDict] = await Promise.all([
        getTradingSymbols(),
        getTicker24hr(),
        getFundingRates()
      ]);

      // 상승률이 양수인 거래 가능한 코인만 필터링
      const validTickers = tickers
        .filter(ticker => 
          tradingSymbols.has(ticker.symbol) && 
          parseFloat(ticker.priceChangePercent) > 0
        )
        .map(ticker => {
          const fundingInfo = fundingDict[ticker.symbol] || { lastFundingRate: 0, nextFundingTime: 0 };
          const fundingPeriod = calculateFundingPeriod(fundingInfo.nextFundingTime);
          return {
            symbol: ticker.symbol,
            priceChangePercent: parseFloat(ticker.priceChangePercent),
            quoteVolume: parseFloat(ticker.quoteVolume),
            lastPrice: parseFloat(ticker.lastPrice),
            highPrice: parseFloat(ticker.highPrice),
            lowPrice: parseFloat(ticker.lowPrice),
            count: parseInt(ticker.count, 10),
            fundingRate: (fundingInfo.lastFundingRate || 0) * 100,
            fundingSymbol: getFundingSymbol((fundingInfo.lastFundingRate || 0) * 100),
            nextFundingTime: fundingInfo.nextFundingTime || 0,
            fundingPeriod: fundingPeriod
          };
        })
        .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
        .slice(0, 10);

      setGainers(validTickers);

      // 통계 계산
      const avgChange = validTickers.reduce((sum, t) => sum + t.priceChangePercent, 0) / validTickers.length;
      const totalVolume = validTickers.reduce((sum, t) => sum + t.quoteVolume, 0);
      const maxGainer = validTickers.reduce((max, t) => 
        t.priceChangePercent > max.priceChangePercent ? t : max
      );
      const minGainer = validTickers.reduce((min, t) => 
        t.priceChangePercent < min.priceChangePercent ? t : min
      );
      const fundingRates = validTickers.map(t => t.fundingRate);
      const avgFunding = fundingRates.reduce((sum, r) => sum + r, 0) / fundingRates.length;
      const positiveFundingCount = fundingRates.filter(r => r > 0.01).length;
      const negativeFundingCount = fundingRates.filter(r => r < -0.01).length;

      setStats({
        avgChange,
        totalVolume,
        maxGainer,
        minGainer,
        avgFunding,
        positiveFundingCount,
        negativeFundingCount
      });

      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터를 가져오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // 30초마다 자동 업데이트
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading && gainers.length === 0) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>바이낸스 선물 시장 데이터 수집 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <p>오류: {error}</p>
        <button onClick={fetchData}>다시 시도</button>
      </div>
    );
  }

  return (
    <div className="top-gainers">
      <div className="header">
        <h1>바이낸스 선물 상승률 상위 10개 코인 분석</h1>
        {lastUpdate && (
          <p className="update-time">
            업데이트 시간: {lastUpdate.toLocaleString('ko-KR')}
          </p>
        )}
        <button onClick={fetchData} className="refresh-btn" disabled={loading}>
          {loading ? '업데이트 중...' : '새로고침'}
        </button>
      </div>

      <div className="gainers-list">
        {gainers.map((gainer, idx) => (
          <div key={gainer.symbol} className="gainer-card">
            <div className="gainer-rank">#{idx + 1}</div>
            <div className="gainer-content">
              <div className="gainer-title-section">
                <h2>
                  <a 
                    href={`https://www.binance.com/en/futures/${gainer.symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="coin-link"
                    title="바이낸스 선물 거래 페이지에서 보기"
                  >
                    {gainer.symbol}
                  </a>
                </h2>
                <div className="chart-buttons">
                  <button
                    onClick={() => {
                      if (expandedChart === gainer.symbol) {
                        setExpandedChart(null);
                      } else {
                        setExpandedChart(gainer.symbol);
                      }
                    }}
                    className="chart-toggle-btn"
                    title="차트 토글"
                  >
                    {expandedChart === gainer.symbol ? '📉 차트 숨기기' : '📈 차트 보기'}
                  </button>
                  <a
                    href={`https://www.binance.com/en/futures/${gainer.symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chart-btn"
                    title="바이낸스에서 보기"
                  >
                    🔗 바이낸스
                  </a>
                </div>
              </div>
              {expandedChart === gainer.symbol && (
                <div className="chart-section">
                  <CustomChart symbol={gainer.symbol} height={400} />
                </div>
              )}
              <div className="gainer-stats">
                <div className="stat-item">
                  <span className="stat-label">24시간 상승률:</span>
                  <span className="stat-value positive">+{gainer.priceChangePercent.toFixed(2)}%</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">현재가:</span>
                  <span className="stat-value">${gainer.lastPrice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">거래량:</span>
                  <span className="stat-value">{formatVolume(gainer.quoteVolume)} USDT</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">펀딩비({gainer.fundingPeriod}h):</span>
                  <span className={`stat-value ${gainer.fundingRate > 0.01 ? 'long-fee' : gainer.fundingRate < -0.01 ? 'short-fee' : ''}`}>
                    {gainer.fundingRate.toFixed(4)}% {gainer.fundingSymbol}
                  </span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">고가:</span>
                  <span className="stat-value">${gainer.highPrice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">저가:</span>
                  <span className="stat-value">${gainer.lowPrice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">거래 건수:</span>
                  <span className="stat-value">{gainer.count.toLocaleString()}건</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {stats && (
        <div className="summary-stats">
          <h2>요약 통계</h2>
          <div className="stats-grid">
            <div className="stat-box">
              <span className="stat-box-label">평균 상승률</span>
              <span className="stat-box-value">{stats.avgChange.toFixed(2)}%</span>
            </div>
            <div className="stat-box">
              <span className="stat-box-label">최고 상승률</span>
              <span className="stat-box-value">
                {stats.maxGainer?.symbol} ({stats.maxGainer?.priceChangePercent.toFixed(2)}%)
              </span>
            </div>
            <div className="stat-box">
              <span className="stat-box-label">최저 상승률</span>
              <span className="stat-box-value">
                {stats.minGainer?.symbol} ({stats.minGainer?.priceChangePercent.toFixed(2)}%)
              </span>
            </div>
            <div className="stat-box">
              <span className="stat-box-label">총 거래량</span>
              <span className="stat-box-value">${stats.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDT</span>
            </div>
            <div className="stat-box">
              <span className="stat-box-label">평균 펀딩비</span>
              <span className="stat-box-value">{stats.avgFunding.toFixed(4)}%</span>
            </div>
            <div className="stat-box">
              <span className="stat-box-label">LONG 수수료 코인</span>
              <span className="stat-box-value">{stats.positiveFundingCount}개</span>
            </div>
            <div className="stat-box">
              <span className="stat-box-label">SHORT 수수료 코인</span>
              <span className="stat-box-value">{stats.negativeFundingCount}개</span>
            </div>
          </div>
        </div>
      )}

      <div className="top-3-highlight">
        <h2>상위 3개 코인</h2>
        <div className="top-3-list">
          {gainers.slice(0, 3).map((gainer, idx) => (
            <div key={gainer.symbol} className="top-3-card">
              <div className="top-3-rank">[{idx + 1}위]</div>
              <div className="top-3-info">
                <h3>
                  <a 
                    href={`https://www.binance.com/en/futures/${gainer.symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="coin-link"
                    title="바이낸스 선물 거래 페이지에서 보기"
                  >
                    {gainer.symbol}
                  </a>
                </h3>
                <a
                  href={`https://www.binance.com/en/futures/${gainer.symbol}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="chart-btn-small"
                  title="차트 보기"
                >
                  📈 차트 보기
                </a>
                <p>상승률: <strong>+{gainer.priceChangePercent.toFixed(2)}%</strong></p>
                <p>펀딩비({gainer.fundingPeriod}h): <strong>{gainer.fundingRate.toFixed(4)}%</strong></p>
                <p>거래량: <strong>${gainer.quoteVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDT</strong></p>
                <p>가격: <strong>${gainer.lastPrice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</strong></p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
