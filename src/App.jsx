import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Create from './pages/Create';
import Session from './pages/Session';
import { useTTLCleanup } from './hooks/useSession';

/**
 * AppRoutes must live inside BrowserRouter so it can use router hooks,
 * and as a separate component so we can call hooks (useTTLCleanup) here.
 */
function AppRoutes() {
  // Run TTL cleanup once per app load for sessions this device hosted.
  useTTLCleanup();

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/create" element={<Create />} />
      <Route path="/session/:id" element={<Session />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
