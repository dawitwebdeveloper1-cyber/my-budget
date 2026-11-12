// Voice entry: "spent 12 dollars on lunch" → −$12.00, Eating Out, "Lunch".
// Speech-to-text uses the phone's built-in speech recognition (on iPhone, Apple turns the
// audio into text). Everything after that, reading the amount and category, happens here.
// Voice entries are never saved without a confirm card, because "fifteen" and "fifty" sound alike.

import { getItem, setItem } from './storage.js';
import { merchantCategory, normalizeMerchant } from './suggest.js';

// ---------- Numbers spoken as words ----------
const SMALL = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const isNumWord = (w) => w in SMALL || w in TENS || w === 'hundred' || w === 'thousand';

// Splits text into tokens, turning spoken and written numbers into number tokens.
// "twelve fifty" stays as two numbers (12, 50) so it can be read as $12.50.
export function tokenize(text) {
  const raw = String(text).toLowerCase()
    .replace(/\$\s*([\d.,]+)/g, ' $1 dollars ')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9.' -]+/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  let total = 0;
  let current = 0;
  let last = null;
  let active = false;
  let isWords = false;
  const flush = () => {
    if (active) out.push({ num: total + current, words: isWords });
    total = 0; current = 0; last = null; active = false; isWords = false;
  };
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    const next = raw[i + 1];
    if (/^\d+(\.\d+)?$/.test(w) || /^\.\d+$/.test(w)) {
      flush();
      out.push({ num: Number(w), words: false, text: w });
      continue;
    }
    if ((w === 'a' || w === 'an') && (next === 'hundred' || next === 'thousand')) {
      if (active && last !== 'thousand') flush();
      current = 1; last = 'small'; active = true; isWords = true;
      continue;
    }
    if (w === 'and' && active && next && isNumWord(next)) continue;
    if (w in SMALL) {
      const n = SMALL[w];
      if (active && (last === 'small' || (last === 'tens' && n >= 10))) flush();
      current += n; last = 'small'; active = true; isWords = true;
      continue;
    }
    if (w in TENS) {
      if (active && (last === 'small' || last === 'tens')) flush();
      current += TENS[w]; last = 'tens'; active = true; isWords = true;
      continue;
    }
    if (w === 'hundred' && active) { current = (current || 1) * 100; last = 'hundred'; continue; }
    if (w === 'thousand' && active) { total += (current || 1) * 1000; current = 0; last = 'thousand'; continue; }
    flush();
    out.push({ word: w });
  }
  flush();
  return out;
}

const DOLLAR = new Set(['dollar', 'dollars', 'buck', 'bucks']);
const CENT = new Set(['cent', 'cents']);

// Whole cents from a number token, exactly (no float maths on money).
function toCents(tok) {
  if (tok.text) {
    const [w, f = ''] = tok.text.split('.');
    if (f.length > 2) return null;
    return Number(w || '0') * 100 + Number((f + '00').slice(0, 2));
  }
  return Number.isSafeInteger(tok.num) ? tok.num * 100 : null;
}

// Finds the amount. Understands "12", "$12.50", "12 dollars 50", "12 dollars and 50 cents",
// "75 cents", "twelve fifty", "a hundred and twenty", "twelve point five".
export function findAmount(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.num === undefined) continue;
    let cents = toCents(t);
    if (cents === null) continue;
    let j = i + 1;
    const at = (k) => tokens[k] ?? {};
    if (CENT.has(at(j).word) && t.num < 100 && !t.text?.includes('.')) return { cents: t.num, end: j };
    if (at(j).word === 'point' && at(j + 1).num !== undefined && t.text === undefined) {
      const d = at(j + 1).num;
      if (d < 10) return { cents: cents + d * 10, end: j + 1 };
      if (d < 100) return { cents: cents + d, end: j + 1 };
    }
    if (DOLLAR.has(at(j).word)) {
      j++;
      if (at(j).word === 'and') j++;
      const c = at(j);
      if (c.num !== undefined && Number.isInteger(c.num) && c.num < 100 && !c.text?.includes('.')) {
        return { cents: cents + c.num, end: CENT.has(at(j + 1).word) ? j + 1 : j };
      }
      return { cents, end: i + 1 };
    }
    // "twelve fifty" → $12.50 (two spoken numbers in a row, the second under 100)
    const n2 = at(i + 1);
    if (t.words && n2.num !== undefined && n2.words && n2.num >= 10 && n2.num < 100 && t.num < 1000) {
      return { cents: cents + n2.num, end: i + 1 };
    }
    return { cents, end: i };
  }
  return null;
}

// ---------- Money in or out, category, name ----------
const INCOME_WORDS = ['got paid', 'paid me', 'paycheck', 'pay cheque', 'paycheque', 'payday', 'earned', 'received', 'income', 'tips', 'deposit'];
const PAY_WORDS = ['got paid', 'paycheck', 'pay cheque', 'paycheque', 'payday', 'paid me', 'wages', 'salary'];
const EXPENSE_WORDS = ['spent', 'spend', 'paid', 'bought', 'buy', 'cost', 'costs'];

