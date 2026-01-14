import React from 'react';
import {
  Box,
  Paper,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Grid,
  Card,
  CardContent,
  IconButton,
  Breadcrumbs,
  Link,
  useTheme,
  alpha,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  TrendingUp as TrendIcon,
  ShoppingCart as ShoppingIcon,
  MonetizationOn as IncomeIcon,
  TrendingUp as InvestmentIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import useBreakdownDrilldown from '@renderer/features/breakdown/hooks/useBreakdownDrilldown';
import OverviewView from '@renderer/features/breakdown/components/OverviewView';
import CategoryView from '@renderer/features/breakdown/components/CategoryView';
import VendorView from '@renderer/features/breakdown/components/VendorView';
import TimelineView from '@renderer/features/breakdown/components/TimelineView';
import CategoryDetailsDialog from '@renderer/features/breakdown/components/CategoryDetailsDialog';
import {
  BreakdownData,
  BreakdownSummary,
  BreakdownTransaction,
  CategoryType,
  FormatCurrencyFn,
  DrillLevel,
} from '@renderer/features/breakdown/types';
import { getBreakdownStrings } from './strings';

interface BreakdownPanelProps {
  breakdowns: BreakdownData;
  startDate: Date;
  endDate: Date;
  categoryType: CategoryType;
  summary?: BreakdownSummary;
  transactions?: BreakdownTransaction[];
}

const BreadcrumbTrail: React.FC<{
  drillStack: DrillLevel[];
  onBreadcrumbClick: (index: number) => void;
  rootLabel: string;
}> = ({ drillStack, onBreadcrumbClick, rootLabel }) => (
  <Breadcrumbs separator={<ChevronRightIcon fontSize="small" />}>
    <Link
      component="button"
      variant="body2"
      onClick={() => onBreadcrumbClick(-1)}
      sx={{
        cursor: 'pointer',
        textDecoration: 'none',
        '&:hover': { textDecoration: 'underline' },
      }}
    >
      {rootLabel}
    </Link>
    {drillStack.map((level, index) => (
      <Link
        key={`${level.type}-${index}`}
        component="button"
        variant="body2"
        onClick={() => onBreadcrumbClick(index)}
        sx={{
          cursor: index < drillStack.length - 1 ? 'pointer' : 'default',
          textDecoration: 'none',
          fontWeight: index === drillStack.length - 1 ? 'bold' : 'normal',
          '&:hover': {
            textDecoration: index < drillStack.length - 1 ? 'underline' : 'none',
          },
        }}
      >
        {level.type === 'parent' ? level.parentName : level.subcategoryName}
      </Link>
    ))}
  </Breadcrumbs>
);

const BreakdownPanel: React.FC<BreakdownPanelProps> = ({
  breakdowns,
  startDate,
  endDate,
  categoryType,
  summary,
  transactions = [],
}) => {
  const { formatCurrency } = useFinancePrivacy();
  const theme = useTheme();
  const strings = getBreakdownStrings();
  const panelStrings = strings.panel;
  const generalStrings = strings.general;
  const overviewStrings = strings.overview;
  const categoryBreakdown = breakdowns?.byCategory ?? [];
  const vendorBreakdown = breakdowns?.byVendor ?? [];
  const monthlyBreakdown = breakdowns?.byMonth ?? [];

  const config = {
    expense: {
      title: panelStrings.titles.expense,
      chartTitle: panelStrings.chartTitles.expense,
      icon: <ShoppingIcon sx={{ mr: 0.5, fontSize: 18 }} />,
    },
    income: {
      title: panelStrings.titles.income,
      chartTitle: panelStrings.chartTitles.income,
      icon: <IncomeIcon sx={{ mr: 0.5, fontSize: 18 }} />,
    },
    investment: {
      title: panelStrings.titles.investment,
      chartTitle: panelStrings.chartTitles.investment,
      icon: <InvestmentIcon sx={{ mr: 0.5, fontSize: 18 }} />,
    },
  } satisfies Record<CategoryType, { title: string; chartTitle: string; icon: React.ReactNode }>;

  const formatCurrencyValue: FormatCurrencyFn = (value, options) =>
    formatCurrency(value, {
      absolute: true,
      minimumFractionDigits: options?.minimumFractionDigits ?? 0,
      maximumFractionDigits: options?.maximumFractionDigits ?? 0,
    });

  const {
    view,
    setView,
    drillStack,
    currentLevel,
    currentData,
    isZooming,
    handleDrillDown,
    handleSubcategoryClick,
    handleBreadcrumbClick,
    handleBackToParent,
    getCategoryTransactionCounts,
    categoryDetails,
    detailsModalOpen,
    openCategoryDetails,
    closeDetailsModal,
    resetDrilldown,
  } = useBreakdownDrilldown({
    startDate,
    endDate,
    categoryType,
    categoryBreakdown,
    transactions,
  });

  const currentConfig = config[categoryType];

  const handleDetailsClose = () => {
    closeDetailsModal();
    resetDrilldown();
  };

  return (
    <>
      <Paper 
        sx={{ 
          p: 3,
          background: alpha(theme.palette.background.paper, 0.4),
          backdropFilter: 'blur(10px)',
          border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          borderRadius: 3,
          boxShadow: theme.shadows[2],
        }}
      >
        {summary && (
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Card 
                variant="outlined"
                sx={{ 
                  background: alpha(theme.palette.background.paper, 0.6),
                  backdropFilter: 'blur(10px)',
                  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                  borderRadius: 2,
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: theme.shadows[4],
                  },
                }}
              >
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    {panelStrings.summary.total[categoryType]}
                  </Typography>
                  <Typography variant="h6" fontWeight="bold" color="primary.main">
                    {formatCurrencyValue(summary.total)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Card 
                variant="outlined"
                sx={{ 
                  background: alpha(theme.palette.background.paper, 0.6),
                  backdropFilter: 'blur(10px)',
                  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                  borderRadius: 2,
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: theme.shadows[4],
                  },
                }}
              >
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    {panelStrings.summary.transactions || generalStrings.transactions}
                  </Typography>
                  <Typography variant="h6" fontWeight="bold">
                    {summary.count}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Card 
                variant="outlined"
                sx={{ 
                  background: alpha(theme.palette.background.paper, 0.6),
                  backdropFilter: 'blur(10px)',
                  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                  borderRadius: 2,
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: theme.shadows[4],
                  },
                }}
              >
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    {panelStrings.summary.average || generalStrings.average}
                  </Typography>
                  <Typography variant="h6" fontWeight="bold">
                    {formatCurrencyValue(summary.average)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {drillStack.length > 0 && (
              <IconButton onClick={handleBackToParent} size="small">
                <BackIcon />
              </IconButton>
            )}
            <Typography variant="h6">{currentConfig.title}</Typography>
          </Box>
          <ToggleButtonGroup
            value={view}
            exclusive
            onChange={(e, newView) => newView && setView(newView)}
            size="small"
            sx={{
              '& .MuiToggleButton-root': {
                borderRadius: 2,
                mx: 0.5,
                border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
                '&.Mui-selected': {
                  backgroundColor: alpha(theme.palette.primary.main, 0.1),
                  color: theme.palette.primary.main,
                  borderColor: alpha(theme.palette.primary.main, 0.3),
                  '&:hover': {
                    backgroundColor: alpha(theme.palette.primary.main, 0.2),
                  },
                },
              },
            }}
          >
            <ToggleButton value="overview">
              {currentConfig.icon}
              {panelStrings.overviewTab}
            </ToggleButton>
            <ToggleButton value="category">{panelStrings.categoryTab}</ToggleButton>
            <ToggleButton value="vendor">{panelStrings.vendorTab}</ToggleButton>
            <ToggleButton value="timeline">
              <TrendIcon sx={{ mr: 0.5, fontSize: 18 }} />
              {panelStrings.timelineTab}
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {drillStack.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <BreadcrumbTrail
              drillStack={drillStack}
              onBreadcrumbClick={handleBreadcrumbClick}
              rootLabel={panelStrings.rootBreadcrumb}
            />
          </Box>
        )}

        {view === 'overview' && (
          <OverviewView
            data={currentData}
            currentLevel={currentLevel}
            isZooming={isZooming}
            categoryType={categoryType}
            chartTitle={currentConfig.chartTitle}
            parentTitle={panelStrings.chartTitles.parent}
            subcategoryTitle={panelStrings.chartTitles.subcategory}
            pendingBreakdownLabel={overviewStrings.pendingBreakdown}
            formatCurrencyValue={formatCurrencyValue}
            onDrillDown={handleDrillDown}
            onSubcategoryClick={handleSubcategoryClick}
            onLeafClick={openCategoryDetails}
            getCategoryTransactionCounts={getCategoryTransactionCounts}
          />
        )}
        {view === 'category' && (
          <CategoryView data={currentData} categoryType={categoryType} formatCurrencyValue={formatCurrencyValue} />
        )}
        {view === 'vendor' && (
          <VendorView
            vendors={vendorBreakdown}
            categoryType={categoryType}
            formatCurrencyValue={formatCurrencyValue}
            vendorTrendLabel={panelStrings.aria.vendorTrend}
          />
        )}
        {view === 'timeline' && (
          <TimelineView data={monthlyBreakdown} categoryType={categoryType} title={currentConfig.title} formatCurrencyValue={formatCurrencyValue} />
        )}
      </Paper>

      <CategoryDetailsDialog
        open={detailsModalOpen}
        details={categoryDetails}
        onClose={handleDetailsClose}
        breadcrumbs={
          <BreadcrumbTrail
            drillStack={drillStack}
            onBreadcrumbClick={handleBreadcrumbClick}
            rootLabel={panelStrings.rootBreadcrumb}
          />
        }
        categoryType={categoryType}
        formatCurrencyValue={formatCurrencyValue}
        onSubcategoryClick={handleSubcategoryClick}
      />
    </>
  );
};

export default BreakdownPanel;
