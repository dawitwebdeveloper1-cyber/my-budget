import { h, s as svg, icon } from '../ui.js';
import { app, persist } from '../state.js';
import { formatCents } from '../money.js';
import { budgetMonth, shiftBudgetMonth, parseStamp } from '../dates.js';
import { monthSummary } from '../calc.js';
import { categoryBudgets, weeklySnapshot, adviceNote, budgetProgress, casualStatus } from '../budget.js';
import { money, howButton, openReceipt, UNVERIFIED, categoryColour, bar, tint, emptyState } from '../components.js';
import { countUp, reducedMotion, EASE } from '../motion.js';
import { openRecap } from './recap.js';
import { backupDue } from '../backup.js';
import { hasVault } from '../vault.js';
import { openPasscodeSetup } from '../lock.js';
import { openSettings } from '../sheets/settings.js';

// animate: true when the Home screen opens (count-up, progress fill, chart draw-in).
export function renderHome(now, animate = false) {
  const st = app.state;
  const period = budgetMonth(now, st.settings.monthStartDay);
  const sum = monthSummary(st.entries, period, now);
  const snapshot = weeklySnapshot(st.entries, now, st.settings.weekStartDay);
  const progress = budgetProgress(st, period, now, sum);
  const motion = animate && !reducedMotion();
  const rv = animate ? ' reveal' : '';

  const statusText = {
    positive: "You're ahead this month",
    negative: "You're behind this month",
    even: 'Breaking even so far',
    unknown: UNVERIFIED,
  }[sum.status];

  // ---- "What's left": the teal centrepiece
  const big = h('span', { class: 'big num' });
  if (sum.left.ok) {
    if (motion) countUp(big, sum.left.value, (v) => formatCents(v), { duration: 1000, delay: 120 });
    else big.textContent = formatCents(sum.left.value);
  }
  const casual = casualStatus({ summary: sum, snapshot, progress, period, now });
  const hero = h('section', { class: `card hero${rv}` },
    h('div', { class: 'label' }, "What's left"),
    sum.left.ok ? big : h('p', { class: 'unverified' }, UNVERIFIED),
    casual ? h('p', { class: 'casual' }, casual) : null,
    h('div', { class: 'hero-foot' },
      h('button', { class: `status ${sum.status}`, onClick: (e) => sum.net.ok && openReceipt(sum.net, e.currentTarget) },
        h('span', { class: 'dot' }),
        h('span', {}, statusText),
        sum.net.ok ? h('span', { class: 'num' }, formatCents(sum.net.value, { sign: 'always' })) : null),
      sum.left.ok ? howButton(sum.left) : null));

  // ---- One gentle line at a time: passcode set-up first, then backup, then spending advice.
  let advice = null;
  const backupDays = backupDue(st.settings, st.entries.length > 0, now);
  if (!hasVault() && st.entries.length > 0) {
    advice = h('button', { class: `advice action${rv}`, onClick: () => openPasscodeSetup() },
      h('span', {}, "Your data isn't locked yet. Set a passcode to encrypt it."), icon('right'));
  } else if (backupDays !== null) {
    advice = h('button', { class: `advice action${rv}`, onClick: () => openSettings('backup') },
      h('span', {}, backupDays === Infinity ? "You haven't made a backup yet. Tap to save one." : `It's been ${backupDays} days since your last backup. Tap to save one.`), icon('right'));
  } else if (st.settings.adviceOn) {
    const note = adviceNote({ budgets: categoryBudgets(st, period, now), summary: sum, snapshot, period, now, dismissed: st.dismissedAdvice });
    if (note) {
      advice = h('div', { class: `advice${rv}`, role: 'note' },
        h('span', {}, note.text),
        h('button', { class: 'advice-x', 'aria-label': 'Dismiss note', onClick: () => { st.dismissedAdvice.push(note.key); persist(); app.render(); } }, icon('close')));
    }
  }

  // ---- Month-end summary: offered for the first week of a new month
  const prev = shiftBudgetMonth(period, -1);
  const hadLastMonth = st.entries.some((e) => e.at >= prev.start && e.at < prev.end);
  const recapLink = daysSince(period.start, now) < 7 && hadLastMonth
    ? h('button', { class: `recap-link${rv}`, onClick: () => openRecap(prev, now) }, h('span', {}, `Your ${prev.short} recap`), icon('right'))
    : null;

  // ---- Money in and money out, side by side
  const pairCard = (label, result, kind, cls, ic) => h('button', {
    class: `pair-card ${cls}${rv}`, disabled: !result.ok,
    onClick: (e) => openReceipt(result, e.currentTarget),
  },
  h('span', { class: 'k' }, h('span', { class: `ic ${kind}` }, icon(ic)), label),
  result.ok ? h('span', { class: `v num ${result.value === 0 ? '' : kind}` }, formatCents(result.value, { sign: 'always' })) : h('span', { class: 'unverified' }, 'Hidden'));
  const pair = h('div', { class: 'pair' },
    pairCard('Money in', sum.moneyIn, 'in', 'tint-sage', 'up'),
    pairCard('Money out', sum.moneyOut, 'out', 'tint-peach', 'down'));

  // ---- Carried over (its own line) and savings
  const row = (label, result, kind) => h('button', { class: 'row', onClick: (e) => openReceipt(result, e.currentTarget.closest('.card')), disabled: !result.ok },
    h('span', { class: 'name' }, h('span', {}, label)),
    result.ok ? money(result.value, { kind: result.value === 0 ? 'zero' : kind }) : h('span', { class: 'unverified' }, 'Hidden'),
    h('span', { class: 'how-ic', 'aria-label': 'Show me how' }, icon('receipt')));
  const extra = h('section', { class: `card${rv}` },
    h('div', { class: 'rows' },
      row(`Carried over from ${sum.previousLabel}`, sum.carry, sum.carry.value < 0 ? 'out' : 'in'),
      sum.saved.ok && sum.saved.value !== 0 ? row('Moved to savings', sum.saved, 'save') : null));

  return [hero, advice, recapLink, pair, extra, renderProgress(progress, motion, rv), renderRing(sum, motion, rv)];
}

