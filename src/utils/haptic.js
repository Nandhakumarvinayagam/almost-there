/** Trigger a vibration pattern if supported.
 * No-op on iOS Safari and browsers that don't implement navigator.vibrate.
 * @param {number|number[]} pattern - ms duration or [buzz,pause,buzz,...] array
 */
export function haptic(pattern = 50) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}
