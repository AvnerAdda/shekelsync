import React from 'react';
import {
  Popover,
  Box,
  Typography,
  Stack,
  Button,
  Checkbox,
  alpha,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import CategoryIcon from '@renderer/features/breakdown/components/CategoryIcon';
import type { Subscription } from '@renderer/types/subscriptions';

interface SubscriptionCategoryFilterPopoverProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  availableCategories: string[];
  subscriptions: Subscription[];
  isCategorySelected: (category: string) => boolean;
  toggleCategory: (category: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
}

/** Map a first-level category name to the icon/color of the first subscription that matches. */
function getCategoryMeta(subscriptions: Subscription[], categoryName: string) {
  const sub = subscriptions.find(
    (s) => (s.parent_category_name || s.category_name || 'Uncategorized') === categoryName,
  );
  return {
    icon: sub?.category_icon || null,
    color: sub?.category_color || null,
  };
}

const SubscriptionCategoryFilterPopover: React.FC<SubscriptionCategoryFilterPopoverProps> = ({
  open,
  anchorEl,
  onClose,
  availableCategories,
  subscriptions,
  isCategorySelected,
  toggleCategory,
  selectAll,
  deselectAll,
}) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.subscriptions.categoryFilter' });

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.12)}`,
            border: '1px solid',
            borderColor: alpha(theme.palette.divider, 0.1),
            backdropFilter: 'blur(20px)',
            bgcolor: alpha(theme.palette.background.paper, 0.95),
            minWidth: 260,
            maxWidth: 320,
          },
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        {/* Header */}
        <Typography variant="subtitle2" fontWeight={700}>
          {t('title')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('subtitle')}
        </Typography>

        {/* Select all / Deselect all */}
        <Stack direction="row" spacing={1} mt={1.5} mb={1}>
          <Button size="small" onClick={selectAll} sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
            {t('selectAll')}
          </Button>
          <Button size="small" onClick={deselectAll} sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
            {t('deselectAll')}
          </Button>
        </Stack>

        {/* Category checklist */}
        <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
          <Stack spacing={0}>
            {availableCategories.map((category) => {
              const meta = getCategoryMeta(subscriptions, category);
              const selected = isCategorySelected(category);
              return (
                <Box
                  key={category}
                  onClick={() => toggleCategory(category)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    py: 0.75,
                    borderRadius: 2,
                    cursor: 'pointer',
                    '&:hover': {
                      bgcolor: alpha(theme.palette.action.hover, 0.06),
                    },
                  }}
                >
                  <Checkbox
                    checked={selected}
                    size="small"
                    tabIndex={-1}
                    disableRipple
                    sx={{ p: 0 }}
                  />
                  <Box
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: 1.5,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: alpha(meta.color || theme.palette.primary.main, 0.12),
                      flexShrink: 0,
                    }}
                  >
                    <CategoryIcon
                      iconName={meta.icon}
                      size={16}
                      color={meta.color || theme.palette.primary.main}
                    />
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{
                      flex: 1,
                      opacity: selected ? 1 : 0.5,
                    }}
                  >
                    {category}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        </Box>
      </Box>
    </Popover>
  );
};

export default SubscriptionCategoryFilterPopover;