function daysSince(startStamp, now) {
  const a = parseStamp(startStamp);
  const b = parseStamp(now);
  return Math.floor((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

// ---- Progress: how much of this month's budget has been spent
function renderProgress(p, motion, rv) {
  const card = h('section', { class: `card${rv}` }, h('h2', {}, "This month's budget"));
  if (!p.ok) {
    card.append(p.empty
      ? emptyState('leaf', null, 'Add money in, or set category limits in Goals, to see how much of your budget is spent.')
      : h('p', { class: 'unverified' }, UNVERIFIED));
    return card;
  }
  const pct = h('span', { class: 'pct num' });
  if (motion) countUp(pct, p.value, (v) => `${v}%`, { duration: 900, delay: 150 });
  else pct.textContent = `${p.value}%`;
  card.append(
    h('div', { class: 'progress-head' },
      h('span', { class: 'progress-sub' }, p.basis === 'budget' ? 'spent of your budget' : 'spent of the money you had'),
      pct),
    bar(p.value, { over: p.value > 100, fill: motion, delay: 110 }),
    h('div', { class: 'progress-head' },
      h('span', { class: 'progress-sub num' }, `${formatCents(p.spent)} of ${formatCents(p.base)}`),
      howButton(p)));
  return card;
}

// ---- Spending ring: rounded slices with small gaps, total in the middle
function renderRing(sum, motion, rv) {
  const card = h('section', { class: `card${rv}` }, h('h2', {}, 'Spending by category'));
  if (!sum.categoriesOk || !sum.moneyOut.ok) { card.append(h('p', { class: 'unverified' }, UNVERIFIED)); return card; }
  const cats = sum.byCategory;
  const total = -sum.moneyOut.value;
  if (!cats.length) { card.append(emptyState('sparkle', 'No spending yet', 'Your spending this month will show up here, by category.')); return card; }

  const CX = 100;
  const R = 78;
  const W = 20;
  const C = 2 * Math.PI * R;
  const single = cats.length === 1;
  const gap = single ? 0 : 7;
  // Slices draw in one after another (about 0.25s apart, faster when there are many).
  const step = Math.min(250, Math.floor(1100 / cats.length));
  let offset = 0;
  const segs = cats.map((c, i) => {
    const len = (c.value / total) * C;
    const dash = single ? C : Math.max(len - W - gap, 0.001);
    const startAt = single ? 0 : offset + W / 2 + gap / 2;
    const seg = svg('circle', {
      cx: CX, cy: CX, r: R, fill: 'none', 'stroke-width': W, 'stroke-linecap': single ? 'butt' : 'round',
      'stroke-dasharray': `${dash} ${C}`, transform: `rotate(${-90 + (startAt / C) * 360} ${CX} ${CX})`,
    });
    seg.style.stroke = categoryColour(c.category); // CSS variable, so it follows dark mode
    if (motion) {
      seg.animate([
        { strokeDasharray: `0.001 ${C}`, opacity: 0 },
        { strokeDasharray: `${dash} ${C}`, opacity: 1 },
      ], { duration: 450, delay: i * step, easing: EASE, fill: 'backwards' });
    }
    offset += len;
    return seg;
  });

  const totalEl = h('b', { class: 'num' });
  if (motion) countUp(totalEl, total, (v) => formatCents(v), { duration: Math.min(1000, step * cats.length + 300) });
  else totalEl.textContent = formatCents(total);
  const ring = h('div', { class: 'ring' },
    svg('svg', { viewBox: '0 0 200 200', role: 'img', 'aria-label': `Spending by category, ${formatCents(total)} in total` },
      svg('circle', { cx: CX, cy: CX, r: R, fill: 'none', stroke: 'var(--track)', 'stroke-width': W }), ...segs),
    h('div', { class: 'center' }, h('div', {}, h('small', {}, 'Spent'), totalEl)));
  ring.querySelector('circle').style.stroke = 'var(--track)';

  // Small tinted cards under the ring, appearing in step with their slices.
  const grid = h('div', { class: 'cat-grid' }, cats.map((c, i) => {
    const dot = h('i', { class: 'swatch' });
    dot.style.background = categoryColour(c.category);
    const el = h('button', { class: `cat-card tint-${tint(i)}${motion ? ' pre' : ''}`, onClick: (e) => openReceipt(c, e.currentTarget) },
      h('span', { class: 'top' }, dot, h('span', {}, c.category)),
      h('span', { class: 'v num' }, formatCents(c.value)));
    if (motion) setTimeout(() => el.classList.add('go'), i * step + 80);
    return el;
  }));

  card.append(ring, grid, h('div', {}, howButton(sum.moneyOut, 'Show me how (all spending)')));
  return card;
}
