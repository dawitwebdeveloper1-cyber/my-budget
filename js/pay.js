// Budget by paycheck: "Left until payday", "About $X a day", irregular pay, and bonus-paycheck months.
// Same rules as everywhere else: whole cents, worked out two ways, receipts that add up exactly.

import { sumCents, formatCents } from './money.js';
import { checked, receiptMatches, signed, isSpending } from './calc.js';
import { occurrenceAt, isActiveAt } from './recurring.js';
import { parseStamp, makeStamp, addDays, formatDate } from './dates.js';
import { activeRules, isPaycheck } from './ops.js';

const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
export const dayNum = (stamp) => { const p = parseStamp(stamp); return Date.UTC(p.y, p.m - 1, p.d) / 86400000; };
// Whole-number division that rounds down, for negatives too (BigInt on its own rounds toward zero).
export const floorDiv = (a, b) => { const q = a / b; return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q; };

// The repeating paycheck, if there is one (and pay isn't set to irregular).
export function payRule(state) {
  if (state.settings.payMode === 'irregular') return null;
  return activeRules(state).find((r) => r.type === 'income' && r.kind === 'paycheck') ?? null;
}

export function loggedPaychecks(state, now) {
  return state.entries.filter((e) => isPaycheck(e) && e.at <= now).sort(byTime);
}

// First occurrence of a rule after `now` (and the one before it).
function aroundNow(rule, now) {
  let k = 0;
  let guard = 0;
  while (occurrenceAt(rule, k) <= now && guard++ < 5000) k++;
  const next = occurrenceAt(rule, k);
  return { prev: k > 0 ? occurrenceAt(rule, k - 1) : null, next: isActiveAt(rule, next) ? next : null };
}

// When this pay period started (your last payday) and when the next one is.
export function payInfo(state, now) {
  const logged = loggedPaychecks(state, now);
  const lastLogged = logged.at(-1)?.at ?? null;
  const rule = payRule(state);
  if (rule) {
    const { prev, next } = aroundNow(rule, now);
    const candidates = [prev, lastLogged].filter(Boolean).sort();
    const start = candidates.at(-1) ?? null;
    return start ? { mode: 'regular', start, next, rule, estimated: false } : null;
  }
  if (!lastLogged) return null;
  // Irregular: estimate the next payday from the usual gap between recent paychecks.
  const recent = logged.slice(-4);
  let next = null;
  let overdue = false;
  if (recent.length >= 2) {
    const gaps = recent.slice(1).map((e, i) => dayNum(e.at) - dayNum(recent[i].at));
    const avgGap = Math.max(1, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length));
    const p = parseStamp(lastLogged);
    const d = addDays(p.y, p.m, p.d, avgGap);
    const est = makeStamp(d.y, d.m, d.d, p.hh, p.mi);
    next = est > now ? est : null; // overdue: "any day now"
    overdue = !next;
  }
  // (One paycheck and no schedule: no way to guess the next payday yet; next and overdue both stay empty.)
  return { mode: 'irregular', start: lastLogged, next, rule: null, estimated: true, overdue };
}

// Bills (repeating or one-off) still to come before the next payday: set aside now.
export function billsBeforePayday(state, now, next) {
  if (!next) return [];
  const out = [];
  for (const r of activeRules(state)) {
    if (r.type !== 'expense') continue;
    for (let k = r.nextIndex, guard = 0; guard < 400; k++, guard++) {
      const at = occurrenceAt(r, k);
      if (at >= next || !isActiveAt(r, at)) break;
      if (at > now) out.push({ name: r.name, cents: r.cents, at, category: r.category });
    }
  }
  for (const e of state.entries) {
    if (e.type === 'expense' && e.at > now && e.at < next) out.push({ name: e.name, cents: e.cents, at: e.at, category: e.category });
  }
  return out.sort(byTime);
}

