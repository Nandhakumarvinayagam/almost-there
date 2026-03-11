/**
 * Convert a hex colour string to a comma-separated RGB string
 * suitable for use inside rgba().
 *
 * hexToRgb('#7C3AED') → '124, 58, 237'
 */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/**
 * Return '#FFFFFF' or '#1A1A1A' — whichever has better contrast
 * against the given background colour, using sRGB → linear luminance.
 *
 * Threshold 0.4 (slightly higher than the WCAG 0.179 midpoint) biases
 * toward white text so primary action buttons stay readable on mid-tones.
 */
export function getContrastTextColor(hexColor) {
  if (!hexColor || hexColor.length < 7) return '#FFFFFF';
  const r = parseInt(hexColor.slice(1, 3), 16) / 255;
  const g = parseInt(hexColor.slice(3, 5), 16) / 255;
  const b = parseInt(hexColor.slice(5, 7), 16) / 255;

  const toLinear = (c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

  return luminance > 0.4 ? '#1A1A1A' : '#FFFFFF';
}
