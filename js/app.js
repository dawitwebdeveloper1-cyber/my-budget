import { h, s, icon, openSheet, toast } from './ui.js';
import { load, save, cleanEntry, newId } from './store.js';
import { parseAmount, formatCents, centsToInput } from './money.js';
import {
  nowStamp, budgetMonth, shiftBudgetMonth, weekOf, shiftWeek, dayOf, shiftDay, inPeriod,
  isStamp, formatDate, formatTime, formatDateTime, dayKey,
} from './dates.js';
import { monthSummary, periodTotals, receiptMatches, signed } from './calc.js';

let state = load();
const view = { tab: 'home', mode: 'month', anchor: null };

const CATEGORY_COLOURS = ['#8FB39A', '#7FA6B8', '#A890B4', '#6FA8A0', '#C9BFA8', '#9AA77A', '#B48FA0', '#8C9DC0', '#A3A39A'];
function categoryColour(name) {
  const i = state.categories.expense.indexOf(name);
  if (i >= 0) return CATEGORY_COLOURS[i % CATEGORY_COLOURS.length];
  let hsh = 0;
  for (const ch of name) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return CATEGORY_COLOURS[hsh % CATEGORY_COLOURS.length];
}

function persist() {
  if (!save(state)) toast("Couldn't save on this device");
}

// ---------- Money display ----------
// Money in: gold, plus sign, up arrow. Money out: coral, minus sign, down arrow.
function money(cents, { kind } = {}) {
  const k = kind ?? (cents > 0 ? 'in' : cents < 0 ? 'out' : 'zero');
  const cls = k === 'in' ? 'in' : k === 'out' ? 'out' : k === 'save' ? 'dim' : '';
  return h('span', { class: `amt num ${cls}` },
    k === 'in' ? icon('up', 'arrow') : k === 'out' || k === 'save' ? icon('down', 'arrow') : null,
    formatCents(cents, { sign: 'always' }));
}

const UNVERIFIED = "Couldn't double-check this number, so it's hidden.";

function howButton(result, label = 'Show me how') {
  return h('button', { class: 'how', onClick: () => openReceipt(result) }, icon('receipt'), label);
}

// ---------- "Show me how" ----------
function openReceipt(result) {
  openSheet(result.receipt?.title ?? 'Show me how', () => {
    if (!result.ok || !receiptMatches(result.receipt, result.value)) {
      return h('p', { class: 'unverified' }, UNVERIFIED);
    }
    const r = result.receipt;
    const lines = r.lines.map((l) => h('div', { class: 'r-line' },
      h('div', { class: 'l' }, l.label,
        l.at ? h('small', {}, `${formatDateTime(l.at)}${l.category && l.type !== 'income' ? ` · ${l.category}` : ''}`) : null),
      h('div', { class: `r ${l.cents > 0 ? 'in' : l.cents < 0 ? 'out' : ''}` }, formatCents(l.cents, { sign: 'always' }))));
    return h('div', { class: 'receipt' },
      h('div', { class: 'receipt-scroll' },
        lines.length ? lines : h('div', { class: 'r-empty' }, 'Nothing yet.')),
      h('hr', { class: 'rule' }),
      h('div', { class: 'r-total' }, h('div', {}, r.totalLabel),
        h('div', { class: `r num ${result.value > 0 ? 'in' : result.value < 0 ? 'out' : ''}` }, formatCents(result.value, { sign: 'always' }))),
      h('p', { class: 'receipt-foot' }, `${r.lines.length} ${r.lines.length === 1 ? 'item' : 'items'} · worked out two ways, both match`));
  });
}

// ---------- Shell ----------
const TABS = [
  ['home', 'Home', 'home'],
  ['activity', 'Activity', 'list'],
  ['goals', 'Goals', 'goal'],
  ['reminders', 'Reminders', 'bell'],
];

