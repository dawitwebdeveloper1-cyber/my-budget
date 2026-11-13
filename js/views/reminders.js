import { h, icon, openSheet } from '../ui.js';
import { app, change, newId } from '../state.js';
import { parseAmount, formatCents, centsToInput } from '../money.js';
import { nowStamp, isStamp, formatDate, formatDateTime } from '../dates.js';
import { FREQS, KINDS, REPEAT_CHOICES, nextOccurrence, upcoming, alertText } from '../recurring.js';
import { activeRules, editRule, stopRule, logUse, markChecked, setTracking } from '../ops.js';
import { money, emptyState, howButton, openReceipt } from '../components.js';
import { subscriptionTotal, checkupDue, trackedItems, costPerUse, yearlyCost } from '../decide.js';
import { addToCalendar } from '../calendar.js';
import { openEntrySheet } from '../sheets/entry.js';

const pad = (n) => String(n).padStart(2, '0');

export function renderReminders(now, animate = false) {
  const st = app.state;
  const rv = animate ? ' reveal' : '';
  const rules = activeRules(st).map((r) => ({ r, next: nextOccurrence(r) })).sort((a, b) => (a.next < b.next ? -1 : 1));
  const bills = rules.filter((x) => x.r.type === 'expense');
  const pays = rules.filter((x) => x.r.type === 'income');

  const row = ({ r, next }) => h('button', { class: 'entry', onClick: (e) => openRuleSheet(r, e.currentTarget) },
    h('div', {},
      h('div', {}, r.name),
      h('div', { class: 'meta' }, `${KINDS[r.kind]} · ${FREQS[r.freq]} · next ${formatDate(next, { weekday: true })}`)),
    money(r.type === 'income' ? r.cents : -r.cents, { kind: r.type === 'income' ? 'in' : 'out' }));

  const addBill = () => openEntrySheet(null, {
    type: 'expense', repeats: 'monthly', kind: 'subscription', category: 'Bills',
    time: `${pad(st.settings.eventHour)}:00`, timeTouched: false,
  });

  // Subscriptions: what they cost a year, and a "Still using these?" check every 3 months.
  const total = subscriptionTotal(st);
  const due = checkupDue(st, now);
  const subCard = total.count ? h('div', {},
    h('button', { class: 'sub-total', onClick: (e) => total.ok && openReceipt(total, e.currentTarget) },
      h('span', {}, `Your ${total.count === 1 ? 'subscription costs' : `${total.count} subscriptions cost`}`),
      total.ok ? h('b', { class: 'num' }, `${formatCents(total.value)} a year`) : h('span', { class: 'unverified' }, 'Hidden')),
    due.length ? h('button', { class: 'advice action', onClick: () => openCheckup() },
      h('span', {}, `Check-up: still using ${due.length === 1 ? due[0].name : `these ${due.length}`}?`), icon('right')) : null) : null;

  // Cost per use: anything with a use counter turned on.
  const tracked = trackedItems(st);
  const usesCard = tracked.length ? h('section', { class: `card${rv}` },
    h('h2', {}, 'Cost per use'),
    h('div', {}, tracked.map(({ kind, item }) => useRow(kind, item, now)))) : null;

  return [
    h('section', { class: `card lav${rv}` },
      h('h2', {}, 'Bills & subscriptions'),
      subCard,
      bills.length ? h('div', { class: 'list-in' }, bills.map(row)) : emptyState('calendar', 'Nothing repeating yet', "Add rent, phone, Netflix and so on, and they'll be added automatically each time."),
      h('button', { class: 'add-line', onClick: addBill }, icon('plus'), 'Add a bill or subscription')),
    usesCard,
    pays.length ? h('section', { class: `card sage${rv}` }, h('h2', {}, 'Paydays'), h('div', { class: 'list-in' }, pays.map(row))) : null,
  ];
}

// One counter line: "Gym: $45.00 a month, used 3 times this month, that's $15.00 a use" + "Used it".
function useRow(kind, item, now) {
  const c = costPerUse(item, now);
  return h('div', { class: 'use-row' },
    h('div', {},
      h('div', {}, item.name),
      h('div', { class: 'meta' }, c?.ok ? c.text : "Couldn't double-check this"),
      c?.receipt ? howButton(c) : null),
    h('button', { class: 'btn primary narrow', onClick: () => countUse(kind, item) }, 'Used it'));
}

// Counts one use now, with Undo.
export function countUse(kind, item) {
  const at = nowStamp();
  change((s) => logUse(s, kind, item.id, at), `Counted a use of ${item.name}`);
}

