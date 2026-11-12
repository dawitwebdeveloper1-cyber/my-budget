// Every number shown in the app comes from here.
// Rules:
//  - all money is whole cents
//  - an entry only counts once its date and time have arrived (at <= now)
//  - every total is worked out two independent ways; if they differ the
//    number is marked not-ok and the app shows a note instead of the number
//  - every total comes with a receipt whose lines add up exactly to it

import { assertCents, sumCents } from './money.js';
import { budgetMonth, shiftBudgetMonth, inPeriod } from './dates.js';

// A refund is money back for something you bought: it goes back into that purchase's
// category (less spending there) and is never counted as income.
export const TYPES = ['income', 'expense', 'saving', 'refund'];

export function signed(e) {
  if (e.type === 'income' || e.type === 'refund') return e.cents;
  if (e.type === 'expense' || e.type === 'saving') return -e.cents;
  throw new Error(`Unknown entry type: ${e.type}`);
}

// Spending counts purchases up and refunds down.
export function spendCents(e) {
  if (e.type === 'expense') return e.cents;
  if (e.type === 'refund') return -e.cents;
  return 0;
}
export const isSpending = (e) => e.type === 'expense' || e.type === 'refund';

const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

// Compare two independently worked-out values.
export function checked(a, b) {
  const ok = Number.isSafeInteger(a) && a === b;
  return ok ? { ok: true, value: a + 0 } : { ok: false, value: null, a, b }; // + 0 turns -0 into 0
}

export function receiptTotal(receipt) {
  return sumCents(receipt.lines.map((l) => l.cents));
}

// A receipt is only usable if its lines add up exactly to the number shown.
export function receiptMatches(receipt, value) {
  return receipt != null && value != null && receiptTotal(receipt) === value;
}

function entryLine(e) {
  return { label: e.type === 'refund' ? `Refund: ${e.name}` : e.name, at: e.at, cents: signed(e), type: e.type, category: e.category };
}

function finish(result, receipt) {
  // Third safety net: the receipt must match the number exactly.
  if (result.ok && !receiptMatches(receipt, result.value)) {
    return { ok: false, value: null, receipt: null };
  }
  return { ...result, receipt: result.ok ? receipt : null };
}

// Totals for any period (day, week, budget month).
export function periodTotals(entries, period, now) {
  // ---- Way A: filter, then add up each kind separately
  const live = entries.filter((e) => e.at <= now && inPeriod(e.at, period)).sort(byTime);
  const inA = sumCents(live.filter((e) => e.type === 'income').map((e) => e.cents));
  // money out = purchases minus refunds
  const outA = sumCents(live.filter((e) => e.type === 'expense').map((e) => e.cents))
    - sumCents(live.filter((e) => e.type === 'refund').map((e) => e.cents));
  const savedA = sumCents(live.filter((e) => e.type === 'saving').map((e) => e.cents));
  const netA = inA - savedA - outA;

  // ---- Way B: one pass over everything, grouping as we go
  let inB = 0;
  let savedB = 0;
  let netB = 0;
  const groups = new Map();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!(e.at <= now) || e.at < period.start || e.at >= period.end) continue;
    assertCents(e.cents);
    netB += signed(e);
    switch (e.type) {
      case 'income': inB += e.cents; break;
      case 'saving': savedB += e.cents; break;
      case 'expense': groups.set(e.category, (groups.get(e.category) ?? 0) + e.cents); break;
      case 'refund': groups.set(e.category, (groups.get(e.category) ?? 0) - e.cents); break;
      default: throw new Error(`Unknown entry type: ${e.type}`);
    }
  }
  const outB = sumCents([...groups.values()]);

  const incomes = live.filter((e) => e.type === 'income');
  const expenses = live.filter(isSpending); // purchases and their refunds
  const savings = live.filter((e) => e.type === 'saving');

  const moneyIn = finish(checked(inA, inB), {
    title: 'Money in', totalLabel: 'Total money in',
    lines: incomes.map(entryLine),
  });
  const moneyOut = finish(checked(-outA, -outB), {
    title: 'Money out', totalLabel: 'Total money out',
    lines: expenses.map(entryLine),
  });
  const saved = finish(checked(-savedA, -savedB), {
    title: 'Moved to savings', totalLabel: 'Total moved to savings',
    lines: savings.map(entryLine),
  });
  const net = finish(checked(netA, netB), {
    title: 'This period', totalLabel: 'In minus out',
    lines: live.map(entryLine),
  });

  // Spending by category (for the ring chart)
  const catA = new Map();
  for (const e of expenses) catA.set(e.category, (catA.get(e.category) ?? 0) + spendCents(e));
  const byCategory = [...catA.entries()]
    .map(([category, cents]) => {
      const c = finish(checked(cents, groups.get(category)), {
        title: category, totalLabel: `Total ${category}`,
        lines: expenses.filter((e) => e.category === category).map(entryLine).map((l) => ({ ...l, cents: -l.cents })),
      });
      return { category, ...c };
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.category.localeCompare(b.category));
  const categoriesOk = byCategory.every((c) => c.ok)
    && moneyOut.ok
    && sumCents(byCategory.map((c) => c.value)) === -moneyOut.value
    && byCategory.length === groups.size;

  return { period, moneyIn, moneyOut, saved, net, byCategory, categoriesOk, entries: live };
}

