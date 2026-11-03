export interface ReleaseNotes {
  version: string;
  date: string | null;
  markdown: string;
}

/** Read only the installed version's section, excluding Unreleased and history. */
export function extractReleaseNotes(changelog: string, version: string): ReleaseNotes | null {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  let start = -1;
  let date: string | null = null;
  let inCodeFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) inCodeFence = !inCodeFence;
    if (inCodeFence) continue;
    const heading = /^##\s+\[?v?(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)\]?(?:\s|$)/.exec(line);
    if (start < 0 && heading?.[1] === version) {
      start = index + 1;
      date = /\b\d{4}-\d{2}-\d{2}\b/.exec(line)?.[0] ?? null;
    } else if (start >= 0 && /^##\s+/.test(line)) {
      return { version, date, markdown: lines.slice(start, index).join('\n').trim() };
    }
  }

  if (start < 0) return null;
  // Reference definitions at the end of CHANGELOG are navigation, not notes.
  const markdown = lines.slice(start).filter((line) => !/^\[[^\]]+\]:\s/.test(line)).join('\n').trim();
  return { version, date, markdown };
}
