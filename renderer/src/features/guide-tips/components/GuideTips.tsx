import React, { useState } from 'react';
import {
  Box,
  Typography,
  Badge,
  IconButton,
  Popover,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Button,
  Divider,
  Tooltip,
  LinearProgress,
  Chip,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  Lightbulb as LightbulbIcon,
  AccountBalance as BankIcon,
  CreditCard as CreditCardIcon,
  Link as PairIcon,
  Category as CategoryIcon,
  Label as TagIcon,
  Rule as RuleIcon,
  Search as SearchIcon,
  TrendingUp as InvestIcon,
  AccountBalanceWallet as BudgetIcon,
  Note as NoteIcon,
  SmartToy as ChatbotIcon,
  EmojiEvents as QuestIcon,
  Sync as SyncIcon,
  CheckCircle as CheckIcon,
  SkipNext as SkipIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGuideTips, type GuideTip } from '../hooks/useGuideTips';
import { useOnboarding } from '@app/contexts/OnboardingContext';

// Custom events to open modals from outside their component tree
const GUIDE_OPEN_CATEGORIES_MODAL = 'guideOpenCategoriesModal';

export { GUIDE_OPEN_CATEGORIES_MODAL };

interface TipConfig {
  icon: React.ReactElement;
  skippable: boolean;
}

const tipConfigs: Record<string, TipConfig> = {
  add_bank: { icon: <BankIcon fontSize="small" />, skippable: false },
  add_credit_cards: { icon: <CreditCardIcon fontSize="small" />, skippable: true },
  pair_accounts: { icon: <PairIcon fontSize="small" />, skippable: false },
  manage_categories: { icon: <CategoryIcon fontSize="small" />, skippable: true },
  categorize: { icon: <TagIcon fontSize="small" />, skippable: false },
  create_rules: { icon: <RuleIcon fontSize="small" />, skippable: true },
  search_transactions: { icon: <SearchIcon fontSize="small" />, skippable: true },
  categorize_investments: { icon: <InvestIcon fontSize="small" />, skippable: true },
  add_investments: { icon: <InvestIcon fontSize="small" />, skippable: true },
  set_budgets: { icon: <BudgetIcon fontSize="small" />, skippable: false },
  add_notes_tags: { icon: <NoteIcon fontSize="small" />, skippable: true },
  try_chatbot: { icon: <ChatbotIcon fontSize="small" />, skippable: true },
  accept_quest: { icon: <QuestIcon fontSize="small" />, skippable: false },
  sync_reminder: { icon: <SyncIcon fontSize="small" />, skippable: false },
};

