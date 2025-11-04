import { createHashRouter } from 'react-router-dom';
import AppLayout, { AppLayoutContext } from './routes/AppLayout';
import HomePage from '@app/components/HomePage';
import AnalysisPage from '@app/components/AnalysisPage';
import InvestmentsPage from '@app/components/InvestmentsPage';
import BudgetsPage from '@app/components/BudgetsPage';
import SettingsPage from '@app/components/SettingsPage';
import { useOutletContext } from 'react-router-dom';

type OutletContext = AppLayoutContext;

const DashboardRoute: React.FC = () => {
  const { dataRefreshKey } = useOutletContext<OutletContext>();
  return <HomePage key={dataRefreshKey} />;
};

const AnalysisRoute: React.FC = () => {
  const { dataRefreshKey } = useOutletContext<OutletContext>();
  return <AnalysisPage key={`analysis-${dataRefreshKey}`} />;
};

const InvestmentsRoute: React.FC = () => {
  const { dataRefreshKey } = useOutletContext<OutletContext>();
  return <InvestmentsPage key={`investments-${dataRefreshKey}`} />;
};

const BudgetsRoute: React.FC = () => {
  const { dataRefreshKey } = useOutletContext<OutletContext>();
  return <BudgetsPage key={`budgets-${dataRefreshKey}`} />;
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
      { path: '/budgets', element: <BudgetsRoute /> },
      { path: '/settings', element: <SettingsRoute /> },
    ],
  },
]);
