// Decision tools: goal finish dates, "Can I afford it?", what-if practice, subscriptions, cost per use.
// Same rules as everywhere else: whole cents, every answer worked out two ways, receipts that add up.

import { sumCents, formatCents } from './money.js';
import { checked, receiptMatches } from './calc.js';
import { parseStamp, makeStamp, addDays, formatDate } from './dates.js';
import { goalProgress, splitAcrossGoals } from './budget.js';
import { leftUntilPayday, usualPaycheck, futurePaydays, usualLeftover, dayNum } from './pay.js';
import { activeRules } from './ops.js';
import { occurrenceAt, isActiveAt } from './recurring.js';

const HORIZON_DAYS = 3653; // look up to 10 years ahead
const TOPUP_DAYS = 90;     // "your usual top-ups": what you added by hand in the last 90 days

const dayStamp = (now, n) => { const p = parseStamp(now); const d = addDays(p.y, p.m, p.d, n); return makeStamp(d.y, d.m, d.d, 23, 59); };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------- How fast a goal is filling ----------
// Auto-save: the goal's share of your usual paycheck. Top-ups: what you added by hand in the last 90 days.
export function goalPace(state, goal, now, { extraPerPaycheck = 0 } = {}) {
  const usual = usualPaycheck(state, now);
  const plan = (state.settings.autoSave ?? []).map((p) => ({ ...p, name: state.goals.find((g) => g.id === p.goalId)?.name })).filter((p) => p.name);
  let share = 0;
  let bp = 0;
  if (usual && plan.some((p) => p.goalId === goal.id && p.bp > 0)) {
    const split = splitAcrossGoals(usual, plan);
    const mine = split.ok ? split.shares.find((s) => s.goalId === goal.id) : null;
    share = mine?.cents ?? 0;
    bp = mine?.bp ?? 0;
  }
  const since = (() => { const p = parseStamp(now); const d = addDays(p.y, p.m, p.d, -TOPUP_DAYS); return makeStamp(d.y, d.m, d.d, p.hh, p.mi); })();
  const topUps = state.entries.filter((e) => e.type === 'saving' && e.goalId === goal.id && !e.parentId && e.at > since && e.at <= now);
  const topUp90 = sumCents(topUps.map((e) => e.cents));
  return { usual, share, bp, extra: extraPerPaycheck, perPaycheck: share + extraPerPaycheck, topUp90, topUps };
}

// When a goal is reached at this pace. savedDelta: pretend money was taken out (negative) or added.
export function goalForecast(state, goal, now, { extraPerPaycheck = 0, savedDelta = 0 } = {}) {
  const prog = goalProgress(goal, state.entries, now);
  if (!prog.ok) return { ok: false };
  const saved = Math.max(0, prog.value + savedDelta);
  const target = goal.targetCents;
  const toGo = target - saved;
  const pace = goalPace(state, goal, now, { extraPerPaycheck });
  const base = { ok: true, goal, saved, target, toGo: Math.max(0, toGo), pace, savedDelta };
  if (toGo <= 0) return { ...base, done: true };
  if (pace.perPaycheck <= 0 && pace.topUp90 <= 0) return { ...base, none: true };

  const until = dayStamp(now, HORIZON_DAYS + 1);
  const paydays = pace.perPaycheck > 0 ? futurePaydays(state, now, until, 20000) : [];
  if (pace.perPaycheck > 0 && !paydays.length && pace.topUp90 <= 0) return { ...base, none: true };
  const paydayDays = paydays.map((at) => dayNum(at) - dayNum(now)); // days from today, ascending
  const by = (day, nPays) => pace.perPaycheck * nPays + Math.floor((pace.topUp90 * day) / TOPUP_DAYS);

  // Way A: step forward one day at a time.
  let dayA = null;
  let pi = 0;
  for (let day = 1; day <= HORIZON_DAYS; day++) {
    while (pi < paydayDays.length && paydayDays[pi] <= day) pi++;
    if (by(day, pi) >= toGo) { dayA = day; break; }
  }
  // Way B: binary search on the day (the amount only ever grows), counting paydays a different way.
  const paysBy = (day) => { let lo = 0; let hi = paydayDays.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (paydayDays[mid] <= day) lo = mid + 1; else hi = mid; } return lo; };
  const amountB = (day) => Number(BigInt(pace.perPaycheck) * BigInt(paysBy(day)) + (BigInt(pace.topUp90) * BigInt(day)) / BigInt(TOPUP_DAYS));
  let dayB = null;
  if (amountB(HORIZON_DAYS) >= toGo) {
    let lo = 1; let hi = HORIZON_DAYS;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (amountB(mid) >= toGo) hi = mid; else lo = mid + 1; }
    dayB = lo;
  }
  if (dayA === null && dayB === null) return { ...base, beyond: true };
  const day = checked(dayA ?? -1, dayB ?? -1);
  if (!day.ok) return { ok: false };
  const nPays = paysBy(day.value);
  const fromPays = pace.perPaycheck * nPays;
  const fromTopUps = Math.floor((pace.topUp90 * day.value) / TOPUP_DAYS);
  const at = dayStamp(now, day.value);
  return {
    ...base, days: day.value, at, label: formatDate(at, { year: parseStamp(at).y !== parseStamp(now).y }), nPays, fromPays, fromTopUps,
    receipt: { kind: 'forecast', title: `${goal.name}: finish date` },
  };
}

