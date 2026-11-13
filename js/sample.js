// "Look around with example data": made-up entries built fresh around today's date.
// They live only in memory: nothing here is ever saved, and Exit (or closing the app) removes all of it.

import { freshState } from './store.js';
import { parseStamp, makeStamp, addDays } from './dates.js';
import { runRecurring } from './ops.js';

export function sampleState(now) {
  const s = freshState();
  s.settings.setupDone = true;
  let n = 0;
  const id = () => `sample-${++n}`;
  const p = parseStamp(now);
  const day = (back, hh = 12, mi = 0) => { const d = addDays(p.y, p.m, p.d, -back); return makeStamp(d.y, d.m, d.d, hh, mi); };
  const created = (at) => { const q = parseStamp(at); return new Date(q.y, q.m - 1, q.d, q.hh, q.mi).toISOString(); };

  // A paycheck every 2 weeks on Fridays; the last one landed 2 to 8 days ago.
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  let sinceFriday = (dow - 5 + 7) % 7;
  if (sinceFriday < 2) sinceFriday += 7;
  s.goals.push(
    { id: 'sample-goal-1', name: 'Emergency fund', targetCents: 300000, createdAt: '' },
    { id: 'sample-goal-2', name: 'Trip to Banff', targetCents: 120000, createdAt: '' },
  );
  s.settings.autoSave = [{ goalId: 'sample-goal-1', bp: 1000 }];
  const rules = [
    { id: 'sample-pay', type: 'income', kind: 'paycheck', name: 'Paycheck', cents: 142000, category: 'Paycheck', freq: 'biweekly', anchor: day(sinceFriday + 42, 9) },
    { id: 'sample-rent', type: 'expense', kind: 'bill', name: 'Rent', cents: 120000, category: 'Housing', freq: 'monthly', anchor: firstOfMonth(p, -1) },
    { id: 'sample-phone', type: 'expense', kind: 'bill', name: 'Phone', cents: 4500, category: 'Bills', freq: 'monthly', anchor: day(40, 9) },
    { id: 'sample-netflix', type: 'expense', kind: 'subscription', name: 'Netflix', cents: 1699, category: 'Fun', freq: 'monthly', anchor: day(52, 9), uses: [] },
  ];
  for (const r of rules) s.recurring.push({ nextIndex: 0, endAt: null, ...r });
  runRecurring(s, now, id, { notify: false });

  // Everyday spending over the last 6 weeks (the same every time, so it reads like a real month).
  const daily = [
    ['No Frills', 'Groceries', 8640], ['Tim Hortons', 'Eating Out', 545], ['Petro-Canada', 'Transport', 5200],
    ['Shoppers Drug Mart', 'Health', 1899], ['Lunch with Sam', 'Eating Out', 2350], ['Walmart', 'Shopping', 3412],
    ['Save-On-Foods', 'Groceries', 6215], ['Movie night', 'Fun', 2400], ['Bus pass', 'Transport', 330],
  ];
  for (let back = 42, i = 0; back >= 0; back--) {
    if (back > 7 ? back % 7 === 3 || back % 5 === 1 : back === 4) continue; // some no-spend days (just one this week)
    const [name, category, cents] = daily[i++ % daily.length];
    const at = day(back, 12 + (i % 6), (i * 7) % 60);
    if (at > now) continue;
    s.entries.push({ id: id(), type: 'expense', name, cents, at, category, note: '', createdAt: created(at) });
  }
  const topUp = day(20, 19);
  s.entries.push({ id: id(), type: 'saving', name: 'To Trip to Banff', cents: 25000, at: topUp, category: 'Savings', note: '', goalId: 'sample-goal-2', createdAt: created(topUp) });
  const refund = day(9, 15);
  s.entries.push({ id: id(), type: 'refund', name: 'Walmart', cents: 1299, at: refund, category: 'Shopping', note: '', createdAt: created(refund) });
  s.limits = { Groceries: 45000, 'Eating Out': 15000 };
  s.celebrated = [];
  s.notice = [];
  s.lastCheckin = s.entries.filter((e) => e.category === 'Paycheck').at(-1)?.id ?? null; // no check-in pop-up in the example
  return s;
}

function firstOfMonth(p, delta) {
  const idx = p.y * 12 + (p.m - 1) + delta;
  return makeStamp(Math.floor(idx / 12), (idx % 12) + 1, 1, 9, 0);
}
