import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useWebSocket } from '@/hooks/useWebSocket';
import Layout from '@/components/Layout';
import LiveDashboard from '@/pages/LiveDashboard';
import Recorded from '@/pages/Recorded';
import SetupConfig from '@/pages/SetupConfig';

function App() {
  useWebSocket();

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<LiveDashboard />} />
        <Route path="/recorded" element={<Recorded />} />
        <Route path="/recorded/:sessionId" element={<Recorded />} />
        <Route path="/setup" element={<SetupConfig />} />
        {/* Old entry points: everything recorded now lives on one page */}
        <Route path="/compare" element={<Navigate to="/recorded" replace />} />
        <Route path="/sessions" element={<Navigate to="/recorded" replace />} />
        <Route path="/stats" element={<Navigate to="/recorded" replace />} />
        <Route path="/session/:sessionId" element={<RedirectSession />} />
      </Routes>
    </Layout>
  );
}

function RedirectSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <Navigate to={sessionId ? `/recorded/${sessionId}` : '/recorded'} replace />;
}

export default App;
