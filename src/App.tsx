import { useState } from 'react';
import { TopGainers } from './components/TopGainers';
import { ShortAnalysis } from './components/ShortAnalysis';
import './App.css';

type Mode = 'gainers' | 'short' | 'calendar';

function App() {
  const [mode, setMode] = useState<Mode>('gainers');

  return (
    <div className="app">
      <nav className="nav">
        <h1 className="nav-title">바이낸스 선물 시장 분석</h1>
        <div className="nav-buttons">
          <button
            className={`nav-button ${mode === 'gainers' ? 'active' : ''}`}
            onClick={() => setMode('gainers')}
          >
            상승률 상위 10개
          </button>
          <button
            className={`nav-button ${mode === 'short' ? 'active' : ''}`}
            onClick={() => setMode('short')}
          >
            Short 적합도 분석
          </button>
          <button
            className={`nav-button ${mode === 'calendar' ? 'active' : ''}`}
            onClick={() => setMode('calendar')}
          >
            경제 캘린더
          </button>
        </div>
      </nav>

      <main className="main-content">
        {mode === 'gainers' && <TopGainers />}
        {mode === 'short' && <ShortAnalysis />}
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