// ---------- Subscription check-up ----------
export function openCheckup(from = null) {
  const sheet = openSheet('Still using these?', () => view(), { from });
  function view() {
    const st = app.state;
    const now = nowStamp();
    const due = checkupDue(st, now);
    if (!due.length) {
      return [h('p', { class: 'dim' }, "All checked. We'll ask again in 3 months."),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => sheet.close() }, 'Done'))];
    }
    return [
      h('p', { class: 'dim' }, 'Every 3 months, a quick look at each subscription.'),
      ...due.map((r) => h('div', { class: 'use-row' },
        h('div', {}, h('div', {}, r.name), h('div', { class: 'meta' }, `${formatCents(r.cents)} ${FREQS[r.freq].toLowerCase()} · ${formatCents(yearlyCost(r))} a year`)),
        h('div', { class: 'inline' },
          h('button', { class: 'btn ghost narrow', onClick: () => confirmStop(r) }, 'No'),
          h('button', { class: 'btn primary narrow', onClick: () => { change((s) => markChecked(s, r.id, now), `Keeping ${r.name}`); sheet.setContent(view()); } }, 'Yes')))),
    ];
  }
  function confirmStop(r) {
    sheet.setTitle(`Stop ${r.name}?`);
    sheet.setContent(
      h('p', { class: 'dim' }, `${r.name} won't be added again here. Remember to cancel it with the company too, or they'll keep charging you. Past entries stay.`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => { change((s) => stopRule(s, r.id), `Stopped ${r.name}`); sheet.setTitle('Still using these?'); sheet.setContent(view()); } }, 'Stop it here'),
        h('button', { class: 'btn ghost', onClick: () => { sheet.setTitle('Still using these?'); sheet.setContent(view()); } }, 'Back')));
  }
}

