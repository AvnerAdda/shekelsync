import { DEFAULT_DONATION_URL } from '../constants';

function normalizeHttpUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') {
    return null;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function resolveDonationUrl(url: string | null | undefined): string {
  return normalizeHttpUrl(url) || DEFAULT_DONATION_URL;
}

export function openDonationUrl(url: string | null | undefined): void {
  if (typeof window === 'undefined') {
    return;
  }

  const targetUrl = resolveDonationUrl(url);
  window.open(targetUrl, '_blank', 'noopener,noreferrer');
}

