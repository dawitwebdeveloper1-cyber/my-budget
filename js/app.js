import { h, icon, openSheet } from './ui.js';
import { app, persist, newId } from './state.js';
import { load } from './store.js';
import { nowStamp, budgetMonth } from './dates.js';
import { runRecurring } from './ops.js';
import { renderHome } from './views/home.js';
import { renderActivity } from './views/activity.js';
import { renderGoals } from './views/goals.js';
import { renderReminders } from './views/reminders.js';
import { openEntrySheet } from './sheets/entry.js';
import { openWelcome } from './sheets/welcome.js';

const TABS = [
  ['home', 'Home', 'home'],
  ['activity', 'Activity', 'list'],
  ['goals', 'Goals', 'goal'],
  ['reminders', 'Reminders', 'bell'],
];

function render() {
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
        h('button', { class: 'round-btn', 'aria-label': 'Settings', onClick: openSettings }, icon('gear'))),
      screen),
    h('button', { class: 'fab', 'aria-label': 'Add an entry', onClick: () => openEntrySheet() }, icon('plus')),
    h('div', { class: 'tabbar' },
      h('nav', { 'aria-label': 'Tabs' }, TABS.map(([id, label, ic]) =>
        h('button', { class: 'tab', 'aria-current': v.tab === id ? 'page' : null, onClick: () => { v.tab = id; render(); window.scrollTo(0, 0); } },
          icon(ic), label)))),
  );
}
app.render = render;

// Settings arrive in Stage 3.
function openSettings() {
  openSheet('Settings', () => [
    h('p', { class: 'dim' }, 'Settings arrive in Stage 3: Money, Alerts, Security and Backup.'),
    h('p', { class: 'faint' }, 'For now the defaults are used: the budget month starts on the 1st, weeks start on Monday, and calendar reminders are at 9:00 AM with alerts 1 day and 1 hour before.'),
  ]);
}

// Add anything repeating whose date and time have arrived, then show what was added.
function catchUp() {
  const added = runRecurring(app.state, nowStamp(), newId);
  if (added.length) persist();
  render();
  if (app.state.notice.length) openWelcome();
}

catchUp();
// Re-check every 30 seconds so entries count right on time.
setInterval(catchUp, 30_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { app.state = load(); catchUp(); }
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
