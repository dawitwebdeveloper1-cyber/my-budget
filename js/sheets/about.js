// The maker's story, "Tell me what to fix", sharing the app with a friend, and What's new.
import { h, openSheet, toast } from '../ui.js';
import { app, persist } from '../state.js';
import { APP_VERSION, FEEDBACK_EMAIL, MAKER_NAME, WHATS_NEW } from '../config.js';

// The app's own address (wherever it's opened from), without anything after it.
const appUrl = () => new URL('./', location.href).href;

export function storyText(name = MAKER_NAME) {
  return [
    name ? `Hi, I'm ${name}, a high school student in Calgary.` : "Hi! I'm a high school student in Calgary.",
    'I built My Budget because budgeting apps felt complicated, wanted my data, or cost money.',
    'This one is free, keeps everything on your phone, and shows you exactly how every number is worked out.',
    FEEDBACK_EMAIL ? 'If something is confusing or broken, tap "Tell me what to fix". I read every message.' : 'Thanks for trying it. It keeps getting better with every update.',
  ];
}

export function openStory(from = null) {
  openSheet('Made by a Calgary high schooler', () => [
    h('div', { class: 'story' }, storyText().map((p) => h('p', {}, p))),
    h('div', { class: 'actions' },
      FEEDBACK_EMAIL ? h('button', { class: 'btn primary', onClick: () => openFeedback() }, 'Tell me what to fix') : null,
      h('button', { class: 'btn ghost', onClick: () => shareApp() }, 'Share My Budget with a friend')),
    h('p', { class: 'faint small-note center' }, `Version ${APP_VERSION}`),
  ], { from });
}

// The email, written so far: what to fix, plus the phone and version (which they can delete).
export function feedbackLink(ua = navigator.userAgent) {
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'other';
  const ios = /OS (\d+)[_.](\d+)/.exec(ua);
  const body = [
    'What should I fix or add?',
    '',
    '',
    '',
    '--',
    `My Budget ${APP_VERSION} · ${device}${ios && device !== 'other' ? ` (iOS ${ios[1]}.${ios[2]})` : ''}`,
    '(Please don\'t include passwords, account numbers or your passcode.)',
  ].join('\n');
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('My Budget feedback')}&body=${encodeURIComponent(body)}`;
}

export function openFeedback() {
  if (!FEEDBACK_EMAIL) return;
  window.location.href = feedbackLink();
}

// One tap to share the app: the phone's share screen, or the link copied.
export async function shareApp() {
  const url = appUrl();
  const data = { title: 'My Budget', text: 'A simple budget app that works by paycheck. Free, and your data stays on your phone.', url };
  try {
    if (navigator.share) { await navigator.share(data); return true; }
  } catch (e) {
    if (e?.name === 'AbortError') return false;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied. Paste it in a message to a friend.');
    return true;
  } catch {
    toast(url);
    return false;
  }
}

// What's new: once after an update. Brand-new people don't see it (everything is new to them).
export function whatsNewDue(state) {
  if (app.sample) return null;
  const seen = state.settings.seenVersion;
  if (seen === APP_VERSION) return null;
  const isNew = !state.entries.length && !state.goals.length && !state.recurring.length;
  if (isNew) { state.settings.seenVersion = APP_VERSION; persist(); return null; }
  return WHATS_NEW[APP_VERSION] ?? null;
}

export function openWhatsNew(lines) {
  if (document.querySelector('dialog[open]')) return;
  const s = openSheet("What's new", () => [
    h('ul', { class: 'facts privacy' }, lines.map((l) => h('li', {}, l))),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => s.close() }, 'Nice')),
  ], { onClose: () => { app.state.settings.seenVersion = APP_VERSION; persist(); } });
}
