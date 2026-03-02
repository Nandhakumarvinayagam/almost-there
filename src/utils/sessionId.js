// Generates a 6-character uppercase alphanumeric session code
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateSessionId() {
  return Array.from({ length: 6 }, () =>
    CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join('');
}
