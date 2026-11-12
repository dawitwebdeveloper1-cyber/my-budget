// Quick add: opens straight to a number pad. Type the amount, tap a category, done.
// It saves right away and shows a 5-second Undo bar. Everything else is optional or one tap deeper.
import { h, icon, openSheet } from '../ui.js';
import { app, change, newId } from '../state.js';
import { parseAmount, formatCents, centsToInput } from '../money.js';
import { nowStamp } from '../dates.js';
import { signed } from '../calc.js';
import { addEntry, quickEntry } from '../ops.js';
import { suggestCategories, merchantCategory } from '../suggest.js';
import { openEntrySheet } from './entry.js';

export function openQuickAdd(from = null) {
  const s = app.state;
  const d = { type: 'expense', amount: '', name: '', note: '', showNote: false, showAll: false };
  const amountEl = h('div', { class: 'qa-amount num', 'aria-live': 'polite' });
  const catsEl = h('div', { class: 'qa-cats-wrap' });
  const favEl = h('div', { class: 'fav-row' });
  const cents = () => parseAmount(d.amount);
  const sheet = openSheet('Add', () => view(), { from });

  function view() {
    drawAmount();
    drawCats();
    drawFavs();
    const nameInput = h('input', {
      class: 'input qa-name', value: d.name, maxlength: 80, autocomplete: 'off',
      placeholder: d.type === 'income' ? 'Where from? (optional)' : 'What was it? (optional)',
      onInput: (e) => { d.name = e.target.value; drawCats(); },
    });
    return [
      h('div', { class: 'seg small', role: 'group', 'aria-label': 'Money in or out' },
        h('button', { 'aria-pressed': String(d.type === 'income'), onClick: () => setType('income') }, 'Money in'),
        h('button', { 'aria-pressed': String(d.type === 'expense'), onClick: () => setType('expense') }, 'Money out')),
      favEl,
      amountEl,
      nameInput,
      catsEl,
      d.showNote
        ? h('textarea', { class: 'input qa-note', maxlength: 500, placeholder: 'Note', onInput: (e) => { d.note = e.target.value; } }, d.note)
        : null,
      numpad(),
      h('div', { class: 'qa-links' },
        d.showNote ? h('span') : h('button', { class: 'link', onClick: () => { d.showNote = true; sheet.setContent(view()); } }, 'Add a note'),
        h('button', { class: 'link', onClick: moreOptions }, 'More options')),
    ];
  }

  function setType(t) {
    d.type = t;
    d.showAll = false;
    sheet.setContent(view());
  }

  function drawAmount() {
    const c = cents();
    amountEl.className = `qa-amount num ${d.amount ? (d.type === 'income' ? 'in' : 'out') : 'empty'}`;
    amountEl.textContent = d.amount ? `${d.type === 'income' ? '+' : '−'}$${d.amount}` : '$0';
    amountEl.setAttribute('aria-label', c ? `Amount ${formatCents(c)}` : 'No amount yet');
  }

  // Three suggested categories (never chosen for you), plus "more" for the full list.
  function drawCats() {
    const c = cents();
    const now = nowStamp();
    const known = merchantCategory(s, d.name, d.type);
    const top = suggestCategories(s, { type: d.type, cents: c, name: d.name, now, limit: 3 });
    const list = d.showAll ? s.categories[d.type] : top;
    const btn = (cat, big) => h('button', {
      class: `${big ? 'qa-cat' : 'chip'}${cat === known ? ' known' : ''}`,
      disabled: !c, onClick: () => save(cat),
    }, cat);
    catsEl.replaceChildren(
      h('div', { class: 'qa-hint' }, c ? (known ? `${d.name.trim()} is usually ${known}. Tap to save.` : 'Tap a category to save') : 'Type an amount, then tap a category'),
      d.showAll
        ? h('div', { class: 'chips' }, list.map((cat) => btn(cat, false)))
        : h('div', { class: 'qa-cats' }, list.map((cat) => btn(cat, true))),
      s.categories[d.type].length > 3
        ? h('button', { class: 'link small', onClick: () => { d.showAll = !d.showAll; drawCats(); } }, d.showAll ? 'Fewer categories' : 'More categories')
        : null);
  }

  function drawFavs() {
    const favs = (s.favourites ?? []).filter((f) => f.type === d.type);
    favEl.replaceChildren(...favs.map((f) => h('button', { class: 'chip fav', onClick: () => saveFavourite(f) },
      h('span', {}, f.name), h('b', { class: 'num' }, formatCents(f.cents)))));
    favEl.hidden = favs.length === 0;
  }

  // ---- Number pad
  function press(k) {
    let a = d.amount;
    if (k === 'back') a = a.slice(0, -1);
    else if (k === '.') { if (!a.includes('.')) a = (a || '0') + '.'; }
    else {
      const [whole, frac] = a.split('.');
      if (frac !== undefined && frac.length >= 2) return;
      if (frac === undefined && whole.length >= 7) return;
      a = a === '0' ? k : a + k;
    }
    d.amount = a;
    drawAmount();
    drawCats();
  }

  function numpad() {
    const key = (k, label = k) => h('button', { class: 'np-key num', 'aria-label': k === 'back' ? 'Delete' : label, onClick: () => press(k) },
      k === 'back' ? icon('left') : label);
    return h('div', { class: 'numpad' }, ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => key(k)), key('.'), key('0'), key('back'));
  }

  // Physical keyboard works too (when not typing in the name or note).
  const onKey = (e) => {
    if (!sheet.el.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === '.') press('.');
    else if (e.key === 'Backspace') press('back');
  };
  document.addEventListener('keydown', onKey);

  // ---- Saving: instant, with Undo
  function save(category) {
    const c = cents();
    if (!c) return;
    const entry = quickEntry({ type: d.type, cents: c, category, name: d.name, note: d.note, at: nowStamp(), newId });
    sheet.close();
    change((st) => addEntry(st, entry, newId), `Saved ${formatCents(signed(entry), { sign: 'always' })} · ${category}`);
  }

  function saveFavourite(f) {
    const entry = quickEntry({ type: f.type, cents: f.cents, category: f.category, name: f.name, at: nowStamp(), newId });
    sheet.close();
    change((st) => addEntry(st, entry, newId), `Saved ${f.name} ${formatCents(signed(entry), { sign: 'always' })}`);
  }

  // Date, time, repeating, hours × pay: the full form, with what's typed so far carried over.
  function moreOptions() {
    const c = cents();
    sheet.close();
    const preset = { type: d.type, name: d.name, note: d.note, showNote: !!d.note };
    if (c) preset.amount = centsToInput(c);
    // Start on the best suggestion (still just a starting point you can change).
    preset.category = merchantCategory(s, d.name, d.type)
      ?? suggestCategories(s, { type: d.type, cents: c, name: d.name, now: nowStamp(), limit: 1 })[0];
    openEntrySheet(null, preset);
  }
}
