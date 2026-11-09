// Saves everything on this device only. Nothing is ever sent anywhere.
// Stage 3 replaces this storage with an encrypted version (passcode + Face ID).

import { isStamp } from './dates.js';
import { MAX_ENTRY_CENTS } from './money.js';
import { TYPES } from './calc.js';
import { FREQS, KINDS } from './recurring.js';

const KEY = 'mybudget.v1';

export const DEFAULT_CATEGORIES = {
  expense: ['Housing', 'Groceries', 'Transport', 'Bills', 'Eating Out', 'Shopping', 'Fun', 'Health', 'Other'],
  income: ['Paycheck', 'Other income'],
};

export const DEFAULT_SETTINGS = {
  monthStartDay: 1,
  weekStartDay: 1,
  autoSaveBp: 0,          // auto-save percentage in basis points (1000 = 10%)
  autoSaveGoalId: null,
  hourlyRateCents: null,  // remembered for the paycheck logger
  adviceOn: true,
  eventHour: 9,           // calendar events at 9:00 AM
};

export function freshState() {
  return {
    version: 2,
    entries: [],
    recurring: [],
    goals: [],
    limits: {},
    adjustments: [],
    notice: [],           // entry ids added automatically since the last visit
    dismissedAdvice: [],
    categories: structuredClone(DEFAULT_CATEGORIES),
    settings: { ...DEFAULT_SETTINGS },
  };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const cents = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_ENTRY_CENTS;
const optStr = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);

// Only keep entries that are completely valid, so bad data can never reach the maths.
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (!TYPES.includes(e.type)) return null;
  if (!cents(e.cents)) return null;
  if (!isStamp(e.at)) return null;
  const name = str(e.name, 80).trim();
  if (!name) return null;
  const out = {
    id: str(e.id, 64) || newId(),
    type: e.type,
    name,
    cents: e.cents,
    at: e.at,
    category: str(e.category, 40).trim() || 'Other',
    note: str(e.note, 500),
    createdAt: str(e.createdAt, 40),
  };
  const rid = optStr(e.recurringId, 64);
  if (rid) { out.recurringId = rid; out.occurrence = Number.isInteger(e.occurrence) ? e.occurrence : 0; }
  if (e.auto === true) out.auto = true;
  const gid = optStr(e.goalId, 64);
  if (gid) out.goalId = gid;
  const pid = optStr(e.parentId, 64);
  if (pid) out.parentId = pid;
  if (Number.isInteger(e.bp) && e.bp >= 0 && e.bp <= 10000) out.bp = e.bp;
  if (Number.isSafeInteger(e.hours) && e.hours > 0 && Number.isSafeInteger(e.rateCents) && e.rateCents > 0) {
    out.hours = e.hours;
    out.rateCents = e.rateCents;
  }
  return out;
}

export function cleanRule(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.type !== 'income' && r.type !== 'expense') return null;
  if (!cents(r.cents) || !isStamp(r.anchor) || !(r.freq in FREQS)) return null;
  const name = str(r.name, 80).trim();
  if (!name) return null;
  return {
    id: str(r.id, 64) || newId(),
    type: r.type,
    kind: r.kind in KINDS ? r.kind : 'other',
    name,
    cents: r.cents,
    category: str(r.category, 40).trim() || 'Other',
    freq: r.freq,
    anchor: r.anchor,
    nextIndex: Number.isInteger(r.nextIndex) && r.nextIndex >= 0 ? r.nextIndex : 0,
    endAt: isStamp(r.endAt) ? r.endAt : null,
    hours: Number.isSafeInteger(r.hours) && r.hours > 0 ? r.hours : undefined,
    rateCents: Number.isSafeInteger(r.rateCents) && r.rateCents > 0 ? r.rateCents : undefined,
  };
}

export function cleanGoal(g) {
  if (!g || typeof g !== 'object') return null;
  const name = str(g.name, 60).trim();
  if (!name || !cents(g.targetCents)) return null;
  return { id: str(g.id, 64) || newId(), name, targetCents: g.targetCents, createdAt: str(g.createdAt, 40) };
}

export function cleanState(raw) {
  const s = freshState();
  if (!raw || typeof raw !== 'object') return s;
  if (Array.isArray(raw.entries)) s.entries = raw.entries.map(cleanEntry).filter(Boolean);
  if (Array.isArray(raw.recurring)) s.recurring = raw.recurring.map(cleanRule).filter(Boolean);
  if (Array.isArray(raw.goals)) s.goals = raw.goals.map(cleanGoal).filter(Boolean);
  for (const kind of ['expense', 'income']) {
    const list = raw.categories?.[kind];
    if (Array.isArray(list)) {
      const names = [...new Set(list.map((c) => str(c, 40).trim()).filter(Boolean))];
      if (names.length) s.categories[kind] = names;
    }
  }
  if (raw.limits && typeof raw.limits === 'object') {
    for (const [k, v] of Object.entries(raw.limits)) if (Number.isSafeInteger(v) && v >= 0 && v <= MAX_ENTRY_CENTS) s.limits[str(k, 40)] = v;
  }
  if (Array.isArray(raw.adjustments)) {
    s.adjustments = raw.adjustments
      .filter((a) => a && isStamp(a.month) && cents(a.cents) && typeof a.from === 'string' && typeof a.to === 'string' && a.from !== a.to)
      .map((a) => ({ id: str(a.id, 64) || newId(), month: a.month, from: str(a.from, 40), to: str(a.to, 40), cents: a.cents }));
  }
  if (Array.isArray(raw.notice)) s.notice = raw.notice.filter((x) => typeof x === 'string').slice(0, 500);
  if (Array.isArray(raw.dismissedAdvice)) s.dismissedAdvice = raw.dismissedAdvice.filter((x) => typeof x === 'string').slice(-200);

  const st = raw.settings ?? {};
  const t = s.settings;
  if (Number.isInteger(st.monthStartDay) && st.monthStartDay >= 1 && st.monthStartDay <= 31) t.monthStartDay = st.monthStartDay;
  if (Number.isInteger(st.weekStartDay) && st.weekStartDay >= 0 && st.weekStartDay <= 6) t.weekStartDay = st.weekStartDay;
  if (Number.isInteger(st.autoSaveBp) && st.autoSaveBp >= 0 && st.autoSaveBp <= 10000) t.autoSaveBp = st.autoSaveBp;
  if (typeof st.autoSaveGoalId === 'string' && s.goals.some((g) => g.id === st.autoSaveGoalId)) t.autoSaveGoalId = st.autoSaveGoalId;
  if (Number.isSafeInteger(st.hourlyRateCents) && st.hourlyRateCents > 0) t.hourlyRateCents = st.hourlyRateCents;
  if (typeof st.adviceOn === 'boolean') t.adviceOn = st.adviceOn;
  if (Number.isInteger(st.eventHour) && st.eventHour >= 0 && st.eventHour <= 23) t.eventHour = st.eventHour;
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
