// Every change to your data goes through here, so the rules are tested in one place.

import { generateDue, nextOccurrence } from './recurring.js';
import { splitAcrossGoals } from './budget.js';
import { rememberMerchant } from './suggest.js';

export const PAYCHECK = 'Paycheck';
export const isPaycheck = (e) => e.type === 'income' && e.category === PAYCHECK;

// The automatic savings for a paycheck: one entry per goal in its auto-save plan.
// Each paycheck remembers the plan it was saved with (entry.autoSave), so changing the
// settings later never rewrites past paychecks.
function savingsFor(state, entry, newId) {
  if (!isPaycheck(entry)) return [];
  if (!Array.isArray(entry.autoSave)) entry.autoSave = (state.settings.autoSave ?? []).map(({ goalId, bp }) => ({ goalId, bp }));
  const plan = entry.autoSave
    .map((p) => ({ ...p, name: state.goals.find((g) => g.id === p.goalId)?.name }))
    .filter((p) => p.name && p.bp > 0);
  if (!plan.length) return [];
  const split = splitAcrossGoals(entry.cents, plan);
  if (!split.ok) return [];
  return split.shares.filter((s) => s.cents > 0).map((s) => ({
    id: newId(), type: 'saving', name: `To ${s.name}`, cents: s.cents, at: entry.at,
    category: 'Savings', note: '', goalId: s.goalId, parentId: entry.id, bp: s.bp, ...(entry.auto ? { auto: true } : {}),
  }));
}

export function addEntry(state, entry, newId) {
  state.entries.push(entry);
  state.entries.push(...savingsFor(state, entry, newId));
  if (!entry.auto && entry.type !== 'saving') rememberMerchant(state, entry.name, entry.category, entry.type);
}

// Quick add: only the amount and category are needed. Without a name, the category is used.
export function quickEntry({ type = 'expense', cents, category, name = '', note = '', at, newId }) {
  return {
    id: newId(), type, cents, at, category,
    name: name.trim() || category,
    note: note.trim(),
    createdAt: new Date().toISOString(),
  };
}

// "Repeat": the same entry again, dated now.
export function repeatEntry(state, entry, now, newId) {
  const copy = {
    id: newId(), type: entry.type, name: entry.name, cents: entry.cents, at: now,
    category: entry.category, note: entry.note ?? '', createdAt: new Date().toISOString(),
    ...(entry.hours ? { hours: entry.hours, rateCents: entry.rateCents } : {}),
  };
  addEntry(state, copy, newId);
  return copy;
}

export function updateEntry(state, entry, newId) {
  const i = state.entries.findIndex((e) => e.id === entry.id);
  if (i < 0) return;
  const was = state.entries[i];
  state.entries[i] = entry;
  // Changing a store's category teaches merchant memory the new one.
  if (entry.type !== 'saving') rememberMerchant(state, entry.name, entry.category, entry.type);
  // Re-work this paycheck's savings with the plan it was saved with.
  const linked = state.entries.filter((e) => e.parentId === entry.id);
  state.entries = state.entries.filter((e) => e.parentId !== entry.id);
  if (!isPaycheck(entry)) { delete entry.autoSave; return; }
  if (!Array.isArray(entry.autoSave)) {
    entry.autoSave = linked.length
      ? linked.map((l) => ({ goalId: l.goalId, bp: l.bp ?? 0 }))
      : isPaycheck(was) ? [] : undefined; // a paycheck saved with no auto-save stays that way
  }
  state.entries.push(...savingsFor(state, entry, newId));
}

export function deleteEntry(state, id) {
  state.entries = state.entries.filter((e) => e.id !== id && e.parentId !== id);
  state.notice = state.notice.filter((n) => n !== id);
}

// Add everything that is now due. Returns the new main entries (for the welcome card).
export function runRecurring(state, now, newId, { notify = true } = {}) {
  const { entries, rules } = generateDue(state.recurring, now, newId);
  state.recurring = rules;
  for (const e of entries) {
    addEntry(state, e, newId);
    if (notify) state.notice.push(e.id);
  }
  return entries;
}

export function addRule(state, rule, now, newId) {
  state.recurring.push(rule);
  const { entries, rules } = generateDue([rule], now, newId);
  state.recurring = state.recurring.map((r) => (r.id === rule.id ? rules[0] : r));
  for (const e of entries) addEntry(state, e, newId);
  return entries;
}

// Remove a rule's entries from a given occurrence onwards (and their savings).
function dropFrom(state, ruleId, occurrence) {
  const gone = new Set(state.entries.filter((e) => e.recurringId === ruleId && e.occurrence >= occurrence).map((e) => e.id));
  state.entries = state.entries.filter((e) => !gone.has(e.id) && !gone.has(e.parentId));
  state.notice = state.notice.filter((n) => !gone.has(n));
}

