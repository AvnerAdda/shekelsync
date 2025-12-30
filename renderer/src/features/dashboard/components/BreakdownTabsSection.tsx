import React from 'react';
import {
  Box,
  Paper,
  Tabs,
  Tab,
  Grid,
  CircularProgress,
  Typography,
  Alert,
  AlertTitle,
  useTheme,
  alpha,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartTooltip } from 'recharts';
import { format } from 'date-fns';
import SankeyChart from './SankeyChart';
import BreakdownPanel from '@renderer/features/breakdown/BreakdownPanel';
import { PortfolioBreakdownItem } from '@renderer/types/investments';
import { useDashboardFilters } from '../DashboardFiltersContext';
import { useTranslation } from 'react-i18next';

interface PortfolioPieChartProps {
  title: string;
  data: any[];
  total: number;
  hint: string;
  emptyTitle: string;
  emptyHint: string;
  color: string;
  chartColors: string[];
  formatCurrencyValue: (value: number) => string;
}

const PortfolioPieChart: React.FC<PortfolioPieChartProps> = ({
  title,
  data,
  total,
  hint,
  emptyTitle,
  emptyHint,
  color,
  chartColors,
  formatCurrencyValue,
}) => {
  const theme = useTheme();
  
  return (
    <Paper
      sx={{
        p: 3,
        height: '100%',
        background: alpha(theme.palette.background.paper, 0.4),
        backdropFilter: 'blur(10px)',
        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        borderRadius: 3,
        boxShadow: theme.shadows[4],
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: theme.shadows[8],
        },
      }}
    >
      <Typography variant="h6" gutterBottom sx={{ color, fontWeight: 600 }}>
        {title}
      </Typography>
      {data.length > 0 ? (
        <>
          <Box sx={{ height: 300, position: 'relative' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {data.map((entry, index) => (
                    <Cell 
                      // eslint-disable-next-line react/no-array-index-key
                      key={`cell-${index}`} 
                      fill={chartColors[index % chartColors.length]} 
                    />
                  ))}
                </Pie>
                <RechartTooltip 
                  formatter={(value: number) => formatCurrencyValue(value)}
                  contentStyle={{
                    backgroundColor: alpha(theme.palette.background.paper, 0.8),
                    backdropFilter: 'blur(10px)',
                    borderRadius: 12,
                    border: `1px solid ${alpha(theme.palette.common.white, 0.1)}`,
                    color: theme.palette.text.primary,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                    padding: '8px 12px',
                  }}
                  itemStyle={{ color: theme.palette.text.primary, fontSize: '0.875rem', fontWeight: 600 }}
                  labelStyle={{ color: theme.palette.text.secondary, fontSize: '0.75rem', marginBottom: '4px' }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center Text */}
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center',
                pointerEvents: 'none',
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1 }}>
                Total
              </Typography>
              <Typography variant="body2" fontWeight={700} sx={{ color: theme.palette.text.primary }}>
                {formatCurrencyValue(total)}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Typography variant="body2" fontWeight="bold" sx={{ color }}>
              {formatCurrencyValue(total)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {hint}
            </Typography>
          </Box>
        </>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300 }}>
          <Typography variant="body2" color="text.secondary">
            {emptyTitle}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            {emptyHint}
          </Typography>
        </Box>
      )}
    </Paper>
  );
};

interface BreakdownTabsSectionProps {
  selectedBreakdownType: 'overall' | 'income' | 'expense' | 'investment';
  onSelectBreakdown: (value: 'overall' | 'income' | 'expense' | 'investment') => void;
  waterfallData: any;
  waterfallLoading: boolean;
  liquidPortfolio: any[];
  restrictedPortfolio: any[];
  formatCurrencyValue: (value: number) => string;
  breakdownData: Record<string, any>;
  breakdownLoading: Record<string, boolean>;
  hasBankAccounts: boolean | null;
  data: any;
  chartColors: string[];
}

