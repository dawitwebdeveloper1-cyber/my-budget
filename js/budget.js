// Goals, category budgets, paycheck maths, weekly snapshot and advice notes.
// Same rules as calc.js: whole cents, two independent ways, receipts that add up exactly.

import { assertCents, sumCents, formatCents } from './money.js';
import { checked, receiptMatches, periodTotals } from './calc.js';
import { weekOf, shiftWeek, parseStamp } from './dates.js';

// ---------- Parsing ----------

// "37.5" -> 3750 (hundredths of an hour). Up to 999.99 hours.
export function parseHours(input) {
  if (typeof input !== 'string') return null;
  const m = /^(\d{0,3})(?:\.(\d{0,2}))?$/.exec(input.trim());
  if (!m || (m[1] === '' && !m[2])) return null;
  const v = Number(m[1] || '0') * 100 + Number(((m[2] ?? '') + '00').slice(0, 2));
  return v > 0 ? v : null;
}

export function formatHours(hundredths) {
  const whole = Math.floor(hundredths / 100);
  const frac = String(hundredths % 100).padStart(2, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

// "10" or "12.5" -> basis points (1000, 1250). 0 to 100%.
export function parsePercent(input) {
  if (typeof input !== 'string') return null;
  const m = /^(\d{0,3})(?:\.(\d{0,2}))?$/.exec(input.trim().replace(/%$/, ''));
  if (!m || (m[1] === '' && !m[2])) return null;
  const v = Number(m[1] || '0') * 100 + Number(((m[2] ?? '') + '00').slice(0, 2));
  return v <= 10000 ? v : null;
}

export function formatPercent(bp) {
  const whole = Math.floor(bp / 100);
  const frac = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return `${frac ? `${whole}.${frac}` : whole}%`;
}

// ---------- Hours × hourly pay ----------
// Rounded to the nearest cent (half a cent rounds up).
export function hoursPay(hundredths, rateCents) {
  assertCents(hundredths);
  assertCents(rateCents);
  const product = hundredths * rateCents; // in 1/10,000 of a dollar
  const a = Math.floor((product + 50) / 100);
  const b = Number((BigInt(hundredths) * BigInt(rateCents) + 50n) / 100n);
  const r = checked(a, b);
  return {
    ...r,
    receipt: r.ok ? { kind: 'product', title: 'Hours × hourly pay', hours: hundredths, rateCents, exact: product, total: r.value } : null,
  };
}

// The exact (unrounded) pay, e.g. "$646.875"
export function formatExact(tenThousandths) {
  const dollars = Math.floor(tenThousandths / 10000);
  let frac = String(tenThousandths % 10000).padStart(4, '0');
  frac = frac.replace(/0+$/, '').padEnd(2, '0');
  return `$${String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

// ---------- Auto-save split ----------
// The savings share rounds DOWN to the cent; the leftover fraction stays spendable.
export function autoSaveSplit(paycheckCents, bp, goalName = 'savings') {
  assertCents(paycheckCents);
  const saveA = Math.floor((paycheckCents * bp) / 10000);
  const saveB = Number((BigInt(paycheckCents) * BigInt(bp)) / 10000n);
  const save = checked(saveA, saveB);
  const spendA = save.ok ? paycheckCents - save.value : NaN;
  const spendB = Number(BigInt(paycheckCents) - (BigInt(paycheckCents) * BigInt(bp)) / 10000n);
  const spend = checked(spendA, spendB);
  const ok = save.ok && spend.ok && save.value + spend.value === paycheckCents;
  const receipt = {
    title: 'Paycheck split', totalLabel: 'Spendable',
    lines: [
      { label: 'Paycheck', cents: paycheckCents },
      { label: `To ${goalName} (${formatPercent(bp)})`, cents: ok ? -save.value : 0, type: 'saving' },
    ],
  };
  if (!ok || !receiptMatches(receipt, spend.value)) return { ok: false, save: null, spend: null, receipt: null };
  return { ok: true, save: save.value, spend: spend.value, value: spend.value, receipt };
}

// ---------- Savings goals ----------
export function goalProgress(goal, entries, now) {
  const mine = entries.filter((e) => e.type === 'saving' && e.goalId === goal.id && e.at <= now)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  const a = sumCents(mine.map((e) => e.cents));
  const groups = new Map();
  for (const e of entries) {
    if (e.type !== 'saving' || !(e.at <= now)) continue;
    groups.set(e.goalId, (groups.get(e.goalId) ?? 0) + assertCents(e.cents));
  }
  const r = checked(a, groups.get(goal.id) ?? 0);
  const receipt = {
    title: goal.name, totalLabel: 'Saved so far',
    lines: mine.map((e) => ({ label: e.name, at: e.at, cents: e.cents, type: 'saving-in' })),
  };
  const ok = r.ok && receiptMatches(receipt, r.value);
  const saved = ok ? r.value : null;
  return {
    ok, value: saved, receipt: ok ? receipt : null,
    target: goal.targetCents,
    percent: ok ? Math.min(100, Math.floor((saved * 100) / goal.targetCents)) : 0,
    toGo: ok ? Math.max(0, goal.targetCents - saved) : null,
    reached: ok && saved >= goal.targetCents,
  };
}

// ---------- Category budgets ----------
// limits: { category: cents }. adjustments: [{ month, from, to, cents }] (this budget month only).
export function categoryBudgets(state, period, now) {
  const totals = periodTotals(state.entries, period, now);
  const spentA = new Map(totals.byCategory.map((c) => [c.category, c.value]));
  const adjustments = (state.adjustments ?? []).filter((a) => a.month === period.start);
  const limits = state.limits ?? {};
  const names = [...state.categories.expense];
  for (const c of spentA.keys()) if (!names.includes(c)) names.push(c);

  const live = state.entries.filter((e) => e.type === 'expense' && e.at <= now && e.at >= period.start && e.at < period.end)
    .sort((a, b) => (a.at < b.at ? -1 : 1));

  const rows = names.map((category) => {
    const limit = Number.isSafeInteger(limits[category]) ? limits[category] : null;
    const spentWayA = totals.categoriesOk ? (spentA.get(category) ?? 0) : NaN;
    const mine = live.filter((e) => e.category === category);
    const spentWayB = sumCents(mine.map((e) => e.cents));
    const spent = checked(spentWayA, spentWayB);
    if (limit === null) return { category, limit: null, spent };

    const adjIn = adjustments.filter((a) => a.to === category);
    const adjOut = adjustments.filter((a) => a.from === category);
    const effective = limit + sumCents(adjIn.map((a) => a.cents)) - sumCents(adjOut.map((a) => a.cents));
    const lines = [
      { label: `${category} limit`, cents: limit, neutral: true },
      ...adjIn.map((a) => ({ label: `Covered from ${a.from}`, cents: a.cents, neutral: true })),
      ...adjOut.map((a) => ({ label: `Moved to ${a.to}`, cents: -a.cents, neutral: true })),
      ...mine.map((e) => ({ label: e.name, at: e.at, cents: -e.cents })),
    ];
    // Way A: limit adjusted, minus total spent. Way B: add up every line one by one.
    const remA = spent.ok ? effective - spent.value : NaN;
    const remB = sumCents(lines.map((l) => l.cents));
    const rem = checked(remA, remB);
    const receipt = { title: category, totalLabel: rem.ok && rem.value < 0 ? 'Over by' : 'Left to spend', lines };
    const ok = rem.ok && receiptMatches(receipt, rem.value);
    return {
      category, limit, effective, spent,
      ok, value: ok ? rem.value : null, receipt: ok ? receipt : null,
      over: ok && rem.value < 0 ? -rem.value : 0,
      percent: ok && effective > 0 ? Math.floor((spent.value * 100) / effective) : (ok && spent.value > 0 ? 100 : 0),
    };
  });

  // Whole budget: every limit minus everything spent in limited categories.
  const limited = rows.filter((r) => r.limit !== null);
  const allOk = limited.every((r) => r.ok);
  const totalA = allOk ? sumCents(limited.map((r) => r.value)) : NaN;
  const totalB = sumCents(limited.map((r) => r.limit))
    - sumCents(live.filter((e) => limited.some((r) => r.category === e.category)).map((e) => e.cents));
  const t = checked(totalA, totalB);
  const totalReceipt = {
    title: 'Whole budget', totalLabel: t.ok && t.value < 0 ? 'Over by' : 'Left to spend',
    lines: limited.flatMap((r) => [
      { label: `${r.category} limit`, cents: r.limit, neutral: true },
      ...(r.spent.value ? [{ label: `${r.category} spending`, cents: -r.spent.value }] : []),
    ]),
  };
  const totalOk = t.ok && receiptMatches(totalReceipt, t.value);
  return {
    rows,
    total: { ok: totalOk, value: totalOk ? t.value : null, receipt: totalOk ? totalReceipt : null, limit: sumCents(limited.map((r) => r.limit)) },
  };
}

// Categories that can cover an overspend, and how much each can give.
export function coverOptions(budgets, overCategory) {
  return budgets.rows
    .filter((r) => r.category !== overCategory && r.limit !== null && r.ok && r.value > 0)
    .map((r) => ({ category: r.category, room: r.value }));
}

// ---------- Weekly snapshot ----------
export function weeklySnapshot(entries, now, weekStart = 1) {
  const thisWeek = weekOf(now, weekStart);
  const lastWeek = shiftWeek(thisWeek, -1);
  const tw = periodTotals(entries, thisWeek, now).moneyOut;
  const lw = periodTotals(entries, lastWeek, now).moneyOut;
  const thisSpent = tw.ok ? -tw.value : NaN;
  const lastSpent = lw.ok ? -lw.value : NaN;
  // Way B: straight loop over all entries
  let tB = 0;
  let lB = 0;
  for (const e of entries) {
    if (e.type !== 'expense' || !(e.at <= now)) continue;
    if (e.at >= thisWeek.start && e.at < thisWeek.end) tB += e.cents;
    else if (e.at >= lastWeek.start && e.at < lastWeek.end) lB += e.cents;
  }
  const d = checked(thisSpent - lastSpent, tB - lB);
  const receipt = {
    title: 'This week vs last week', totalLabel: 'Difference',
    lines: [
      { label: "This week's spending so far", cents: thisSpent, neutral: true },
      { label: "Last week's spending", cents: -lastSpent, neutral: true },
    ],
  };
  const ok = d.ok && Number.isSafeInteger(thisSpent) && receiptMatches(receipt, d.value);
  return {
    thisWeek, lastWeek,
    thisOut: { ...tw, receipt: tw.receipt && { ...tw.receipt, title: "This week's spending" } },
    lastOut: { ...lw, receipt: lw.receipt && { ...lw.receipt, title: "Last week's spending" } },
    diff: { ok, value: ok ? d.value : null, receipt: ok ? receipt : null },
  };
}

// ---------- This month's budget progress (Home progress bar) ----------
// With category limits: spending in those categories ÷ the total of the limits.
// Without limits: all spending ÷ the money you've had this month (carried over + in − saved).
// The percentage rounds DOWN, so it never says 100% before you actually get there.
export function budgetProgress(state, period, now, summary) {
  const b = categoryBudgets(state, period, now);
  const limited = b.rows.filter((r) => r.limit !== null);
  let spentA, spentB, base, basis, spentReceipt, baseReceipt;
  if (limited.length) {
    if (!b.total.ok || !limited.every((r) => r.spent.ok)) return { ok: false };
    basis = 'budget';
    base = b.total.limit;
    spentA = b.total.limit - b.total.value;
    spentB = sumCents(limited.map((r) => r.spent.value));
    const names = new Set(limited.map((r) => r.category));
    const items = state.entries.filter((e) => e.type === 'expense' && names.has(e.category) && e.at <= now && e.at >= period.start && e.at < period.end)
      .sort((a, b2) => (a.at < b2.at ? -1 : 1));
    spentReceipt = { title: 'Spent in categories with limits', totalLabel: 'Spent so far', lines: items.map((e) => ({ label: e.name, at: e.at, category: e.category, type: 'expense', cents: e.cents, neutral: true })) };
    baseReceipt = { title: 'Your budget', totalLabel: 'Total budget', lines: limited.map((r) => ({ label: `${r.category} limit`, cents: r.limit, neutral: true })) };
  } else {
    if (!summary.left.ok || !summary.moneyOut.ok || !summary.moneyIn.ok || !summary.saved.ok || !summary.carry.ok) return { ok: false };
    basis = 'money';
    base = summary.carry.value + summary.moneyIn.value + summary.saved.value;
    spentA = -summary.moneyOut.value;
    spentB = 0;
    for (const e of state.entries) if (e.type === 'expense' && e.at <= now && e.at >= period.start && e.at < period.end) spentB += e.cents;
    spentReceipt = { title: 'Spent this month', totalLabel: 'Spent so far', lines: (summary.moneyOut.receipt?.lines ?? []).map((l) => ({ ...l, cents: -l.cents, neutral: true })) };
    baseReceipt = { title: 'Money you had this month', totalLabel: 'Money you had', lines: [
      ...(summary.carry.value ? [{ label: `Carried over from ${summary.previousLabel}`, cents: summary.carry.value, neutral: true }] : []),
      ...(summary.moneyIn.receipt?.lines ?? []).map((l) => ({ ...l, neutral: true })),
      ...(summary.saved.receipt?.lines ?? []).map((l) => ({ ...l, neutral: true })),
    ] };
  }
  const spent = checked(spentA, spentB);
  if (!spent.ok || base <= 0) return { ok: false, empty: base <= 0, basis };
  if (!receiptMatches(spentReceipt, spent.value) || !receiptMatches(baseReceipt, base)) return { ok: false, basis };
  const pA = Math.floor((spent.value * 100) / base);
  const pB = Number((BigInt(spent.value) * 100n) / BigInt(base));
  const pct = checked(pA, pB);
  if (!pct.ok) return { ok: false, basis };
  const exact = Number((BigInt(spent.value) * 10000n) / BigInt(base)); // hundredths of a percent
  return {
    ok: true, basis, value: pct.value, spent: spent.value, base,
    receipt: { kind: 'ratio', title: basis === 'budget' ? "This month's budget" : 'Spent this month', spent: spent.value, base, exact, percent: pct.value, spentReceipt, baseReceipt, spentLabel: 'Spent so far', baseLabel: basis === 'budget' ? 'Your budget' : 'Money you had' },
  };
}

// ---------- A short, casual status line for Home ----------
export function casualStatus({ summary, snapshot, progress, period, now }) {
  if (!summary.left.ok) return null;
  if (summary.left.value < 0) return 'Slow down a bit';
  const total = daysBetween(period.start, period.end) || 1;
  const elapsed = Math.min(total, daysBetween(period.start, now.slice(0, 10) + 'T00:00') + 1);
  if (progress?.ok && progress.value > Math.floor((elapsed * 100) / total) + 10) return 'Slow down a bit';
  if (snapshot.thisOut.ok && snapshot.thisOut.value === 0) return 'Quiet week so far';
  if (snapshot.diff.ok && snapshot.lastOut.ok) {
    const last = -snapshot.lastOut.value;
    if (snapshot.diff.value >= 2000 && last > 0 && snapshot.diff.value * 4 > last) return 'Spending is up this week. Slow down a bit';
  }
  return "You're good this week";
}

// ---------- Advice notes (gentle, one at a time) ----------
function daysBetween(a, b) {
  const pa = parseStamp(a);
  const pb = parseStamp(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export function adviceNote({ budgets, summary, snapshot, period, now, dismissed = [] }) {
  const notes = [];
  const over = budgets.rows.filter((r) => r.over > 0).sort((a, b) => b.over - a.over);
  for (const r of over) {
    notes.push({ key: `over:${r.category}:${period.start}`, text: `${r.category} is ${formatCents(r.over)} over its limit. You can cover it from another category in Goals.` });
  }
  const daysLeft = Math.max(0, daysBetween(now.slice(0, 10) + 'T00:00', period.end));
  const close = budgets.rows.filter((r) => r.limit !== null && r.ok && r.over === 0 && r.percent >= 85 && r.value >= 0)
    .sort((a, b) => b.percent - a.percent);
  for (const r of close) {
    notes.push({ key: `close:${r.category}:${period.start}`, text: `${r.category} has ${formatCents(r.value)} left for the next ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}.` });
  }
  if (summary.left.ok && summary.left.value < 0) {
    notes.push({ key: `negative:${period.start}`, text: 'Spending is ahead of the money you have right now. A slower few days would help.' });
  }
  if (snapshot.diff.ok && snapshot.diff.value >= 2000) {
    const last = -snapshot.lastOut.value;
    if (last > 0 && snapshot.diff.value * 4 > last) {
      notes.push({ key: `week:${snapshot.thisWeek.start}`, text: `This week's spending is ${formatCents(snapshot.diff.value)} higher than last week.` });
    }
  }
  return notes.find((n) => !dismissed.includes(n.key)) ?? null;
}