function render() {
  const root = document.getElementById('app');
  const now = nowStamp();
  const titles = { home: 'Home', activity: 'Activity', goals: 'Goals', reminders: 'Reminders' };
  const period = budgetMonth(now, state.settings.monthStartDay);

  const screen = {
    home: () => renderHome(now),
    activity: () => renderActivity(now),
    goals: () => placeholder('Savings goals and category budgets', 'Coming in the next stage.'),
    reminders: () => placeholder('Upcoming bills and subscriptions', 'Coming in the next stage.'),
  }[view.tab]();

  root.replaceChildren(
    h('main', { class: 'shell' },
      h('header', { class: 'topbar' },
        h('div', {}, h('div', { class: 'eyebrow' }, view.tab === 'home' ? period.label : 'My Budget'), h('h1', {}, titles[view.tab])),
        h('button', { class: 'round-btn', 'aria-label': 'Settings', onClick: openSettings }, icon('gear'))),
      screen),
    h('button', { class: 'fab', 'aria-label': 'Add an entry', onClick: () => openEntrySheet() }, icon('plus')),
    h('div', { class: 'tabbar' },
      h('nav', { 'aria-label': 'Tabs' }, TABS.map(([id, label, ic]) =>
        h('button', { class: 'tab', 'aria-current': view.tab === id ? 'page' : null, onClick: () => { view.tab = id; render(); window.scrollTo(0, 0); } },
          icon(ic), label)))),
  );
}

function placeholder(title, sub) {
  return h('div', { class: 'card placeholder fade-in' }, h('h2', {}, title), h('p', {}, sub));
}

// ---------- Home ----------
function renderHome(now) {
  const period = budgetMonth(now, state.settings.monthStartDay);
  const sum = monthSummary(state.entries, period, now);

  const statusText = {
    positive: "You're ahead this month",
    negative: "You're behind this month",
    even: 'Even so far this month',
    unknown: UNVERIFIED,
  }[sum.status];

  const hero = h('section', { class: 'card hero fade-in' },
    h('div', { class: 'label' }, "What's left"),
    sum.left.ok
      ? h('span', { class: `big num ${sum.left.value < 0 ? 'neg' : ''}` }, formatCents(sum.left.value))
      : h('p', { class: 'unverified' }, UNVERIFIED),
    h('div', { class: 'hero-foot' },
      h('button', { class: `status ${sum.status}`, onClick: () => sum.net.ok && openReceipt(sum.net) },
        h('span', { class: 'dot' }),
        h('span', {}, statusText),
        sum.net.ok ? h('span', { class: `num ${sum.net.value > 0 ? 'in' : sum.net.value < 0 ? 'out' : ''}` }, formatCents(sum.net.value, { sign: 'always' })) : null),
      sum.left.ok ? howButton(sum.left) : null));

  const row = (label, result, kind) => h('button', { class: 'row', onClick: () => openReceipt(result), disabled: !result.ok },
    h('span', { class: 'name' }, h('span', {}, label)),
    result.ok ? money(result.value, { kind: result.value === 0 ? 'zero' : kind }) : h('span', { class: 'unverified' }, 'Hidden'),
    h('span', { class: 'how-ic', 'aria-label': 'Show me how' }, icon('receipt')));

  const lines = h('section', { class: 'card fade-in' },
    h('h2', {}, 'This month'),
    h('div', { class: 'rows' },
      row(`Carried over from ${sum.previousLabel}`, sum.carry, sum.carry.value < 0 ? 'out' : 'in'),
      row('Money in', sum.moneyIn, 'in'),
      sum.saved.ok && sum.saved.value !== 0 ? row('Moved to savings', sum.saved, 'save') : null,
      row('Money out', sum.moneyOut, 'out')));

  return [hero, lines, renderRing(sum)];
}

