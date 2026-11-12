// Import a bank file (CSV): pick the file, answer at most a couple of one-time questions,
// review what's new (duplicates already skipped), then import with Undo.
import { h, icon, openSheet, toast } from '../ui.js';
import { app, change, newId } from '../state.js';
import { formatCents } from '../money.js';
import { formatDate } from '../dates.js';
import { addEntry } from '../ops.js';
import {
  parseCSV, detectLayout, readTransactions, signExample, dedupe, importKey, guessCategory, cleanDescription, toISODate, dateParts,
} from '../bankimport.js';

const ROLE_LABELS = [['ignore', "Don't use"], ['date', 'Date'], ['desc', 'Description'], ['amount', 'Amount (+ and −)'], ['debit', 'Money out'], ['credit', 'Money in']];

export function openImport(from = null) {
  const s = app.state;
  let rows = null;
  let layout = null;
  let opts = null; // { roles, dateOrder, signMode }
  const sheet = openSheet('Import from your bank', () => start(), { from });

  function start() {
    const input = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', class: 'sr' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try { loadText(await f.text()); } catch { toast("Couldn't open that file"); }
    });
    return [
      h('p', { class: 'dim' }, 'Download your transactions as a CSV file from your online banking, then choose it here. Everything is read on this phone.'),
      h('ul', { class: 'facts' },
        h('li', {}, 'Works with RBC, TD, Scotiabank, BMO, CIBC, Tangerine, Simplii, Desjardins, Wealthsimple and most others.'),
        h('li', {}, "Entries you already have are skipped, so importing the same file twice is safe."),
        h('li', {}, 'You can check and change categories before anything is added, and undo it after.')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => input.click() }, 'Choose a bank file'), input,
        h('button', { class: 'btn ghost', onClick: () => { sheet.setTitle('Getting the file'); sheet.setContent(guides()); } }, 'How do I get the file?')),
    ];
  }

  function loadText(text) {
    rows = parseCSV(text);
    layout = detectLayout(rows);
    const saved = s.importProfiles?.[layout.signature];
    opts = {
      roles: saved?.roles ?? layout.roles,
      dateOrder: saved?.dateOrder ?? layout.dateOrder,
      signMode: saved?.signMode ?? null,
    };
    if (!rows.length) { toast("That file looks empty"); return; }
    next();
  }

  // Ask only what we can't work out, in this order: columns, date order, money-out direction.
  function next() {
    const r = opts.roles;
    const ready = r.date !== null && r.desc.length && (r.amount !== null || (r.debit !== null && r.credit !== null));
    if (!ready) return askColumns();
    if (!['ymd', 'dmy', 'mdy'].includes(opts.dateOrder)) {
      const order = detectDateOrderFor(r.date);
      if (order === 'ask' || order === 'invalid') return askDateOrder();
      opts.dateOrder = order;
    }
    if (r.amount !== null && !opts.signMode) return askSign();
    review();
  }

  function detectDateOrderFor(col) {
    let a = false; let b = false; let ab = false;
    for (const row of rows.slice(layout.headerAt + 1)) {
      const p = dateParts(row[col]);
      if (p?.kind !== 'ab') continue;
      ab = true;
      if (p.a > 12) a = true;
      if (p.b > 12) b = true;
    }
    if (!ab) return 'ymd';
    if (a && !b) return 'dmy';
    if (b && !a) return 'mdy';
    return 'ask';
  }

  // For files we don't recognise: "which column is which?", with an example from each column.
  function askColumns() {
    const width = Math.max(...rows.map((r) => r.length));
    const sample = rows.slice(layout.headerAt + 1).find((r) => r.filter(Boolean).length >= 2) ?? rows[0];
    const roleOf = (i) => (opts.roles.date === i ? 'date' : opts.roles.amount === i ? 'amount' : opts.roles.debit === i ? 'debit'
      : opts.roles.credit === i ? 'credit' : opts.roles.desc.includes(i) ? 'desc' : 'ignore');
    const set = (i, role) => {
      const r = opts.roles;
      for (const k of ['date', 'amount', 'debit', 'credit']) if (r[k] === i) r[k] = null;
      r.desc = r.desc.filter((x) => x !== i);
      if (role === 'desc') r.desc.push(i);
      else if (role !== 'ignore') { if (r[role] !== null) r[role] = null; r[role] = i; }
      if (role === 'amount') { r.debit = null; r.credit = null; }
      if (role === 'debit' || role === 'credit') r.amount = null;
    };
    opts.roles = { ...opts.roles, desc: [...opts.roles.desc] };
    sheet.setTitle('Which column is which?');
    sheet.setContent(
      h('p', { class: 'dim' }, "This layout is new to me. Match each column once and I'll remember it for next time."),
      h('div', { class: 'map-list' }, Array.from({ length: width }, (_, i) => {
        const sel = h('select', { class: 'input', 'aria-label': `Column ${i + 1}` },
          ROLE_LABELS.map(([v, t]) => h('option', { value: v, selected: roleOf(i) === v ? 'selected' : null }, t)));
        sel.addEventListener('change', () => set(i, sel.value));
        return h('div', { class: 'map-row' },
          h('div', { class: 'map-ex' },
            h('b', {}, layout.header?.[i] || `Column ${i + 1}`),
            h('span', { class: 'faint small' }, sample[i] ? `e.g. ${sample[i]}` : '(empty)')),
          sel);
      })),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => {
        const r = opts.roles;
        if (r.date === null || !r.desc.length || (r.amount === null && (r.debit === null || r.credit === null))) {
          toast('Pick a Date, a Description, and either Amount or both Money out and Money in');
          return;
        }
        opts.dateOrder = null;
        next();
      } }, 'Continue')));
  }

  function askDateOrder() {
    const ex = rows.slice(layout.headerAt + 1).map((r) => r[opts.roles.date]).find((v) => dateParts(v)?.kind === 'ab');
    const p = dateParts(ex);
    const name = (y, m, d) => formatDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00`, { year: true });
    const valid = (o) => toISODate(ex, o) !== null;
    sheet.setTitle('One quick question');
    sheet.setContent(
      h('p', { class: 'dim' }, `Your file writes dates like "${ex}". Which date is that?`),
      h('div', { class: 'actions' },
        valid('mdy') ? h('button', { class: 'btn ghost', onClick: () => { opts.dateOrder = 'mdy'; next(); } }, name(p.y, p.a, p.b)) : null,
        valid('dmy') ? h('button', { class: 'btn ghost', onClick: () => { opts.dateOrder = 'dmy'; next(); } }, name(p.y, p.b, p.a)) : null));
  }

  function askSign() {
    const ex = signExample(rows, { ...layout, roles: opts.roles });
    if (!ex) { opts.signMode = 'negative-out'; return review(); }
    const pick = (wasOut) => { opts.signMode = ex.negative === wasOut ? 'negative-out' : 'positive-out'; next(); };
    sheet.setTitle('One quick question');
    sheet.setContent(
      h('p', { class: 'dim' }, 'Banks write spending differently. In your file:'),
      h('div', { class: 'confirm-card' },
        h('div', { class: 'what' }, ex.description || 'An entry'),
        h('div', { class: 'meta' }, ex.date),
        h('div', { class: 'big num' }, ex.raw)),
      h('p', { class: 'dim center' }, 'Was that money going out (spending)?'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => pick(true) }, 'Yes, money out'),
        h('button', { class: 'btn ghost', onClick: () => pick(false) }, 'No, money in')));
  }

  // What's new, with categories you can change and anything you can leave out.
  function review() {
    const { transactions, problems } = readTransactions(rows, layout, opts);
    const { fresh, skipped } = dedupe(transactions, s.entries);
    const items = fresh.map((t) => {
      const g = guessCategory(s, t);
      return { t, type: t.type, name: cleanDescription(t.description), category: g.category, include: !t.maybe };
    }).sort((a, b) => (a.t.date < b.t.date ? 1 : -1));
    let showAll = items.length <= 60;
    sheet.setTitle('Check before importing');
    const draw = () => {
      const chosen = items.filter((x) => x.include);
      const list = showAll ? items : items.slice(0, 60);
      sheet.setContent(
        h('div', { class: 'import-sum' },
          h('b', {}, `${items.length} new ${items.length === 1 ? 'entry' : 'entries'}`),
          skipped ? h('span', {}, ` · Skipped ${skipped} you already had`) : null,
          problems.length ? h('details', { class: 'faint small' }, h('summary', {}, `${problems.length} ${problems.length === 1 ? 'row' : 'rows'} couldn't be read`),
            h('ul', {}, problems.slice(0, 20).map((p) => h('li', {}, p)))) : null),
        items.some((x) => x.t.maybe) ? h('p', { class: 'faint small-note' }, 'Entries marked "already have?" look like ones in the app with a different name. They\'re unticked so nothing is counted twice.') : null,
        items.length ? h('div', { class: 'import-list' }, list.map((x) => {
          const opt = (type, c) => h('option', { value: `${type}|${c}`, selected: x.type === type && x.category === c ? 'selected' : null }, c);
          // Money coming in can be income or a refund (money back into a spending category).
          const sel = h('select', { class: 'input small-select', 'aria-label': `Category for ${x.name}` },
            x.t.type === 'expense'
              ? s.categories.expense.map((c) => opt('expense', c))
              : [h('optgroup', { label: 'Money in' }, s.categories.income.map((c) => opt('income', c))),
                h('optgroup', { label: 'Refund back into' }, s.categories.expense.map((c) => opt('refund', c)))]);
          sel.addEventListener('change', () => { [x.type, x.category] = sel.value.split('|'); draw(); });
          const box = h('input', { type: 'checkbox', checked: x.include, 'aria-label': `Import ${x.name}` });
          box.addEventListener('change', () => { x.include = box.checked; draw(); });
          return h('div', { class: `import-row${x.include ? '' : ' off'}` },
            box,
            h('div', { class: 'grow' },
              h('div', { class: 'import-name' }, x.name),
              h('div', { class: 'faint small' }, formatDate(`${x.t.date}T00:00`, { weekday: true }),
                x.type === 'refund' ? h('span', { class: 'refund-tag' }, ' · refund') : null,
                x.t.maybe ? h('span', { class: 'maybe' }, ` · already have? (${x.t.maybe.name})`) : null),
              sel),
            h('span', { class: `num ${x.type === 'expense' ? 'out' : 'in'}` }, formatCents(x.type === 'expense' ? -x.t.cents : x.t.cents, { sign: 'always' })));
        })) : h('p', { class: 'dim center' }, 'Nothing new in this file.'),
        !showAll ? h('button', { class: 'link', onClick: () => { showAll = true; draw(); } }, `Show all ${items.length}`) : null,
        h('div', { class: 'actions' },
          chosen.length ? h('button', { class: 'btn primary', onClick: () => save(chosen) }, `Import ${chosen.length} ${chosen.length === 1 ? 'entry' : 'entries'}`) : null,
          h('button', { class: 'btn ghost', onClick: () => sheet.close() }, items.length ? 'Cancel' : 'Done')));
    };
    draw();
  }

  function save(chosen) {
    const profile = { roles: opts.roles, dateOrder: opts.dateOrder, signMode: opts.signMode };
    sheet.close();
    change((st) => {
      st.importProfiles ??= {};
      st.importProfiles[layout.signature] = profile;
      for (const x of chosen) {
        addEntry(st, {
          id: newId(), type: x.type, name: x.name, cents: x.t.cents, at: `${x.t.date}T12:00`,
          category: x.category, note: '', createdAt: new Date().toISOString(),
          imported: true, importKey: importKey(x.t),
        }, newId);
      }
    }, `Imported ${chosen.length} ${chosen.length === 1 ? 'entry' : 'entries'}`);
  }

  // ---- How to download the file from each bank (menus change, so the wording is kept general)
  function guides() {
    const G = [
      ['RBC', 'Sign in to RBC Online Banking on a computer or phone browser. Open the account, choose "Download Transactions", pick "Comma Separated Values (.csv)" and the dates you want.'],
      ['TD', 'Sign in to EasyWeb. Open the account, choose "Download", pick the "Spreadsheet (.csv)" format and the date range.'],
      ['Scotiabank', 'Sign in to Scotia Online. Open the account, choose "Download transactions" and pick CSV.'],
      ['BMO', 'Sign in to BMO Online Banking. Open the account or card, choose "Download transactions" (or "Export") and pick CSV.'],
      ['CIBC', 'Sign in to CIBC Online Banking. Open the account, choose "Download transactions" and pick "Spreadsheet (CSV)".'],
      ['Tangerine', 'Sign in on the Tangerine website. Open the account, choose "Download transactions" and pick CSV.'],
      ['Simplii', 'Sign in on the Simplii website. Open the account, choose "Download transactions" and pick CSV.'],
      ['Desjardins', 'Sign in to AccèsD on the website. Open the account and look for "Télécharger" / "Download transactions", then pick CSV.'],
      ['Wealthsimple', 'Open your account\'s activity or statements on the website and look for an "Export" or "Download CSV" option.'],
      ['Other banks and credit unions', 'Look for "Download", "Export" or "Transactions history" on the account page and choose CSV (sometimes called "Spreadsheet" or "Excel CSV"). The first time, I\'ll ask which column is which and remember it.'],
    ];
    return [
      h('p', { class: 'dim' }, 'Most banks only offer this on their website, not in their phone app. Menus change from time to time, so look for "Download" or "Export" if the wording differs.'),
      h('div', { class: 'guide-list' }, G.map(([bank, steps]) => h('details', { class: 'set-section' },
        h('summary', {}, h('span', { class: 'set-title' }, bank), icon('right')),
        h('div', { class: 'set-body' }, h('p', {}, steps))))),
      h('p', { class: 'faint small-note' }, 'On iPhone, the file goes to the Files app (Downloads). Then come back here and tap "Choose a bank file".'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => { sheet.setTitle('Import from your bank'); sheet.setContent(start()); } }, 'Back')),
    ];
  }
}
