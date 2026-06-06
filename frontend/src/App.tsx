import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import JoinPage from './pages/JoinPage';
import CreatePage from './pages/CreatePage';
import LobbyPage from './pages/LobbyPage';
import GamePage from './pages/GamePage';
import SettlementPage from './pages/SettlementPage';

function App() {
  return (
    <div
      style={{
        '--adm-color-primary': '#7c3aed',
        '--adm-color-success': '#10b981',
        '--adm-color-danger': '#ef4444',
        '--adm-color-warning': '#f59e0b',
      } as React.CSSProperties}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/join" replace />} />
          <Route path="/join" element={<JoinPage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/lobby/:gameId" element={<LobbyPage />} />
          <Route path="/game/:gameId" element={<GamePage />} />
          <Route path="/settlement/:gameId" element={<SettlementPage />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
