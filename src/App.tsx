import { useState, useEffect } from 'react';
import { TopGainers } from './components/TopGainers';
import { ShortAnalysis } from './components/ShortAnalysis';
import { LongAnalysis } from './components/LongAnalysis';
import './App.css';

type Mode = 'gainers' | 'short' | 'long' | 'calendar';

const STORAGE_KEY = 'binance-futures-max-coins';
const DEFAULT_MAX_COINS = 10;

function App() {
  const [mode, setMode] = useState<Mode>('short');
  const [maxCoins, setMaxCoins] = useState<number>(DEFAULT_MAX_COINS);

  // localStorage에서 설정 불러오기
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
        setMaxCoins(parsed);
      }
    }
  }, []);

  return (
    <div className="app">
      <nav className="nav">
        <h1 className="nav-title">바이낸스 선물 시장 분석</h1>
        <div className="nav-right">
          <div className="nav-buttons">
            <button
              className={`nav-button ${mode === 'short' ? 'active' : ''}`}
              onClick={() => setMode('short')}
            >
              Short 적합도 분석
            </button>
            <button
              className={`nav-button ${mode === 'long' ? 'active' : ''}`}
              onClick={() => setMode('long')}
            >
              Long 적합도 분석
            </button>
            <button
              className={`nav-button ${mode === 'calendar' ? 'active' : ''}`}
              onClick={() => setMode('calendar')}
            >
              경제 캘린더
            </button>
          </div>
        </div>
      </nav>

      <main className="main-content">
        {mode === 'gainers' && <TopGainers maxCoins={maxCoins} />}
        {mode === 'short' && <ShortAnalysis maxCoins={maxCoins} />}
        {mode === 'long' && <LongAnalysis maxCoins={maxCoins} />}
        {mode === 'calendar' && (
          <div style={{ width: '100%', height: '100vh', border: 'none' }}>
            <iframe
              src="https://kr.investing.com/economic-calendar/"
              style={{ width: '100%', height: '100%', border: 'none' }}
              title="경제 캘린더"
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
