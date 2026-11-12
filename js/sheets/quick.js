// Quick add: opens straight to a number pad. Type the amount, tap a category, done.
// It saves right away and shows a 5-second Undo bar. Everything else is optional or one tap deeper.
import { h, icon, openSheet } from '../ui.js';
import { app, change, newId } from '../state.js';
import { parseAmount, formatCents, centsToInput } from '../money.js';
import { nowStamp } from '../dates.js';
import { signed } from '../calc.js';
import { addEntry, quickEntry } from '../ops.js';
import { suggestCategories, merchantCategory } from '../suggest.js';
import { voiceAvailable, listen, bestGuess } from '../voice.js';
import { photoToCanvas, scanReceipt, highlight } from '../scan.js';

// A band of the photo around the total line (or the top of the receipt), sized to fit the screen.
function cropAround(canvas, bbox) {
  const bandH = Math.min(canvas.height, Math.max(220, Math.round(canvas.width * 0.55)));
  const mid = bbox ? (bbox.y0 + bbox.y1) / 2 : bandH / 2;
  const y = Math.max(0, Math.min(canvas.height - bandH, Math.round(mid - bandH / 2)));
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = bandH;
  out.getContext('2d').drawImage(canvas, 0, y, canvas.width, bandH, 0, 0, canvas.width, bandH);
  out.setAttribute('role', 'img');
  out.setAttribute('aria-label', 'Part of your receipt photo');
  return out;
}
import { openEntrySheet } from './entry.js';

