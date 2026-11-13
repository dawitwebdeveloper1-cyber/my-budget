// Add / edit an entry: money in or out, repeating schedules, paycheck logger and auto-save preview.
import { h, icon, openSheet } from '../ui.js';
import { app, change, newId } from '../state.js';
import { parseAmount, formatCents, centsToInput } from '../money.js';
import { nowStamp, isStamp, formatDateTime } from '../dates.js';
import { signed } from '../calc.js';
import { parseHours, formatHours, hoursPay, splitAcrossGoals, formatPercent } from '../budget.js';
import { FREQS, REPEAT_CHOICES, alertText } from '../recurring.js';
import { addEntry, updateEntry, deleteEntry, addRule, editFuture, deleteFuture, PAYCHECK, setTracking, logUse } from '../ops.js';
import { looksLikeSubscription, costPerUse } from '../decide.js';
import { cleanEntry, cleanRule } from '../store.js';
import { receiptBody, openReceipt, howButton } from '../components.js';
import { addToCalendar } from '../calendar.js';

const pad = (n) => String(n).padStart(2, '0');

function chipGroup(label, options, value, onPick) {
  return h('div', { class: 'chips', role: 'group', 'aria-label': label }, options.map(([v, text]) =>
    h('button', { class: 'chip', 'aria-pressed': String(value === v), onClick: () => onPick(v) }, text)));
}

