import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Create from './pages/Create';
import Session from './pages/Session';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<Create />} />
        <Route path="/session/:id" element={<Session />} />
      </Routes>
    </BrowserRouter>
  );
}
