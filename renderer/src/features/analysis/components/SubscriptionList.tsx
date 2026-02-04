import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  TextField,
  InputAdornment,
  Stack,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Skeleton,
  Fade,
  Button,
  alpha,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  Search as SearchIcon,
  Sort as SortIcon,
  ArrowUpward as AscIcon,
  ArrowDownward as DescIcon,
  AttachMoney as AmountIcon,
  SortByAlpha as AlphaIcon,
  Schedule as DateIcon,
  Category as CategoryIcon,
  Inbox as EmptyIcon,
  Check as CheckIcon,
  KeyboardArrowDown as ShowMoreIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import SubscriptionCard from './SubscriptionCard';
import type { Subscription, SubscriptionStatus } from '@renderer/types/subscriptions';

const MAX_VISIBLE_ITEMS = 5;
const SCROLL_HEIGHT = 480;

type SortField = 'name' | 'amount' | 'next_date' | 'category';
type SortDirection = 'asc' | 'desc';

interface SubscriptionListProps {
  subscriptions: Subscription[];
  loading: boolean;
  onEdit: (subscription: Subscription) => void;
  onStatusChange: (id: number, status: SubscriptionStatus) => void;
  onDelete: (id: number) => void;
}

const SubscriptionList: React.FC<SubscriptionListProps> = ({
  subscriptions,
  loading,
  onEdit,
  onStatusChange,
  onDelete,
}) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.subscriptions' });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('amount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [sortAnchorEl, setSortAnchorEl] = useState<null | HTMLElement>(null);
  const [showAll, setShowAll] = useState(false);

  // Use 2 columns on larger screens when we have enough items
  const isLargeScreen = useMediaQuery(theme.breakpoints.up('lg'));

  const statusOptions: Array<{ value: SubscriptionStatus | 'all'; color?: string }> = [
    { value: 'all' },
    { value: 'active', color: theme.palette.success.main },
    { value: 'paused', color: theme.palette.warning.main },
    { value: 'cancelled', color: theme.palette.error.main },
    { value: 'review', color: theme.palette.info.main },
    { value: 'keep', color: theme.palette.secondary.main },
  ];

  const sortOptions: Array<{ field: SortField; icon: React.ReactNode }> = [
    { field: 'amount', icon: <AmountIcon fontSize="small" /> },
    { field: 'name', icon: <AlphaIcon fontSize="small" /> },
    { field: 'next_date', icon: <DateIcon fontSize="small" /> },
    { field: 'category', icon: <CategoryIcon fontSize="small" /> },
  ];

  const filteredAndSortedSubscriptions = useMemo(() => {
    let result = subscriptions.filter((sub) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = sub.display_name?.toLowerCase().includes(query);
        const matchesCategory = sub.category_name?.toLowerCase().includes(query);
        const matchesParent = sub.parent_category_name?.toLowerCase().includes(query);
        if (!matchesName && !matchesCategory && !matchesParent) {
          return false;
        }
      }

      // Status filter
      if (statusFilter !== 'all' && sub.status !== statusFilter) {
        return false;
      }

      return true;
    });

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = (a.display_name || '').localeCompare(b.display_name || '');
          break;
        case 'amount':
          const amountA = a.user_amount || a.detected_amount || 0;
          const amountB = b.user_amount || b.detected_amount || 0;
          comparison = amountA - amountB;
          break;
        case 'next_date':
          const dateA = a.next_expected_date ? new Date(a.next_expected_date).getTime() : Infinity;
          const dateB = b.next_expected_date ? new Date(b.next_expected_date).getTime() : Infinity;
          comparison = dateA - dateB;
          break;
        case 'category':
          comparison = (a.category_name || a.parent_category_name || '').localeCompare(
            b.category_name || b.parent_category_name || ''
          );
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [subscriptions, searchQuery, statusFilter, sortField, sortDirection]);

  const handleSortClick = (event: React.MouseEvent<HTMLElement>) => {
    setSortAnchorEl(event.currentTarget);
  };

  const handleSortClose = () => {
    setSortAnchorEl(null);
  };

  const handleSortSelect = (field: SortField) => {
    if (field === sortField) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    handleSortClose();
  };

  if (loading && subscriptions.length === 0) {
    return (
      <Box>
        {/* Search and filter skeleton */}
        <Stack direction="row" spacing={2} mb={3} alignItems="center">
          <Skeleton variant="rounded" width={280} height={40} sx={{ borderRadius: 3 }} />
          <Stack direction="row" spacing={1}>
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} variant="rounded" width={70} height={32} sx={{ borderRadius: 2 }} />
            ))}
          </Stack>
        </Stack>
        {/* Cards skeleton */}
        <Stack spacing={1.5}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton
              key={i}
              variant="rounded"
              height={80}
              sx={{ borderRadius: 3, opacity: 1 - i * 0.2 }}
            />
          ))}
        </Stack>
      </Box>
    );
  }

  return (
    <Box>
      {/* Search and filter bar */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        mb={3}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
      >
        <TextField
          size="small"
          placeholder={t('list.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
              </InputAdornment>
            ),
          }}
          sx={{
            width: { xs: '100%', sm: 280 },
            '& .MuiOutlinedInput-root': {
              borderRadius: 3,
              bgcolor: alpha(theme.palette.background.paper, 0.4),
              transition: 'all 0.2s',
              '&:hover': {
                bgcolor: alpha(theme.palette.background.paper, 0.6),
              },
              '&.Mui-focused': {
                bgcolor: alpha(theme.palette.background.paper, 0.8),
              },
            },
          }}
        />

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          {/* Status filter chips */}
          {statusOptions.map((option) => (
            <Chip
              key={option.value}
              label={t(`list.filter.${option.value}`)}
              onClick={() => setStatusFilter(option.value)}
              size="small"
              sx={{
                borderRadius: 2,
                fontWeight: 500,
                bgcolor: statusFilter === option.value
                  ? option.color
                    ? alpha(option.color, 0.15)
                    : alpha(theme.palette.primary.main, 0.15)
                  : alpha(theme.palette.action.active, 0.05),
                color: statusFilter === option.value
                  ? option.color || theme.palette.primary.main
                  : 'text.secondary',
                border: '1px solid',
                borderColor: statusFilter === option.value
                  ? option.color
                    ? alpha(option.color, 0.3)
                    : alpha(theme.palette.primary.main, 0.3)
                  : 'transparent',
                transition: 'all 0.2s',
                '&:hover': {
                  bgcolor: option.color
                    ? alpha(option.color, 0.1)
                    : alpha(theme.palette.primary.main, 0.1),
                },
              }}
            />
          ))}

          {/* Sort button */}
          <IconButton
            size="small"
            onClick={handleSortClick}
            sx={{
              ml: 1,
              bgcolor: alpha(theme.palette.action.active, 0.05),
              '&:hover': { bgcolor: alpha(theme.palette.action.active, 0.1) },
            }}
          >
            <SortIcon fontSize="small" />
            {sortDirection === 'asc' ? (
              <AscIcon sx={{ fontSize: 12, ml: -0.5 }} />
            ) : (
              <DescIcon sx={{ fontSize: 12, ml: -0.5 }} />
            )}
          </IconButton>

          <Menu
            anchorEl={sortAnchorEl}
            open={Boolean(sortAnchorEl)}
            onClose={handleSortClose}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            slotProps={{
              paper: {
                sx: {
                  mt: 1,
                  borderRadius: 2,
                  minWidth: 180,
                },
              },
            }}
          >
            {sortOptions.map((option) => (
              <MenuItem
                key={option.field}
                onClick={() => handleSortSelect(option.field)}
                selected={sortField === option.field}
              >
                <ListItemIcon>{option.icon}</ListItemIcon>
                <ListItemText>{t(`list.sort.${option.field}`)}</ListItemText>
                {sortField === option.field && (
                  <CheckIcon fontSize="small" sx={{ ml: 1, color: 'primary.main' }} />
                )}
              </MenuItem>
            ))}
          </Menu>
        </Stack>
      </Stack>

      {/* Results count */}
      <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
        {t('list.showing', { count: filteredAndSortedSubscriptions.length, total: subscriptions.length })}
      </Typography>

      {/* Subscription cards */}
      {filteredAndSortedSubscriptions.length === 0 ? (
        <Fade in>
          <Box
            sx={{
              py: 6,
              px: 4,
              textAlign: 'center',
              borderRadius: 4,
              bgcolor: alpha(theme.palette.background.paper, 0.3),
              border: '2px dashed',
              borderColor: alpha(theme.palette.divider, 0.2),
            }}
          >
            <EmptyIcon
              sx={{
                fontSize: 48,
                color: alpha(theme.palette.text.secondary, 0.3),
                mb: 2,
              }}
            />
            <Typography variant="h6" color="text.secondary" fontWeight={500}>
              {searchQuery || statusFilter !== 'all'
                ? t('list.noResults')
                : t('list.empty')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, opacity: 0.7 }}>
              {searchQuery || statusFilter !== 'all'
                ? t('list.noResultsHint')
                : t('list.emptyHint')}
            </Typography>
          </Box>
        </Fade>
      ) : (
        <>
          {/* Scrollable container when showing all */}
          <Box
            sx={{
              maxHeight: showAll ? SCROLL_HEIGHT : 'none',
              overflowY: showAll ? 'auto' : 'visible',
              pr: showAll ? 1 : 0,
              '&::-webkit-scrollbar': {
                width: 6,
              },
              '&::-webkit-scrollbar-track': {
                bgcolor: alpha(theme.palette.action.active, 0.05),
                borderRadius: 3,
              },
              '&::-webkit-scrollbar-thumb': {
                bgcolor: alpha(theme.palette.action.active, 0.2),
                borderRadius: 3,
                '&:hover': {
                  bgcolor: alpha(theme.palette.action.active, 0.3),
                },
              },
            }}
          >
            {/* Two-column layout on large screens - disabled inside the list panel */}
            {false && isLargeScreen && filteredAndSortedSubscriptions.length > 3 ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 1.5,
                  minWidth: 0,
                }}
              >
                {(showAll
                  ? filteredAndSortedSubscriptions
                  : filteredAndSortedSubscriptions.slice(0, MAX_VISIBLE_ITEMS)
                ).map((subscription, idx) => (
                  <Fade
                    in
                    key={subscription.id || `sub-${idx}`}
                    style={{ transitionDelay: `${Math.min(idx, 5) * 30}ms` }}
                  >
                    <div>
                      <SubscriptionCard
                        subscription={subscription}
                        onEdit={onEdit}
                        onStatusChange={onStatusChange}
                        onDelete={onDelete}
                      />
                    </div>
                  </Fade>
                ))}
              </Box>
            ) : (
              // Single column layout
              <Stack spacing={1.5}>
                {(showAll
                  ? filteredAndSortedSubscriptions
                  : filteredAndSortedSubscriptions.slice(0, MAX_VISIBLE_ITEMS)
                ).map((subscription, idx) => (
                  <Fade
                    in
                    key={subscription.id || `sub-${idx}`}
                    style={{ transitionDelay: `${Math.min(idx, 5) * 30}ms` }}
                  >
                    <div>
                      <SubscriptionCard
                        subscription={subscription}
                        onEdit={onEdit}
                        onStatusChange={onStatusChange}
                        onDelete={onDelete}
                      />
                    </div>
                  </Fade>
                ))}
              </Stack>
            )}
          </Box>

          {/* Show more/less button */}
          {filteredAndSortedSubscriptions.length > MAX_VISIBLE_ITEMS && (
            <Box sx={{ textAlign: 'center', mt: 2 }}>
              <Button
                size="small"
                onClick={() => setShowAll(!showAll)}
                endIcon={
                  <ShowMoreIcon
                    sx={{
                      transform: showAll ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.2s',
                    }}
                  />
                }
                sx={{
                  textTransform: 'none',
                  color: 'text.secondary',
                  '&:hover': { bgcolor: alpha(theme.palette.action.active, 0.05) },
                }}
              >
                {showAll
                  ? t('list.showLess')
                  : t('list.showMore', { count: filteredAndSortedSubscriptions.length - MAX_VISIBLE_ITEMS })}
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

export default SubscriptionList;