// opts.from: the tapped row (expands into the form). opts.action 'delete': go straight to the delete confirmation.
export function openEntrySheet(existing = null, preset = {}, { from = null, action = null } = {}) {
  if (existing?.type === 'saving') { openSavingSheet(existing, { from, action }); return; }
  const s = app.state;
  const now = nowStamp();
  const rule = existing?.recurringId ? s.recurring.find((r) => r.id === existing.recurringId) : null;
  const d = existing
    ? {
      type: existing.type, name: existing.name, amount: centsToInput(existing.cents), category: existing.category,
      date: existing.at.slice(0, 10), time: existing.at.slice(11), note: existing.note, showNote: !!existing.note,
      repeats: 'never', kind: 'bill', timeTouched: true,
      payMode: existing.hours ? 'hours' : 'amount',
      hours: existing.hours ? formatHours(existing.hours) : '', rate: existing.rateCents ? centsToInput(existing.rateCents) : '',
    }
    : {
      type: 'expense', name: '', amount: '', category: s.categories.expense[0], date: now.slice(0, 10), time: now.slice(11),
      note: '', showNote: false, repeats: 'never', kind: 'bill', timeTouched: false, payMode: 'amount', hours: '',
      rate: s.settings.hourlyRateCents ? centsToInput(s.settings.hourlyRateCents) : '',
      ...preset,
    };
  let errors = {};
  let kindEl = null; // the Bill / Subscription chips (declared before the sheet draws them)
  const title = existing ? 'Edit entry' : 'New entry';
  const isPay = () => d.type === 'income' && d.category === PAYCHECK;
  const sheet = openSheet(title, () => form(), { from });

  function setRepeats(v) {
    d.repeats = v;
    if (v !== 'never' && !d.timeTouched) d.time = `${pad(s.settings.eventHour)}:00`;
    redraw();
  }

  function payPreview() {
    const hrs = parseHours(d.hours);
    const rate = parseAmount(d.rate);
    if (hrs === null || rate === null) return h('p', { class: 'faint calc-line' }, 'Enter hours and hourly pay');
    const r = hoursPay(hrs, rate);
    if (!r.ok) return h('p', { class: 'unverified' }, "Couldn't double-check this number.");
    return h('div', { class: 'calc-line' }, h('span', { class: 'num in big-ish' }, `= ${formatCents(r.value)}`), howButton(r));
  }

  function form() {
    // A refund goes back into a spending category.
    const cats = s.categories[d.type === 'refund' ? 'expense' : d.type];
    if (!cats.includes(d.category)) d.category = cats[0];
    if (d.type === 'refund') d.repeats = 'never';
    const refundBox = h('input', { type: 'checkbox', id: 'is-refund', checked: d.type === 'refund' });
    refundBox.addEventListener('change', () => { d.type = refundBox.checked ? 'refund' : 'income'; redraw(); });
    const field = (label, input, err) => [h('label', { class: 'field' }, h('span', {}, label), input), errors[err] ? h('p', { class: 'error' }, errors[err]) : null];
    const input = (key, { live, ...attrs } = {}) => h('input', { class: 'input', value: d[key], autocomplete: 'off', ...attrs, onInput: (ev) => { d[key] = ev.target.value; if (key === 'time' || key === 'date') d.timeTouched = true; live?.(); } });

    let amountBlock;
    if (isPay() && d.payMode === 'hours') {
      const preview = h('div', {}, payPreview());
      const live = () => preview.replaceChildren(payPreview());
      amountBlock = [
        h('div', { class: 'two' },
          field('Hours worked', input('hours', { inputmode: 'decimal', placeholder: '40', live }), 'hours'),
          field('Hourly pay', h('div', { class: 'money-input' }, h('span', { class: 'cur' }, '$'), input('rate', { inputmode: 'decimal', placeholder: '0.00', live })), 'rate')),
        preview,
      ];
    } else {
      amountBlock = field('Amount', h('div', { class: 'money-input' }, h('span', { class: 'cur' }, '$'), input('amount', { inputmode: 'decimal', placeholder: '0.00' })), 'amount');
    }

    return [
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Money in or out' },
        h('button', { 'aria-pressed': String(d.type === 'income' || d.type === 'refund'), onClick: () => { if (d.type !== 'refund') d.type = 'income'; redraw(); } }, 'Money in'),
        h('button', { 'aria-pressed': String(d.type === 'expense'), onClick: () => { d.type = 'expense'; redraw(); } }, 'Money out')),
      d.type === 'income' || d.type === 'refund'
        ? h('label', { class: 'check refund-check', for: 'is-refund' }, refundBox, h('span', {}, "It's a refund (money back for something I bought)"))
        : null,
      isPay() ? h('div', { class: 'seg small', role: 'group', 'aria-label': 'How to enter the paycheck' },
        h('button', { 'aria-pressed': String(d.payMode === 'amount'), onClick: () => { d.payMode = 'amount'; redraw(); } }, 'Amount'),
        h('button', { 'aria-pressed': String(d.payMode === 'hours'), onClick: () => { d.payMode = 'hours'; redraw(); } }, 'Hours × pay')) : null,
      amountBlock,
      field('Name', input('name', { maxlength: 80, placeholder: d.type === 'income' ? 'e.g. Paycheck' : d.type === 'refund' ? 'e.g. Walmart return' : 'e.g. Groceries at No Frills', live: autoKind }), 'name'),
      h('div', { class: 'field' }, h('span', {}, d.type === 'refund' ? 'Goes back into' : 'Category'),
        chipGroup('Category', cats.map((c) => [c, c]), d.category, (c) => { d.category = c; redraw(); })),
      !existing && d.type !== 'refund' ? h('div', { class: 'field' }, h('span', {}, 'Repeats'),
        chipGroup('Repeats', [['never', 'Never'], ...REPEAT_CHOICES], d.repeats, setRepeats)) : null,
      !existing && d.repeats !== 'never' && d.type === 'expense' ? h('div', { class: 'field' }, h('span', {}, 'This is a'), kindChips()) : null,
      existing ? usesBlock() : null,
      rule ? h('p', { class: 'faint small-note' }, `Repeats ${FREQS[rule.freq].toLowerCase()}. Changes can apply to just this one or all future ones.`) : null,
      h('div', { class: 'two' },
        h('label', { class: 'field' }, h('span', {}, d.repeats !== 'never' ? 'First date' : 'Date'), input('date', { type: 'date' })),
        h('label', { class: 'field' }, h('span', {}, 'Time'), input('time', { type: 'time' }))),
      errors.when ? h('p', { class: 'error' }, errors.when) : null,
      d.showNote
        ? h('label', { class: 'field' }, h('span', {}, 'Note'), h('textarea', { class: 'input', maxlength: 500, onInput: (ev) => { d.note = ev.target.value; } }, d.note))
        : h('button', { class: 'link', onClick: () => { d.showNote = true; redraw(); } }, 'Add a note'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: saveNow }, existing ? 'Save changes' : 'Save'),
        existing ? h('button', { class: 'btn danger', onClick: confirmDelete }, 'Delete entry') : null),
    ];
  }

  // Bill or subscription: picked from the name (Netflix, gym…) until you choose yourself.
  function kindChips() {
    kindEl = chipGroup('Kind', [['bill', 'Bill'], ['subscription', 'Subscription']], d.kind, (k) => { d.kind = k; d.kindTouched = true; redraw(); });
    return kindEl;
  }
  function autoKind() {
    if (d.kindTouched) return;
    const k = looksLikeSubscription(d.name) ? 'subscription' : 'bill';
    if (k === d.kind) return;
    d.kind = k;
    if (kindEl?.isConnected) kindEl.replaceWith(kindChips()); // swap the chips in place, so typing isn't interrupted
  }
  if (!existing && d.name) autoKind();

  // Cost per use for a one-off purchase of $100 or more: an optional use counter.
  function usesBlock() {
    const live = app.state.entries.find((e) => e.id === existing.id) ?? existing;
    if (rule || live.type !== 'expense') return null;
    const c = costPerUse(live, nowStamp());
    const toggle = (on) => { change((st) => setTracking(st, 'entry', existing.id, on), on ? 'Use counter on' : 'Use counter off'); redraw(); };
    if (!c) {
      return live.cents >= 10000 ? h('button', { class: 'link', onClick: () => toggle(true) }, 'Count each time I use it (cost per use)') : null;
    }
    return h('div', { class: 'field' }, h('span', {}, 'Cost per use'),
      h('div', { class: 'use-row' },
        h('div', {}, h('div', { class: 'meta' }, c.ok ? c.text : "Couldn't double-check this"), c.receipt ? howButton(c) : null),
        h('button', { class: 'btn primary narrow', onClick: () => { const at = nowStamp(); change((st) => logUse(st, 'entry', existing.id, at), `Counted a use of ${live.name}`); redraw(); } }, 'Used it')),
      h('button', { class: 'link', onClick: () => toggle(false) }, 'Turn the counter off'));
  }

  function redraw() { sheet.setTitle(title); sheet.setContent(form()); }
  if (existing && action === 'delete') confirmDelete();

  function build() {
    errors = {};
    let cents = null;
    let hours;
    let rateCents;
    if (isPay() && d.payMode === 'hours') {
      hours = parseHours(d.hours) ?? undefined;
      rateCents = parseAmount(d.rate) ?? undefined;
      if (!hours) errors.hours = 'Enter hours, like 37.5';
      if (!rateCents) errors.rate = 'Enter your hourly pay';
      if (hours && rateCents) {
        const r = hoursPay(hours, rateCents);
        if (r.ok && r.value > 0) cents = r.value;
        else errors.hours = 'That works out to less than a cent';
      }
    } else {
      cents = parseAmount(d.amount);
      if (cents === null) errors.amount = 'Enter an amount, like 12.50';
    }
    if (!d.name.trim()) errors.name = 'Give it a name';
    const at = `${d.date}T${(d.time || '').slice(0, 5)}`;
    if (!isStamp(at)) errors.when = 'Pick a date and time';
    if (Object.keys(errors).length) return null;
    return cleanEntry({
      // the saved entry as it is now (a use counted while this form was open is kept)
      ...(existing ? (app.state.entries.find((e) => e.id === existing.id) ?? existing) : {}),
      id: existing?.id ?? newId(), type: d.type, name: d.name.trim(), cents, at,
      category: d.category, note: d.showNote ? d.note.trim() : '',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      hours, rateCents,
    });
  }

  function splitPreview(entry) {
    if (!(entry.type === 'income' && entry.category === PAYCHECK)) return null;
    // The split this paycheck was saved with, or today's auto-save settings for a new one.
    const plan = (Array.isArray(existing?.autoSave) ? existing.autoSave : s.settings.autoSave ?? [])
      .map((p) => ({ ...p, name: s.goals.find((g) => g.id === p.goalId)?.name })).filter((p) => p.name && p.bp > 0);
    if (!plan.length) return null;
    const split = splitAcrossGoals(entry.cents, plan);
    return split.ok ? h('div', { class: 'split' }, receiptBody(split)) : null;
  }

  // Typed entries save right away (with Undo). Only a repeating item asks which ones to change.
  function saveNow() {
    const entry = build();
    if (!entry) { redraw(); return; }
    if (rule) review(entry);
    else commit(entry);
  }

  function review(entry) {
    const kind = entry.type === 'income' || entry.type === 'refund' ? 'in' : 'out';
    const future = entry.at > nowStamp();
    const repeating = !existing && d.repeats !== 'never';
    sheet.setTitle('Change which ones?');
    const buttons = rule
      ? [h('button', { class: 'btn primary', onClick: () => commit(entry, 'one') }, 'Save just this one'),
        h('button', { class: 'btn ghost', onClick: () => commit(entry, 'future') }, 'Save this and all future ones')]
      : [h('button', { class: 'btn primary', onClick: () => commit(entry) }, existing ? 'Save changes' : 'Save')];
    sheet.setContent(
      h('div', { class: 'confirm-card' },
        h('div', { class: `big num ${kind}` }, icon(kind === 'in' ? 'up' : 'down', 'arrow'), formatCents(signed(entry), { sign: 'always' })),
        h('div', { class: 'what' }, entry.name),
        h('div', { class: 'meta' }, `${entry.category} · ${formatDateTime(entry.at)}`),
        entry.hours ? h('div', { class: 'meta' }, `${formatHours(entry.hours)} hours × ${formatCents(entry.rateCents)}`) : null,
        repeats(repeating) ,
        entry.note ? h('div', { class: 'note' }, entry.note) : null),
      splitPreview(entry),
      future && !repeating ? h('p', { class: 'future-note' }, `This will count from ${formatDateTime(entry.at)}.`) : null,
      h('div', { class: 'actions' }, ...buttons, h('button', { class: 'btn ghost', onClick: redraw }, 'Back')));
  }

  function repeats(repeating) {
    if (!repeating) return null;
    return h('div', { class: 'meta' }, `Repeats ${FREQS[d.repeats].toLowerCase()} · ${d.type === 'expense' ? (d.kind === 'subscription' ? 'Subscription' : 'Bill') : 'Income'}`);
  }

  function commit(entry, scope) {
    const now = nowStamp();
    const rememberRate = (st) => { if (entry.rateCents) st.settings.hourlyRateCents = entry.rateCents; };
    if (existing) {
      change((st) => {
        rememberRate(st);
        if (scope === 'future') editFuture(st, existing.id, entry, now, newId);
        else updateEntry(st, entry, newId);
      }, 'Changes saved');
      sheet.close();
      return;
    }
    if (d.repeats === 'never') {
      change((st) => { rememberRate(st); addEntry(st, entry, newId); },
        entry.at > now ? `Saved. Counts from ${formatDateTime(entry.at)}`
          : entry.type === 'refund' ? `Refund ${formatCents(entry.cents, { sign: 'always' })} back into ${entry.category}`
            : `Saved ${formatCents(signed(entry), { sign: 'always' })} · ${entry.category}`);
      sheet.close();
      return;
    }
    const newRule = cleanRule({
      id: newId(), type: entry.type,
      kind: entry.type === 'expense' ? d.kind : entry.category === PAYCHECK ? 'paycheck' : 'other',
      name: entry.name, cents: entry.cents, category: entry.category, freq: d.repeats,
      anchor: entry.at, nextIndex: 0, endAt: null, hours: entry.hours, rateCents: entry.rateCents,
    });
    change((st) => { rememberRate(st); addRule(st, newRule, now, newId); },
      entry.at > now ? `Saved. First one counts on ${formatDateTime(entry.at)}` : 'Saved');
    if (entry.type !== 'expense') { sheet.close(); return; }
    // Offer the calendar reminder right away (one tap, then the phone handles it forever).
    sheet.setTitle('Add a reminder?');
    sheet.setContent(
      h('p', { class: 'dim' }, `Add ${newRule.name} to your calendar. It repeats ${FREQS[newRule.freq].toLowerCase()} and alerts you ${alertText(s.settings)}.`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => { addToCalendar(newRule); sheet.close(); } }, 'Add to Calendar'),
        h('button', { class: 'btn ghost', onClick: () => sheet.close() }, 'Not now')),
      h('p', { class: 'faint small-note center' }, 'You can do this later from the Reminders tab.'));
  }

  function confirmDelete() {
    sheet.setTitle('Delete this entry?');
    const kind = existing.type === 'income' || existing.type === 'refund' ? 'in' : 'out';
    const card = h('div', { class: 'confirm-card' },
      h('div', { class: `big num ${kind}` }, icon(kind === 'in' ? 'up' : 'down', 'arrow'), formatCents(signed(existing), { sign: 'always' })),
      h('div', { class: 'what' }, existing.name),
      h('div', { class: 'meta' }, `${existing.category} · ${formatDateTime(existing.at)}`));
    const done = (fn) => () => { change(fn, 'Deleted'); sheet.close(); };
    sheet.setContent(card, h('div', { class: 'actions' },
      rule
        ? [h('button', { class: 'btn primary', onClick: done((st) => deleteEntry(st, existing.id)) }, 'Delete just this one'),
          h('button', { class: 'btn ghost', onClick: done((st) => deleteFuture(st, existing.id)) }, 'Delete this and all future ones')]
        : h('button', { class: 'btn primary', onClick: done((st) => deleteEntry(st, existing.id)) }, 'Delete'),
      h('button', { class: 'btn ghost', onClick: redraw }, 'Keep it')));
  }
}

