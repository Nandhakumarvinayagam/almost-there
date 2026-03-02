import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Lightweight toast hook — returns a message string (or null) and a
 * showToast() function.  Render <Toast message={toast} /> in your component
 * to display the notification.
 *
 * @example
 *   const { toast, showToast } = useToast();
 *   // ...
 *   await copyToClipboard(text);
 *   showToast('Copied!');
 *   // ...
 *   return <><YourUI /><Toast message={toast} /></>;
 */
export function useToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  // CRITICAL: clear the pending timer on unmount to prevent state updates
  // after the component is gone.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const showToast = useCallback((message, duration = 1500) => {
    setToast(message);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  return { toast, showToast };
}