function renderRing(sum) {
  const card = h('section', { class: 'card fade-in' }, h('h2', {}, 'Spending by category'));
  if (!sum.categoriesOk || !sum.moneyOut.ok) { card.append(h('p', { class: 'unverified' }, UNVERIFIED)); return card; }
  const cats = sum.byCategory;
  const total = -sum.moneyOut.value;
  if (!cats.length) { card.append(h('p', { class: 'empty' }, 'No spending yet this month.')); return card; }

  const R = 60, W = 16, C = 2 * Math.PI * R;
  const gap = cats.length > 1 ? 3 : 0;
  let offset = 0;
  const segs = cats.map((c) => {
    const len = (c.value / total) * C;
    const seg = s('circle', {
      cx: 75, cy: 75, r: R, fill: 'none', stroke: categoryColour(c.category), 'stroke-width': W,
      'stroke-dasharray': `${Math.max(len - gap, 0.01)} ${C}`, 'stroke-dashoffset': -offset,
    });
    offset += len;
    return seg;
  });
  const ring = h('div', { class: 'ring' },
    s('svg', { viewBox: '0 0 150 150', role: 'img', 'aria-label': 'Spending by category' },
      s('circle', { cx: 75, cy: 75, r: R, fill: 'none', stroke: 'rgba(237,230,214,0.07)', 'stroke-width': W }), ...segs),
    h('div', { class: 'center' }, h('div', {}, h('small', {}, 'Spent'), h('b', { class: 'num' }, formatCents(total)))));

  const legend = h('div', { class: 'legend rows' }, cats.map((c) =>
    h('button', { class: 'row', onClick: () => openReceipt(c) },
      h('span', { class: 'name' }, h('i', { class: 'swatch', 'data-c': c.category }), h('span', {}, c.category)),
      h('span', { class: 'amt num' }, formatCents(c.value)))));
  // colour swatches (set via CSSOM, allowed by the security policy)
  legend.querySelectorAll('.swatch').forEach((el) => { el.style.background = categoryColour(el.dataset.c); });

  card.append(h('div', { class: 'ring-wrap' }, ring, legend),
    h('div', {}, howButton(sum.moneyOut, 'Show me how (all spending)')));
  return card;
}

// ---------- Activity ----------
function activityPeriod(now) {
  const at = view.anchor ?? now;
  if (view.mode === 'day') return dayOf(at);
  if (view.mode === 'week') return weekOf(at, state.settings.weekStartDay);
  return budgetMonth(at, state.settings.monthStartDay);
}

function renderActivity(now) {
  const period = activityPeriod(now);
  const shift = (d) => {
    const p = view.mode === 'day' ? shiftDay(period, d) : view.mode === 'week' ? shiftWeek(period, d) : shiftBudgetMonth(period, d);
    view.anchor = p.start;
    render();
  };
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'View by' },
    [['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([m, label]) =>
      h('button', { 'aria-pressed': String(view.mode === m), onClick: () => { view.mode = m; view.anchor = null; render(); } }, label)));
  const pager = h('div', { class: 'pager' },
    h('button', { class: 'round-btn', 'aria-label': 'Previous', onClick: () => shift(-1) }, icon('left')),
    h('button', { onClick: () => { view.anchor = null; render(); }, 'aria-label': 'Back to today' }, h('b', {}, period.label)),
    h('button', { class: 'round-btn', 'aria-label': 'Next', onClick: () => shift(1) }, icon('right')));

  const t = periodTotals(state.entries, period, now);
  const mini = (label, result, kind) => h('button', { class: 'row', onClick: () => openReceipt(result), disabled: !result.ok },
    h('span', { class: 'dim' }, label),
    result.ok ? money(result.value, { kind: result.value === 0 ? 'zero' : kind }) : h('span', { class: 'unverified' }, 'Hidden'));
  const totals = h('section', { class: 'card fade-in' },
    h('div', { class: 'totals-mini' }, mini('Money in', t.moneyIn, 'in'), mini('Money out', t.moneyOut, 'out')));

  const list = state.entries.filter((e) => inPeriod(e.at, period)).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const body = [];
  if (!list.length) body.push(h('div', { class: 'card empty fade-in' }, 'Nothing here yet. Tap + to add an entry.'));
  let currentDay = null;
  let group = null;
  for (const e of list) {
    if (dayKey(e.at) !== currentDay) {
      currentDay = dayKey(e.at);
      body.push(h('div', { class: 'day-head' }, formatDate(e.at, { weekday: true })));
      group = h('div', { class: 'card list fade-in' });
      body.push(group);
    }
    group.append(entryRow(e, now));
  }
  return [seg, pager, totals, ...body];
}

