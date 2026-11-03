import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { version } from '@app/package.json';
import ReleaseNotesDialog from '../ReleaseNotesDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: 'en' },
    t: (key: string, options?: { version?: string }) => ({
      'releaseNotes.title': 'What’s new',
      'releaseNotes.subtitle': 'The latest improvements to ShekelSync.',
      'releaseNotes.version': `Version ${options?.version}`,
      'releaseNotes.close': 'Got it',
      'releaseNotes.fullChangelog': 'Full changelog',
      'common.close': 'Close',
    }[key] || key),
  }),
}));

vi.mock('../../../../../CHANGELOG.md?raw', async () => {
  const { version: current } = await import('@app/package.json');
  return { default: `## [${current}] - 2026-11-03\n### Added\n- **Formatted** notes with [privacy](PRIVACY.md).\n- ![Remote tracking image](https://example.com/tracker.png)\n<script>alert('unsafe')</script>\n## [0.0.1]\n- Old release` };
});

describe('release notes dialog', () => {
  it('formats the installed release and safely resolves documentation links', () => {
    render(<ReleaseNotesDialog onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'What’s new' })).toBeInTheDocument();
    expect(screen.getByText(`Version ${version}`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Added' })).toBeInTheDocument();
    expect(screen.getByText('Formatted').tagName).toBe('STRONG');
    expect(screen.queryByText('Old release')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByRole('link', { name: 'privacy' })).toHaveAttribute('href',
      `https://github.com/AvnerAdda/shekelsync/blob/v${version}/PRIVACY.md`);
    expect(screen.getByRole('link', { name: 'Full changelog' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('acknowledges using either the main action or close button', () => {
    const close = vi.fn();
    render(<ReleaseNotesDialog onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledTimes(2);
  });
});