export function openQuickAdd(from = null) {
  const s = app.state;
  const d = { type: 'expense', amount: '', name: '', note: '', showNote: false, showAll: false };
  const amountEl = h('div', { class: 'qa-amount num', 'aria-live': 'polite' });
  const catsEl = h('div', { class: 'qa-cats-wrap' });
  const favEl = h('div', { class: 'fav-row' });
  const cents = () => parseAmount(d.amount);
  let stopVoice = null;
  const sheet = openSheet('Add', () => view(), { from, onClose: () => stopVoice?.() });

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
      h('div', { class: 'qa-amount-row' },
        d.type === 'expense' ? h('button', { class: 'cam-btn', 'aria-label': 'Scan a receipt', onClick: pickPhoto }, icon('camera')) : null,
        amountEl,
        // The mic only shows where the phone supports speech, and hides after two failures.
        voiceAvailable() ? h('button', { class: 'mic-btn', 'aria-label': 'Say it instead', onClick: startVoice }, icon('mic')) : null),
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

  // ---- Voice entry: listen, then always show a confirm card before saving
  function backToKeypad() {
    stopVoice?.();
    stopVoice = null;
    sheet.setTitle('Add');
    sheet.setContent(view());
  }

  function startVoice() {
    const msg = h('p', { class: 'voice-msg' });
    const again = h('div', { class: 'actions', hidden: true },
      h('button', { class: 'btn primary', onClick: startVoice }, 'Try again'),
      h('button', { class: 'btn ghost', onClick: backToKeypad }, 'Type it instead'));
    let failed = false;
    const fail = (text) => {
      failed = true;
      sheet.setTitle('Add');
      msg.textContent = text;
      mic.classList.remove('on');
      again.hidden = false;
      cancel.hidden = true;
    };
    const mic = h('div', { class: 'mic-big on', 'aria-hidden': 'true' }, icon('mic'));
    const cancel = h('button', { class: 'btn ghost', onClick: backToKeypad }, 'Cancel');
    sheet.setTitle('Listening…');
    sheet.setContent(h('div', { class: 'voice-wrap' },
      mic,
      h('p', { class: 'dim center' }, 'Say something like', h('br'), '"spent 12 dollars on lunch"'),
      msg, again, cancel));
    stopVoice = listen({
      onResult: (alts) => { stopVoice = null; confirmVoice(bestGuess(alts, s)); },
      onError: (err) => fail(err === 'not-allowed' || err === 'service-not-allowed'
        ? 'Microphone access is off. You can allow it in your phone\'s settings, or type it in.'
        : err === 'no-speech' ? "I didn't hear anything. Try again?" : "Couldn't use voice just now. Try again, or type it in."),
      onEnd: (got) => { if (!got && !failed) fail("I didn't catch that. Try again?"); },
    });
  }

  function confirmVoice(p) {
    const v = { type: p.type, cents: p.cents, category: p.category, name: p.name };
    sheet.setTitle('Is this right?');
    const draw = () => {
      const cats = s.categories[v.type];
      const shown = v.category ? cats : suggestCategories(s, { type: v.type, cents: v.cents, name: v.name, now: nowStamp(), limit: cats.length });
      const ready = v.cents && v.category;
      sheet.setContent(
        h('p', { class: 'heard' }, `"${p.heard}"`),
        v.cents
          ? h('div', { class: `qa-amount num ${v.type === 'income' ? 'in' : 'out'}` }, formatCents(v.type === 'income' ? v.cents : -v.cents, { sign: 'always' }))
          : h('p', { class: 'voice-msg' }, "I didn't hear an amount."),
        v.cents ? h('p', { class: 'qa-hint' }, 'Check the amount: "fifteen" and "fifty" sound alike.') : null,
        h('div', { class: 'seg small', role: 'group', 'aria-label': 'Money in or out' },
          h('button', { 'aria-pressed': String(v.type === 'income'), onClick: () => { v.type = 'income'; if (!s.categories.income.includes(v.category)) v.category = null; draw(); } }, 'Money in'),
          h('button', { 'aria-pressed': String(v.type === 'expense'), onClick: () => { v.type = 'expense'; if (!s.categories.expense.includes(v.category)) v.category = null; draw(); } }, 'Money out')),
        h('input', { class: 'input qa-name', value: v.name, maxlength: 80, placeholder: 'Name (optional)', onInput: (e) => { v.name = e.target.value; } }),
        h('div', { class: 'qa-cats-wrap' },
          h('div', { class: 'qa-hint' }, v.category ? 'Category' : 'Pick a category'),
          h('div', { class: 'chips' }, shown.map((c) => h('button', { class: 'chip', 'aria-pressed': String(c === v.category), onClick: () => { v.category = c; draw(); } }, c)))),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', disabled: !ready, onClick: () => saveVoice(v) }, v.cents ? 'Save' : 'Save (needs an amount)'),
          h('button', { class: 'btn ghost', onClick: () => { d.type = v.type; d.amount = v.cents ? centsToInput(v.cents).replace(/\.00$/, '') : ''; d.name = v.name; backToKeypad(); } }, v.cents ? 'Fix it on the keypad' : 'Type the amount'),
          h('button', { class: 'link', onClick: startVoice }, 'Try again')));
    };
    draw();
  }

  function saveVoice(v) {
    const entry = quickEntry({ type: v.type, cents: v.cents, category: v.category, name: v.name, at: nowStamp(), newId });
    sheet.close();
    change((st) => addEntry(st, entry, newId), `Saved ${formatCents(signed(entry), { sign: 'always' })} · ${v.category}`);
  }

  // ---- Receipt scanning: photo → read on the phone → confirm card with the total highlighted
  function pickPhoto() {
    const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr' });
    input.addEventListener('change', () => { const f = input.files?.[0]; input.remove(); if (f) readPhoto(f); });
    document.body.append(input);
    input.click();
  }

  async function readPhoto(file) {
    const fill = h('i');
    const label = h('p', { class: 'dim center' }, 'Getting the reader ready');
    sheet.setTitle('Reading your receipt…');
    sheet.setContent(h('div', { class: 'voice-wrap' },
      h('div', { class: 'mic-big on', 'aria-hidden': 'true' }, icon('camera')),
      h('div', { class: 'bar scan-bar', role: 'progressbar', 'aria-label': 'Reading progress' }, fill),
      label,
      h('p', { class: 'faint small-note center' }, 'Your photo stays on this phone.')));
    fill.style.width = '2%';
    let canvas;
    try {
      canvas = await photoToCanvas(file);
      const result = await scanReceipt(canvas, (p, text) => {
        fill.style.width = `${Math.round(p * 100)}%`;
        label.textContent = text;
      });
      if (!sheet.el.isConnected) return;
      if (!result.total || result.confidence < 30) couldntRead(canvas, result.store);
      else confirmScan(canvas, result);
    } catch {
      if (sheet.el.isConnected) couldntRead(canvas, '');
    }
  }

  // Blurry or unreadable: offer to type it, with the store name filled in if we got it.
  function couldntRead(canvas, store) {
    sheet.setTitle('Couldn\'t read that one');
    sheet.setContent(
      canvas ? h('div', { class: 'scan-photo' }, cropAround(canvas, null)) : null,
      h('p', { class: 'dim center' }, store ? `Looks like ${store}. Type the amount in?` : 'The photo may be blurry or too dark. Type it in?'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => { d.type = 'expense'; d.name = store || d.name; backToKeypad(); } }, 'Type it in'),
        h('button', { class: 'btn ghost', onClick: pickPhoto }, 'Try another photo')));
  }

  function confirmScan(canvas, r) {
    const v = { cents: r.total.cents, name: r.store, category: merchantCategory(s, r.store, 'expense') };
    const line = r.lines[r.total.line];
    sheet.setTitle('Is this right?');
    const draw = () => {
      const cats = v.category ? s.categories.expense : suggestCategories(s, { type: 'expense', cents: v.cents, name: v.name, now: nowStamp(), limit: s.categories.expense.length });
      sheet.setContent(
        h('div', { class: 'scan-photo' }, cropAround(highlight(canvas, line?.bbox), line?.bbox)),
        h('div', { class: 'qa-amount num out' }, formatCents(-v.cents, { sign: 'always' })),
        h('p', { class: 'qa-hint' }, r.total.how === 'total' ? 'Read from the TOTAL line (highlighted). Check it matches.' : 'No TOTAL line found, so this is the largest amount (highlighted). Check it.'),
        h('input', { class: 'input qa-name', value: v.name, maxlength: 80, placeholder: 'Store (optional)', onInput: (e) => { v.name = e.target.value; } }),
        h('div', { class: 'qa-cats-wrap' },
          h('div', { class: 'qa-hint' }, v.category ? 'Category' : 'Pick a category'),
          h('div', { class: 'chips' }, cats.map((c) => h('button', { class: 'chip', 'aria-pressed': String(c === v.category), onClick: () => { v.category = c; draw(); } }, c)))),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', disabled: !v.category, onClick: () => saveVoice({ type: 'expense', cents: v.cents, category: v.category, name: v.name }) }, 'Save'),
          h('button', { class: 'btn ghost', onClick: () => { d.type = 'expense'; d.amount = centsToInput(v.cents).replace(/\.00$/, ''); d.name = v.name; backToKeypad(); } }, 'Fix it on the keypad'),
          h('button', { class: 'link', onClick: pickPhoto }, 'Try another photo')));
    };
    draw();
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