// The short line under a goal: "At this pace, $2,000 by Jun 14".
export function forecastText(f) {
  if (!f?.ok) return null;
  if (f.done) return null;
  if (f.none) return 'Add money or turn on auto-save to see a finish date';
  if (f.beyond) return 'At this pace, more than 10 years away';
  return `At this pace, ${formatCents(f.target)} by ${f.label}`;
}

// ---------- Can I afford it? ----------
// Yes: it fits in what's left until payday. Yes, but: the gap could come out of a goal (the one
// furthest from finishing, so nearly-done goals aren't touched). Not yet: how many paychecks it takes.
export function canAfford(state, now, price) {
  if (!Number.isSafeInteger(price) || price <= 0) return { ok: false, reason: 'price' };
  const lup = leftUntilPayday(state, now);
  if (!lup.ok) return { ok: false, reason: lup.reason ?? 'unverified' };
  const L = lup.value;
  const stale = staleNote(state, now);
  const base = { ok: true, price, left: L, lup, stale };

  if (price <= L) {
    const after = L - price;
    const receipt = { title: 'Can I afford it?', totalLabel: 'Left until payday after buying it', lines: [
      { label: 'Left until payday', cents: L, type: 'carry' },
      { label: 'This purchase', cents: -price, type: 'expense' },
    ] };
    const v = checked(after, L + -price);
    if (!v.ok || !receiptMatches(receipt, v.value)) return { ok: false, reason: 'unverified' };
    let perDay = null;
    if (lup.next && lup.perDay) {
      const days = lup.perDay.days;
      const pd = checked(Math.floor(after / days), Number(BigInt(after) / BigInt(days)));
      if (pd.ok) perDay = { ok: true, value: pd.value, days, receipt: { kind: 'divide', title: 'About a day', top: after, topLabel: 'Left until payday after buying it', by: days, byLabel: `Days until ${lup.nextLabel}`, result: pd.value } };
    }
    return { ...base, verdict: 'yes', value: after, receipt, after, perDay };
  }

  const gap = price - L; // what's missing (includes any overdraft already there)
  // Yes, but: one goal that already holds the gap.
  const options = [];
  for (const g of state.goals) {
    const before = goalForecast(state, g, now);
    if (!before.ok || before.done || before.saved < gap) continue;
    const after = goalForecast(state, g, now, { savedDelta: -gap });
    options.push({ goal: g, before, after });
  }
  if (options.length) {
    const far = (o) => (o.before.days ?? Infinity);
    options.sort((a, b) => far(b) - far(a) || a.before.saved / a.before.target - b.before.saved / b.before.target);
    const pick = options[0];
    const pushed = pick.before.days != null && pick.after.days != null ? pick.after.days - pick.before.days : null;
    const receipt = { title: 'Can I afford it?', totalLabel: 'Left until payday after buying it', lines: [
      { label: 'Left until payday', cents: L, type: 'carry' },
      { label: 'This purchase', cents: -price, type: 'expense' },
      { label: `Taken from ${pick.goal.name}`, cents: gap, type: 'saving-in' },
    ] };
    if (!receiptMatches(receipt, 0)) return { ok: false, reason: 'unverified' };
    return { ...base, verdict: 'yesbut', value: 0, receipt, gap, goal: pick.goal, before: pick.before, after: pick.after, pushed };
  }

  // Not yet: the gap ÷ what's usually left over from a paycheck, rounded up.
  const receipt = { title: 'Can I afford it?', totalLabel: 'Short by', lines: [
    { label: 'Left until payday', cents: L, type: 'carry' },
    { label: 'This purchase', cents: -price, type: 'expense' },
  ] };
  if (!receiptMatches(receipt, -gap)) return { ok: false, reason: 'unverified' };
  const lo = usualLeftover(state, now);
  let paychecks = null;
  if (lo?.ok && lo.value > 0) {
    const n = checked(Math.ceil(gap / lo.value), Number((BigInt(gap) + BigInt(lo.value) - 1n) / BigInt(lo.value)));
    if (n.ok) {
      const pays = futurePaydays(state, now, dayStamp(now, HORIZON_DAYS + 1), n.value);
      paychecks = {
        ok: true, value: n.value, leftover: lo, when: pays.length >= n.value ? pays[n.value - 1] : null,
        receipt: { kind: 'divide', byMoney: true, roundUp: true, title: 'How many paychecks', top: gap, topLabel: 'Short by', by: lo.value, byLabel: 'Usually left from a paycheck', result: n.value, resultLabel: 'Paychecks (rounded up)' },
      };
    }
  }
  return { ...base, verdict: 'notyet', value: -gap, receipt, gap, paychecks, leftover: lo };
}

