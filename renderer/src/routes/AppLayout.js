import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppBar, Box, Toolbar, Typography, useTheme, } from '@mui/material';
import Sidebar from '@app/components/Sidebar';
import FinancialChatbot from '@app/components/FinancialChatbot';
import SmartNotifications from '@app/components/SmartNotifications';
import logoUrl from '@app/public/logo.svg?url';
const DRAWER_WIDTH_COLLAPSED = 65;
const pageToPath = {
    home: '/',
    analysis: '/analysis',
    investments: '/investments',
    budgets: '/budgets',
    settings: '/settings',
};
const pathToPage = (pathname) => {
    const match = Object.entries(pageToPath).find(([, value]) => value === pathname);
    return match ? match[0] : 'home';
};
const AppLayout = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const theme = useTheme();
    const [currentPage, setCurrentPage] = useState(() => pathToPage(location.pathname));
    const [dataRefreshKey, setDataRefreshKey] = useState(0);
    useEffect(() => {
        setCurrentPage(pathToPage(location.pathname));
    }, [location.pathname]);
    const handlePageChange = useCallback((page) => {
        setCurrentPage(page);
        const targetPath = pageToPath[page] ?? '/';
        if (location.pathname !== targetPath) {
            navigate(targetPath);
        }
    }, [location.pathname, navigate]);
    const handleDataRefresh = useCallback(() => {
        setDataRefreshKey((prev) => prev + 1);
        window.dispatchEvent(new Event('dataRefresh'));
    }, []);
    const outletContext = useMemo(() => ({ dataRefreshKey, triggerDataRefresh: handleDataRefresh }), [dataRefreshKey, handleDataRefresh]);
    return (_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', minHeight: '100vh' }, children: [_jsx(AppBar, { position: "fixed", sx: {
                    zIndex: (muiTheme) => muiTheme.zIndex.drawer + 1,
                    backgroundColor: 'background.paper',
                    color: 'text.primary',
                    boxShadow: 1,
                    borderBottom: `1px solid ${theme.palette.divider}`,
                }, children: _jsxs(Toolbar, { sx: { justifyContent: 'space-between' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsx("img", { src: logoUrl, alt: "ShekelSync", width: 32, height: 32 }), _jsx(Typography, { variant: "h6", component: "div", sx: { fontWeight: 600 }, children: "ShekelSync" })] }), _jsx(SmartNotifications, {})] }) }), _jsxs(Box, { sx: { display: 'flex', flexGrow: 1, mt: 8 }, children: [_jsx(Sidebar, { currentPage: currentPage, onPageChange: handlePageChange, onDataRefresh: handleDataRefresh }), _jsx(Box, { component: "main", sx: {
                            flexGrow: 1,
                            p: 3,
                            ml: { xs: 0, md: `${DRAWER_WIDTH_COLLAPSED}px` },
                            transition: theme.transitions.create(['margin'], {
                                easing: theme.transitions.easing.sharp,
                                duration: theme.transitions.duration.leavingScreen,
                            }),
                        }, children: _jsx(Outlet, { context: outletContext }) })] }), _jsx(FinancialChatbot, {})] }));
};
export default AppLayout;
