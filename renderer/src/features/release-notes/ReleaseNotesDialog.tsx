import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import { version } from '@app/package.json';
import changelog from '../../../../CHANGELOG.md?raw';
import { extractReleaseNotes } from './changelog';

const notes = extractReleaseNotes(changelog, version);
const changelogUrl = `https://github.com/AvnerAdda/shekelsync/blob/v${version}/CHANGELOG.md`;

function releaseLink(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, `https://github.com/AvnerAdda/shekelsync/blob/v${version}/`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export default function ReleaseNotesDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation('translation');
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const date = notes?.date ? new Date(`${notes.date}T12:00:00`) : null;
  const releaseDate = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date)
    : null;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth scroll="paper" aria-labelledby="release-notes-title">
      <DialogTitle id="release-notes-header" component="div" sx={{ px: 3, pt: 3, pb: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Box sx={{ display: 'grid', placeItems: 'center', bgcolor: 'action.hover', color: 'primary.main', borderRadius: 3, width: 48, height: 48, flexShrink: 0 }}>
            <AutoAwesomeIcon />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography id="release-notes-title" variant="h5" component="h2" sx={{ fontWeight: 700 }}>
              {t('releaseNotes.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('releaseNotes.subtitle')}
            </Typography>
          </Box>
          <IconButton aria-label={t('common.close')} onClick={onClose} size="small"><CloseIcon /></IconButton>
        </Stack>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 2 }}>
          <Chip size="small" color="primary" variant="outlined" label={t('releaseNotes.version', { version })} />
          {releaseDate && <Typography variant="caption" color="text.secondary">{releaseDate}</Typography>}
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ px: 3, maxHeight: '60vh' }}>
        {!locale.startsWith('en') && (
          <Typography variant="caption" color="text.secondary">{t('releaseNotes.englishNote')}</Typography>
        )}
        <Box lang="en" dir="ltr" sx={{
          fontSize: '0.9rem', lineHeight: 1.75, overflowWrap: 'anywhere',
          '& h3': { fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'primary.main', mt: 3, mb: 1 },
          '& h3:first-of-type': { mt: 0.5 },
          '& p': { mt: 0, mb: 1.5 },
          '& ul, & ol': { pl: 2.5, mt: 0, mb: 2 },
          '& li': { pl: 0.5, mb: 1 },
          '& code': { bgcolor: 'action.hover', borderRadius: 0.5, px: 0.5, fontSize: '0.85em' },
          '& pre': { overflow: 'auto', p: 1.5, bgcolor: 'action.hover', borderRadius: 1 },
        }}>
          <ReactMarkdown skipHtml components={{
            img: () => null,
            a: ({ href, children }) => (
              <Link href={releaseLink(href)} target="_blank" rel="noopener noreferrer">{children}</Link>
            ),
          }}>
            {notes?.markdown || t('releaseNotes.empty')}
          </ReactMarkdown>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Button component="a" href={changelogUrl} target="_blank" rel="noopener noreferrer" endIcon={<OpenInNewIcon />}>
          {t('releaseNotes.fullChangelog')}
        </Button>
        <Button variant="contained" onClick={onClose}>{t('releaseNotes.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