const GuideTips: React.FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  const { status: onboardingStatus } = useOnboarding();
  const { tips, pendingCount, completedCount, allDone, loading, dismissTip } = useGuideTips();
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

  const open = Boolean(anchorEl);

  // Only show when onboarding is complete
  if (!onboardingStatus?.isComplete) {
    return null;
  }

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleTipAction = (tip: GuideTip) => {
    handleClose();

    switch (tip.id) {
      case 'add_bank':
        window.dispatchEvent(new CustomEvent('openAccountsModal', { detail: { tab: 'bank' } }));
        break;
      case 'add_credit_cards':
        window.dispatchEvent(new CustomEvent('openAccountsModal', { detail: { tab: 'credit' } }));
        break;
      case 'pair_accounts':
        window.dispatchEvent(new CustomEvent('openAccountsModal'));
        break;
      case 'manage_categories':
      case 'categorize':
      case 'create_rules':
        window.dispatchEvent(new CustomEvent(GUIDE_OPEN_CATEGORIES_MODAL, { detail: { tab: tip.id } }));
        break;
      case 'search_transactions':
        // Programmatically trigger Ctrl+K
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
        break;
      case 'categorize_investments':
        window.dispatchEvent(new CustomEvent(GUIDE_OPEN_CATEGORIES_MODAL, { detail: { tab: 'categorize' } }));
        break;
      case 'add_investments':
        navigate('/investments');
        break;
      case 'set_budgets':
        navigate('/analysis');
        break;
      case 'add_notes_tags':
        // Navigate to home / transactions
        navigate('/');
        break;
      case 'try_chatbot':
        window.dispatchEvent(new CustomEvent('openChatbotDrawer'));
        break;
      case 'accept_quest':
        navigate('/analysis');
        break;
      case 'sync_reminder':
        // Trigger bulk sync
        window.dispatchEvent(new CustomEvent('guideTriggerBulkSync'));
        break;
      default:
        break;
    }
  };

  const handleSkip = async (tipId: string) => {
    await dismissTip(tipId);
  };

  const getDescription = (tip: GuideTip): string => {
    const data = tip.data || {};
    switch (tip.id) {
      case 'add_credit_cards':
        return t('guideTips.tips.add_credit_cards.description', {
          count: (data.creditCardCount as number) || 0,
        });
      case 'pair_accounts':
        return t('guideTips.tips.pair_accounts.description', {
          count: (data.unpairedCount as number) || 0,
        });
      case 'categorize':
        return t('guideTips.tips.categorize.description', {
          count: (data.uncategorizedCount as number) || 0,
        });
      case 'create_rules':
        return t('guideTips.tips.create_rules.description', {
          count: (data.ruleCount as number) || 0,
        });
      case 'add_investments':
        return t('guideTips.tips.add_investments.description', {
          count: (data.investmentAccountCount as number) || 0,
        });
      case 'set_budgets':
        return t('guideTips.tips.set_budgets.description', {
          count: (data.budgetCount as number) || 0,
        });
      case 'add_notes_tags':
        return t('guideTips.tips.add_notes_tags.description', {
          notes: (data.notesCount as number) || 0,
          tags: (data.tagsCount as number) || 0,
        });
      case 'accept_quest':
        return t('guideTips.tips.accept_quest.description', {
          count: (data.acceptedCount as number) || 0,
        });
      default:
        return t(`guideTips.tips.${tip.id}.description`);
    }
  };

  const pendingTips = tips.filter(t => !t.completed);
  const completedTips = tips.filter(t => t.completed);
  const progressPercent = tips.length > 0 ? (completedCount / tips.length) * 100 : 0;

  return (
    <>
      <Tooltip title={t('guideTips.tooltip')}>
        <IconButton
          color="inherit"
          size="small"
          onClick={handleClick}
          sx={{
            opacity: allDone ? 0.4 : 1,
            color: theme.palette.warning.main,
            '&:hover': {
              backgroundColor: 'action.hover',
            },
          }}
        >
          <Badge
            badgeContent={allDone ? 0 : pendingCount}
            color="warning"
            max={99}
            sx={{
              '& .MuiBadge-badge': {
                fontSize: '0.65rem',
                minWidth: 16,
                height: 16,
              },
            }}
          >
            <LightbulbIcon sx={{ fontSize: 20 }} />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{
          paper: {
            sx: {
              width: 380,
              maxHeight: 520,
              borderRadius: 2,
              overflow: 'hidden',
            },
          },
        }}
      >
        {/* Header */}
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            {t('guideTips.header')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <LinearProgress
              variant="determinate"
              value={progressPercent}
              sx={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                backgroundColor: alpha(theme.palette.primary.main, 0.12),
                '& .MuiLinearProgress-bar': { borderRadius: 3 },
              }}
            />
            <Chip
              label={t('guideTips.progress', { done: completedCount, total: tips.length })}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.7rem', height: 22 }}
            />
          </Box>
        </Box>

        <Divider />

        {/* Tip list */}
        <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
          {loading && tips.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {t('guideTips.loading')}
              </Typography>
            </Box>
          ) : (
            <List dense disablePadding>
              {/* Pending tips */}
              {pendingTips.map((tip) => {
                const config = tipConfigs[tip.id];
                return (
                  <ListItem
                    key={tip.id}
                    sx={{
                      px: 2,
                      py: 1,
                      alignItems: 'flex-start',
                      '&:hover': { backgroundColor: 'action.hover' },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36, mt: 0.5, color: 'primary.main' }}>
                      {config?.icon || <LightbulbIcon fontSize="small" />}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography variant="body2" fontWeight={500}>
                          {t(`guideTips.tips.${tip.id}.title`)}
                        </Typography>
                      }
                      secondary={
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            {getDescription(tip)}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => handleTipAction(tip)}
                              sx={{ fontSize: '0.7rem', py: 0, minHeight: 24, textTransform: 'none' }}
                            >
                              {t(`guideTips.tips.${tip.id}.action`)}
                            </Button>
                            {config?.skippable && (
                              <Button
                                size="small"
                                onClick={() => handleSkip(tip.id)}
                                startIcon={<SkipIcon sx={{ fontSize: '0.8rem !important' }} />}
                                sx={{
                                  fontSize: '0.65rem',
                                  py: 0,
                                  minHeight: 24,
                                  textTransform: 'none',
                                  color: 'text.secondary',
                                }}
                              >
                                {t('guideTips.skip')}
                              </Button>
                            )}
                          </Box>
                        </Box>
                      }
                    />
                  </ListItem>
                );
              })}

              {/* Divider between pending and completed */}
              {pendingTips.length > 0 && completedTips.length > 0 && (
                <Divider sx={{ my: 0.5 }} />
              )}

              {/* Completed tips */}
              {completedTips.map((tip) => {
                const config = tipConfigs[tip.id];
                return (
                  <ListItem
                    key={tip.id}
                    sx={{
                      px: 2,
                      py: 0.5,
                      opacity: 0.5,
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36, color: 'success.main' }}>
                      <CheckIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography
                          variant="body2"
                          sx={{ textDecoration: 'line-through', color: 'text.secondary' }}
                        >
                          {t(`guideTips.tips.${tip.id}.title`)}
                        </Typography>
                      }
                    />
                  </ListItem>
                );
              })}
            </List>
          )}
        </Box>
      </Popover>
    </>
  );
};

export default GuideTips;