// Money moved to a savings goal.
function openSavingSheet(entry, { from = null, action = null } = {}) {
  const s = app.state;
  const parent = entry.parentId ? s.entries.find((e) => e.id === entry.parentId) : null;
  const goal = s.goals.find((g) => g.id === entry.goalId);
  const card = () => h('div', { class: 'confirm-card' },
    h('div', { class: 'big num dim' }, icon('down', 'arrow'), formatCents(-entry.cents)),
    h('div', { class: 'what' }, goal ? `To ${goal.name}` : entry.name),
    h('div', { class: 'meta' }, formatDateTime(entry.at)));
  const confirmDelete = () => {
    sheet.setTitle('Delete this entry?');
    sheet.setContent(card(), h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onClick: () => { change((st) => deleteEntry(st, entry.id), 'Deleted'); sheet.close(); } }, 'Delete'),
      h('button', { class: 'btn ghost', onClick: () => sheet.close() }, 'Keep it')));
  };
  const sheet = openSheet('Moved to savings', () => [
    h('div', { class: 'confirm-card' },
      h('div', { class: 'big num dim' }, icon('down', 'arrow'), formatCents(-entry.cents)),
      h('div', { class: 'what' }, goal ? `To ${goal.name}` : entry.name),
      h('div', { class: 'meta' }, formatDateTime(entry.at)),
      entry.bp ? h('div', { class: 'meta' }, `Auto-save: ${formatPercent(entry.bp)} of the paycheck`) : null),
    parent
      ? h('div', { class: 'actions' },
        h('p', { class: 'faint small-note center' }, 'This came from your paycheck automatically. To change it, edit the paycheck.'),
        h('button', { class: 'btn ghost', onClick: () => { sheet.close(); openEntrySheet(parent); } }, 'Open the paycheck'))
      : h('div', { class: 'actions' },
        h('button', { class: 'btn danger', onClick: confirmDelete }, 'Delete')),
  ], { from });
  if (action === 'delete' && !parent) confirmDelete();
}

export { openReceipt };
