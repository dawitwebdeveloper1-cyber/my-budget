// Keep people coming back, gently: a forgiving streak, the payday check-in, weekly wins and the
// monthly recap's extras. Never invents a win: if there's nothing true and positive to say, it says nothing.

import { sumCents, formatCents } from './money.js';
import { checked, receiptMatches, spendCents, isSpending } from './calc.js';
import { makeStamp, toStamp, weekOf, shiftWeek } from './dates.js';
import { goalProgress } from './budget.js';
import { loggedPaychecks, leftUntilPayday, dayNum } from './pay.js';

const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
const dayKeyOf = (n) => { const d = new Date(n * 86400000); return makeStamp(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()).slice(0, 10); };

// ---------- Logging days ----------
// The days you logged something yourself (not repeating items or auto-savings added for you).
// It's the day you logged it that counts, even if the entry is dated earlier.
export function loggingDays(state) {
  const days = new Set();
  for (const e of state.entries) {
    if (e.auto || e.parentId) continue;
    let day = e.at.slice(0, 10);
    if (e.createdAt) {
      const t = new Date(e.createdAt);
      if (!Number.isNaN(t.getTime())) day = toStamp(t).slice(0, 10);
    }
    days.add(day);
  }
  return days;
}

// ---------- Forgiving streak ----------
// Counts your logging days. One missed day a week is a free skip; a second one pauses the streak
// (the number waits for you instead of going back to zero). Logging again carries on from there.
export function streak(state, now, weekStart = 1) {
  const days = loggingDays(state);
  if (!days.size) return null;
  const today = now.slice(0, 10);
  const todayN = dayNum(now);
  const count = [...days].filter((d) => d <= today).length;
  const week = weekOf(now, weekStart);
  const first = [...days].sort()[0];
  let misses = 0;
  for (let n = Math.max(dayNum(week.start), dayNum(`${first}T00:00`)); n < todayN; n++) {
    if (!days.has(dayKeyOf(n))) misses++;
  }
  const loggedToday = days.has(today);
  const paused = !loggedToday && misses >= 2;
  return { count, paused, skipUsed: misses === 1, loggedToday, misses };
}

export function streakText(s) {
  if (!s || s.count < 2) return null;
  return `${s.count}-day streak${s.paused ? ' · paused' : ''}`;
}

// ---------- Spending by category between two moments ----------
function spendingIn(state, from, to, now) {
  return state.entries.filter((e) => isSpending(e) && e.at >= from && e.at < to && e.at <= now).sort(byTime);
}

// ---------- Payday check-in ----------
// Once per paycheck, in the 3 days after it arrives: what came in, what got saved, and how the last
// paycheck went compared with the one before.
export function paydayCheckin(state, now) {
  const pays = loggedPaychecks(state, now);
  const p = pays.at(-1);
  if (!p || dayNum(now) - dayNum(p.at) > 3 || state.lastCheckin === p.id) return null;
  const saved = state.entries.filter((e) => e.type === 'saving' && e.parentId === p.id);
  const savedTotal = sumCents(saved.map((e) => e.cents));
  const out = { paycheck: p, saved, savedTotal, compare: null };
  const lup = leftUntilPayday(state, now);
  if (lup.ok) out.lup = lup;

  // How the last paycheck went: [previous payday, this payday) vs the one before it.
  const i = pays.length - 1;
  if (i >= 2) {
    const a = spendingIn(state, pays[i - 1].at, p.at, now); // the paycheck that just ended
    const b = spendingIn(state, pays[i - 2].at, pays[i - 1].at, now); // the one before
    const cats = new Set([...a, ...b].map((e) => e.category));
    const by = (list, c) => sumCents(list.filter((e) => e.category === c).map(spendCents));
    const changes = [...cats].map((c) => ({ category: c, now: by(a, c), before: by(b, c) })).map((x) => ({ ...x, less: x.before - x.now }));
    const best = changes.filter((x) => x.less >= 100).sort((x, y) => y.less - x.less)[0];
    const totalA = sumCents(a.map(spendCents));
    const totalB = sumCents(b.map(spendCents));
    if (best) {
      const items = [...b.filter((e) => e.category === best.category), ...a.filter((e) => e.category === best.category)];
      const receipt = {
        title: `${best.category}: last two paychecks`, totalLabel: 'Less this time',
        lines: items.map((e) => {
          const before = e.at < pays[i - 1].at;
          return { label: `${before ? 'Paycheck before' : 'Last paycheck'}: ${e.type === 'refund' ? `Refund: ${e.name}` : e.name}`, at: e.at, cents: before ? spendCents(e) : -spendCents(e), neutral: true };
        }),
      };
      let bWay = 0;
      for (const e of items) bWay += e.at < pays[i - 1].at ? spendCents(e) : -spendCents(e);
      const v = checked(best.less, bWay);
      if (v.ok && receiptMatches(receipt, v.value)) {
        out.compare = { ok: true, value: v.value, receipt, text: `You spent ${formatCents(v.value)} less on ${best.category} than the paycheck before.` };
      }
    } else if (a.length || b.length) {
      // Nothing went down: just the plain facts, no spin.
      const diff = totalA - totalB;
      out.compare = { ok: true, value: null, text: diff > 0
        ? `Last paycheck you spent ${formatCents(totalA)}, ${formatCents(diff)} more than the one before.`
        : `Last paycheck you spent ${formatCents(totalA)}, about the same as the one before.` };
    }
  }
  return out;
}

