import React from 'react';
import {
  Box,
  Typography,
  useTheme,
  alpha,
  FormControl,
  Select,
  MenuItem,
  SelectChangeEvent,
  IconButton,
  Paper,
} from '@mui/material';
import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import {
  InvestmentAccountSummary,
  InvestmentCategoryKey,
  PortfolioHistoryPoint,
  PortfolioSummary,
} from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';
import InvestmentPerformanceCard from './InvestmentPerformanceCard';
import {
  getOrderedPortfolioAccounts,
  getPortfolioCategoryBuckets,
  normalizeInvestmentCategory,
} from '../utils/portfolio-categories';

interface PerformanceCardsSectionProps {
  portfolioData: PortfolioSummary;
  accountHistories: Record<number, PortfolioHistoryPoint[]>;
  categoryFilter: 'all' | InvestmentCategoryKey;
  onCategoryFilterChange: (category: 'all' | InvestmentCategoryKey) => void;
  onAccountClick?: (account: InvestmentAccountSummary) => void;
}

const CHART_COLORS = [
  '#3ea54d', // Brand green
  '#00897B', // Teal
  '#e88b78', // Brand peach
  '#F97316', // Orange
  '#06B6D4', // Cyan
  '#F4A261', // Warm amber
  '#26A69A', // Teal light
  '#78e88b', // Brand green light
  '#EF4444', // Red
  '#14B8A6', // Teal dark
];

const PerformanceCardsSection: React.FC<PerformanceCardsSectionProps> = ({
  portfolioData,
  accountHistories,
  categoryFilter,
  onCategoryFilterChange,
  onAccountClick,
}) => {
  const theme = useTheme();
  const { t } = useTranslation('translation');
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  const allAccounts = React.useMemo(
    () => getOrderedPortfolioAccounts(portfolioData),
    [portfolioData],
  );

  const categories = React.useMemo(
    () => getPortfolioCategoryBuckets(portfolioData)
      .filter(({ bucket }) => (bucket.accounts?.length || 0) > 0)
      .map(({ key }) => key),
    [portfolioData],
  );

  const filteredAccounts = categoryFilter === 'all'
    ? allAccounts
    : allAccounts.filter((account) => normalizeInvestmentCategory(account.investment_category) === categoryFilter);

  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = 220; // Card width + gap
      scrollContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            {t('investmentsPage.performance.overviewTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('investmentsPage.performance.overviewSubtitle')}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* Category Filter */}
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select
              value={categoryFilter}
              onChange={(e: SelectChangeEvent) =>
                onCategoryFilterChange(e.target.value as 'all' | InvestmentCategoryKey)}
              sx={{
                fontSize: '0.75rem',
                '& .MuiSelect-select': {
                  py: 0.75,
                },
              }}
            >
              <MenuItem value="all">{t('investmentsPage.performance.allCategories')}</MenuItem>
              {categories.map((category) => (
                <MenuItem key={category} value={category}>
                  {t(`investmentsPage.balanceSheet.buckets.${category}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Navigation Arrows */}
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <IconButton
              size="small"
              onClick={() => handleScroll('left')}
              sx={{
                bgcolor: alpha(theme.palette.action.selected, 0.1),
                '&:hover': {
                  bgcolor: alpha(theme.palette.action.selected, 0.2),
                },
              }}
            >
              <ChevronLeft fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => handleScroll('right')}
              sx={{
                bgcolor: alpha(theme.palette.action.selected, 0.1),
                '&:hover': {
                  bgcolor: alpha(theme.palette.action.selected, 0.2),
                },
              }}
            >
              <ChevronRight fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      </Box>

      {/* Scrollable Cards Container */}
      <Box
        ref={scrollContainerRef}
        sx={{
          display: 'flex',
          gap: 2,
          overflowX: 'auto',
          pb: 1,
          scrollbarWidth: 'thin',
          '&::-webkit-scrollbar': {
            height: 6,
          },
          '&::-webkit-scrollbar-track': {
            bgcolor: alpha(theme.palette.action.selected, 0.1),
            borderRadius: 3,
          },
          '&::-webkit-scrollbar-thumb': {
            bgcolor: alpha(theme.palette.action.selected, 0.3),
            borderRadius: 3,
            '&:hover': {
              bgcolor: alpha(theme.palette.action.selected, 0.5),
            },
          },
        }}
      >
        {filteredAccounts.map((account, index) => (
          <InvestmentPerformanceCard
            key={account.id}
            account={account}
            history={accountHistories[account.id] || []}
            color={CHART_COLORS[index % CHART_COLORS.length]}
            onClick={account.account_type === 'savings' ? onAccountClick : undefined}
          />
        ))}

        {filteredAccounts.length === 0 && (
          <Box
            sx={{
              py: 4,
              width: '100%',
              textAlign: 'center',
            }}
          >
            <Typography color="text.secondary">
              {t('investmentsPage.performance.noAccounts')}
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default PerformanceCardsSection;
