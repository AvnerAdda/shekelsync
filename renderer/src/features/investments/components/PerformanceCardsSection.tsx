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
import { PortfolioSummary, PortfolioHistoryPoint } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';
import InvestmentPerformanceCard from './InvestmentPerformanceCard';

interface PerformanceCardsSectionProps {
  portfolioData: PortfolioSummary;
  accountHistories: Record<number, PortfolioHistoryPoint[]>;
  categoryFilter: string;
  onCategoryFilterChange: (category: string) => void;
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
}) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.performance' });
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  // Combine all accounts
  const allAccounts = [
    ...(portfolioData.restrictedAccounts || []),
    ...(portfolioData.liquidAccounts || []),
  ];

  // Get unique categories for filter
  const categories = Array.from(
    new Set(allAccounts.map(a => a.account_type).filter(Boolean))
  );

  // Filter accounts by category
  const filteredAccounts = categoryFilter === 'all'
    ? allAccounts
    : allAccounts.filter(a => a.account_type === categoryFilter);

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
        <Typography variant="subtitle1" fontWeight={600}>
          {t('title', 'My Performance')}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* Category Filter */}
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select
              value={categoryFilter}
              onChange={(e: SelectChangeEvent) => onCategoryFilterChange(e.target.value)}
              sx={{
                fontSize: '0.75rem',
                '& .MuiSelect-select': {
                  py: 0.75,
                },
              }}
            >
              <MenuItem value="all">{t('allCategories', 'All Categories')}</MenuItem>
              {categories.map(cat => (
                <MenuItem key={cat} value={cat}>
                  {cat}
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
              {t('noAccounts', 'No investment accounts found')}
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default PerformanceCardsSection;