export function leftUntilPayday(state, now) {
  const info = payInfo(state, now);
  if (!info) return { ok: false, reason: 'nopay' };
  const { start, next } = info;
  const counted = state.entries.filter((e) => e.at <= now);
  const inPeriod = counted.filter((e) => e.at >= start).sort(byTime);
  const bills = billsBeforePayday(state, now, next);

  // Way A: add up each part separately.
  const carryA = sumCents(counted.filter((e) => e.at < start).map(signed));
  const inA = sumCents(inPeriod.filter((e) => e.type === 'income').map((e) => e.cents));
  const savedA = sumCents(inPeriod.filter((e) => e.type === 'saving').map((e) => e.cents));
  const spentA = sumCents(inPeriod.filter(isSpending).map((e) => (e.type === 'expense' ? e.cents : -e.cents)));
  const billsA = sumCents(bills.map((b) => b.cents));
  const leftA = carryA + inA - savedA - spentA - billsA;

  // Way B: your balance right now (one pass over everything), minus what's set aside.
  let balance = 0;
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const e = state.entries[i];
    if (e.at <= now) balance += signed(e);
  }
  let billsB = 0;
  for (let i = bills.length - 1; i >= 0; i--) billsB += bills[i].cents;
  const left = checked(leftA, balance - billsB);

  const nextLabel = next ? formatDate(next, { weekday: true }) : null;
  const receipt = {
    title: 'Left until payday', totalLabel: 'Left until payday',
    lines: [
      ...(carryA ? [{ label: 'Left from before payday', cents: carryA, type: 'carry' }] : []),
      ...inPeriod.map((e) => ({
        label: e.type === 'refund' ? `Refund: ${e.name}` : e.name, at: e.at, cents: signed(e), type: e.type, category: e.category,
      })),
      ...bills.map((b) => ({ label: `Due before payday: ${b.name}`, at: b.at, cents: -b.cents, type: 'expense', category: b.category })),
    ],
  };
  const ok = left.ok && receiptMatches(receipt, left.value);

  // About $X a day until payday (rounded down, so it never promises more than there is).
  let perDay = null;
  if (ok && next) {
    const days = Math.max(1, dayNum(next) - dayNum(now));
    const usable = Math.max(0, left.value);
    const pdA = Math.floor(usable / days);
    const pdB = Number(BigInt(usable) / BigInt(days));
    const pd = checked(pdA, pdB);
    if (pd.ok) {
      perDay = { ok: true, value: pd.value, days, receipt: { kind: 'divide', title: 'About a day', top: usable, topLabel: 'Left until payday', by: days, byLabel: `Days until ${nextLabel}`, result: pd.value } };
    }
  }
  return {
    ok, value: ok ? left.value : null, receipt: ok ? receipt : null,
    info, next, nextLabel, bills, perDay,
  };
}

// ---------- Irregular pay ----------
// Plans with the average of the last 3 paychecks, and shows the range.
export function irregularStats(state, now) {
  const last = loggedPaychecks(state, now).slice(-3);
  if (last.length < 2) return null;
  const total = sumCents(last.map((e) => e.cents));
  const a = Math.floor(total / last.length);
  const b = Number(last.reduce((t, e) => t + BigInt(e.cents), 0n) / BigInt(last.length));
  const avg = checked(a, b);
  if (!avg.ok) return null;
  return {
    avg: avg.value, low: Math.min(...last.map((e) => e.cents)), high: Math.max(...last.map((e) => e.cents)), count: last.length,
    receipt: { kind: 'divide', title: 'Your usual paycheck', top: total, topLabel: `Last ${last.length} paychecks added up`, by: last.length, byLabel: 'Number of paychecks', result: avg.value, parts: last.map((e) => ({ label: e.name, at: e.at, cents: e.cents })) },
  };
}

// A paycheck much bigger than usual (in the last 3 days): suggest putting the extra toward goals.
export function bigPaycheck(state, now) {
  const all = loggedPaychecks(state, now);
  const latest = all.at(-1);
  if (!latest || all.length < 4 || dayNum(now) - dayNum(latest.at) > 3) return null;
  const before = all.slice(-4, -1);
  const usual = Math.floor(sumCents(before.map((e) => e.cents)) / before.length);
  const extra = latest.cents - usual;
  if (usual <= 0 || latest.cents * 2 < usual * 3 || extra < 5000) return null; // 1.5× usual and at least $50 more
  return { entry: latest, usual, extra, key: `big:${latest.id}` };
}

// ---------- Looking ahead (for goal dates and "Can I afford it?") ----------
// The usual paycheck: the scheduled amount, or the average of the last 3 when pay changes.
export function usualPaycheck(state, now) {
  const rule = payRule(state);
  if (rule) return rule.cents;
  return irregularStats(state, now)?.avg ?? null;
}

