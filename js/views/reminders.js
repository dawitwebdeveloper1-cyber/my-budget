import { h, icon, openSheet } from '../ui.js';
import { app, change, newId } from '../state.js';
import { parseAmount, formatCents, centsToInput } from '../money.js';
import { nowStamp, isStamp, formatDate, formatDateTime } from '../dates.js';
import { FREQS, KINDS, nextOccurrence, upcoming, alertText } from '../recurring.js';
import { activeRules, editRule, stopRule } from '../ops.js';
import { money, emptyState } from '../components.js';
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

  return [
    h('section', { class: `card lav${rv}` },
      h('h2', {}, 'Bills & subscriptions'),
      bills.length ? h('div', { class: 'list-in' }, bills.map(row)) : emptyState('calendar', 'Nothing repeating yet', "Add rent, phone, Netflix and so on, and they'll be added automatically each time."),
      h('button', { class: 'add-line', onClick: addBill }, icon('plus'), 'Add a bill or subscription')),
    pays.length ? h('section', { class: `card sage${rv}` }, h('h2', {}, 'Paydays'), h('div', { class: 'list-in' }, pays.map(row))) : null,
  ];
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
      h('div', { class: 'actions' },
        rule.type === 'expense' ? h('button', { class: 'btn primary', onClick: () => addToCalendar(rule) }, 'Add to Calendar') : null,
        rule.type === 'expense' ? h('p', { class: 'faint small-note center' }, `Alerts ${alertText(st.settings)}, every time.`) : null,
        h('button', { class: 'btn ghost', onClick: () => { sheet.setTitle('Edit'); sheet.setContent(edit()); } }, 'Edit'),
        h('button', { class: 'btn danger', onClick: confirmStop }, 'Stop repeating')),
    ];
  }

  const d = {
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
      h('div', { class: 'field' }, h('span', {}, 'Repeats'), chips('Repeats', Object.entries(FREQS), d.freq, (v) => { d.freq = v; })),
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
    change((s) => editRule(s, rule.id, { name: d.name.trim(), cents, category: d.category, freq: d.freq, anchor }, nowStamp(), newId), 'Changes saved');
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
