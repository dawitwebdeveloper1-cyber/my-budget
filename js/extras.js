// The optional extras: switches for each one, "owed to you" from split bills, and cash on hand.
// Only the basics are on for new people: quick add, Left until payday, goals, show me how, Can I afford it?

import { sumCents, formatCents } from './money.js';
import { checked, receiptMatches } from './calc.js';
import { isStamp } from './dates.js';

// Each extra: its switch, a plain name, and one line about what it does.
export const EXTRAS = [
  ['streak', 'Logging streak', 'A small day count in the corner. One missed day a week is free.'],
  ['nudges', 'Gentle notes', 'One calm note at a time on Home: categories near their limit, bonus paychecks, subscription check-ups.'],
  ['weeklyWins', 'Weekly wins', 'One small true fact about last week, early in the week.'],
  ['checkin', 'Payday check-in', 'A short screen on payday: what came in, what got saved, how last paycheck went.'],
  ['whatIf', 'What-if practice', 'Try a change and see goal dates move, without changing anything.'],
  ['costPerUse', 'Cost per use', 'Count each time you use a subscription or a big purchase.'],
  ['splits', 'Split bills', 'Mark what friends owe you for a bill you paid. Only your share counts as spending.'],
  ['cash', 'Cash', 'Tag cash spending and keep a "cash on hand" amount.'],
];
export const EXTRA_KEYS = EXTRAS.map(([k]) => k);

// New people: everything off. Data from before switches existed: what was there stays on.
export const extrasOff = () => Object.fromEntries(EXTRA_KEYS.map((k) => [k, false]));
export const extrasAsBefore = () => ({ ...Object.fromEntries(EXTRA_KEYS.map((k) => [k, true])), splits: false, cash: false });

export function on(state, key) {
  return state.settings.extras?.[key] === true;
}

// ---------- Owed to you ----------
// Split bills not paid back yet, and the total.
export function owedToYou(state, now) {
  const repaid = new Set(state.entries.filter((e) => e.type === 'repaid' && e.at <= now).map((e) => e.splitOf));
  const open = state.entries.filter((e) => e.type === 'expense' && e.owed && e.at <= now && !repaid.has(e.id))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  const a = sumCents(open.map((e) => e.owed));
  let b = 0;
  for (let i = open.length - 1; i >= 0; i--) b += open[i].owed;
  const total = checked(a, b);
  const receipt = { title: 'Owed to you', totalLabel: 'Owed to you', lines: open.map((e) => ({ label: `${e.name}: friends' part of ${formatCents(e.cents)}`, at: e.at, cents: e.owed, neutral: true })) };
  const ok = total.ok && receiptMatches(receipt, total.value);
  return { ok, value: ok ? total.value : null, receipt: ok ? receipt : null, open };
}

// ---------- Cash on hand ----------
// The last count you entered, minus cash spending and plus cash coming in since then.
export function cashOnHand(state, now) {
  const c = state.settings.cash;
  if (!c || !Number.isSafeInteger(c.cents) || !isStamp(c.at)) return null;
  const since = state.entries.filter((e) => e.cash && e.at > c.at && e.at <= now).sort((x, y) => (x.at < y.at ? -1 : 1));
  const flow = (e) => (e.type === 'income' ? e.cents : -e.cents);
  const a = c.cents + sumCents(since.map(flow));
  let b = c.cents;
  for (const e of since) b += e.type === 'income' ? e.cents : -e.cents;
  const total = checked(a, b);
  const receipt = { title: 'Cash on hand', totalLabel: 'Cash on hand now', lines: [
    { label: 'You counted', at: c.at, cents: c.cents, neutral: true },
    ...since.map((e) => ({ label: e.name, at: e.at, cents: flow(e), type: e.type, category: e.category })),
  ] };
  const ok = total.ok && receiptMatches(receipt, total.value);
  return { ok, value: ok ? total.value : null, receipt: ok ? receipt : null, since: since.length };
}
