// Bank file (CSV) import.
// Works out the layout from the file itself (headers in English or French, or no headers at all),
// so it handles any bank or credit union. What it can't be sure about, it asks once, using an
// example row from the file, and remembers the answer for next time.

import { normalizeMerchant, merchantCategory } from './suggest.js';
import { HINTS } from './voice.js';

// ---------- CSV ----------
export function parseCSV(text) {
  const src = String(text).replace(/^﻿/, '');
  const firstLines = src.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  const count = (ch) => firstLines.reduce((n, l) => n + (l.replace(/"[^"]*"/g, '').split(ch).length - 1), 0);
  const delim = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()));
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()));
  return rows;
}

// ---------- Money ----------
// "1,234.56", "-12.50", "(12.50)", "$12.50", "12.50-", "12,50", "1 234,56" → signed whole cents.
export function parseMoney(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  s = s.replace(/^[-−]/, () => { neg = !neg; return ''; }).replace(/^\+/, '');
  s = s.replace(/[$\s ]|CAD|USD/gi, '');
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // French decimal comma
  else s = s.replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m || m[1].length > 9) return null;
  const cents = Number(m[1]) * 100 + Number(((m[2] ?? '') + '00').slice(0, 2));
  return neg ? -cents : cents;
}

// ---------- Dates ----------
const MONTHS = {
  jan: 1, janv: 1, january: 1, janvier: 1, feb: 2, fev: 2, 'fév': 2, fevr: 2, 'févr': 2, february: 2, février: 2,
  mar: 3, mars: 3, march: 3, apr: 4, avr: 4, april: 4, avril: 4, may: 5, mai: 5, jun: 6, juin: 6, june: 6,
  jul: 7, juil: 7, july: 7, juillet: 7, aug: 8, aou: 8, 'aoû': 8, 'août': 8, august: 8, sep: 9, sept: 9, september: 9,
  septembre: 9, oct: 10, october: 10, octobre: 10, nov: 11, november: 11, novembre: 11, dec: 12, 'déc': 12, december: 12, 'décembre': 12,
};
const pad = (n) => String(n).padStart(2, '0');
const validYMD = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
const fullYear = (y) => (y < 100 ? 2000 + y : y);

// Splits a date into parts; "a/b/y" dates stay ambiguous until the whole file is looked at.
export function dateParts(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ');
  let m;
  if ((m = /^(\d{4})[-/ ]?(\d{1,2})[-/ ]?(\d{1,2})(?:[ t]\d{1,2}:\d{2}.*)?$/.exec(s)) && (m[2].length === 2 || /[-/]/.test(s))) {
    return { kind: 'ymd', y: +m[1], m: +m[2], d: +m[3] };
  }
  if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?: .*)?$/.exec(s))) return { kind: 'ab', a: +m[1], b: +m[2], y: fullYear(+m[3]) };
  if ((m = /^(\d{1,2}) ([\p{L}]+) (\d{2,4})$/u.exec(s)) && MONTHS[m[2]]) return { kind: 'ymd', y: fullYear(+m[3]), m: MONTHS[m[2]], d: +m[1] };
  if ((m = /^([\p{L}]+) (\d{1,2}) (\d{4})$/u.exec(s)) && MONTHS[m[1]]) return { kind: 'ymd', y: +m[3], m: MONTHS[m[1]], d: +m[2] };
  return null;
}

// Looks at every date in the file: if any first number is over 12 it's day-first,
// if any second number is over 12 it's month-first; otherwise we have to ask.
export function detectDateOrder(values) {
  let dayFirst = false;
  let monthFirst = false;
  let any = false;
  for (const v of values) {
    const p = dateParts(v);
    if (p?.kind !== 'ab') continue;
    any = true;
    if (p.a > 12) dayFirst = true;
    if (p.b > 12) monthFirst = true;
  }
  if (!any) return 'ymd';
  if (dayFirst && !monthFirst) return 'dmy';
  if (monthFirst && !dayFirst) return 'mdy';
  return dayFirst && monthFirst ? 'invalid' : 'ask';
}

