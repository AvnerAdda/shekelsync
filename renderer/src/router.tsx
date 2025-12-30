import { lazy, Suspense } from 'react';
import { createHashRouter, useOutletContext } from 'react-router-dom';
import AppLayout, { AppLayoutContext } from './routes/AppLayout';

const HomePage = lazy(() => import('@renderer/features/dashboard/pages/HomePage'));
const AnalysisPageNew = lazy(() => import('@renderer/features/analysis/pages/AnalysisPageNew'));
const InvestmentsPage = lazy(() => import('@renderer/features/investments/pages/InvestmentsPage'));
const SettingsPage = lazy(() => import('@renderer/features/settings/pages/SettingsPage'));

type OutletContext = AppLayoutContext;

const withSuspense = (node: JSX.Element) => (
  <Suspense fallback={null}>
    {node}
  </Suspense>
);

const DashboardRoute = () => {
  const { dataRefreshKey } = useOutletContext<OutletContext>();
  return withSuspense(<HomePage key={dataRefreshKey} />);
};

const AnalysisRoute = () => {
  const { dataRefreshKey } = useOutletContext<OutletContext>();
  return withSuspense(<AnalysisPageNew key={`analysis-${dataRefreshKey}`} />);
};

const InvestmentsRoute = () => {
  const { dataRefreshKey } = useOutletContext<OutletContext>();
  return withSuspense(<InvestmentsPage key={`investments-${dataRefreshKey}`} />);
};

const SettingsRoute = () => {
  const { dataRefreshKey } = useOutletContext<OutletContext>();
  return withSuspense(<SettingsPage key={`settings-${dataRefreshKey}`} />);
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
