// Saves everything on this device only. Nothing is ever sent anywhere.
// Stage 3 replaces this storage with an encrypted version (passcode + Face ID).

import { isStamp } from './dates.js';
import { MAX_ENTRY_CENTS } from './money.js';
import { TYPES } from './calc.js';

const KEY = 'mybudget.v1';

export const DEFAULT_CATEGORIES = {
  expense: ['Housing', 'Groceries', 'Transport', 'Bills', 'Eating Out', 'Shopping', 'Fun', 'Health', 'Other'],
  income: ['Paycheck', 'Other income'],
};

export function freshState() {
  return {
    version: 1,
    entries: [],
    categories: structuredClone(DEFAULT_CATEGORIES),
    settings: { monthStartDay: 1, weekStartDay: 1 },
  };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// Only keep entries that are completely valid, so bad data can never reach the maths.
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (!TYPES.includes(e.type)) return null;
  if (!Number.isSafeInteger(e.cents) || e.cents <= 0 || e.cents > MAX_ENTRY_CENTS) return null;
  if (!isStamp(e.at)) return null;
  const name = str(e.name, 80).trim();
  if (!name) return null;
  return {
    id: str(e.id, 64) || newId(),
    type: e.type,
    name,
    cents: e.cents,
    at: e.at,
    category: str(e.category, 40).trim() || 'Other',
    note: str(e.note, 500),
    createdAt: str(e.createdAt, 40),
  };
}

export function cleanState(raw) {
  const s = freshState();
  if (!raw || typeof raw !== 'object') return s;
  if (Array.isArray(raw.entries)) s.entries = raw.entries.map(cleanEntry).filter(Boolean);
  for (const kind of ['expense', 'income']) {
    const list = raw.categories?.[kind];
    if (Array.isArray(list)) {
      const names = [...new Set(list.map((c) => str(c, 40).trim()).filter(Boolean))];
      if (names.length) s.categories[kind] = names;
    }
  }
  const st = raw.settings ?? {};
  if (Number.isInteger(st.monthStartDay) && st.monthStartDay >= 1 && st.monthStartDay <= 31) s.settings.monthStartDay = st.monthStartDay;
  if (Number.isInteger(st.weekStartDay) && st.weekStartDay >= 0 && st.weekStartDay <= 6) s.settings.weekStartDay = st.weekStartDay;
  return s;
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? cleanState(JSON.parse(raw)) : freshState();
  } catch {
    return freshState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
