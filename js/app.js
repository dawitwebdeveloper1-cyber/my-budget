import { h, icon, toast } from './ui.js';
import { app, persist, newId } from './state.js';
import { load } from './store.js';
import { nowStamp, budgetMonth } from './dates.js';
import { runRecurring } from './ops.js';
import { goalProgress } from './budget.js';
import { hasVault, isUnlocked, lock, flush } from './vault.js';
import { showLock } from './lock.js';
import { reveal, confetti } from './motion.js';
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

// animate: true when a screen opens (tab switch, app start, unlock). Plain redraws stay still.
function render(animate = false) {
  if (!running) return;
  const root = document.getElementById('app');
  const now = nowStamp();
  const v = app.view;
  const period = budgetMonth(now, app.state.settings.monthStartDay);
  const screen = {
    home: () => renderHome(now, animate),
    activity: () => renderActivity(now, animate),
    goals: () => renderGoals(now, animate),
    reminders: () => renderReminders(now, animate),
  }[v.tab]();

  const screenEl = h('div', { class: `screen${animate ? ' enter' : ''}` }, screen);
  screenEl.addEventListener('animationend', () => screenEl.classList.remove('enter'), { once: true });
  root.replaceChildren(
    h('main', { class: 'shell' },
      h('header', { class: 'topbar' },
        h('div', {},
          h('div', { class: 'eyebrow' }, v.tab === 'home' || v.tab === 'goals' ? period.label : 'My Budget'),
          h('h1', {}, TABS.find((t) => t[0] === v.tab)[1])),
        h('button', { class: 'round-btn', 'aria-label': 'Settings', onClick: (e) => openSettings(null, e.currentTarget) }, icon('gear'))),
      screenEl),
    h('button', { class: 'fab', 'aria-label': 'Add an entry', onClick: () => openEntrySheet() }, icon('plus')),
    h('div', { class: 'tabbar' },
      h('nav', { 'aria-label': 'Tabs' }, TABS.map(([id, label, ic]) =>
        h('button', {
          class: 'tab', 'aria-current': v.tab === id ? 'page' : null,
          onClick: () => { if (v.tab === id) return; v.tab = id; window.scrollTo({ top: 0, behavior: 'instant' }); render(true); },
        }, icon(ic), label)))),
  );
  if (animate) reveal(root);
  celebrate();
}
app.render = () => render(false);

// Confetti the first time a savings goal is reached.
function celebrate() {
  const st = app.state;
  const now = nowStamp();
  const reached = st.goals.filter((g) => goalProgress(g, st.entries, now).reached).map((g) => g.id);
  const before = st.celebrated;
  if (before === null) { st.celebrated = reached; persist(); return; } // first run after updating: no surprise confetti
  const fresh = reached.filter((id) => !before.includes(id));
  if (!fresh.length && reached.length === before.length) return;
  st.celebrated = reached;
  persist();
  if (fresh.length) {
    confetti();
    const g = st.goals.find((x) => x.id === fresh[0]);
    if (g && !document.querySelector('.toast')) toast(`You reached ${g.name}!`);
  }
}

// Add anything repeating whose date and time have arrived, then show what was added.
function catchUp(animate = false) {
  if (!running) return;
  const added = runRecurring(app.state, nowStamp(), newId);
  if (added.length) persist();
  render(animate);
  if (app.state.notice.length) openWelcome();
}

function start(state) {
  app.state = state;
  running = true;
  catchUp(true);
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
setInterval(() => catchUp(false), 30_000);

if (hasVault()) showLock(start);
else start(load());

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}
