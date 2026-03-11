/**
 * Detects a human-readable label and Material Icon name for a registry URL.
 * Used to render registry link chips with meaningful labels instead of raw URLs.
 *
 * This is a rendering utility — NOT part of normalizeSession(). It runs at render
 * time when displaying the logistics registry card.
 *
 * Reference: Plan v5, Section 16
 *
 * @param {string|null} url - The registry URL stored in session.logistics.registry
 * @returns {{ label: string, icon: string } | null}
 */
export function detectRegistryLabel(url) {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    const pathname = new URL(url).pathname;

    if (hostname.includes('venmo.com'))
      return { label: 'Venmo', icon: 'payments' };
    if (hostname.includes('cash.app'))
      return { label: 'Cash App', icon: 'payments' };
    if (hostname.includes('spotify.com'))
      return { label: 'Playlist', icon: 'queue_music' };
    if (hostname.includes('amazon.com') && pathname.includes('registries'))
      return { label: 'Registry', icon: 'card_giftcard' };
    if (hostname.includes('docs.google.com'))
      return { label: 'Google Doc', icon: 'description' };
    return { label: 'Link', icon: 'link' };
  } catch {
    return { label: 'Link', icon: 'link' };
  }
}
