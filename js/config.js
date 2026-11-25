// Things about the app itself (not your data): its version, what's new, and how to reach the maker.

export const APP_VERSION = '2026.12.2';

// Where "Tell me what to fix" emails go. Empty = the button stays hidden until an address is set.
export const FEEDBACK_EMAIL = '';

// The maker's first name for the story screen. Empty = the story is told without a name.
export const MAKER_NAME = '';

// Shown once after an update ("What's new"). Newest first; keep each line short.
export const WHATS_NEW = {
  '2026.12.2': [
    'A calmer Home: your big number up top, and the month one tap away under "This month".',
    'Settings → Extras: switch each extra on or off. Everything you had stays on.',
    'New extras: split a bill with friends ("Owed to you") and track cash on hand.',
    'When an update is ready, a small bar says so. Tap it to refresh.',
  ],
  '2026.12': [
    'Share a goal: a clean picture card for your story, with no amounts unless you choose.',
    FEEDBACK_EMAIL ? 'Tell me what to fix: one tap in Settings sends feedback straight to me.' : null,
    'Share My Budget with a friend from Settings.',
    'Lock timer, a privacy page, a spreadsheet export and a backup check (from the last update).',
  ].filter(Boolean),
};
