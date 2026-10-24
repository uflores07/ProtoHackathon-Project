// Paste your Firebase web config here so phones sync with each other (see TEAM.md, Person 4).
// It is safe to commit: Firebase web config is public by design; access is set by the database rules.
// While this is null, Split runs on this device only (tabs in the same browser still sync).
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCg3mvmSUjr36HkkO-qV-twskriwguxrJo',
  authDomain: 'split-app-1c17d.firebaseapp.com',
  databaseURL: 'https://split-app-1c17d-default-rtdb.firebaseio.com',
  projectId: 'split-app-1c17d',
  storageBucket: 'split-app-1c17d.firebasestorage.app',
  messagingSenderId: '286187957922',
  appId: '1:286187957922:web:4ccde645c275fb8b5471fb',
};

// The Gemini model used for receipt/menu reading and restaurant search.
// See https://ai.google.dev/gemini-api/docs/models for the current list.
export const MODEL = 'gemini-3.8-flash';

// The Cloudflare Worker that holds the Gemini key for the GitHub Pages app (see cloudflare-worker.js),
// e.g. 'https://split-ai.yourname.workers.dev'. Safe to commit: it's a URL, not the key.
// While this is null, the hosted app needs a key in Settings (or runs in demo mode).
export const AI_PROXY = 'https://split-ai.jackluk518.workers.dev';
