import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../apps/desktop/src/app/App';
import { ErrorBoundary } from '../../apps/desktop/src/app/ErrorBoundary';
import { installSyntheticToolApi } from './fixture-api';
import '../../apps/desktop/src/ui/styles.css';

installSyntheticToolApi(new URLSearchParams(location.search).get('scenario') ?? 'gmail');
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary>
  <span className="synthetic-tool-qa-label" style={{ position: 'fixed', top: 10, right: 18, zIndex: 100, padding: '5px 10px', borderRadius: 8,
    background: '#f1edff', color: '#625687', fontSize: 11, pointerEvents: 'none' }}>합성 QA 데이터 · 외부 전송 없음</span>
</StrictMode>);
