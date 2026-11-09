// Every change to your data goes through here, so the rules are tested in one place.

import { generateDue, nextOccurrence } from './recurring.js';
import { autoSaveSplit } from './budget.js';

export const PAYCHECK = 'Paycheck';
export const isPaycheck = (e) => e.type === 'income' && e.category === PAYCHECK;

// The automatic savings entry for a paycheck (or null if auto-save is off).
function savingFor(state, entry, newId) {
  const { autoSaveBp: bp, autoSaveGoalId: goalId } = state.settings;
  if (!isPaycheck(entry) || !bp) return null;
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) return null;
  const split = autoSaveSplit(entry.cents, bp, goal.name);
  if (!split.ok || split.save <= 0) return null;
  return {
    id: newId(), type: 'saving', name: `To ${goal.name}`, cents: split.save, at: entry.at,
    category: 'Savings', note: '', goalId: goal.id, parentId: entry.id, bp, ...(entry.auto ? { auto: true } : {}),
  };
}

export function addEntry(state, entry, newId) {
  state.entries.push(entry);
  const s = savingFor(state, entry, newId);
  if (s) state.entries.push(s);
}

export function updateEntry(state, entry, newId) {
  const i = state.entries.findIndex((e) => e.id === entry.id);
  if (i < 0) return;
  const was = state.entries[i];
  state.entries[i] = entry;
  const linked = state.entries.find((e) => e.parentId === entry.id);
  if (linked) {
    const goal = state.goals.find((g) => g.id === linked.goalId);
    const split = isPaycheck(entry) ? autoSaveSplit(entry.cents, linked.bp ?? 0, goal?.name) : null;
    if (!split?.ok || split.save <= 0) state.entries = state.entries.filter((e) => e.id !== linked.id);
    else Object.assign(linked, { cents: split.save, at: entry.at });
  } else if (!isPaycheck(was)) {
    const s = savingFor(state, entry, newId);
    if (s) state.entries.push(s);
  }
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
  if (state.settings.autoSaveGoalId === goalId) {
    state.settings.autoSaveGoalId = null;
    state.settings.autoSaveBp = 0;
  }
}