function entryRow(e, now) {
  const future = e.at > now;
  const kind = e.type === 'income' ? 'in' : e.type === 'saving' ? 'save' : 'out';
  return h('button', { class: `entry ${future ? 'future' : ''}`, onClick: () => openEntrySheet(e) },
    h('div', {},
      h('div', {}, e.name),
      h('div', { class: 'meta' }, future ? `Counts from ${formatDateTime(e.at)}` : `${e.category} · ${formatTime(e.at)}`)),
    money(signed(e), { kind }));
}

// ---------- Add / edit an entry ----------
function openEntrySheet(existing = null) {
  const now = nowStamp();
  const d = existing
    ? { type: existing.type, name: existing.name, amount: centsToInput(existing.cents), category: existing.category, date: existing.at.slice(0, 10), time: existing.at.slice(11), note: existing.note, showNote: !!existing.note }
    : { type: 'expense', name: '', amount: '', category: state.categories.expense[0], date: now.slice(0, 10), time: now.slice(11), note: '', showNote: false };
  let errors = {};
  if (existing?.type === 'saving') {
    // Savings transfers are managed by the auto-save feature (next stage).
    openSheet('Moved to savings', () => [
      h('div', { class: 'confirm-card' }, h('div', { class: 'big num dim' }, formatCents(-existing.cents)), h('div', { class: 'meta' }, formatDateTime(existing.at))),
    ]);
    return;
  }

  const sheet = openSheet(existing ? 'Edit entry' : 'New entry', () => form());

  function form() {
    const cats = state.categories[d.type];
    if (!cats.includes(d.category)) d.category = cats[0];

    const typeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Money in or out' },
      h('button', { 'aria-pressed': String(d.type === 'expense'), onClick: () => { d.type = 'expense'; redraw(); } }, 'Money out'),
      h('button', { 'aria-pressed': String(d.type === 'income'), onClick: () => { d.type = 'income'; redraw(); } }, 'Money in'));

    const name = h('input', { class: 'input', value: d.name, maxlength: 80, placeholder: d.type === 'income' ? 'e.g. Paycheck' : 'e.g. Groceries at No Frills', autocomplete: 'off', onInput: (ev) => { d.name = ev.target.value; } });
    const amount = h('input', { class: 'input', value: d.amount, inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off', onInput: (ev) => { d.amount = ev.target.value; } });
    const date = h('input', { class: 'input', type: 'date', value: d.date, onInput: (ev) => { d.date = ev.target.value; } });
    const time = h('input', { class: 'input', type: 'time', value: d.time, onInput: (ev) => { d.time = ev.target.value; } });

    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Category' }, cats.map((c) =>
      h('button', { class: 'chip', 'aria-pressed': String(d.category === c), onClick: () => { d.category = c; redraw(); } }, c)));

    const note = d.showNote
      ? h('label', { class: 'field' }, h('span', {}, 'Note'),
        h('textarea', { class: 'input', maxlength: 500, onInput: (ev) => { d.note = ev.target.value; } }, d.note))
      : h('button', { class: 'link', onClick: () => { d.showNote = true; redraw(); } }, 'Add a note');

    const err = (k) => (errors[k] ? h('p', { class: 'error' }, errors[k]) : null);

    return [
      typeSeg,
      h('label', { class: 'field' }, h('span', {}, 'Amount'), h('div', { class: 'money-input' }, h('span', { class: 'cur' }, '$'), amount)), err('amount'),
      h('label', { class: 'field' }, h('span', {}, 'Name'), name), err('name'),
      h('div', { class: 'field' }, h('span', {}, 'Category'), chips),
      h('div', { class: 'two' },
        h('label', { class: 'field' }, h('span', {}, 'Date'), date),
        h('label', { class: 'field' }, h('span', {}, 'Time'), time)), err('when'),
      note,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: review }, 'Review'),
        existing ? h('button', { class: 'btn danger', onClick: confirmDelete }, 'Delete entry') : null),
    ];
  }

  function redraw() { sheet.setTitle(existing ? 'Edit entry' : 'New entry'); sheet.setContent(form()); }

  function build() {
    errors = {};
    const cents = parseAmount(d.amount);
    if (cents === null) errors.amount = 'Enter an amount, like 12.50';
    if (!d.name.trim()) errors.name = 'Give it a name';
    const at = `${d.date}T${(d.time || '').slice(0, 5)}`;
    if (!isStamp(at)) errors.when = 'Pick a date and time';
    if (Object.keys(errors).length) return null;
    return cleanEntry({
      id: existing?.id ?? newId(), type: d.type, name: d.name.trim(), cents, at,
      category: d.category, note: d.showNote ? d.note.trim() : '', createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
  }

  function review() {
    const entry = build();
    if (!entry) { redraw(); return; }
    const kind = entry.type === 'income' ? 'in' : 'out';
    const future = entry.at > nowStamp();
    sheet.setTitle(existing ? 'Save changes?' : 'Add this?');
    sheet.setContent(
      h('div', { class: 'confirm-card' },
        h('div', { class: `big num ${kind}` }, icon(kind === 'in' ? 'up' : 'down', 'arrow'), formatCents(signed(entry), { sign: 'always' })),
        h('div', { class: 'what' }, entry.name),
        h('div', { class: 'meta' }, `${entry.category} · ${formatDateTime(entry.at)}`),
        entry.note ? h('div', { class: 'note' }, entry.note) : null),
      future ? h('p', { class: 'future-note' }, `This will count from ${formatDateTime(entry.at)}.`) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => commit(entry) }, existing ? 'Save changes' : 'Save'),
        h('button', { class: 'btn ghost', onClick: redraw }, 'Back')));
  }

  function commit(entry) {
    const before = state.entries.slice();
    state.entries = existing ? state.entries.map((e) => (e.id === existing.id ? entry : e)) : [...state.entries, entry];
    persist();
    sheet.close();
    render();
    toast(existing ? 'Changes saved' : 'Saved', { label: 'Undo', run: () => { state.entries = before; persist(); render(); toast('Undone'); } });
  }

  function confirmDelete() {
    sheet.setTitle('Delete this entry?');
    const kind = existing.type === 'income' ? 'in' : 'out';
    sheet.setContent(
      h('div', { class: 'confirm-card' },
        h('div', { class: `big num ${kind}` }, icon(kind === 'in' ? 'up' : 'down', 'arrow'), formatCents(signed(existing), { sign: 'always' })),
        h('div', { class: 'what' }, existing.name),
        h('div', { class: 'meta' }, `${existing.category} · ${formatDateTime(existing.at)}`)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => {
          const before = state.entries.slice();
          state.entries = state.entries.filter((e) => e.id !== existing.id);
          persist();
          sheet.close();
          render();
          toast('Deleted', { label: 'Undo', run: () => { state.entries = before; persist(); render(); toast('Undone'); } });
        } }, 'Delete'),
        h('button', { class: 'btn ghost', onClick: redraw }, 'Keep it')));
  }
}

// ---------- Settings (Stage 3) ----------
function openSettings() {
  openSheet('Settings', () => [
    h('p', { class: 'dim' }, 'Settings arrive in Stage 3: Money, Alerts, Security and Backup.'),
    h('p', { class: 'faint' }, 'For now the defaults are used: the budget month starts on the 1st and weeks start on Monday.'),
  ]);
}

// ---------- Start ----------
render();
// Re-check every 30 seconds so future-dated entries start counting right on time.
setInterval(render, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { state = load(); render(); } });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
