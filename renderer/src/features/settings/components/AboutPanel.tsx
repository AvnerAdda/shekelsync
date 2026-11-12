import React from 'react';
import { alpha, Box, Button, Paper, Stack, Typography, useTheme } from '@mui/material';
import BugReportIcon from '@mui/icons-material/BugReport';
import CoffeeIcon from '@mui/icons-material/LocalCafe';
import FeedbackIcon from '@mui/icons-material/Feedback';
import GitHubIcon from '@mui/icons-material/GitHub';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import MailIcon from '@mui/icons-material/MailOutlined';
import { useTranslation } from 'react-i18next';
import {
  BUG_REPORT_URL,
  CONTACT_URL,
  DONATION_OPEN_MODAL_EVENT,
  FEEDBACK_URL,
  PROJECT_REPO_URL,
} from '@renderer/features/support';

const FEATURE_KEYS = ['sync', 'categorize', 'insights', 'forecast', 'assistant'] as const;

const openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

interface ActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  testId: string;
}

const ActionCard: React.FC<ActionCardProps> = ({ icon, title, description, children, testId }) => {
  const theme = useTheme();
  return (
    <Paper
      variant="outlined"
      data-testid={testId}
      sx={{ p: 2.5, flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 1.5 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box
          sx={{
            display: 'flex',
            p: 0.75,
            borderRadius: 1.5,
            color: 'primary.main',
            bgcolor: alpha(theme.palette.primary.main, 0.1),
          }}
        >
          {icon}
        </Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{title}</Typography>
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', flex: 1 }}>{description}</Typography>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>{children}</Stack>
    </Paper>
  );
};

interface AboutPanelProps {
  appVersion: string;
}

const AboutPanel: React.FC<AboutPanelProps> = ({ appVersion }) => {
  const { t } = useTranslation('translation', { keyPrefix: 'settings.about' });

  const openDonation = () => {
    // The title bar owns the donation modal (records the intent, then opens Buy Me a Coffee).
    window.dispatchEvent(new CustomEvent(DONATION_OPEN_MODAL_EVENT));
  };

  return (
    <Box>
      <Paper id="about" sx={{ p: 3, mb: 3, scrollMarginTop: 112 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <InfoIcon color="primary" />
          <Typography variant="h6">{t('title')}</Typography>
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          {t('version', { version: appVersion })}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          {t('description')}
        </Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          {t('featuresTitle')}
        </Typography>
        <Typography variant="body2" component="ul" sx={{ color: 'text.secondary', m: 0, ps: 3 }}>
          {FEATURE_KEYS.map((key) => (
            <li key={key}>{t(`features.${key}`)}</li>
          ))}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mt: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('madeWith')}
          </Typography>
          <Button size="small" startIcon={<GitHubIcon />} onClick={() => openExternal(PROJECT_REPO_URL)}>
            {t('sourceCode')}
          </Button>
        </Box>
      </Paper>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <ActionCard
          testId="about-contact"
          icon={<MailIcon fontSize="small" />}
          title={t('contact.title')}
          description={t('contact.description')}
        >
          <Button variant="outlined" size="small" onClick={() => openExternal(CONTACT_URL)}>
            {t('contact.action')}
          </Button>
        </ActionCard>

        <ActionCard
          testId="about-feedback"
          icon={<FeedbackIcon fontSize="small" />}
          title={t('feedback.title')}
          description={t('feedback.description')}
        >
          <Button variant="outlined" size="small" onClick={() => openExternal(FEEDBACK_URL)}>
            {t('feedback.action')}
          </Button>
          <Button size="small" startIcon={<BugReportIcon />} onClick={() => openExternal(BUG_REPORT_URL)}>
            {t('feedback.bug')}
          </Button>
        </ActionCard>

        <ActionCard
          testId="about-coffee"
          icon={<CoffeeIcon fontSize="small" />}
          title={t('coffee.title')}
          description={t('coffee.description')}
        >
          <Button variant="contained" size="small" startIcon={<CoffeeIcon />} onClick={openDonation}>
            {t('coffee.action')}
          </Button>
        </ActionCard>
      </Stack>
    </Box>
  );
};

export default AboutPanel;