const BreakdownTabsSection: React.FC<BreakdownTabsSectionProps> = ({
  selectedBreakdownType,
  onSelectBreakdown,
  waterfallData,
  waterfallLoading,
  liquidPortfolio,
  restrictedPortfolio,
  formatCurrencyValue,
  breakdownData,
  breakdownLoading,
  hasBankAccounts,
  data,
  chartColors,
}) => {
  const { startDate, endDate } = useDashboardFilters();
  const { t } = useTranslation('translation', { keyPrefix: 'breakdownTabs' });
  const theme = useTheme();

  const renderWaterfallContent = () => {
    if (waterfallLoading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      );
    }
    
    if (waterfallData?.waterfallData && waterfallData.waterfallData.length > 0) {
      return (
        <>
          <SankeyChart data={waterfallData.waterfallData} height={600} />
          <Box 
            sx={{ 
              mt: 3, 
              p: 2,
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              flexWrap: 'wrap', 
              gap: 2,
              background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.secondary.main, 0.05)} 100%)`,
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.divider, 0.05)}`,
            }}
          >
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Total Income
              </Typography>
              <Typography variant="h6" fontWeight="bold" color="primary.main">
                {formatCurrencyValue(waterfallData.summary.totalIncome)}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Period
              </Typography>
              <Typography variant="body2" fontWeight="500">
                {format(startDate, 'MMM dd, yyyy')} - {format(endDate, 'MMM dd, yyyy')}
              </Typography>
            </Box>
          </Box>
        </>
      );
    }

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <Typography variant="body1" color="text.secondary" gutterBottom>
          {t('overall.noData')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('overall.noDataHint')}
        </Typography>
      </Box>
    );
  };

  const renderBreakdownContent = (type: string) => {
    if (breakdownLoading[type]) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={40} thickness={4} />
        </Box>
      );
    }

    if (breakdownData[type]) {
      return (
        <BreakdownPanel
          breakdowns={breakdownData[type].breakdowns}
          summary={breakdownData[type].summary}
          startDate={startDate}
          endDate={endDate}
          categoryType={type as any}
          transactions={breakdownData[type].transactions}
        />
      );
    }

    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">
          {type === 'investment' ? t('investment.comingSoon') : t('shared.noDataPeriod')}
        </Typography>
      </Box>
    );
  };

  return (
    <Box sx={{ mb: 3 }}>
      <Paper
        sx={{
          background: alpha(theme.palette.background.paper, 0.4),
          backdropFilter: 'blur(10px)',
          border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          borderRadius: 3,
          overflow: 'hidden',
          boxShadow: theme.shadows[2],
        }}
      >
        <Tabs 
          value={selectedBreakdownType} 
          onChange={(event, newValue) => newValue && onSelectBreakdown(newValue)} 
          variant="fullWidth"
          sx={{
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.95rem',
              transition: 'all 0.2s',
              '&:hover': {
                backgroundColor: alpha(theme.palette.primary.main, 0.05),
              },
              '&.Mui-selected': {
                color: theme.palette.primary.main,
              },
            },
            '& .MuiTabs-indicator': {
              height: 3,
              borderRadius: '3px 3px 0 0',
            },
          }}
        >
          <Tab label={t('tabs.overall')} value="overall" />
          <Tab label={t('tabs.income')} value="income" />
          <Tab label={t('tabs.expense')} value="expense" />
          <Tab label={t('tabs.investment')} value="investment" />
        </Tabs>
        <Box sx={{ p: 3 }}>
          {selectedBreakdownType === 'overall' && (
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Paper 
                  sx={{ 
                    p: 3, 
                    background: alpha(theme.palette.background.paper, 0.6),
                    backdropFilter: 'blur(10px)',
                    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                    borderRadius: 3,
                    boxShadow: theme.shadows[2],
                  }}
                >
                  {renderWaterfallContent()}
                </Paper>
              </Grid>

              <Grid item xs={12} md={6}>
                <PortfolioPieChart
                  title={t('investment.liquid')}
                  data={liquidPortfolio}
                  total={liquidPortfolio.reduce((sum, item) => sum + item.value, 0)}
                  hint={t('investment.liquidHint')}
                  emptyTitle={t('investment.noLiquid')}
                  emptyHint={t('investment.addLiquidHint')}
                  color={theme.palette.info.main}
                  chartColors={chartColors}
                  formatCurrencyValue={formatCurrencyValue}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <PortfolioPieChart
                  title={t('investment.restricted')}
                  data={restrictedPortfolio}
                  total={restrictedPortfolio.reduce((sum, item) => sum + item.value, 0)}
                  hint={t('investment.restrictedHint')}
                  emptyTitle={t('investment.noRestricted')}
                  emptyHint={t('investment.addRestrictedHint')}
                  color={theme.palette.success.main}
                  chartColors={chartColors}
                  formatCurrencyValue={formatCurrencyValue}
                />
              </Grid>
            </Grid>
          )}

          {(['expense', 'income', 'investment'] as const).map(type => (
            <Box key={type} sx={{ display: selectedBreakdownType === type ? 'block' : 'none' }}>
              {type === 'income' && data && data.summary.totalIncome === 0 && hasBankAccounts !== null && (
                <Alert 
                  severity="info" 
                  icon={<InfoOutlinedIcon />} 
                  sx={{ 
                    mb: 3, 
                    borderRadius: 2,
                    background: alpha(theme.palette.info.main, 0.1),
                    border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
                  }}
                >
                  <AlertTitle>{t('income.noIncomeTitle')}</AlertTitle>
                  {hasBankAccounts === false ? (
                    <Typography variant="body2">
                      {t('income.noAccounts')}
                    </Typography>
                  ) : (
                    <Typography variant="body2">
                      {t('income.noIncomePeriod')}
                    </Typography>
                  )}
                </Alert>
              )}

              {renderBreakdownContent(type)}
            </Box>
          ))}
        </Box>
      </Paper>
    </Box>
  );
};

export default BreakdownTabsSection;