// "This and all future ones": the old schedule stops here and a new one starts from this entry.
export function editFuture(state, entryId, entry, now, newId) {
  const old = state.entries.find((e) => e.id === entryId);
  const rule = state.recurring.find((r) => r.id === old?.recurringId);
  if (!old || !rule) { updateEntry(state, entry, newId); return; }
  dropFrom(state, rule.id, old.occurrence);
  rule.endAt = old.at;
  const fresh = {
    ...rule, id: newId(), name: entry.name, cents: entry.cents, category: entry.category,
    type: entry.type, anchor: entry.at, nextIndex: 0, endAt: null,
    hours: entry.hours, rateCents: entry.rateCents,
  };
  addRule(state, fresh, now, newId);
}

// "This and all future ones" for delete: stop the schedule from here.
export function deleteFuture(state, entryId) {
  const old = state.entries.find((e) => e.id === entryId);
  const rule = state.recurring.find((r) => r.id === old?.recurringId);
  if (!old || !rule) { deleteEntry(state, entryId); return; }
  dropFrom(state, rule.id, old.occurrence);
  rule.endAt = old.at;
}

// Edit a schedule from the Reminders tab: changes apply from the next date onwards.
export function editRule(state, ruleId, fields, now, newId) {
  const rule = state.recurring.find((r) => r.id === ruleId);
  if (!rule) return;
  if (rule.nextIndex === 0) {
    state.recurring = state.recurring.filter((r) => r.id !== ruleId);
    addRule(state, { ...rule, ...fields, nextIndex: 0 }, now, newId);
    return;
  }
  rule.endAt = nextOccurrence(rule) ?? rule.endAt;
  addRule(state, { ...rule, ...fields, id: newId(), nextIndex: 0, endAt: null }, now, newId);
}

// Stop a schedule: nothing more will be added. Past entries stay.
export function stopRule(state, ruleId) {
  const rule = state.recurring.find((r) => r.id === ruleId);
  if (!rule) return;
  if (rule.nextIndex === 0) state.recurring = state.recurring.filter((r) => r.id !== ruleId);
  else rule.endAt = nextOccurrence(rule) ?? rule.endAt;
}

// ---------- Cost per use and the subscription check-up ----------
const findItem = (state, kind, id) => (kind === 'rule' ? state.recurring : state.entries).find((x) => x.id === id);

// Turn a use counter on (an empty list) or off (removed, with its counts).
export function setTracking(state, kind, id, on) {
  const item = findItem(state, kind, id);
  if (!item) return;
  if (on && !Array.isArray(item.uses)) item.uses = [];
  if (!on) delete item.uses;
}

export function logUse(state, kind, id, at) {
  const item = findItem(state, kind, id);
  if (!item) return;
  item.uses = [...(item.uses ?? []), at].sort().slice(-500);
}

export function undoUse(state, kind, id, at) {
  const item = findItem(state, kind, id);
  const i = item?.uses?.lastIndexOf(at) ?? -1;
  if (i >= 0) item.uses.splice(i, 1);
}

// "Still using this? Yes": don't ask again for 3 months.
export function markChecked(state, ruleId, now) {
  const rule = state.recurring.find((r) => r.id === ruleId);
  if (rule) rule.checkedAt = now;
}

export function activeRules(state) {
  return state.recurring.filter((r) => nextOccurrence(r) !== null);
}

// Rename a category everywhere it's used: entries, schedules, limits and this month's moves.
export function renameCategory(state, kind, from, to) {
  const name = to.trim();
  const list = state.categories[kind];
  if (!name || name === from || !list.includes(from) || list.includes(name)) return false;
  if (kind === 'income' && from === PAYCHECK) return false;
  const type = kind === 'income' ? 'income' : 'expense';
  state.categories[kind] = list.map((c) => (c === from ? name : c));
  for (const e of state.entries) if (e.type === type && e.category === from) e.category = name;
  for (const r of state.recurring) if (r.type === type && r.category === from) r.category = name;
  if (kind === 'expense') {
    if (from in state.limits) { state.limits[name] = state.limits[from]; delete state.limits[from]; }
    for (const a of state.adjustments) {
      if (a.from === from) a.from = name;
      if (a.to === from) a.to = name;
    }
  }
  return true;
}

// Remove a category from the list. Past entries keep their category name.
export function deleteCategory(state, kind, name) {
  const list = state.categories[kind];
  if (list.length <= 1 || !list.includes(name) || (kind === 'income' && name === PAYCHECK)) return false;
  state.categories[kind] = list.filter((c) => c !== name);
  if (kind === 'expense') delete state.limits[name];
  return true;
}

export function addCategory(state, kind, name) {
  const n = name.trim();
  if (!n || n.length > 40 || state.categories[kind].includes(n)) return false;
  state.categories[kind].push(n);
  return true;
}

export function deleteGoal(state, goalId) {
  state.goals = state.goals.filter((g) => g.id !== goalId);
  state.settings.autoSave = (state.settings.autoSave ?? []).filter((p) => p.goalId !== goalId);
}
