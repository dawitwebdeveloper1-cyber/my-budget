import { h, icon } from './ui.js';
import { app, persist, newId } from './state.js';
import { load } from './store.js';
import { nowStamp, budgetMonth } from './dates.js';
import { runRecurring } from './ops.js';
import { hasVault, isUnlocked, lock, flush } from './vault.js';
import { showLock } from './lock.js';
import { renderHome } from './views/home.js';
import { renderActivity } from './views/activity.js';
import { renderGoals } from './views/goals.js';
import { renderReminders } from './views/reminders.js';
import { openEntrySheet } from './sheets/entry.js';
import { openWelcome } from './sheets/welcome.js';
import { openSettings } from './sheets/settings.js';

const TABS = [
  ['home', 'Home', 'home'],
  ['activity', 'Activity', 'list'],
  ['goals', 'Goals', 'goal'],
  ['reminders', 'Reminders', 'bell'],
];

let running = false; // true only while unlocked (or when no passcode is set)

function render() {
  if (!running) return;
  const root = document.getElementById('app');
  const now = nowStamp();
  const v = app.view;
  const period = budgetMonth(now, app.state.settings.monthStartDay);
  const screen = {
    home: () => renderHome(now),
    activity: () => renderActivity(now),
    goals: () => renderGoals(now),
    reminders: () => renderReminders(now),
  }[v.tab]();

  root.replaceChildren(
    h('main', { class: 'shell' },
      h('header', { class: 'topbar' },
        h('div', {},
          h('div', { class: 'eyebrow' }, v.tab === 'home' || v.tab === 'goals' ? period.label : 'My Budget'),
          h('h1', {}, TABS.find((t) => t[0] === v.tab)[1])),
        h('button', { class: 'round-btn', 'aria-label': 'Settings', onClick: () => openSettings() }, icon('gear'))),
      screen),
    h('button', { class: 'fab', 'aria-label': 'Add an entry', onClick: () => openEntrySheet() }, icon('plus')),
    h('div', { class: 'tabbar' },
      h('nav', { 'aria-label': 'Tabs' }, TABS.map(([id, label, ic]) =>
        h('button', { class: 'tab', 'aria-current': v.tab === id ? 'page' : null, onClick: () => { v.tab = id; render(); window.scrollTo(0, 0); } },
          icon(ic), label)))),
  );
}
app.render = render;

// Add anything repeating whose date and time have arrived, then show what was added.
function catchUp() {
  if (!running) return;
  const added = runRecurring(app.state, nowStamp(), newId);
  if (added.length) persist();
  render();
  if (app.state.notice.length) openWelcome();
}

function start(state) {
  app.state = state;
  running = true;
  catchUp();
}

// Lock: forget the key, clear the screen, show the passcode screen.
async function lockNow() {
  if (!hasVault()) return;
  await flush();
  running = false;
  lock();
  showLock(start);
}
app.lockNow = lockNow;

// Lock again after more than a minute away from the app.
let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  const away = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = null;
  if (hasVault() && isUnlocked() && away > 60_000) lockNow();
  else catchUp();
});

// Re-check every 30 seconds so entries count right on time.
setInterval(catchUp, 30_000);

if (hasVault()) showLock(start);
else start(load());

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
