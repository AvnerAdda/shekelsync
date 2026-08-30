import React, { useState } from 'react';
import {
  Button,
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ReplayIcon from '@mui/icons-material/Replay';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useTranslation } from 'react-i18next';
import type {
  MoneyReviewAction,
  MoneyReviewItem,
  MoneyReviewStatus,
  SnoozePreset,
} from '../types';

interface MoneyReviewItemActionsProps {
  item: MoneyReviewItem;
  busy: boolean;
  onPrimaryAction: (item: MoneyReviewItem, action: MoneyReviewAction) => Promise<void>;
  onUpdateStatus: (
    item: MoneyReviewItem,
    status: MoneyReviewStatus,
    snoozePreset?: SnoozePreset,
  ) => Promise<boolean>;
  align?: 'start' | 'end';
}

const MoneyReviewItemActions: React.FC<MoneyReviewItemActionsProps> = ({
  item,
  busy,
  onPrimaryAction,
  onUpdateStatus,
  align = 'start',
}) => {
  const { t } = useTranslation('translation', { keyPrefix: 'moneyReview' });
  const [snoozeAnchor, setSnoozeAnchor] = useState<HTMLElement | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const isQuest = item.actionType.startsWith('quest_');
  const isCompleted = ['resolved', 'dismissed'].includes(item.status);
  const isSnoozed = item.status === 'snoozed';

  const handleSnooze = (preset: SnoozePreset) => {
    setSnoozeAnchor(null);
    void onUpdateStatus(item, 'snoozed', preset);
  };

  const primaryButton = item.primaryAction ? (
    <Button
      variant="contained"
      size="small"
      startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <OpenInNewIcon />}
      disabled={busy}
      onClick={() => void onPrimaryAction(item, item.primaryAction!)}
      sx={{ minWidth: { sm: 148 } }}
    >
      {item.primaryAction.label || t('actions.open')}
    </Button>
  ) : item.status === 'active' && !isQuest ? (
    <Button
      variant="contained"
      size="small"
      disabled={busy}
      onClick={() => void onUpdateStatus(item, 'accepted')}
      sx={{ minWidth: { sm: 128 } }}
    >
      {t('actions.start')}
    </Button>
  ) : null;

  return (
    <>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{
          flexShrink: 0,
          width: { xs: '100%', md: 'auto' },
          alignItems: { xs: 'stretch', sm: 'center' },
          justifyContent: align === 'end' ? 'flex-end' : 'flex-start',
          '& > .MuiButton-root': { width: { xs: '100%', sm: 'auto' } },
        }}
      >
        {isQuest ? primaryButton : isCompleted ? (
          <Button
            size="small"
            startIcon={busy ? <CircularProgress size={16} /> : <ReplayIcon />}
            disabled={busy}
            onClick={() => void onUpdateStatus(item, 'active')}
          >
            {t('actions.reopen')}
          </Button>
        ) : isSnoozed ? (
          <Button
            size="small"
            variant="contained"
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <ReplayIcon />}
            disabled={busy}
            onClick={() => void onUpdateStatus(item, 'active')}
          >
            {t('actions.reopenNow')}
          </Button>
        ) : (
          <>
            {primaryButton}
            <Button
              size="small"
              variant={primaryButton ? 'outlined' : 'contained'}
              startIcon={<CheckCircleOutlineIcon />}
              disabled={busy}
              onClick={() => void onUpdateStatus(item, 'resolved')}
            >
              {t('actions.done')}
            </Button>
            <Tooltip title={t('actions.snooze')}>
              <IconButton
                size="small"
                aria-label={t('actions.snooze')}
                disabled={busy}
                aria-haspopup="menu"
                aria-expanded={Boolean(snoozeAnchor)}
                onClick={(event) => setSnoozeAnchor(event.currentTarget)}
              >
                <ScheduleIcon />
              </IconButton>
            </Tooltip>
          </>
        )}

        {!isQuest && !isCompleted && (
          <Tooltip title={t('actions.more')}>
            <IconButton
              size="small"
              aria-label={t('actions.more')}
              disabled={busy}
              onClick={(event) => setMoreAnchor(event.currentTarget)}
            >
              <MoreHorizIcon />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      <Menu anchorEl={snoozeAnchor} open={Boolean(snoozeAnchor)} onClose={() => setSnoozeAnchor(null)}>
        <MenuItem onClick={() => handleSnooze('1_week')}>
          <ListItemIcon><ScheduleIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('snooze.week')} secondary={t('snooze.weekHint')} />
        </MenuItem>
        <MenuItem onClick={() => handleSnooze('1_month')}>
          <ListItemIcon><ScheduleIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('snooze.month')} secondary={t('snooze.monthHint')} />
        </MenuItem>
        <MenuItem onClick={() => handleSnooze('3_months')}>
          <ListItemIcon><ScheduleIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('snooze.threeMonths')} secondary={t('snooze.threeMonthsHint')} />
        </MenuItem>
      </Menu>

      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
        <MenuItem
          onClick={() => {
            setMoreAnchor(null);
            void onUpdateStatus(item, 'dismissed');
          }}
          sx={{ color: 'text.secondary' }}
        >
          <ListItemIcon><DeleteOutlineIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('actions.hide', { defaultValue: 'Hide' })} secondary={t('actions.hideHint', { defaultValue: 'Hide this message without changing your financial plan' })} />
        </MenuItem>
      </Menu>
    </>
  );
};

export default MoneyReviewItemActions;
