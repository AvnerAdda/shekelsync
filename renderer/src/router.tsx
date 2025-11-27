import { createHashRouter } from 'react-router-dom';
import AppLayout, { AppLayoutContext } from './routes/AppLayout';
import HomePage from '@renderer/features/dashboard/pages/HomePage';
import AnalysisPageNew from '@renderer/features/analysis/pages/AnalysisPageNew';
import InvestmentsPage from '@renderer/features/investments/pages/InvestmentsPage';
import SettingsPage from '@renderer/features/settings/pages/SettingsPage';
import { useOutletContext } from 'react-router-dom';

type OutletContext = AppLayoutContext;

const DashboardRoute: React.FC = () => {
  const { dataRefreshKey } = useOutletContext<OutletContext>();
  return <HomePage key={dataRefreshKey} />;
};

const AnalysisRoute: React.FC = () => {
  const { dataRefreshKey } = useOutletContext<OutletContext>();
  return <AnalysisPageNew key={`analysis-${dataRefreshKey}`} />;
};

const InvestmentsRoute: React.FC = () => {
  const { dataRefreshKey } = useOutletContext<OutletContext>();
  return <InvestmentsPage key={`investments-${dataRefreshKey}`} />;
};

const SettingsRoute: React.FC = () => {
  const { dataRefreshKey } = useOutletContext<OutletContext>();
  return <SettingsPage key={`settings-${dataRefreshKey}`} />;
};

export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { path: '/', element: <DashboardRoute /> },
      { path: '/analysis', element: <AnalysisRoute /> },
      { path: '/investments', element: <InvestmentsRoute /> },
      { path: '/settings', element: <SettingsRoute /> },
    ],
  },
], {
  future: {
    v7_startTransition: true,
  },
});
