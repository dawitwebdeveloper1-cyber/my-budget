import { h, icon, onHold, holdMenu, toast } from '../ui.js';
import { app, change, newId } from '../state.js';
import { repeatEntry } from '../ops.js';
import { isFavourite, addFavourite, removeFavourite, MAX_FAVOURITES } from '../suggest.js';
import { nowStamp } from '../dates.js';
import { formatCents, centsToInput } from '../money.js';
import { formatHours } from '../budget.js';
import { budgetMonth, shiftBudgetMonth, weekOf, shiftWeek, dayOf, shiftDay, inPeriod, formatDate, formatTime, formatDateTime, dayKey } from '../dates.js';
import { periodTotals, signed } from '../calc.js';
import { weeklySnapshot } from '../budget.js';
import { FREQS, upcoming } from '../recurring.js';
import { activeRules } from '../ops.js';
import { money, howButton, openReceipt, emptyState } from '../components.js';
import { openEntrySheet } from '../sheets/entry.js';
import { openRuleSheet } from './reminders.js';
import { openRecap } from './recap.js';
import { openQuickAdd } from '../sheets/quick.js';

function activityPeriod(now) {
  const v = app.view;
  const at = v.anchor ?? now;
  if (v.mode === 'day') return dayOf(at);
  if (v.mode === 'week') return weekOf(at, app.state.settings.weekStartDay);
  return budgetMonth(at, app.state.settings.monthStartDay);
}

export function renderActivity(now, animate = false) {
  const st = app.state;
  const v = app.view;
  const rv = animate ? ' reveal' : '';
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
  const snapshot = h('section', { class: `card snapshot${rv}` },
    h('h2', {}, 'Weekly snapshot'),
    h('div', { class: 'totals-mini' },
      mini('This week so far', snap.thisOut, 'out'),
      mini('Last week', snap.lastOut, 'out')),
    h('div', { class: 'snap-foot' },
      h('span', { class: `snap-diff ${snap.diff.value > 0 ? 'out' : snap.diff.value < 0 ? 'calm' : ''}` }, diffText),
      snap.diff.ok ? howButton(snap.diff) : null));

  const finished = v.mode === 'month' && period.end <= now && st.entries.some((e) => inPeriod(e.at, period));
  const recap = finished ? h('button', { class: `recap-link${rv}`, onClick: () => openRecap(period, now) },
    h('span', {}, `${period.short} recap`), icon('right')) : null;

  const t = periodTotals(st.entries, period, now);
  const totals = h('div', { class: `totals-mini pair-gap${rv}` }, mini('Money in', t.moneyIn, 'in'), mini('Money out', t.moneyOut, 'out'));

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
  if (!items.length) body.push(h('div', { class: `card${rv}` }, emptyState('list', 'Nothing here yet', 'Press and hold any entry later for quick options.',
    { label: 'Add an entry', run: () => openQuickAdd() })));
  let day = null;
  let group = null;
  for (const it of items) {
    if (dayKey(it.at) !== day) {
      day = dayKey(it.at);
      body.push(h('div', { class: 'day-head' }, formatDate(it.at, { weekday: true })));
      group = h('div', { class: `card list${rv}` });
      body.push(group);
    }
    group.append(it.entry ? entryRow(it.entry, now) : upcomingRow(it.rule, it.at));
  }
  return [seg, pager, snapshot, recap, totals, ...body];
}

function mini(label, result, kind) {
  return h('button', { class: 'row', onClick: (e) => openReceipt(result, e.currentTarget), disabled: !result.ok },
    h('span', { class: 'dim' }, label),
    result.ok ? money(result.value, { kind: result.value === 0 ? 'zero' : kind }) : h('span', { class: 'unverified' }, 'Hidden'));
}

export function entryRow(e, now) {
  const future = e.at > now;
  const kind = e.type === 'income' || e.type === 'refund' ? 'in' : e.type === 'saving' ? 'save' : 'out';
  const meta = future ? `Counts from ${formatDateTime(e.at)}`
    : `${e.type === 'saving' ? 'Savings' : e.type === 'refund' ? `Refund · ${e.category}` : e.category} · ${formatTime(e.at)}${e.recurringId ? ' · repeats' : ''}`;
  const el = h('button', { class: `entry ${future ? 'future' : ''}`, onClick: () => openEntrySheet(e, {}, { from: el }) },
    h('div', {}, h('div', {}, e.name), h('div', { class: 'meta' }, meta)),
    money(signed(e), { kind }));
  // Press and hold: Edit, Duplicate, Delete
  onHold(el, () => {
    const auto = e.type === 'saving' && e.parentId;
    const isMoney = e.type !== 'saving';
    const fav = isMoney && isFavourite(app.state, e);
    const full = (app.state.favourites ?? []).length >= MAX_FAVOURITES;
    holdMenu(el, [
      { label: 'Edit', icon: 'edit', run: () => openEntrySheet(e) },
      // Repeat: the same entry again, today, saved straight away (with Undo)
      isMoney ? { label: 'Repeat today', icon: 'repeat', run: () => change((st) => repeatEntry(st, e, nowStamp(), newId), `Repeated ${e.name} ${formatCents(signed(e), { sign: 'always' })}`) } : null,
      isMoney ? { label: 'Duplicate', icon: 'copy', run: () => openEntrySheet(null, duplicateOf(e)) } : null,
      // Money back for this purchase: same name and category, ready to save
      e.type === 'expense' ? { label: 'Got a refund', icon: 'repeat', run: () => openEntrySheet(null, { ...duplicateOf(e), type: 'refund' }) } : null,
      isMoney ? (fav
        ? { label: 'Remove from favourites', icon: 'star', run: () => change((st) => removeFavourite(st, e), 'Removed from favourites') }
        : { label: 'Add to favourites', icon: 'star', run: () => (full ? toast(`Favourites are full (${MAX_FAVOURITES}). Remove one first.`) : change((st) => addFavourite(st, e, newId), `${e.name} is now a favourite`)) }) : null,
      !auto ? { label: 'Delete', icon: 'trash', danger: true, run: () => openEntrySheet(e, {}, { action: 'delete' }) } : null,
    ].filter(Boolean));
  });
  return el;
}

// A copy of an entry, dated now, ready to review and save.
function duplicateOf(e) {
  return {
    type: e.type, name: e.name, amount: centsToInput(e.cents), category: e.category,
    note: e.note ?? '', showNote: !!e.note,
    payMode: e.hours ? 'hours' : 'amount',
    hours: e.hours ? formatHours(e.hours) : '', rate: e.rateCents ? centsToInput(e.rateCents) : '',
  };
}

function upcomingRow(rule, at) {
  const kind = rule.type === 'income' ? 'in' : 'out';
  const el = h('button', { class: 'entry future', onClick: () => openRuleSheet(rule, el) },
    h('div', {}, h('div', {}, rule.name), h('div', { class: 'meta' }, `${FREQS[rule.freq]} · counts from ${formatTime(at)}`)),
    money(rule.type === 'income' ? rule.cents : -rule.cents, { kind }));
  return el;
}
