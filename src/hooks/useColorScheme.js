import { useState, useEffect } from 'react';

/**
 * Returns 'dark' or 'light' based on the OS/browser color-scheme preference.
 * Subscribes to live changes so the UI updates when the user toggles system theme.
 */
export function useColorScheme() {
  const [isDark, setIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isDark ? 'dark' : 'light';
}
