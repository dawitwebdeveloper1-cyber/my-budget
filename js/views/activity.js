import { h, icon } from '../ui.js';
import { app } from '../state.js';
import { formatCents } from '../money.js';
import { budgetMonth, shiftBudgetMonth, weekOf, shiftWeek, dayOf, shiftDay, inPeriod, formatDate, formatTime, formatDateTime, dayKey } from '../dates.js';
import { periodTotals, signed } from '../calc.js';
import { weeklySnapshot } from '../budget.js';
import { FREQS, upcoming } from '../recurring.js';
import { activeRules } from '../ops.js';
import { money, howButton, openReceipt } from '../components.js';
import { openEntrySheet } from '../sheets/entry.js';
import { openRuleSheet } from './reminders.js';
import { openRecap } from './recap.js';

function activityPeriod(now) {
  const v = app.view;
  const at = v.anchor ?? now;
  if (v.mode === 'day') return dayOf(at);
  if (v.mode === 'week') return weekOf(at, app.state.settings.weekStartDay);
  return budgetMonth(at, app.state.settings.monthStartDay);
}

export function renderActivity(now) {
  const st = app.state;
  const v = app.view;
  const period = activityPeriod(now);
  const shift = (d) => {
    const p = v.mode === 'day' ? shiftDay(period, d) : v.mode === 'week' ? shiftWeek(period, d) : shiftBudgetMonth(period, d);
    v.anchor = p.start;
    app.render();
  };

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'View by' },
    [['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([m, label]) =>
      h('button', { 'aria-pressed': String(v.mode === m), onClick: () => { v.mode = m; v.anchor = null; app.render(); } }, label)));

  const pager = h('div', { class: 'pager' },
    h('button', { class: 'round-btn', 'aria-label': 'Previous', onClick: () => shift(-1) }, icon('left')),
    h('button', { onClick: () => { v.anchor = null; app.render(); }, 'aria-label': 'Back to today' }, h('b', {}, period.label)),
    h('button', { class: 'round-btn', 'aria-label': 'Next', onClick: () => shift(1) }, icon('right')));

  // Weekly snapshot: this week vs last week
  const snap = weeklySnapshot(st.entries, now, st.settings.weekStartDay);
  let diffText = "Couldn't double-check this.";
  if (snap.diff.ok) {
    const d = snap.diff.value;
    diffText = d > 0 ? `${formatCents(d)} more than last week`
      : d < 0 ? `${formatCents(-d)} less than last week` : 'Same as last week';
  }
  const snapshot = h('section', { class: 'card fade-in' },
    h('h2', {}, 'Weekly snapshot'),
    h('div', { class: 'totals-mini' },
      mini('This week so far', snap.thisOut, 'out'),
      mini('Last week', snap.lastOut, 'out')),
    h('div', { class: 'snap-foot' },
      h('span', { class: `snap-diff ${snap.diff.value > 0 ? 'out' : snap.diff.value < 0 ? 'calm' : ''}` }, diffText),
      snap.diff.ok ? howButton(snap.diff) : null));

  const finished = v.mode === 'month' && period.end <= now && st.entries.some((e) => inPeriod(e.at, period));
  const recap = finished ? h('button', { class: 'recap-link fade-in', onClick: () => openRecap(period, now) },
    h('span', {}, `${period.short} recap`), icon('right')) : null;

  const t = periodTotals(st.entries, period, now);
  const totals = h('section', { class: 'card fade-in' },
    h('div', { class: 'totals-mini' }, mini('Money in', t.moneyIn, 'in'), mini('Money out', t.moneyOut, 'out')));

  // Saved entries, plus upcoming repeats that fall in this period
  const items = st.entries.filter((e) => inPeriod(e.at, period)).map((e) => ({ at: e.at, entry: e }));
  for (const rule of activeRules(st)) {
    for (const at of upcoming(rule, 40)) {
      if (at >= period.end) break;
      if (at >= period.start) items.push({ at, rule });
    }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const body = [];
  if (!items.length) body.push(h('div', { class: 'card empty fade-in' }, 'Nothing here yet. Tap + to add an entry.'));
  let day = null;
  let group = null;
  for (const it of items) {
    if (dayKey(it.at) !== day) {
      day = dayKey(it.at);
      body.push(h('div', { class: 'day-head' }, formatDate(it.at, { weekday: true })));
      group = h('div', { class: 'card list fade-in' });
      body.push(group);
    }
    group.append(it.entry ? entryRow(it.entry, now) : upcomingRow(it.rule, it.at));
  }
  return [seg, pager, snapshot, recap, totals, ...body];
}

function mini(label, result, kind) {
  return h('button', { class: 'row', onClick: () => openReceipt(result), disabled: !result.ok },
    h('span', { class: 'dim' }, label),
    result.ok ? money(result.value, { kind: result.value === 0 ? 'zero' : kind }) : h('span', { class: 'unverified' }, 'Hidden'));
}

export function entryRow(e, now) {
  const future = e.at > now;
  const kind = e.type === 'income' ? 'in' : e.type === 'saving' ? 'save' : 'out';
  const meta = future ? `Counts from ${formatDateTime(e.at)}`
    : `${e.type === 'saving' ? 'Savings' : e.category} · ${formatTime(e.at)}${e.recurringId ? ' · repeats' : ''}`;
  return h('button', { class: `entry ${future ? 'future' : ''}`, onClick: () => openEntrySheet(e) },
    h('div', {}, h('div', {}, e.name), h('div', { class: 'meta' }, meta)),
    money(signed(e), { kind }));
}

function upcomingRow(rule, at) {
  const kind = rule.type === 'income' ? 'in' : 'out';
  return h('button', { class: 'entry future', onClick: () => openRuleSheet(rule) },
    h('div', {}, h('div', {}, rule.name), h('div', { class: 'meta' }, `${FREQS[rule.freq]} · counts from ${formatTime(at)}`)),
    money(rule.type === 'income' ? rule.cents : -rule.cents, { kind }));
}
