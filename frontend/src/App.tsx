import { Routes, Route } from 'react-router-dom';
import { useWebSocket } from '@/hooks/useWebSocket';
import Layout from '@/components/Layout';
import LiveDashboard from '@/pages/LiveDashboard';
import TelemetryCharts from '@/pages/TelemetryCharts';
import TrackMap from '@/pages/TrackMap';
import LapComparison from '@/pages/LapComparison';
import SessionTable from '@/pages/SessionTable';
import StatsAnalytics from '@/pages/StatsAnalytics';
import SetupConfig from '@/pages/SetupConfig';
import SessionViewer from '@/pages/SessionViewer';

function App() {
  useWebSocket();
  
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<LiveDashboard />} />
        <Route path="/charts" element={<TelemetryCharts />} />
        <Route path="/track" element={<TrackMap />} />
        <Route path="/compare" element={<LapComparison />} />
        <Route path="/sessions" element={<SessionTable />} />
        <Route path="/session/:sessionId" element={<SessionViewer />} />
        <Route path="/stats" element={<StatsAnalytics />} />
        <Route path="/setup" element={<SetupConfig />} />
      </Routes>
    </Layout>
  );
}

export default App;