// Paydays after `now`, up to `max` of them and before `until` (a stamp).
// Irregular pay repeats the usual gap from the last paycheck; an overdue one counts as tomorrow.
export function futurePaydays(state, now, until, max = 400) {
  const out = [];
  const rule = payRule(state);
  if (rule) {
    for (let k = 0, guard = 0; out.length < max && guard < 20000; k++, guard++) {
      const at = occurrenceAt(rule, k);
      if (at >= until || !isActiveAt(rule, at)) break;
      if (at > now) out.push(at);
    }
    return out;
  }
  const logged = loggedPaychecks(state, now).slice(-4);
  if (logged.length < 2) return out;
  const gaps = logged.slice(1).map((e, i) => dayNum(e.at) - dayNum(logged[i].at));
  const gap = Math.max(1, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length));
  const last = parseStamp(logged.at(-1).at);
  const d1 = addDays(last.y, last.m, last.d, gap);
  const expected = makeStamp(d1.y, d1.m, d1.d, last.hh, last.mi);
  // Overdue ("any day now"): plan the next one for tomorrow, then the usual gap after that.
  const p = expected > now ? last : parseStamp(now);
  const firstOffset = expected > now ? gap : 1;
  for (let i = 0; out.length < max; i++) {
    const d = addDays(p.y, p.m, p.d, firstOffset + gap * i);
    const at = makeStamp(d.y, d.m, d.d, last.hh, last.mi);
    if (at >= until) break;
    if (at > now) out.push(at);
  }
  return out;
}

// What's usually left over from a paycheck after bills, spending and savings: the average of
// your last 3 complete pay periods (each one runs from a paycheck to the next).
export function usualLeftover(state, now) {
  const pays = loggedPaychecks(state, now);
  if (pays.length < 2) return null;
  const periods = [];
  for (let i = Math.max(1, pays.length - 3); i < pays.length; i++) {
    const from = pays[i - 1].at;
    const to = pays[i].at;
    const inside = state.entries.filter((e) => e.at >= from && e.at < to && e.at <= now);
    periods.push({ from, to, cents: sumCents(inside.map(signed)), count: inside.length });
  }
  const total = sumCents(periods.map((p) => p.cents));
  const a = Math.floor(total / periods.length);
  const b = Number(floorDiv(BigInt(total), BigInt(periods.length)));
  const avg = checked(a, b);
  if (!avg.ok) return null;
  return {
    ok: true, value: avg.value, periods,
    receipt: {
      kind: 'divide', title: 'Usually left from a paycheck', top: total, topLabel: `Left over in your last ${periods.length} pay ${periods.length === 1 ? 'period' : 'periods'}`,
      by: periods.length, byLabel: 'Pay periods', result: avg.value,
      parts: periods.map((p) => ({ label: `${formatDate(p.from)} to ${formatDate(p.to)}`, cents: p.cents, neutral: true })),
    },
  };
}

// ---------- Bonus-paycheck months ----------
// Every 2 weeks: some months have 3 paydays. Weekly: some have 5. Looks ahead `months` months.
export function bonusMonths(rule, fromStamp, months = 12) {
  if (!rule || (rule.freq !== 'biweekly' && rule.freq !== 'weekly')) return [];
  const usual = rule.freq === 'biweekly' ? 2 : 4;
  const from = parseStamp(fromStamp);
  const startKey = from.y * 12 + (from.m - 1);
  const endKey = startKey + months;
  const counts = new Map();
  for (let k = 0, guard = 0; guard < 2000; k++, guard++) {
    const at = occurrenceAt(rule, k);
    if (!isActiveAt(rule, at)) break;
    const p = parseStamp(at);
    const key = p.y * 12 + (p.m - 1);
    if (key >= endKey) break;
    if (key >= startKey) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, c]) => c > usual)
    .map(([key, c]) => ({ y: Math.floor(key / 12), m: (key % 12) + 1, paydays: c }));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "Heads up: March has a bonus paycheck" in the month before it, or "This month…" during it.
export function bonusHeadsUp(state, now) {
  const rule = payRule(state);
  if (!rule) return null;
  const p = parseStamp(now);
  const soon = bonusMonths(rule, makeStamp(p.y, p.m, 1), 2)[0];
  if (!soon) return null;
  const thisMonth = soon.y === p.y && soon.m === p.m;
  const extra = soon.paydays - (rule.freq === 'biweekly' ? 2 : 4);
  const word = extra === 1 ? 'a bonus paycheck' : `${extra} bonus paychecks`;
  return {
    key: `bonus:${soon.y}-${soon.m}`,
    text: thisMonth
      ? `This month has ${word} (${soon.paydays} paydays). Consider putting one toward a goal.`
      : `Heads up: ${MONTHS[soon.m - 1]} has ${word} (${soon.paydays} paydays).`,
  };
}

export { formatCents };