// "Based on entries up to Tuesday." when nothing's been logged for 3+ days.
export function staleNote(state, now) {
  let last = null;
  for (const e of state.entries) if (!e.auto && !e.parentId && e.at <= now && (!last || e.at > last)) last = e.at;
  if (!last) return null;
  const days = dayNum(now) - dayNum(last);
  if (days < 3) return null;
  const p = parseStamp(last);
  const when = days < 7 ? DAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()] : formatDate(last);
  return `Based on entries up to ${when}.`;
}

// ---------- What-if practice ----------
// "What if I cut Eating Out by $40 a paycheck and put it toward Trip?" Nothing is saved.
export function whatIf(state, now, { goalId, perPaycheck }) {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal || !Number.isSafeInteger(perPaycheck) || perPaycheck <= 0) return { ok: false };
  const before = goalForecast(state, goal, now);
  const after = goalForecast(state, goal, now, { extraPerPaycheck: perPaycheck });
  if (!before.ok || !after.ok) return { ok: false };
  const sooner = before.days != null && after.days != null ? before.days - after.days : null;
  return { ok: true, goal, before, after, sooner, noPaydays: !futurePaydays(state, now, dayStamp(now, 400), 1).length };
}

// Usual spending in a category per pay period (last 3 complete periods), for the what-if hint.
export function usualCategorySpend(state, now, category) {
  const lo = usualLeftover(state, now);
  if (!lo?.ok) return null;
  const totals = lo.periods.map((p) => sumCents(state.entries
    .filter((e) => e.at >= p.from && e.at < p.to && e.category === category && (e.type === 'expense' || e.type === 'refund'))
    .map((e) => (e.type === 'expense' ? e.cents : -e.cents))));
  return Math.max(0, Math.floor(sumCents(totals) / totals.length));
}

// ---------- Subscriptions ----------
const PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, yearly: 1 };
const PER_YEAR_LABEL = { weekly: '52 weeks', biweekly: '26 paydays', semimonthly: '24 times', monthly: '12 months', yearly: '1 year' };
const SUB_RE = /\b(netflix|spotify|disney|crave|prime|amazon prime|apple|icloud|youtube|hulu|paramount|audible|kindle|xbox|playstation|ps ?plus|nintendo|game ?pass|adobe|microsoft|office ?365|dropbox|google (one|storage)|chatgpt|openai|claude|patreon|onlyfans|twitch|gym|fitness|goodlife|planet fitness|peloton|duolingo|headspace|calm|membership|subscription|club|news|times|globe|magazine|vpn|nordvpn|expressvpn|uber one|doordash|dashpass|skip|instacart|hellofresh|stream|music|tidal|deezer|sirius)\b/i;

