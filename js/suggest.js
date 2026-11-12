// Making logging fast: category suggestions, merchant memory and favourites.
// Suggestions are only ever suggestions: the app never picks a category on its own,
// except when you've already tagged that exact store before (merchant memory).

import { parseStamp } from './dates.js';

// "Tim Hortons #1234 " → "tim hortons"
export function normalizeMerchant(name) {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/#\s*\d+/g, ' ')          // store numbers
    .replace(/\b\d{3,}\b/g, ' ')        // long numbers (terminal ids)
    .replace(/[^\p{L}\p{N}&' ]+/gu, ' ') // punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Merchant memory ----------
// Remember which category a store belongs to. Called whenever you save an entry with a name.
export function rememberMerchant(state, name, category, type = 'expense') {
  const key = normalizeMerchant(name);
  if (!key || !category || key === normalizeMerchant(category)) return false;
  state.merchants ??= {};
  const k = `${type}:${key}`;
  if (state.merchants[k] === category) return false;
  state.merchants[k] = category;
  // keep the memory a sensible size
  const ks = Object.keys(state.merchants);
  if (ks.length > 500) delete state.merchants[ks[0]];
  return true;
}

export function merchantCategory(state, name, type = 'expense') {
  const key = normalizeMerchant(name);
  if (!key) return null;
  const cat = state.merchants?.[`${type}:${key}`] ?? null;
  return cat && state.categories[type].includes(cat) ? cat : null;
}

export function forgetMerchant(state, key) {
  if (state.merchants) delete state.merchants[key];
}

// ---------- Category suggestions ----------
const hourOf = (stamp) => parseStamp(stamp)?.hh ?? 12;
const daysApart = (a, b) => {
  const pa = parseStamp(a);
  const pb = parseStamp(b);
  return Math.abs(Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000;
};

// Top categories for a new entry, best first. Uses: how often and how recently you've used each
// category, what you usually log at this time of day, entries of a similar amount, and the store.
export function suggestCategories(state, { type = 'expense', cents = null, name = '', now, limit = 3 }) {
  const allowed = state.categories[type];
  const score = new Map(allowed.map((c, i) => [c, -i * 0.001])); // tiny tie-break: your list order
  const hour = hourOf(now);
  const key = normalizeMerchant(name);
  const remembered = merchantCategory(state, name, type);
  if (remembered) score.set(remembered, score.get(remembered) + 1000);

  const recent = state.entries.filter((e) => e.type === type && !e.auto && e.at <= now && allowed.includes(e.category));
  for (const e of recent.slice(-600)) {
    const age = daysApart(e.at, now);
    if (age > 120) continue;
    const w = Math.exp(-age / 30); // recent entries count more
    // How often you use a category matters a little; how similar this entry is matters more.
    let s = 0.4 * w;
    const dh = Math.min(Math.abs(hourOf(e.at) - hour), 24 - Math.abs(hourOf(e.at) - hour));
    if (dh <= 2) s += 1 * w;
    if (cents && e.cents) {
      const ratio = Math.abs(Math.log(cents / e.cents));
      s += (3 / (1 + ratio * 8)) * w;
      if (cents === e.cents) s += 2 * w; // the exact same amount (bus fare, coffee) is a strong hint
    }
    if (key && normalizeMerchant(e.name) === key) s += 6 * w;
    score.set(e.category, score.get(e.category) + s);
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c);
}

// ---------- Favourites ----------
export const MAX_FAVOURITES = 12;

export function favouriteKey(f) {
  return `${f.type}|${normalizeMerchant(f.name)}|${f.cents}|${f.category}`;
}

export function isFavourite(state, entry) {
  const k = favouriteKey(entry);
  return (state.favourites ?? []).some((f) => favouriteKey(f) === k);
}

export function addFavourite(state, entry, newId) {
  state.favourites ??= [];
  if (isFavourite(state, entry) || state.favourites.length >= MAX_FAVOURITES) return false;
  state.favourites.push({ id: newId(), type: entry.type, name: entry.name, cents: entry.cents, category: entry.category });
  return true;
}

export function removeFavourite(state, entryOrId) {
  const k = typeof entryOrId === 'string' ? null : favouriteKey(entryOrId);
  state.favourites = (state.favourites ?? []).filter((f) => (k ? favouriteKey(f) !== k : f.id !== entryOrId));
}
