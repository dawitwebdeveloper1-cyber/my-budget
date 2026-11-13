import { h, icon, toast } from './ui.js';
import { app, persist, newId } from './state.js';
import { load } from './store.js';
import { initStorage, requestPersistence } from './storage.js';
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
import { openQuickAdd } from './sheets/quick.js';
import { openWelcome } from './sheets/welcome.js';
import { openCheckin } from './sheets/checkin.js';
import { paydayCheckin, streak, streakText } from './habits.js';
import { needsSetup, renderSetup } from './views/setup.js';
import { sampleState } from './sample.js';
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
  // Brand-new: the quick setup comes first (no tabs, no + button until it's done or skipped).
  if (needsSetup(app.state)) {
    root.replaceChildren(h('main', { class: 'shell setup-shell' }, renderSetup({ onSample: startSample })));
    if (animate) reveal(root);
    return;
  }
  const period = budgetMonth(now, app.state.settings.monthStartDay);
  const screen = {
    home: () => renderHome(now, animate),
    activity: () => renderActivity(now, animate),
    goals: () => renderGoals(now, animate),
    reminders: () => renderReminders(now, animate),
  }[v.tab]();
  const screenEl = h('div', { class: `screen${animate ? ' enter' : ''}` }, screen);
  screenEl.addEventListener('animationend', () => screenEl.classList.remove('enter'), { once: true });
  root.replaceChildren(...[
    app.sample ? h('div', { class: 'sample-bar', role: 'status' },
      h('span', {}, h('b', {}, 'Example data'), ' · nothing is saved'),
      h('button', { class: 'sample-exit', onClick: exitSample }, 'Exit')) : null,
    h('main', { class: 'shell' },
      h('header', { class: 'topbar' },
        h('div', {},
          h('div', { class: 'eyebrow' }, v.tab === 'home' || v.tab === 'goals' ? period.label : 'My Budget'),
          h('h1', {}, TABS.find((t) => t[0] === v.tab)[1])),
        h('div', { class: 'top-right' },
          v.tab === 'home' ? streakPill(now) : null,
          h('button', { class: 'round-btn', 'aria-label': 'Settings', onClick: (e) => openSettings(null, e.currentTarget) }, icon('gear')))),
      screenEl),
    h('button', { class: 'fab', 'aria-label': 'Add an entry', onClick: () => openQuickAdd() }, icon('plus')),
    h('div', { class: 'tabbar' },
      h('nav', { 'aria-label': 'Tabs' }, TABS.map(([id, label, ic]) =>
        h('button', {
          class: 'tab', 'aria-current': v.tab === id ? 'page' : null,
          onClick: () => { if (v.tab === id) return; v.tab = id; window.scrollTo({ top: 0, behavior: 'instant' }); render(true); },
        }, icon(ic), label)))),
  ].filter(Boolean));
  if (animate) reveal(root);
  celebrate();
}
app.render = () => render(false);

// Example data: built in memory, never saved. Exit reloads the app, which removes every trace of it.
function startSample() {
  app.sample = true;
  app.state = sampleState(nowStamp());
  app.view.tab = 'home';
  window.scrollTo({ top: 0, behavior: 'instant' });
  render(true);
  toast('Example data. Look around and try things; none of it is saved.');
}
function exitSample() {
  app.sample = false;
  location.reload();
}

// The streak: small and in the corner, never a big message. Tapping explains how it works.
function streakPill(now) {
  const s = streak(app.state, now, app.state.settings.weekStartDay);
  const text = streakText(s);
  if (!text) return null;
  return h('button', { class: `streak${s.paused ? ' paused' : ''}`, 'aria-label': text, onClick: () => toast(s.paused
    ? 'Paused, not lost. Log anything to pick it up again.'
    : s.loggedToday ? 'Logged today. One missed day a week is free.' : s.skipUsed ? "This week's free skip is used. Log today to keep going." : 'One missed day a week is free.') },
  `${s.count}`, h('span', {}, s.paused ? ' days · paused' : ' days'));
}

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
  // On payday, the check-in takes the place of "Added since your last visit".
  const checkin = paydayCheckin(app.state, nowStamp());
  if (checkin) openCheckin(checkin);
  else if (app.state.notice.length) openWelcome();
}

function start(state) {
  app.sample = false; // real data from here on (also after unlocking)
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

// Big text: follow the iPhone's Text Size setting (Settings → Display & Brightness → Text Size, and
// Accessibility → Larger Text). Safari reports it through the "-apple-system-body" font; the default is 17px.
// The whole app scales with it (up to 1.4×), so nothing gets cut off. Other browsers keep normal size.
function applyTextSize() {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;font:-apple-system-body';
  document.body.append(probe);
  const px = probe.style.font ? parseFloat(getComputedStyle(probe).fontSize) : 0;
  probe.remove();
  const scale = px > 17 ? Math.min(1.4, Math.round((px / 17) * 100) / 100) : 1;
  document.documentElement.style.setProperty('--text-scale', String(scale));
  document.documentElement.classList.toggle('big-text', scale > 1);
}
applyTextSize();
document.addEventListener('visibilitychange', () => { if (!document.hidden) applyTextSize(); });

// Start: open the device storage (moving old data across safely), ask the phone to keep it, then go.
async function boot() {
  await initStorage();
  requestPersistence();
  if (hasVault()) showLock(start);
  else start(load());
}
boot();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}
