import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Button,
  IconButton,
  Alert,
  CircularProgress,
  Stack,
  LinearProgress,
  Tooltip,
  Tab,
  Tabs,
  Divider,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ChipProps } from '@mui/material';
import {
  EmojiEvents as TrophyIcon,
  LocalFireDepartment as StreakIcon,
  Star as StarIcon,
  CheckCircle as CheckIcon,
  Close as CloseIcon,
  Timer as TimerIcon,
  TrendingDown as ReduceIcon,
  Savings as SavingsIcon,
  AccountBalance as BudgetIcon,
  Refresh as RefreshIcon,
  PlayArrow as AcceptIcon,
  Storefront as MerchantIcon,
  Weekend as WeekendIcon,
} from '@mui/icons-material';
import { useQuests } from '@renderer/features/analysis/hooks/useQuests';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { SmartAction, QuestDifficulty } from '@renderer/types/quests';
import { useTranslation } from 'react-i18next';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: Readonly<TabPanelProps>) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

const QuestsPanel: React.FC = () => {
  const {
    proposedQuests,
    acceptedQuests,
    stats,
    loading,
    generating,
    error,
    generateQuests,
    acceptQuest,
    declineQuest,
    verifyQuest,
  } = useQuests();
  const { formatCurrency } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.quests' });
  const [tabValue, setTabValue] = useState(0);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const getDifficultyColor = (difficulty?: QuestDifficulty): ChipProps['color'] => {
    switch (difficulty) {
      case 'hard':
        return 'error';
      case 'medium':
        return 'warning';
      case 'easy':
        return 'success';
      default:
        return 'default';
    }
  };

  const getQuestIcon = (type: SmartAction['action_type']) => {
    if (type === 'quest_merchant_limit') return <MerchantIcon />;
    if (type === 'quest_weekend_limit') return <WeekendIcon />;
    if (type.includes('reduce') || type.includes('spending')) return <ReduceIcon />;
    if (type.includes('savings')) return <SavingsIcon />;
    if (type.includes('budget')) return <BudgetIcon />;
    return <StarIcon />;
  };

  const formatDuration = (days?: number) => {
    if (!days) return '';
    if (days === 7) return t('duration.week');
    if (days === 30) return t('duration.month');
    return t('duration.days', { count: days });
  };

  const handleAccept = async (questId: number) => {
    setActionLoading(questId);
    try {
      await acceptQuest(questId);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDecline = async (questId: number) => {
    setActionLoading(questId);
    try {
      await declineQuest(questId);
    } finally {
      setActionLoading(null);
    }
  };

  const handleVerify = async (questId: number) => {
    setActionLoading(questId);
    try {
      await verifyQuest(questId);
    } finally {
      setActionLoading(null);
    }
  };

  const renderStatsBar = () => {
    if (!stats) return null;

    const levelProgress = stats.level_progress;
    const progressPct = levelProgress.progress_pct || 0;

    return (
      <Card sx={{ mb: 2, background: 'linear-gradient(135deg, #286b33 0%, #3ea54d 50%, #6b3328 100%)' }}>
        <CardContent>
          <Stack direction="row" spacing={3} alignItems="center" justifyContent="space-between">
            {/* Level */}
            <Stack direction="row" spacing={1} alignItems="center">
              <TrophyIcon sx={{ color: 'gold', fontSize: 32 }} />
              <Box>
                <Typography variant="h6" color="white" fontWeight="bold">
                  {t('stats.level', { level: stats.level })}
                </Typography>
                {!levelProgress.max_level_reached && (
                  <Typography variant="caption" color="rgba(255,255,255,0.8)">
                    {t('stats.nextLevel', {
                      points: levelProgress.points_needed,
                      level: levelProgress.next_level,
                    })}
                  </Typography>
                )}
              </Box>
            </Stack>

            {/* Points */}
            <Box textAlign="center">
              <Typography variant="h5" color="white" fontWeight="bold">
                {stats.total_points}
              </Typography>
              <Typography variant="caption" color="rgba(255,255,255,0.8)">
                {t('stats.points', { points: '' }).replace('pts', 'points')}
              </Typography>
            </Box>

            {/* Streak */}
            <Stack direction="row" spacing={1} alignItems="center">
              <StreakIcon sx={{ color: stats.current_streak > 0 ? '#ff6b6b' : 'rgba(255,255,255,0.5)', fontSize: 28 }} />
              <Box>
                <Typography variant="h6" color="white" fontWeight="bold">
                  {stats.current_streak}
                </Typography>
                <Typography variant="caption" color="rgba(255,255,255,0.8)">
                  {t('stats.streak', { count: stats.current_streak })}
                </Typography>
              </Box>
            </Stack>

            {/* Completed/Failed */}
            <Stack direction="row" spacing={2}>
              <Box textAlign="center">
                <Typography variant="h6" color="#4ade80" fontWeight="bold">
                  {stats.quests_completed}
                </Typography>
                <Typography variant="caption" color="rgba(255,255,255,0.8)">
                  {t('stats.completed')}
                </Typography>
              </Box>
              <Box textAlign="center">
                <Typography variant="h6" color="#f87171" fontWeight="bold">
                  {stats.quests_failed}
                </Typography>
                <Typography variant="caption" color="rgba(255,255,255,0.8)">
                  {t('stats.failed')}
                </Typography>
              </Box>
            </Stack>
          </Stack>

          {/* Level progress bar */}
          {!levelProgress.max_level_reached && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress
                variant="determinate"
                value={progressPct}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: 'rgba(255,255,255,0.3)',
                  '& .MuiLinearProgress-bar': {
                    backgroundColor: 'gold',
                    borderRadius: 4,
                  },
                }}
              />
            </Box>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderQuestCard = (quest: SmartAction, isAccepted: boolean) => {
    const isLoading = actionLoading === quest.id;
    const progress = quest.progress;
    const timeRemaining = quest.time_remaining;

    return (
      <Card
        key={quest.id}
        sx={{
          mb: 2,
          border: '1px solid',
          borderColor: isAccepted ? 'primary.main' : 'divider',
          opacity: isLoading ? 0.7 : 1,
          transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: (theme) => `0 8px 24px ${alpha(theme.palette.common.black, 0.1)}`,
          },
        }}
      >
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="flex-start">
            {/* Icon */}
            <Box
              sx={{
                p: 1,
                borderRadius: 2,
                backgroundColor: 'action.hover',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {getQuestIcon(quest.action_type)}
            </Box>

            {/* Content */}
            <Box flex={1}>
              <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                <Typography variant="subtitle1" fontWeight="bold">
                  {quest.title}
                </Typography>
                {quest.quest_difficulty && (
                  <Chip
                    label={t(`difficulty.${quest.quest_difficulty}`)}
                    size="small"
                    color={getDifficultyColor(quest.quest_difficulty)}
                  />
                )}
              </Stack>

              <Typography variant="body2" color="text.secondary" mb={1}>
                {quest.description}
              </Typography>

              {/* Progress bar for accepted quests */}
              {isAccepted && progress && (
                <Box mb={1}>
                  <Stack direction="row" justifyContent="space-between" mb={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      {quest.action_type === 'quest_merchant_limit'
                        ? `${progress.current} / ${progress.target} ${t('progress.visits')}`
                        : `${formatCurrency(progress.current)} / ${formatCurrency(progress.target)}`}
                    </Typography>
                    <Typography
                      variant="caption"
                      color={progress.on_track ? 'success.main' : 'warning.main'}
                    >
                      {progress.on_track ? t('progress.onTrack') : t('progress.atRisk')}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, progress.percentage)}
                    color={progress.on_track ? 'success' : 'warning'}
                    sx={{ height: 6, borderRadius: 3 }}
                  />
                </Box>
              )}

              {/* Meta info */}
              <Stack direction="row" spacing={2} alignItems="center">
                {/* Duration / Time remaining */}
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <TimerIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="caption" color="text.secondary">
                    {(() => {
                      if (isAccepted && timeRemaining) {
                        return timeRemaining.expired
                          ? t('progress.expired')
                          : t('progress.daysLeft', { count: timeRemaining.days });
                      }
                      return formatDuration(quest.quest_duration_days);
                    })()}
                  </Typography>
                </Stack>

                {/* Points reward */}
                <Chip
                  icon={<StarIcon sx={{ fontSize: 14 }} />}
                  label={t('rewards.points', { points: quest.points_reward })}
                  size="small"
                  color="primary"
                  variant="outlined"
                />

                {/* Potential impact */}
                {quest.potential_impact && quest.potential_impact > 0 && (
                  <Typography variant="caption" color="success.main">
                    {formatCurrency(quest.potential_impact)} potential savings
                  </Typography>
                )}
              </Stack>
            </Box>

            {/* Actions */}
            <Stack direction="row" spacing={1}>
              {isAccepted ? (
                <Tooltip title={t('actions.verify')}>
                  <IconButton
                    color="primary"
                    aria-label={t('actions.verify')}
                    onClick={() => handleVerify(quest.id)}
                    disabled={isLoading}
                  >
                    {isLoading ? <CircularProgress size={20} /> : <CheckIcon />}
                  </IconButton>
                </Tooltip>
              ) : (
                <>
                  <Tooltip title={t('actions.accept')}>
                    <IconButton
                      color="primary"
                      aria-label={t('actions.accept')}
                      onClick={() => handleAccept(quest.id)}
                      disabled={isLoading}
                    >
                      {isLoading ? <CircularProgress size={20} /> : <AcceptIcon />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('actions.decline')}>
                    <IconButton
                      color="default"
                      aria-label={t('actions.decline')}
                      onClick={() => handleDecline(quest.id)}
                      disabled={isLoading}
                    >
                      <CloseIcon />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    );
  };

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Box>
          <Typography variant="h6" fontWeight="bold">
            {t('title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('subtitle')}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={generating ? <CircularProgress size={16} /> : <RefreshIcon />}
          onClick={() => generateQuests(false)}
          disabled={generating}
        >
          {generating ? t('actions.generating') : t('actions.generate')}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Stats bar */}
      {renderStatsBar()}

      {/* Tabs */}
      <Tabs
        value={tabValue}
        onChange={(_, newValue) => setTabValue(newValue)}
        sx={{ mb: 1 }}
      >
        <Tab
          label={`${t('tabs.proposed')} (${proposedQuests.length})`}
          disabled={loading}
        />
        <Tab
          label={`${t('tabs.accepted')} (${acceptedQuests.length})`}
          disabled={loading}
        />
      </Tabs>

      <Divider sx={{ mb: 2 }} />

      {loading ? (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <TabPanel value={tabValue} index={0}>
            {proposedQuests.length === 0 ? (
              <Alert severity="info">
                <Typography variant="subtitle2">{t('empty.proposed.title')}</Typography>
                <Typography variant="body2">{t('empty.proposed.description')}</Typography>
              </Alert>
            ) : (
              proposedQuests.map(quest => renderQuestCard(quest, false))
            )}
          </TabPanel>

          <TabPanel value={tabValue} index={1}>
            {acceptedQuests.length === 0 ? (
              <Alert severity="info">
                <Typography variant="subtitle2">{t('empty.accepted.title')}</Typography>
                <Typography variant="body2">{t('empty.accepted.description')}</Typography>
              </Alert>
            ) : (
              acceptedQuests.map(quest => renderQuestCard(quest, true))
            )}
          </TabPanel>
        </>
      )}
    </Box>
  );
};

export default QuestsPanel;