export function toISODate(raw, order) {
  const p = dateParts(raw);
  if (!p) return null;
  let y, m, d;
  if (p.kind === 'ymd') ({ y, m, d } = p);
  else if (order === 'dmy') { y = p.y; m = p.b; d = p.a; }
  else if (order === 'mdy') { y = p.y; m = p.a; d = p.b; }
  else return null;
  return validYMD(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// ---------- Working out the layout ----------
const H = {
  date: /^(transaction\s*date|trans\.?\s*date|date\s*of\s*transaction|date|posted\s*date|posting\s*date|date\s*de\s*(la\s*)?transaction|date\s*d'?op[ée]ration|date\s*de\s*l'?op[ée]ration|transaction\s*date\s*\(yyyymmdd\))$/i,
  posted: /^(posted|posting)\s*date|date\s*d'?inscription/i,
  balance: /(balance|solde)/i,
  debit: /(debit|d[ée]bit|withdrawals?|funds\s*out|money\s*out|paid\s*out|retraits?|sorties?)/i,
  credit: /(credit|cr[ée]dit|deposits?|funds\s*in|money\s*in|paid\s*in|d[ée]p[ôo]ts?|entr[ée]es?)/i,
  amount: /^(amount|transaction\s*amount|montant|montant\s*\(\$\)|cad\$?|amount\s*\(cad\)|value)$/i,
  desc: /(description|details|d[ée]tails|merchant|payee|name|memo|narrative|libell[ée]|^transaction$|transaction\s*details|nom)/i,
  ignore: /(account|compte|card|carte|cheque|chèque|item\s*#|usd|currency|devise|category|cat[ée]gorie|type|status|reference|r[ée]f[ée]rence|^#$|^no\.?$)/i,
};

const isMoneyCell = (v) => v === '' || parseMoney(v) !== null;
const isDateCell = (v) => dateParts(v) !== null;

// Finds the header row (some banks put a few lines of account info first).
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const r = rows[i];
    const hits = r.filter((c) => H.date.test(c) || H.amount.test(c) || H.debit.test(c) || H.credit.test(c) || H.desc.test(c)).length;
    if (hits >= 2 && !r.some((c) => isDateCell(c) && /\d/.test(c))) return i;
  }
  return -1;
}

export function detectLayout(rows) {
  const headerAt = findHeader(rows);
  const header = headerAt >= 0 ? rows[headerAt] : null;
  const data = rows.slice(headerAt + 1).filter((r) => r.some((c) => isDateCell(c)));
  const width = Math.max(...data.map((r) => r.length), header?.length ?? 0);
  const roles = { date: null, desc: [], amount: null, debit: null, credit: null };

  if (header) {
    const used = new Set();
    const pick = (re, avoid) => header.findIndex((h, i) => !used.has(i) && re.test(h) && !(avoid && avoid.test(h)));
    let di = pick(H.date, H.posted);
    if (di < 0) di = header.findIndex((h) => H.posted.test(h));
    if (di >= 0) { roles.date = di; used.add(di); }
    header.forEach((h, i) => { if (H.posted.test(h) || H.balance.test(h)) used.add(i); });
    const ai = pick(H.amount);
    if (ai >= 0) { roles.amount = ai; used.add(ai); }
    if (roles.amount === null) {
      const de = pick(H.debit, H.ignore);
      if (de >= 0) { roles.debit = de; used.add(de); }
      const cr = pick(H.credit, H.ignore);
      if (cr >= 0) { roles.credit = cr; used.add(cr); }
    }
    header.forEach((h, i) => { if (!used.has(i) && H.desc.test(h) && !H.ignore.test(h)) roles.desc.push(i); });
  } else {
    // No header: judge each column by what's in it.
    const col = (i) => data.map((r) => r[i] ?? '');
    const share = (vals, f) => vals.filter(f).length / Math.max(1, vals.length);
    for (let i = 0; i < width; i++) if (roles.date === null && share(col(i), isDateCell) > 0.8) roles.date = i;
    const money = [];
    for (let i = 0; i < width; i++) {
      if (i === roles.date) continue;
      const v = col(i);
      if (share(v, isMoneyCell) > 0.9 && share(v, (x) => x !== '') > 0) money.push(i);
    }
    const filled = (i) => share(col(i), (x) => x !== '');
    // Two money columns where each row fills exactly one: money out / money in.
    const pairs = [];
    for (let a = 0; a < money.length; a++) for (let b = a + 1; b < money.length; b++) {
      const x = money[a];
      const y = money[b];
      if (data.every((r) => ((r[x] ?? '') === '') !== ((r[y] ?? '') === ''))) pairs.push([x, y]);
    }
    if (pairs.length) [roles.debit, roles.credit] = pairs[0];
    else {
      const full = money.filter((i) => filled(i) > 0.9);
      if (full.length) roles.amount = full[0]; // the first always-filled one; a later one is usually the balance
    }
    let bestText = -1;
    let bestLen = 0;
    for (let i = 0; i < width; i++) {
      if (i === roles.date || money.includes(i)) continue;
      const len = col(i).reduce((n, v) => n + (/[a-z]/i.test(v) ? v.length : 0), 0);
      if (len > bestLen) { bestLen = len; bestText = i; }
    }
    if (bestText >= 0) roles.desc.push(bestText);
  }

  const dateOrder = roles.date === null ? 'ask' : detectDateOrder(data.map((r) => r[roles.date]));
  const ready = roles.date !== null && roles.desc.length > 0 && (roles.amount !== null || (roles.debit !== null && roles.credit !== null));
  return {
    headerAt, header, roles, dateOrder, ready,
    // A single amount column needs one question: is negative money out, or positive?
    needsSign: roles.amount !== null,
    signature: signatureOf(header, width),
    bank: guessBank(header, width, roles),
  };
}

export function signatureOf(header, width) {
  return header ? `h:${header.map((h) => h.toLowerCase()).join('|')}` : `n:${width}`;
}

// Names the bank only when the layout clearly matches; otherwise it just says "your bank".
function guessBank(header, width, roles) {
  const h = (header ?? []).map((x) => x.toLowerCase()).join('|');
  if (/description 1.*description 2/.test(h) && /cad\$/.test(h)) return 'RBC';
  if (/transaction date\|transaction\|name\|memo\|amount/.test(h)) return 'Tangerine';
  if (/funds out.*funds in/.test(h)) return 'Simplii';
  if (/item #.*card #.*transaction date.*posting date.*transaction amount/.test(h)) return 'BMO';
  if (/montant|libell|date de/.test(h)) return 'a French-language bank file';
  if (!header && roles.debit !== null && width === 5) return 'TD';
  if (!header && roles.debit !== null && (width === 4 || width === 5)) return 'CIBC';
  return null;
}

// ---------- Turning rows into transactions ----------
// (no word boundary at the end, so "RECLAIM011500000001" still counts)
export const REFUND_RE = /\b(mdse return|merchandise return|return|returns|refund|reversal|correction|charge discount|fee rebate|rebate|reclaim|retour|remboursement|annulation)(?![a-z])/i;
// signMode: 'negative-out' (−12.50 is spending) or 'positive-out' (12.50 is spending, refunds negative).
export function readTransactions(rows, layout, { dateOrder = layout.dateOrder, signMode = 'negative-out', roles = layout.roles } = {}) {
  const out = [];
  const problems = [];
  rows.slice(layout.headerAt + 1).forEach((r) => {
    const rawDate = r[roles.date];
    if (!isDateCell(rawDate)) return; // totals, notes, blank lines
    const date = toISODate(rawDate, dateOrder);
    const description = roles.desc.map((i) => r[i] ?? '').filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    let cents = null;
    let type = null;
    if (roles.amount !== null) {
      const v = parseMoney(r[roles.amount]);
      if (v !== null && v !== 0) {
        const out_ = signMode === 'negative-out' ? v < 0 : v > 0;
        type = out_ ? 'expense' : 'income';
        cents = Math.abs(v);
      }
    } else {
      const d = parseMoney(r[roles.debit]);
      const c = parseMoney(r[roles.credit]);
      if (d) { type = 'expense'; cents = Math.abs(d); } else if (c) { type = 'income'; cents = Math.abs(c); }
    }
    if (!date || !cents || !description) { problems.push(r.filter(Boolean).join(', ')); return; }
    // Money back for a purchase (returns, reversals, fee discounts) is a refund, not income.
    if (type === 'income' && REFUND_RE.test(description)) type = 'refund';
    out.push({ date, cents, type, description });
  });
  return { transactions: out, problems };
}

// An example row for the "was this money out?" question.
export function signExample(rows, layout) {
  for (const r of rows.slice(layout.headerAt + 1)) {
    const v = parseMoney(r[layout.roles.amount]);
    if (v && isDateCell(r[layout.roles.date])) {
      return { raw: r[layout.roles.amount], date: r[layout.roles.date], description: layout.roles.desc.map((i) => r[i]).filter(Boolean).join(' '), negative: v < 0 };
    }
  }
  return null;
}

// ---------- Duplicates ----------
export function importKey(t) {
  return `${t.date}|${t.cents}|${t.type}|${normalizeMerchant(t.description)}`;
}

const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

// Skips what you already have. Two identical bus fares on the same day both count:
// it compares how many of each you have, not just whether one exists.
// Same amount, same direction, within 2 days but a different name (your "Paycheck" vs the bank's
// "PAYROLL DEPOSIT", which often posts a day later) is flagged as "maybe", not silently added twice.
export function dedupe(transactions, entries) {
  const have = new Map();
  const pool = entries.filter((e) => e.type !== 'saving').map((e) => ({ e, used: false }));
  for (const p of pool) {
    const keys = new Set([p.e.importKey, importKey({ date: p.e.at.slice(0, 10), cents: p.e.cents, type: p.e.type, description: p.e.name })].filter(Boolean));
    for (const k of keys) have.set(k, [...(have.get(k) ?? []), p]);
  }
  const fresh = [];
  let skipped = 0;
  // Exact matches first, so they don't get used up as "maybe" matches.
  const rest = [];
  for (const t of transactions) {
    const p = (have.get(importKey(t)) ?? []).find((x) => !x.used);
    if (p) { p.used = true; skipped++; } else rest.push(t);
  }
  for (const t of rest) {
    const d = dayNum(t.date);
    const near = pool.find((p) => !p.used && p.e.type === t.type && p.e.cents === t.cents && Math.abs(dayNum(p.e.at.slice(0, 10)) - d) <= 2);
    if (near) { near.used = true; fresh.push({ ...t, maybe: { name: near.e.name, at: near.e.at } }); } else fresh.push(t);
  }
  return { fresh, skipped };
}

// ---------- Categories ----------
const PAYROLL = /\b(payroll|pay ?roll|salary|direct dep|direct deposit|wages|paie|salaire)\b/i;

// Store memory first, then everyday words, then a safe default. Always changeable before saving.
const BANK_FEES = /\b(service charge|monthly fee|overdraft|nsf|account fee|annual fee|interest charge)\b/i;

export function guessCategory(state, t) {
  const name = cleanDescription(t.description);
  // A refund goes back into the category the purchase was in, so it's guessed like spending.
  const kind = t.type === 'refund' ? 'expense' : t.type;
  const remembered = merchantCategory(state, name, kind) ?? merchantCategory(state, t.description, kind);
  if (remembered) return { category: remembered, sure: true };
  const cats = state.categories[kind];
  // Match on the cleaned store name, so words like "Internet Banking" can't fool it into "Bills".
  const text = ` ${name.toLowerCase()} `;
  if (kind === 'expense' && BANK_FEES.test(t.description) && cats.includes('Bills')) return { category: 'Bills', sure: false };
  if (t.type === 'income') {
    if (PAYROLL.test(text) && cats.includes('Paycheck')) return { category: 'Paycheck', sure: false };
    return { category: cats.includes('Other income') ? 'Other income' : cats[0], sure: false };
  }
  for (const [cat, words] of Object.entries(HINTS)) {
    if (cats.includes(cat) && words.some((w) => text.includes(` ${w} `) || text.includes(` ${w}`))) return { category: cat, sure: false };
  }
  return { category: cats.includes('Other') ? 'Other' : cats[cats.length - 1], sure: false };
}

// Store names from bank descriptions:
// "Point of Sale - Interac RETAIL PURCHASE 001001001779 7 ELEVEN STORE" → "7 Eleven"
// "Point of Sale - Visa Debit INTL VISA DEB RETAIL PURCHASE SP HYPEDEPT 6240… 58.00 CAD @ 1.000000" → "Sp Hypedept"
export function cleanDescription(d) {
  let t = ` ${d} `
    // how the bank says the money moved (not part of the store's name)
    .replace(/^\s*(point of sale\s*-\s*(interac|visa debit|debit|mastercard debit)|internet banking|online banking|mobile banking|branch transaction|electronic funds transfer|atm withdrawal|pre-?authori[sz]ed (debit|payment)|bill payment)\s*/i, ' ')
    .replace(/\s\d+[.,]\d{2}\s?(cad|usd|eur|gbp)\s?@\s?[\d.]+\s*$/i, ' ')      // foreign currency tail
    .replace(/\$\s?\d[\d.,]*.*$/, ' ')                                           // "FEE$16.95 RECORD-KEEPING N/A"
    .replace(/\b(intl|int|international)\s+visa\s+deb\b/gi, ' ')
    .replace(/\b(retail purchase|purchase reversal|mdse return|merchandise return|direct credit|visa debit|correction|reversal|purchase|pos|interac|visa|mastercard|debit|e-?transfer|point of sale|achat|paiement|online|payment|apple pay|google pay|contactless|tap|pending\.?b?|deposit)\b/gi, ' ')
    .replace(/\bsq\s?\*/gi, ' ')                                                 // Square card readers
    .replace(/([a-z])\d{6,}\b/gi, '$1')                                          // "RECLAIM011523460469" → "RECLAIM"
    .replace(/\b(?=(?:[a-z]*\d){4})(?=[a-z0-9]*[a-z])[a-z0-9]{8,}\b/gi, ' ')     // reference codes: "1VMFPV6I0000" (not "KRISPYKREME541C")
    .replace(/#\s*\d*/g, ' ')                                                    // store numbers
    .replace(/\b\d{4,}\b/g, ' ')                                                 // long numbers
    .replace(/\b(store)\s*$/i, ' ')
    .replace(/\b(ab|bc|on|qc|mb|sk|ns|nb|pe|nl|yt|nt|nu|can|ca)\s*$/i, ' ')
    .replace(/^[\s\-–*]+|[\s\-–*]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // "LYFT *TEMP AU", "GOOGLE *SERVICE", "BIRD* T": the part before the * is the company.
  if (t.includes('*')) t = t.split('*')[0].trim() || t.replace(/\*/g, ' ').trim();
  t = t.replace(/\s+[a-z]$/i, '').trim(); // a stray single letter at the end
  if (!t) t = d.replace(/^\s*(point of sale\s*-\s*\w+( debit)?|internet banking|branch transaction|electronic funds transfer)\s*/i, '').trim() || d.trim();
  if (t.length > 40) t = t.slice(0, 40).replace(/\s+\S*$/, '');
  // Capitals at the start of words only, so "SENIORE'S PIZZA" → "Seniore's Pizza", not "Seniore'S".
  return t.toLowerCase().replace(/(^|[\s(/&-])(\p{L})/gu, (m, sep, c) => sep + c.toUpperCase());
}