// ---------- Weekly wins ----------
// In the first 3 days of a week, one small true fact about last week. Nothing true and positive → nothing.
export function weeklyWin(state, now, weekStart = 1) {
  const thisWeek = weekOf(now, weekStart);
  if (dayNum(now) - dayNum(thisWeek.start) > 2) return null;
  const last = shiftWeek(thisWeek, -1);
  const before = shiftWeek(thisWeek, -2);
  const key = `win:${last.start}`;
  const days = loggingDays(state);
  const loggedIn = (w) => [...days].filter((d) => d >= w.start.slice(0, 10) && d < w.end.slice(0, 10)).length;
  const inWeek = (w, pred) => state.entries.filter((e) => e.at >= w.start && e.at < w.end && e.at <= now && pred(e));

  // 1. Saved more than the week before.
  const sLast = inWeek(last, (e) => e.type === 'saving');
  const sBefore = inWeek(before, (e) => e.type === 'saving');
  const savedMore = sumCents(sLast.map((e) => e.cents)) - sumCents(sBefore.map((e) => e.cents));
  if (sLast.length && savedMore >= 100) {
    const receipt = { title: 'Saved: last week vs the week before', totalLabel: 'More saved last week', lines: [
      ...sLast.map((e) => ({ label: e.name, at: e.at, cents: e.cents, neutral: true })),
      ...sBefore.map((e) => ({ label: `Week before: ${e.name}`, at: e.at, cents: -e.cents, neutral: true })),
    ] };
    if (receiptMatches(receipt, savedMore)) return { key, text: `Last week you saved ${formatCents(savedMore)} more than the week before.`, result: { ok: true, value: savedMore, receipt } };
  }

  // 2. Spent less than the week before (only when both weeks were really logged).
  if (loggedIn(last) >= 3 && loggedIn(before) >= 3) {
    const xLast = inWeek(last, isSpending);
    const xBefore = inWeek(before, isSpending);
    const less = sumCents(xBefore.map(spendCents)) - sumCents(xLast.map(spendCents));
    if (less >= 1000) {
      const receipt = { title: 'Spending: last week vs the week before', totalLabel: 'Less spent last week', lines: [
        ...xBefore.map((e) => ({ label: `Week before: ${e.name}`, at: e.at, cents: spendCents(e), neutral: true })),
        ...xLast.map((e) => ({ label: e.name, at: e.at, cents: -spendCents(e), neutral: true })),
      ] };
      if (receiptMatches(receipt, less)) return { key, text: `Last week you spent ${formatCents(less)} less than the week before.`, result: { ok: true, value: less, receipt } };
    }
  }

  // 3. No-spend days (only counted in a week you logged on at least 4 days).
  if (loggedIn(last) >= 4) {
    const spendDays = new Set(inWeek(last, (e) => e.type === 'expense').map((e) => e.at.slice(0, 10)));
    const free = 7 - spendDays.size;
    if (free >= 2) return { key, text: `${free} no-spend days last week.` };
  }

  // 4. Goal progress.
  for (const g of state.goals) {
    const added = inWeek(last, (e) => e.type === 'saving' && e.goalId === g.id);
    const cents = sumCents(added.map((e) => e.cents));
    if (cents > 0) {
      const p = goalProgress(g, state.entries, now);
      if (!p.ok) continue;
      const receipt = { title: `${g.name}: last week`, totalLabel: 'Added last week', lines: added.map((e) => ({ label: e.name, at: e.at, cents: e.cents, type: 'saving-in' })) };
      if (receiptMatches(receipt, cents)) {
        return { key, text: p.reached ? `${g.name} grew ${formatCents(cents)} last week, and it's reached.` : `${g.name} grew ${formatCents(cents)} last week. It's ${p.percent}% there.`, result: { ok: true, value: cents, receipt } };
      }
    }
  }
  return null;
}

// ---------- Monthly recap extras ----------
// Best week: the full week inside the month with the least spending (only weeks you logged in).
export function bestWeek(state, period, now, weekStart = 1) {
  const days = loggingDays(state);
  let w = weekOf(period.start, weekStart);
  if (w.start < period.start) w = shiftWeek(w, 1);
  const weeks = [];
  for (; w.end <= period.end && w.end <= now; w = shiftWeek(w, 1)) {
    const logged = [...days].filter((d) => d >= w.start.slice(0, 10) && d < w.end.slice(0, 10)).length;
    if (logged < 3) continue;
    const items = spendingIn(state, w.start, w.end, now);
    weeks.push({ week: w, cents: sumCents(items.map(spendCents)), items });
  }
  if (weeks.length < 2) return null;
  const best = weeks.sort((a, b) => a.cents - b.cents)[0];
  const receipt = { title: `Week of ${best.week.label}`, totalLabel: 'Spent that week', lines: best.items.map((e) => ({ label: e.name, at: e.at, category: e.category, cents: spendCents(e), neutral: true })) };
  if (!receiptMatches(receipt, best.cents)) return null;
  return { ok: true, value: best.cents, receipt, label: best.week.label, text: `Best week: ${best.week.label}, ${formatCents(Math.max(0, best.cents))} spent.` };
}

// Goals: what went in during the month, and how far along each one is now.
export function goalMonth(state, period, now) {
  return state.goals.map((g) => {
    const added = state.entries.filter((e) => e.type === 'saving' && e.goalId === g.id && e.at >= period.start && e.at < period.end && e.at <= now);
    const cents = sumCents(added.map((e) => e.cents));
    const p = goalProgress(g, state.entries, now);
    if (!p.ok) return null;
    return { goal: g, cents, percent: p.percent, reached: p.reached,
      result: { ok: true, value: cents, receipt: { title: `${g.name}: ${period.short}`, totalLabel: 'Added this month', lines: added.map((e) => ({ label: e.name, at: e.at, cents: e.cents, type: 'saving-in' })) } } };
  }).filter((x) => x && (x.cents > 0 || !x.reached));
}
