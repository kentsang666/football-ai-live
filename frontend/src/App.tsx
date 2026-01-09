import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LiveMatchDashboard } from './components/LiveMatchDashboard';
import { HistoryPage } from './components/HistoryPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LiveMatchDashboard />} />
        <Route path="/history" element={<HistoryPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