export function looksLikeSubscription(name) {
  return SUB_RE.test(String(name ?? ''));
}

export function subscriptions(state) {
  return activeRules(state).filter((r) => r.type === 'expense' && r.kind === 'subscription');
}

export function yearlyCost(rule) {
  return rule.cents * (PER_YEAR[rule.freq] ?? 0);
}

export function subscriptionTotal(state) {
  const subs = subscriptions(state);
  const a = sumCents(subs.map(yearlyCost));
  let b = 0;
  for (let i = subs.length - 1; i >= 0; i--) b += Number(BigInt(subs[i].cents) * BigInt(PER_YEAR[subs[i].freq] ?? 0));
  const total = checked(a, b);
  const receipt = {
    title: 'Subscriptions per year', totalLabel: 'A year',
    lines: subs.map((r) => ({ label: `${r.name}: ${formatCents(r.cents)} × ${PER_YEAR_LABEL[r.freq]}`, cents: yearlyCost(r), neutral: true })),
  };
  const ok = total.ok && receiptMatches(receipt, total.value);
  return { ok, value: ok ? total.value : null, receipt: ok ? receipt : null, count: subs.length };
}

// Every 3 months, ask "Still using this?" for each subscription.
export function checkupDue(state, now) {
  return subscriptions(state).filter((r) => {
    const since = r.checkedAt ?? r.anchor;
    return since <= now && dayNum(now) - dayNum(since) >= 90;
  });
}

// ---------- Cost per use ----------
const CYCLE = { weekly: 'this week', biweekly: 'in the last 2 weeks', semimonthly: 'this half-month', monthly: 'this month', yearly: 'this year' };
const EVERY = { weekly: 'a week', biweekly: 'every 2 weeks', semimonthly: 'twice a month', monthly: 'a month', yearly: 'a year' };

// The start of a schedule's current cycle: its latest date that has arrived.
function cycleStart(rule, now) {
  let prev = null;
  for (let k = 0, guard = 0; guard < 20000; k++, guard++) {
    const at = occurrenceAt(rule, k);
    if (at > now || !isActiveAt(rule, at)) break;
    prev = at;
  }
  return prev;
}

// Subscription: price per cycle ÷ uses this cycle. Purchase: price ÷ every use so far.
export function costPerUse(item, now) {
  if (!Array.isArray(item.uses)) return null;
  const isRule = 'freq' in item;
  const from = isRule ? cycleStart(item, now) : item.at;
  const uses = from ? item.uses.filter((u) => u >= from && u <= now).length : 0;
  const head = isRule ? `${formatCents(item.cents)} ${EVERY[item.freq]}` : formatCents(item.cents);
  if (!uses) {
    return { ok: true, uses: 0, value: null, text: isRule ? `${head}, not used yet ${CYCLE[item.freq]}` : `${head}, not used yet` };
  }
  const per = checked(Math.floor(item.cents / uses), Number(BigInt(item.cents) / BigInt(uses)));
  if (!per.ok) return { ok: false };
  const times = uses === 1 ? 'once' : `${uses} times`;
  return {
    ok: true, uses, value: per.value,
    text: `${head}, used ${times}${isRule ? ` ${CYCLE[item.freq]}` : ''}, that's ${formatCents(per.value)} a use`,
    receipt: { kind: 'divide', title: `${item.name}: cost per use`, top: item.cents, topLabel: isRule ? `Cost ${EVERY[item.freq]}` : 'Price', by: uses, byLabel: isRule ? `Uses ${CYCLE[item.freq]}` : 'Uses so far', result: per.value, resultLabel: 'Each use (rounded down)' },
  };
}

// Items with a use counter turned on: subscriptions (schedules) and one-off purchases.
export function trackedItems(state) {
  return [
    ...subscriptions(state).filter((r) => Array.isArray(r.uses)).map((r) => ({ kind: 'rule', item: r })),
    ...state.entries.filter((e) => e.type === 'expense' && Array.isArray(e.uses)).map((e) => ({ kind: 'entry', item: e })),
  ];
}
