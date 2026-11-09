import { h, s as svg, icon } from '../ui.js';
import { app, persist } from '../state.js';
import { formatCents } from '../money.js';
import { budgetMonth, shiftBudgetMonth, parseStamp } from '../dates.js';
import { monthSummary } from '../calc.js';
import { categoryBudgets, weeklySnapshot, adviceNote } from '../budget.js';
import { money, howButton, openReceipt, UNVERIFIED, categoryColour } from '../components.js';
import { openRecap } from './recap.js';
import { backupDue } from '../backup.js';
import { hasVault } from '../vault.js';
import { openPasscodeSetup } from '../lock.js';
import { openSettings } from '../sheets/settings.js';

export function renderHome(now) {
  const st = app.state;
  const period = budgetMonth(now, st.settings.monthStartDay);
  const sum = monthSummary(st.entries, period, now);

  const statusText = {
    positive: "You're ahead this month",
    negative: "You're behind this month",
    even: 'Even so far this month',
    unknown: UNVERIFIED,
  }[sum.status];

  const hero = h('section', { class: 'card hero fade-in' },
    h('div', { class: 'label' }, "What's left"),
    sum.left.ok
      ? h('span', { class: `big num ${sum.left.value < 0 ? 'neg' : ''}` }, formatCents(sum.left.value))
      : h('p', { class: 'unverified' }, UNVERIFIED),
    h('div', { class: 'hero-foot' },
      h('button', { class: `status ${sum.status}`, onClick: () => sum.net.ok && openReceipt(sum.net) },
        h('span', { class: 'dot' }),
        h('span', {}, statusText),
        sum.net.ok ? h('span', { class: `num ${sum.net.value > 0 ? 'in' : sum.net.value < 0 ? 'out' : ''}` }, formatCents(sum.net.value, { sign: 'always' })) : null),
      sum.left.ok ? howButton(sum.left) : null));

  // One gentle line at a time: passcode set-up first, then backup, then spending advice.
  let advice = null;
  const backupDays = backupDue(st.settings, st.entries.length > 0, now);
  if (!hasVault() && st.entries.length > 0) {
    advice = h('button', { class: 'advice action fade-in', onClick: () => openPasscodeSetup() },
      h('span', {}, "Your data isn't locked yet. Set a passcode to encrypt it."), icon('right'));
  } else if (backupDays !== null) {
    advice = h('button', { class: 'advice action fade-in', onClick: () => openSettings('backup') },
      h('span', {}, backupDays === Infinity ? "You haven't made a backup yet. Tap to save one." : `It's been ${backupDays} days since your last backup. Tap to save one.`), icon('right'));
  } else if (st.settings.adviceOn) {
    const note = adviceNote({
      budgets: categoryBudgets(st, period, now), summary: sum,
      snapshot: weeklySnapshot(st.entries, now, st.settings.weekStartDay),
      period, now, dismissed: st.dismissedAdvice,
    });
    if (note) {
      advice = h('div', { class: 'advice fade-in', role: 'note' },
        h('span', {}, note.text),
        h('button', { class: 'advice-x', 'aria-label': 'Dismiss note', onClick: () => { st.dismissedAdvice.push(note.key); persist(); app.render(); } }, icon('close')));
    }
  }

  // Month-end summary: offered for the first week of a new month
  const prev = shiftBudgetMonth(period, -1);
  const dayIntoMonth = daysSince(period.start, now);
  const hadLastMonth = st.entries.some((e) => e.at >= prev.start && e.at < prev.end);
  const recapLink = dayIntoMonth < 7 && hadLastMonth
    ? h('button', { class: 'recap-link fade-in', onClick: () => openRecap(prev, now) },
      h('span', {}, `Your ${prev.short} recap`), icon('right'))
    : null;

  const row = (label, result, kind) => h('button', { class: 'row', onClick: () => openReceipt(result), disabled: !result.ok },
    h('span', { class: 'name' }, h('span', {}, label)),
    result.ok ? money(result.value, { kind: result.value === 0 ? 'zero' : kind }) : h('span', { class: 'unverified' }, 'Hidden'),
    h('span', { class: 'how-ic', 'aria-label': 'Show me how' }, icon('receipt')));

  const lines = h('section', { class: 'card fade-in' },
    h('h2', {}, 'This month'),
    h('div', { class: 'rows' },
      row(`Carried over from ${sum.previousLabel}`, sum.carry, sum.carry.value < 0 ? 'out' : 'in'),
      row('Money in', sum.moneyIn, 'in'),
      sum.saved.ok && sum.saved.value !== 0 ? row('Moved to savings', sum.saved, 'save') : null,
      row('Money out', sum.moneyOut, 'out')));

  return [hero, advice, recapLink, lines, renderRing(sum)];
}

function daysSince(startStamp, now) {
  const a = parseStamp(startStamp);
  const b = parseStamp(now);
  return Math.floor((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

function renderRing(sum) {
  const card = h('section', { class: 'card fade-in' }, h('h2', {}, 'Spending by category'));
  if (!sum.categoriesOk || !sum.moneyOut.ok) { card.append(h('p', { class: 'unverified' }, UNVERIFIED)); return card; }
  const cats = sum.byCategory;
  const total = -sum.moneyOut.value;
  if (!cats.length) { card.append(h('p', { class: 'empty' }, 'No spending yet this month.')); return card; }

  const R = 60;
  const W = 16;
  const C = 2 * Math.PI * R;
  const gap = cats.length > 1 ? 3 : 0;
  let offset = 0;
  const segs = cats.map((c) => {
    const len = (c.value / total) * C;
    const seg = svg('circle', {
      cx: 75, cy: 75, r: R, fill: 'none', stroke: categoryColour(c.category), 'stroke-width': W,
      'stroke-dasharray': `${Math.max(len - gap, 0.01)} ${C}`, 'stroke-dashoffset': -offset,
    });
    offset += len;
    return seg;
  });
  const ring = h('div', { class: 'ring' },
    svg('svg', { viewBox: '0 0 150 150', role: 'img', 'aria-label': 'Spending by category' },
      svg('circle', { cx: 75, cy: 75, r: R, fill: 'none', stroke: 'rgba(237,230,214,0.07)', 'stroke-width': W }), ...segs),
    h('div', { class: 'center' }, h('div', {}, h('small', {}, 'Spent'), h('b', { class: 'num' }, formatCents(total)))));

  const legend = h('div', { class: 'legend rows' }, cats.map((c) => {
    const sw = h('i', { class: 'swatch' });
    sw.style.background = categoryColour(c.category);
    return h('button', { class: 'row', onClick: () => openReceipt(c) },
      h('span', { class: 'name' }, sw, h('span', {}, c.category)),
      h('span', { class: 'amt num' }, formatCents(c.value)));
  }));

  card.append(h('div', { class: 'ring-wrap' }, ring, legend),
    h('div', {}, howButton(sum.moneyOut, 'Show me how (all spending)')));
  return card;
}
