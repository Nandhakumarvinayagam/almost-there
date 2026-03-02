/**
 * Toast — fixed-position notification that fades in and auto-dismisses.
 * Controlled entirely by its parent via the `message` prop; when message
 * is null the component renders nothing.  Pair with useToast().
 *
 * variant="default"  — dark pill near top (clipboard feedback etc.)
 * variant="accent"   — bright green, slides up from above ETA panel
 *                      (used for "almost there!" announcements)
 */
export default function Toast({ message, variant = 'default' }) {
  if (!message) return null;
  return (
    <div
      className={`toast-notification${variant === 'accent' ? ' toast-notification-accent' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
