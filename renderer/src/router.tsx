import { lazy, Suspense, type ReactElement } from 'react';
import { Navigate, createHashRouter, useLocation } from 'react-router-dom';
import AppLayout from './routes/AppLayout';
import LoadingFallback from './components/LoadingFallback';
import { RouteErrorBoundaryShell } from './components/RouteErrorBoundary';

const HomePage = lazy(() => import('@renderer/features/dashboard/pages/HomePage'));
const MoneyReviewPage = lazy(() => import('@renderer/features/money-review/pages/MoneyReviewPage'));
const ActivityPage = lazy(() => import('@renderer/features/activity/pages/ActivityPage'));
const AnalysisPageNew = lazy(() => import('@renderer/features/analysis/pages/AnalysisPageNew'));
const InvestmentsPage = lazy(() => import('@renderer/features/investments/pages/InvestmentsPage'));
const SettingsPage = lazy(() => import('@renderer/features/settings/pages/SettingsPage'));

const withSuspense = (node: ReactElement) => (
  <Suspense fallback={<LoadingFallback />}>
    {node}
  </Suspense>
);

const DashboardRoute = () => withSuspense(<HomePage />);

const ReviewRoute = () => withSuspense(<MoneyReviewPage />);

const ActivityRoute = () => withSuspense(<ActivityPage />);

const AnalysisRoute = () => withSuspense(<AnalysisPageNew />);

const InvestmentsRoute = () => withSuspense(<InvestmentsPage />);

const SettingsRoute = () => withSuspense(<SettingsPage />);

const LegacyBudgetsRedirect = () => {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  searchParams.set('tab', 'budget');

  return (
    <Navigate
      replace
      to={{
        pathname: '/plan',
        search: `?${searchParams.toString()}`,
        hash: location.hash,
      }}
    />
  );
};

export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteErrorBoundaryShell />,
    children: [
      { path: '/', element: <DashboardRoute /> },
      { path: '/review', element: <ReviewRoute /> },
      { path: '/activity', element: <ActivityRoute /> },
      { path: '/plan', element: <AnalysisRoute /> },
      { path: '/wealth', element: <InvestmentsRoute /> },
      // Legacy deep links remain valid while v0.2 promotes the simpler IA.
      { path: '/analysis', element: <AnalysisRoute /> },
      { path: '/budgets', element: <LegacyBudgetsRedirect /> },
      { path: '/investments', element: <InvestmentsRoute /> },
      { path: '/settings', element: <SettingsRoute /> },
    ],
  },
], {
  future: {
    v7_startTransition: true,
  },
});