// The Home screen: this budget month, plus what carried over from before it.
export function monthSummary(entries, period, now) {
  const totals = periodTotals(entries, period, now);

  // ---- Carry-over, Way A: add up every counted entry before this month
  const carryA = sumCents(entries.filter((e) => e.at <= now && e.at < period.start).map(signed));

  // ---- Carry-over, Way B: add up each earlier month's result, month by month
  const earliest = entries.reduce((min, e) => (e.at <= now && (min === null || e.at < min) ? e.at : min), null);
  const monthLines = [];
  if (earliest !== null && earliest < period.start) {
    let p = budgetMonth(earliest, period.startDay);
    let guard = 0;
    while (p.start < period.start && guard++ < 1200) {
      const t = periodTotals(entries, p, now);
      if (!t.net.ok) { monthLines.push(null); break; }
      if (t.entries.length > 0) monthLines.push({ label: `${p.label} result`, cents: t.net.value });
      p = shiftBudgetMonth(p, 1);
    }
  }
  const carryB = monthLines.includes(null) ? NaN : sumCents(monthLines.map((l) => l.cents));
  const prev = shiftBudgetMonth(period, -1);
  const carry = finish(checked(carryA, carryB), {
    title: `Carried over from ${prev.short}`, totalLabel: 'Carried over',
    lines: monthLines.includes(null) ? [] : monthLines,
  });

  // ---- What's left, Way A: carry + in - savings - out
  const parts = [carry, totals.moneyIn, totals.saved, totals.moneyOut];
  const leftA = parts.every((x) => x.ok) ? carry.value + totals.moneyIn.value + totals.saved.value + totals.moneyOut.value : NaN;
  // ---- What's left, Way B: the running balance of every counted entry up to now
  let leftB = 0;
  for (const e of entries) if (e.at <= now && e.at < period.end) leftB += signed(e);

  const left = finish(checked(leftA, leftB), {
    title: "What's left", totalLabel: "What's left",
    lines: [
      ...(carry.ok && carry.value !== 0 ? [{ label: carry.receipt.title, cents: carry.value, type: 'carry' }] : []),
      ...totals.entries.map(entryLine),
    ],
  });

  const net = totals.net.ok ? { ...totals.net, receipt: { ...totals.net.receipt, title: `${period.short} so far`, totalLabel: 'This month so far' } } : totals.net;
  const status = !net.ok ? 'unknown' : net.value > 0 ? 'positive' : net.value < 0 ? 'negative' : 'even';

  return { ...totals, net, carry, left, status, previousLabel: prev.short };
}
