/**
 * Copies text to the clipboard.
 * Uses the modern Clipboard API when available, with a textarea-based
 * execCommand fallback for older browsers.
 * Throws if copying fails on both paths.
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Legacy fallback — create an off-screen textarea, select, execCommand
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    if (!document.execCommand('copy')) throw new Error('execCommand copy returned false');
  } finally {
    document.body.removeChild(ta);
  }
}
