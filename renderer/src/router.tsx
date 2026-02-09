import { lazy, Suspense } from 'react';
import { createHashRouter } from 'react-router-dom';
import AppLayout from './routes/AppLayout';
import LoadingFallback from './components/LoadingFallback';

const HomePage = lazy(() => import('@renderer/features/dashboard/pages/HomePage'));
const AnalysisPageNew = lazy(() => import('@renderer/features/analysis/pages/AnalysisPageNew'));
const InvestmentsPage = lazy(() => import('@renderer/features/investments/pages/InvestmentsPage'));
const SettingsPage = lazy(() => import('@renderer/features/settings/pages/SettingsPage'));

const withSuspense = (node: JSX.Element) => (
  <Suspense fallback={<LoadingFallback />}>
    {node}
  </Suspense>
);

const DashboardRoute = () => withSuspense(<HomePage />);

const AnalysisRoute = () => withSuspense(<AnalysisPageNew />);

const InvestmentsRoute = () => withSuspense(<InvestmentsPage />);

const SettingsRoute = () => withSuspense(<SettingsPage />);

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