// ---------- One repeating item ----------
export function openRuleSheet(rule, from = null) {
  const st = app.state;
  const next = nextOccurrence(rule);
  const sheet = openSheet(rule.name, () => view(), { from });

  function view() {
    const dates = upcoming(rule, 3);
    return [
      h('div', { class: 'confirm-card' },
        h('div', { class: `big num ${rule.type === 'income' ? 'in' : 'out'}` }, icon(rule.type === 'income' ? 'up' : 'down', 'arrow'),
          formatCents(rule.type === 'income' ? rule.cents : -rule.cents, { sign: 'always' })),
        h('div', { class: 'what' }, rule.name),
        h('div', { class: 'meta' }, `${KINDS[rule.kind]} · ${FREQS[rule.freq]} · ${rule.category}`)),
      dates.length ? h('div', { class: 'field' }, h('span', {}, 'Coming up'),
        h('ul', { class: 'facts' }, dates.map((d) => h('li', {}, formatDateTime(d))))) : null,
      rule.kind === 'subscription' ? counter() : null,
      h('div', { class: 'actions' },
        rule.type === 'expense' ? h('button', { class: 'btn primary', onClick: () => addToCalendar(rule) }, 'Add to Calendar') : null,
        rule.type === 'expense' ? h('p', { class: 'faint small-note center' }, `Alerts ${alertText(st.settings)}, every time.`) : null,
        h('button', { class: 'btn ghost', onClick: () => { sheet.setTitle('Edit'); sheet.setContent(edit()); } }, 'Edit'),
        h('button', { class: 'btn danger', onClick: confirmStop }, 'Stop repeating')),
    ];
  }

  // Cost per use: an optional counter for subscriptions.
  function counter() {
    const live = app.state.recurring.find((r) => r.id === rule.id) ?? rule;
    const c = costPerUse(live, nowStamp());
    const toggle = (on) => { change((s) => setTracking(s, 'rule', rule.id, on), on ? 'Use counter on' : 'Use counter off'); sheet.setContent(view()); };
    if (!c) {
      return h('div', { class: 'field' }, h('span', {}, 'Cost per use'),
        h('button', { class: 'btn ghost', onClick: () => toggle(true) }, 'Count each time I use it'));
    }
    return h('div', { class: 'field' }, h('span', {}, 'Cost per use'),
      h('div', { class: 'use-row' },
        h('div', {}, h('div', { class: 'meta' }, c.ok ? c.text : "Couldn't double-check this"), c.receipt ? howButton(c) : null),
        h('button', { class: 'btn primary narrow', onClick: () => { countUse('rule', live); sheet.setContent(view()); } }, 'Used it')),
      h('button', { class: 'link', onClick: () => toggle(false) }, 'Turn the counter off'));
  }

  const d = {
    kind: rule.kind,
    name: rule.name, amount: centsToInput(rule.cents), category: rule.category, freq: rule.freq,
    date: (next ?? rule.anchor).slice(0, 10), time: (next ?? rule.anchor).slice(11),
  };
  let errors = {};

  function edit() {
    const cats = st.categories[rule.type];
    const chips = (label, options, value, pick) => h('div', { class: 'chips', role: 'group', 'aria-label': label }, options.map(([v, t]) =>
      h('button', { class: 'chip', 'aria-pressed': String(value === v), onClick: () => { pick(v); sheet.setContent(edit()); } }, t)));
    return [
      h('label', { class: 'field' }, h('span', {}, 'Amount'),
        h('div', { class: 'money-input' }, h('span', { class: 'cur' }, '$'), h('input', { class: 'input', inputmode: 'decimal', value: d.amount, onInput: (e) => { d.amount = e.target.value; } }))),
      errors.amount ? h('p', { class: 'error' }, errors.amount) : null,
      h('label', { class: 'field' }, h('span', {}, 'Name'), h('input', { class: 'input', maxlength: 80, value: d.name, onInput: (e) => { d.name = e.target.value; } })),
      errors.name ? h('p', { class: 'error' }, errors.name) : null,
      h('div', { class: 'field' }, h('span', {}, 'Category'), chips('Category', cats.map((c) => [c, c]), d.category, (v) => { d.category = v; })),
      rule.type === 'expense' ? h('div', { class: 'field' }, h('span', {}, 'This is a'),
        chips('Kind', [['bill', 'Bill'], ['subscription', 'Subscription']], d.kind, (v) => { d.kind = v; })) : null,
      rule.freq === 'semimonthly'
        ? h('p', { class: 'faint small-note' }, 'Twice a month. Change the days from Settings → Money → Your pay.')
        : h('div', { class: 'field' }, h('span', {}, 'Repeats'), chips('Repeats', REPEAT_CHOICES, d.freq, (v) => { d.freq = v; })),
      h('div', { class: 'two' },
        h('label', { class: 'field' }, h('span', {}, 'Next date'), h('input', { class: 'input', type: 'date', value: d.date, onInput: (e) => { d.date = e.target.value; } })),
        h('label', { class: 'field' }, h('span', {}, 'Time'), h('input', { class: 'input', type: 'time', value: d.time, onInput: (e) => { d.time = e.target.value; } }))),
      errors.when ? h('p', { class: 'error' }, errors.when) : null,
      h('p', { class: 'faint small-note' }, 'Changes apply from the next date on. Past entries stay as they are.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: save }, 'Save changes'),
        h('button', { class: 'btn ghost', onClick: () => { sheet.setTitle(rule.name); sheet.setContent(view()); } }, 'Back')),
    ];
  }

  function save() {
    errors = {};
    const cents = parseAmount(d.amount);
    const anchor = `${d.date}T${d.time.slice(0, 5)}`;
    if (cents === null) errors.amount = 'Enter an amount, like 18.99';
    if (!d.name.trim()) errors.name = 'Give it a name';
    if (!isStamp(anchor)) errors.when = 'Pick a date and time';
    if (Object.keys(errors).length) { sheet.setContent(edit()); return; }
    change((s) => editRule(s, rule.id, { name: d.name.trim(), cents, category: d.category, freq: d.freq, anchor, ...(rule.type === 'expense' ? { kind: d.kind } : {}) }, nowStamp(), newId), 'Changes saved');
    sheet.close();
    if (rule.type === 'expense') {
      const updated = activeRules(app.state).find((r) => r.name === d.name.trim() && r.anchor === anchor);
      if (updated) {
        const again = openSheet('Update your calendar?', () => [
          h('p', { class: 'dim' }, 'Your calendar still has the old reminder. Add the new one, then delete the old event in Calendar.'),
          h('div', { class: 'actions' },
            h('button', { class: 'btn primary', onClick: () => { addToCalendar(updated); again.close(); } }, 'Add to Calendar'),
            h('button', { class: 'btn ghost', onClick: () => again.close() }, 'Not now')),
        ]);
      }
    }
  }

  function confirmStop() {
    sheet.setTitle('Stop repeating?');
    sheet.setContent(
      h('p', { class: 'dim' }, `${rule.name} won't be added again. Past entries stay. If you added it to your calendar, delete that event in Calendar too.`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => { change((s) => stopRule(s, rule.id), 'Stopped repeating'); sheet.close(); } }, 'Stop repeating'),
        h('button', { class: 'btn ghost', onClick: () => { sheet.setTitle(rule.name); sheet.setContent(view()); } }, 'Keep it')));
  }
}