// Everyday words → the default categories (only used if you have that category).
const HINTS = {
  'Eating Out': ['lunch', 'dinner', 'breakfast', 'coffee', 'restaurant', 'takeout', 'take out', 'pizza', 'burger', 'sushi', 'tim hortons', 'starbucks', 'mcdonalds', "mcdonald's", 'subway', 'food court', 'snack', 'snacks', 'bubble tea', 'drinks'],
  Groceries: ['groceries', 'grocery', 'supermarket', 'no frills', 'superstore', 'safeway', 'costco', 'walmart groceries', 'sobeys', 'loblaws', 'freshco', 'food basics', 'metro'],
  Transport: ['gas', 'bus', 'transit', 'uber', 'lyft', 'taxi', 'train', 'parking', 'fuel', 'ctrain', 'c train', 'ttc', 'bus pass'],
  Housing: ['rent', 'mortgage'],
  Bills: ['phone bill', 'phone', 'internet', 'hydro', 'electricity', 'bill', 'insurance', 'netflix', 'spotify', 'subscription'],
  Shopping: ['clothes', 'shoes', 'shopping', 'amazon', 'mall', 'hoodie', 'shirt'],
  Fun: ['movie', 'movies', 'game', 'games', 'concert', 'cinema', 'bowling', 'party'],
  Health: ['doctor', 'dentist', 'pharmacy', 'medicine', 'shoppers', 'gym', 'vitamins'],
};

const has = (text, phrase) => new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(text);
const title = (s) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export function parseVoice(text, state) {
  const clean = ` ${String(text).toLowerCase().replace(/[^\p{L}\p{N}$.' ]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
  const tokens = tokenize(text);
  const amount = findAmount(tokens);

  // "got paid" and "paid me" mean money in, so they don't count as the spending word "paid".
  const withoutPay = clean.replace(/ got paid | paid me /g, ' ');
  const expenseHit = EXPENSE_WORDS.some((w) => has(withoutPay, w));
  const incomeHit = INCOME_WORDS.some((w) => has(clean, w));
  const type = incomeHit && !expenseHit ? 'income' : 'expense';
  const cats = state.categories[type];

  // Name: what comes after "at" (a store) or else "on" / "for" / "from".
  const words = tokens.map((t) => t.word ?? null);
  let name = '';
  for (const marker of ['at', 'on', 'for', 'from']) {
    const k = words.lastIndexOf(marker);
    if (k >= 0 && k < words.length - 1) {
      const rest = words.slice(k + 1).filter((w) => w && !DOLLAR.has(w) && !CENT.has(w));
      const stop = rest.findIndex((w) => ['at', 'on', 'for', 'from', 'and'].includes(w));
      const picked = (stop >= 0 ? rest.slice(0, stop) : rest).join(' ').trim();
      if (picked && !['it', 'that', 'this', 'the'].includes(picked)) { name = title(picked); break; }
    }
  }

  // Category: a store you've tagged before, then a category named outright, then everyday words.
  let category = name ? merchantCategory(state, name, type) : null;
  if (!category) category = cats.find((c) => has(clean, c.toLowerCase())) ?? null;
  if (!category && type === 'income') {
    if (PAY_WORDS.some((w) => has(clean, w)) && cats.includes('Paycheck')) category = 'Paycheck';
    else if (cats.includes('Other income')) category = 'Other income';
  }
  if (!category && type === 'expense') {
    for (const [cat, hints] of Object.entries(HINTS)) {
      if (cats.includes(cat) && hints.some((h) => has(clean, h))) { category = cat; break; }
    }
  }
  if (name && category && normalizeMerchant(name) === normalizeMerchant(category)) name = '';
  return { heard: String(text).trim(), type, cents: amount?.cents || null, category, name };
}

// Of the phone's best guesses, use the first one that has an amount.
export function bestGuess(alternatives, state) {
  const parsed = alternatives.map((a) => parseVoice(a, state));
  return parsed.find((p) => p.cents) ?? parsed[0] ?? null;
}

// ---------- The phone's speech recognition ----------
const FAILS_KEY = 'mybudget.device.voiceFails';
const Recognizer = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

const fails = () => Number(getItem(FAILS_KEY) || 0);
function recordFail() { setItem(FAILS_KEY, String(fails() + 1)).catch(() => {}); }
function resetFails() { if (fails()) setItem(FAILS_KEY, '0').catch(() => {}); }

// Hidden where the phone has no speech recognition, or after it fails twice in a row.
export function voiceAvailable() {
  return !!Recognizer() && fails() < 2;
}

// Listens once. Returns a function that stops listening.
export function listen({ onResult, onError, onEnd }) {
  const R = Recognizer();
  if (!R) { onError?.('unsupported'); return () => {}; }
  const r = new R();
  r.lang = 'en-CA';
  r.interimResults = false;
  r.maxAlternatives = 3;
  r.continuous = false;
  let got = false;
  r.onresult = (e) => {
    got = true;
    resetFails();
    onResult([...e.results[0]].map((a) => a.transcript));
  };
  r.onerror = (e) => {
    if (e.error !== 'aborted' && e.error !== 'no-speech') recordFail();
    onError?.(e.error);
  };
  r.onend = () => onEnd?.(got);
  try {
    r.start();
  } catch {
    recordFail();
    onError?.('start-failed');
  }
  return () => { try { r.abort(); } catch { /* already stopped */ } };
}
