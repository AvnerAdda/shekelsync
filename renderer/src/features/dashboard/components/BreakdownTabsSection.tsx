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
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartTooltip } from 'recharts';
import { format } from 'date-fns';
import SankeyChart from './SankeyChart';
import BreakdownPanel from '@renderer/features/breakdown/BreakdownPanel';
import { PortfolioBreakdownItem } from '@renderer/types/investments';
import { useDashboardFilters } from '../DashboardFiltersContext';

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

  return (
    <Box sx={{ mb: 3 }}>
      <Paper>
        <Tabs value={selectedBreakdownType} onChange={(event, newValue) => newValue && onSelectBreakdown(newValue)} variant="fullWidth">
          <Tab label="Overall" value="overall" />
          <Tab label="Income" value="income" />
          <Tab label="Expenses" value="expense" />
          <Tab label="Investment" value="investment" />
        </Tabs>
        <Box sx={{ p: 3 }}>
          {selectedBreakdownType === 'overall' && (
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Paper sx={{ p: 2 }}>
                  {waterfallLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                      <CircularProgress />
                    </Box>
                  ) : waterfallData?.waterfallData && waterfallData.waterfallData.length > 0 ? (
                    <>
                      <SankeyChart data={waterfallData.waterfallData} height={600} />
                      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
                        <Typography variant="body2" fontWeight="bold">
                          Total Income: {formatCurrencyValue(waterfallData.summary.totalIncome)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Period: {format(startDate, 'MMM dd, yyyy')} - {format(endDate, 'MMM dd, yyyy')}
                        </Typography>
                      </Box>
                    </>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                      <Typography variant="body2" color="text.secondary">
                        No financial flow data available for this period
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                        Add income and expense transactions to see flow diagram
                      </Typography>
                    </Box>
                  )}
                </Paper>
              </Grid>

              <Grid item xs={12} md={6}>
                <Paper sx={{ p: 2, height: '100%' }}>
                  <Typography variant="h6" gutterBottom sx={{ color: 'info.main' }}>
                    Liquid Investments
                  </Typography>
                  {liquidPortfolio.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={liquidPortfolio}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={90}
                            labelLine={false}
                            label={(entry: any) => {
                              const item = entry as PortfolioBreakdownItem;
                              return `${item.name}: ${item.percentage.toFixed(1)}%`;
                            }}
                            fill="#8884d8"
                            dataKey="value"
                          >
                            {liquidPortfolio.map((entry, index) => (
                              <Cell key={`liquid-${index}`} fill={chartColors[index % chartColors.length]} />
                            ))}
                          </Pie>
                          <RechartTooltip formatter={(value: number) => formatCurrencyValue(value)} />
                        </PieChart>
                      </ResponsiveContainer>
                      <Box sx={{ mt: 2, textAlign: 'center' }}>
                        <Typography variant="body2" fontWeight="bold" color="info.main">
                          Total Liquid: {formatCurrencyValue(liquidPortfolio.reduce((sum, item) => sum + item.value, 0))}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Accessible investments
                        </Typography>
                      </Box>
                    </>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                      <Typography variant="body2" color="text.secondary">
                        No liquid investments
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                        Add brokerage, crypto, or savings accounts
                      </Typography>
                    </Box>
                  )}
                </Paper>
              </Grid>

              <Grid item xs={12} md={6}>
                <Paper sx={{ p: 2, height: '100%' }}>
                  <Typography variant="h6" gutterBottom sx={{ color: 'success.main' }}>
                    Restricted Investments
                  </Typography>
                  {restrictedPortfolio.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={restrictedPortfolio}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={90}
                            labelLine={false}
                            label={(entry: any) => {
                              const item = entry as PortfolioBreakdownItem;
                              return `${item.name}: ${item.percentage.toFixed(1)}%`;
                            }}
                            fill="#82ca9d"
                            dataKey="value"
                          >
                            {restrictedPortfolio.map((entry, index) => (
                              <Cell key={`restricted-${index}`} fill={chartColors[index % chartColors.length]} />
                            ))}
                          </Pie>
                          <RechartTooltip formatter={(value: number) => formatCurrencyValue(value)} />
                        </PieChart>
                      </ResponsiveContainer>
                      <Box sx={{ mt: 2, textAlign: 'center' }}>
                        <Typography variant="body2" fontWeight="bold" color="success.main">
                          Total Restricted: {formatCurrencyValue(restrictedPortfolio.reduce((sum, item) => sum + item.value, 0))}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Pension, provident & study funds
                        </Typography>
                      </Box>
                    </>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                      <Typography variant="body2" color="text.secondary">
                        No long-term savings
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                        Add pension, provident, or study fund accounts
                      </Typography>
                    </Box>
                  )}
                </Paper>
              </Grid>
            </Grid>
          )}

          {(['expense', 'income', 'investment'] as const).map(type => (
            <Box key={type} sx={{ display: selectedBreakdownType === type ? 'block' : 'none' }}>
              {type === 'income' && data && data.summary.totalIncome === 0 && hasBankAccounts !== null && (
                <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ mb: 2 }}>
                  <AlertTitle>No Income Data</AlertTitle>
                  {hasBankAccounts === false ? (
                    <Typography variant="body2">
                      Add your bank account credentials to automatically track income transactions and get a complete view of your financial flows.
                    </Typography>
                  ) : (
                    <Typography variant="body2">
                      No income transactions found for the selected period. Verify your last bank scrape was successful or run a new scrape to update your data.
                    </Typography>
                  )}
                </Alert>
              )}

              {breakdownLoading[type] ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                  <CircularProgress size={32} />
                </Box>
              ) : breakdownData[type] ? (
                <BreakdownPanel
                  breakdowns={breakdownData[type].breakdowns}
                  summary={breakdownData[type].summary}
                  startDate={startDate}
                  endDate={endDate}
                  categoryType={type}
                  transactions={breakdownData[type].transactions}
                />
              ) : (
                <Typography color="text.secondary">
                  {type === 'investment' ? 'Investment breakdown coming soon.' : 'No breakdown data available for this period.'}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      </Paper>
    </Box>
  );
};

export default BreakdownTabsSection;
