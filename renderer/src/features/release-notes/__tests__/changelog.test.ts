import { describe, expect, it } from 'vitest';
import { version } from '@app/package.json';
import changelog from '../../../../../CHANGELOG.md?raw';
import { extractReleaseNotes } from '../changelog';

describe('release changelog extraction', () => {
  it('requires a nonempty changelog entry for the version being shipped', () => {
    const notes = extractReleaseNotes(changelog, version);
    expect(notes?.version).toBe(version);
    expect(notes?.markdown.trim().length).toBeGreaterThan(0);
    expect(notes?.markdown).not.toContain('## [Unreleased]');
  });

  it('keeps multiline Markdown and ignores unreleased and other versions', () => {
    const notes = extractReleaseNotes([
      '# Changes', '## [Unreleased]', '- Future work',
      '## [1.2.3] - 2026-11-03', '### Added', '- **Formatted** notes', '  continued here.',
      '```md', '## [9.9.9]', '```', '### Fixed', '- A fix',
      '## [1.2.2] - 2026-10-30', '- Old work',
    ].join('\r\n'), '1.2.3');

    expect(notes).toEqual({
      version: '1.2.3', date: '2026-11-03',
      markdown: '### Added\n- **Formatted** notes\n  continued here.\n```md\n## [9.9.9]\n```\n### Fixed\n- A fix',
    });
  });

  it('handles prereleases and removes footer reference definitions', () => {
    expect(extractReleaseNotes('## [2.0.0-beta.1]\n- Preview\n\n[Unreleased]: https://example.com', '2.0.0-beta.1'))
      .toEqual({ version: '2.0.0-beta.1', date: null, markdown: '- Preview' });
  });

  it('does not substitute another release when the installed version is missing', () => {
    expect(extractReleaseNotes('## [1.2.30]\n- Different release', '1.2.3')).toBeNull();
  });
});
