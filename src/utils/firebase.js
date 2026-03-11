import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

// Resolves with the Firebase User once anonymous sign-in completes.
// All Firebase reads/writes (which require auth != null in security rules)
// must wait for this promise before starting.
export const whenAuthReady = signInAnonymously(auth)
  .then((cred) => cred.user)
  .catch((err) => {
    console.error('Anonymous auth failed:', err);
    return null;
  });

/**
 * Returns the current Firebase auth user, retrying anonymous sign-in if needed.
 * Use this instead of `whenAuthReady` when you need a guaranteed non-null user.
 */
export async function ensureAuth() {
  // Fast path: already signed in
  if (auth.currentUser) return auth.currentUser;
  // Wait for the initial attempt
  const user = await whenAuthReady;
  if (user) return user;
  // Retry once
  const cred = await signInAnonymously(auth);
  return cred.user;
}
