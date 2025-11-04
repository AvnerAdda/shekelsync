import { jsx as _jsx } from "react/jsx-runtime";
import { createHashRouter } from 'react-router-dom';
import AppLayout from './routes/AppLayout';
import HomePage from '@app/components/HomePage';
import AnalysisPage from '@app/components/AnalysisPage';
import InvestmentsPage from '@app/components/InvestmentsPage';
import BudgetsPage from '@app/components/BudgetsPage';
import SettingsPage from '@app/components/SettingsPage';
import { useOutletContext } from 'react-router-dom';
const DashboardRoute = () => {
    const { dataRefreshKey } = useOutletContext();
    return _jsx(HomePage, {}, dataRefreshKey);
};
const InvestmentsRoute = () => {
    const { dataRefreshKey } = useOutletContext();
    return _jsx(InvestmentsPage, {}, dataRefreshKey);
};
export const router = createHashRouter([
    {
        path: '/',
        element: _jsx(AppLayout, {}),
        children: [
            { path: '/', element: _jsx(DashboardRoute, {}) },
            { path: '/analysis', element: _jsx(AnalysisPage, {}) },
            { path: '/investments', element: _jsx(InvestmentsRoute, {}) },
            { path: '/budgets', element: _jsx(BudgetsPage, {}) },
            { path: '/settings', element: _jsx(SettingsPage, {}) },
        ],
    },
]);
