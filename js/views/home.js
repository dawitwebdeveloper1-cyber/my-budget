import { h, s as svg, icon, openSheet } from '../ui.js';
import { app, persist } from '../state.js';
import { formatCents } from '../money.js';
import { budgetMonth, shiftBudgetMonth, parseStamp } from '../dates.js';
import { monthSummary } from '../calc.js';
import { categoryBudgets, weeklySnapshot, adviceNote, budgetProgress, casualStatus } from '../budget.js';
import { money, howButton, openReceipt, UNVERIFIED, emptyState } from '../components.js';
import { countUp, reducedMotion, EASE } from '../motion.js';
import { openRecap } from './recap.js';
import { backupDue } from '../backup.js';
import { hasVault } from '../vault.js';
import { openPasscodeSetup } from '../lock.js';
import { openSettings } from '../sheets/settings.js';
import { openPaySetup } from '../sheets/paysetup.js';
import { leftUntilPayday, bigPaycheck, bonusHeadsUp } from '../pay.js';
import { openGoalSheet } from './goals.js';
import { openAfford, openWhatIf } from '../sheets/decide.js';
import { checkupDue } from '../decide.js';
import { openCheckup } from './reminders.js';

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

  // ---- The centrepiece: "Left until payday" (or this month's "What's left" until pay is set up)
  const lup = leftUntilPayday(st, now);
  const main = lup.ok ? lup : sum.left;
  const big = h('span', { class: 'big num' });
  if (main.ok) {
    if (motion) countUp(big, main.value, (v) => formatCents(v), { duration: 1000, delay: 120 });
    else big.textContent = formatCents(main.value);
  }
  let sub = null;
  if (lup.ok) {
    const when = lup.next
      ? `${lup.info.estimated ? 'next pay expected' : 'payday'} ${lup.nextLabel}`
      : 'next pay any day now';
    sub = !lup.next && !lup.info.overdue
      ? h('button', { class: 'perday press', onClick: () => openPaySetup() }, 'Add your payday to see a daily amount ›')
      : h('div', { class: 'perday' },
      lup.perDay
        ? h('button', { class: 'press', onClick: (e) => openReceipt(lup.perDay, e.currentTarget.closest('.card')) },
          'About ', h('b', { class: 'num' }, formatCents(lup.perDay.value)), ' a day')
        : null,
      h('span', {}, lup.perDay ? ` · ${when}` : when));
  } else if (lup.reason === 'nopay') {
    sub = h('button', { class: 'perday press', onClick: () => openPaySetup() }, 'Set up your pay to see "Left until payday" ›');
  }
  const casual = casualStatus({ summary: sum, snapshot, progress, period, now });
  const hero = h('section', { class: `card hero${rv}` },
    h('div', { class: 'label' }, lup.ok ? 'Left until payday' : "What's left"),
    main.ok ? big : h('p', { class: 'unverified' }, UNVERIFIED),
    sub,
    casual ? h('div', {}, h('span', { class: 'pill' }, h('span', { class: 'dot' }), casual)) : null,
    heroProgress(progress, motion),
    // Ahead / behind this month, with its own "show me how"
    h('div', { class: 'net' },
      h('button', { class: 'press', onClick: (e) => sum.net.ok && openReceipt(sum.net, e.currentTarget.closest('.card')) },
        `${statusText} `, sum.net.ok ? h('b', { class: 'num' }, formatCents(sum.net.value, { sign: 'always' })) : null),
      main.ok ? howButton(main) : null));

  // ---- One gentle line at a time: home screen first (keeps data safe), then passcode, backup, advice.
  let advice = null;
  const backupDays = backupDue(st.settings, st.entries.length > 0, now);
  if (!isInstalled()) {
    advice = h('button', { class: `advice action${rv}`, onClick: (e) => openInstallHelp(e.currentTarget) },
      h('span', {}, 'Add My Budget to your home screen so your data stays safe.'), icon('right'));
  } else if (!hasVault() && st.entries.length > 0) {
    advice = h('button', { class: `advice action${rv}`, onClick: () => openPasscodeSetup() },
      h('span', {}, "Your data isn't locked yet. Set a passcode to encrypt it."), icon('right'));
  } else if (backupDays !== null) {
    advice = h('button', { class: `advice action${rv}`, onClick: () => openSettings('backup') },
      h('span', {}, backupDays === Infinity ? "You haven't made a backup yet. Tap to save one." : `It's been ${backupDays} days since your last backup. Tap to save one.`), icon('right'));
  } else if (st.settings.adviceOn) {
    // Paycheck notes first (a much bigger paycheck than usual, a bonus-paycheck month), then spending.
    const big2 = bigPaycheck(st, now);
    const bonus = bonusHeadsUp(st, now);
    const dismissed = st.dismissedAdvice;
    const due = checkupDue(st, now);
    const checkKey = `checkup:${now.slice(0, 10)}`; // "not now" hides it for today
    const note = big2 && !dismissed.includes(big2.key)
      ? { key: big2.key, text: `This paycheck is ${formatCents(big2.extra)} more than usual. Put some toward a goal?`, action: () => openGoalSheet(st.goals[0] ?? null, null, big2.extra) }
      : bonus && !dismissed.includes(bonus.key) ? bonus
        : due.length && !dismissed.includes(checkKey)
          ? { key: checkKey, text: due.length === 1 ? `Subscription check-up: still using ${due[0].name}?` : `Subscription check-up: still using these ${due.length}?`, action: () => openCheckup() }
          : adviceNote({ budgets: categoryBudgets(st, period, now), summary: sum, snapshot, period, now, dismissed });
    if (note?.action) {
      advice = h('div', { class: `advice${rv}`, role: 'note' },
        h('button', { class: 'advice-go press', onClick: note.action }, note.text),
        h('button', { class: 'advice-x', 'aria-label': 'Dismiss note', onClick: () => { st.dismissedAdvice.push(note.key); persist(); app.render(); } }, icon('close')));
    } else if (note) {
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
      lup.ok ? row(`What's left in ${period.short}`, sum.left, sum.left.value < 0 ? 'out' : 'in') : null,
      row(`Carried over from ${sum.previousLabel}`, sum.carry, sum.carry.value < 0 ? 'out' : 'in'),
      sum.saved.ok && sum.saved.value !== 0 ? row('Moved to savings', sum.saved, 'save') : null));

  // ---- Decision tools, right under the main card
  const tools = h('div', { class: `tools${rv}` },
    h('button', { class: 'tool press', onClick: (e) => openAfford(e.currentTarget) }, icon('receipt'), 'Can I afford it?'),
    h('button', { class: 'tool press', onClick: (e) => openWhatIf(e.currentTarget) }, icon('leaf'), 'Try a what-if'));

  return [hero, tools, advice, recapLink, pair, extra, renderRing(sum, motion, rv)];
}

// Budget progress inside the main card: "53% of this month's budget used"
function heroProgress(p, motion) {
  if (!p.ok) {
    return p.empty ? null : h('p', { class: 'used' }, UNVERIFIED);
  }
  const width = `${Math.min(100, p.value)}%`;
  const fill = h('i', { class: p.value > 100 ? 'over' : '' });
  const barEl = h('div', { class: `hero-bar${motion ? ' fill' : ''}`, role: 'progressbar', 'aria-valuenow': String(Math.min(100, p.value)), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Budget used' }, fill);
  if (motion) {
    fill.style.width = '0%';
    setTimeout(() => requestAnimationFrame(() => { fill.style.width = width; }), 160);
  } else {
    fill.style.width = width;
  }
  const pct = h('b', { class: 'num' });
  if (motion) countUp(pct, p.value, (v) => `${v}%`, { duration: 900, delay: 160 });
  else pct.textContent = `${p.value}%`;
  return h('div', {},
    barEl,
    h('button', { class: 'used press', onClick: (e) => openReceipt(p, e.currentTarget.closest('.card')) },
      h('span', {}, pct, p.basis === 'budget' ? " of this month's budget used" : " of this month's money used"),
      h('span', { class: 'num' }, `${formatCents(p.spent)} of ${formatCents(p.base)}`)));
}

// Opened from the home screen icon (not inside Safari)?
export function isInstalled() {
  return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

function openInstallHelp(from) {
  openSheet('Keep your data safe', () => [
    h('p', { class: 'dim' }, 'When My Budget is only opened in Safari, the iPhone can clear its saved data if you don\'t visit for about a week. Adding it to your home screen stops that, and it opens full screen like a normal app.'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Open this page in ', h('b', {}, 'Safari'), '.'),
      h('li', {}, 'Tap the ', h('b', {}, 'Share'), ' button (the square with an arrow).'),
      h('li', {}, 'Scroll down and tap ', h('b', {}, 'Add to Home Screen'), ', then ', h('b', {}, 'Add'), '.'),
      h('li', {}, 'From now on, open My Budget from that icon.')),
    h('p', { class: 'faint small-note' }, 'Data saved here in Safari and data in the home screen app are kept separately. If you already have entries here, export a backup first (Settings → Backup) and import it in the home screen app.'),
  ], { from });
}

function daysSince(startStamp, now) {
  const a = parseStamp(startStamp);
  const b = parseStamp(now);
  return Math.floor((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

// Slices take the category colours in order: burnt orange, amber, deep olive, oxblood, then similar warm tones.
const sliceColour = (i) => `var(--c${(i % 9) + 1})`;

// ---- Spending ring: slices with small gaps, total in the middle
function renderRing(sum, motion, rv) {
  const card = h('section', { class: `card${rv}` }, h('h2', {}, 'Spending by category'));
  if (!sum.categoriesOk || !sum.moneyOut.ok) { card.append(h('p', { class: 'unverified' }, UNVERIFIED)); return card; }
  const all = sum.byCategory;
  const total = -sum.moneyOut.value;
  // Only categories with spending get a slice; ones where refunds outweighed spending are listed as money back.
  const cats = all.filter((c) => c.value > 0);
  const back = all.filter((c) => c.value < 0);
  const sliceTotal = cats.reduce((a, c) => a + c.value, 0);
  if (!cats.length) {
    card.append(emptyState('sparkle', 'No spending yet', back.length ? 'Only refunds so far this month.' : 'Your spending this month will show up here, by category.'));
    return card;
  }

  const CX = 100;
  const R = 80;
  const W = 22;
  const C = 2 * Math.PI * R;
  const single = cats.length === 1;
  const gap = single ? 0 : 7;
  // Slices draw in one after another (about 0.25s apart, faster when there are many).
  const step = Math.min(250, Math.floor(1100 / cats.length));
  let offset = 0;
  const segs = cats.map((c, i) => {
    const len = (c.value / sliceTotal) * C;
    const dash = single ? C : Math.max(len - W - gap, 0.001);
    const startAt = single ? 0 : offset + W / 2 + gap / 2;
    const seg = svg('circle', {
      cx: CX, cy: CX, r: R, fill: 'none', 'stroke-width': W, 'stroke-linecap': single ? 'butt' : 'round',
      'stroke-dasharray': `${dash} ${C}`, transform: `rotate(${-90 + (startAt / C) * 360} ${CX} ${CX})`,
    });
    seg.style.stroke = sliceColour(i); // CSS variable, so it follows dark mode
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

  // Category list beside the ring, each line fading in alongside its slice.
  const list = h('div', { class: 'cat-list' }, cats.map((c, i) => {
    const dot = h('i', { class: 'swatch' });
    dot.style.background = sliceColour(i);
    const el = h('button', { class: `cat-item press${motion ? ' pre' : ''}`, onClick: () => openReceipt(c, card) },
      dot, h('span', { class: 'n' }, c.category), h('span', { class: 'v num' }, formatCents(c.value)));
    if (motion) setTimeout(() => el.classList.add('go'), i * step + 80);
    return el;
  }), back.map((c) => h('button', { class: 'cat-item press', onClick: () => openReceipt(c, card) },
    h('i', { class: 'swatch' }), h('span', { class: 'n' }, c.category), h('span', { class: 'v num in' }, `${formatCents(-c.value, { sign: 'always' })} back`))));

  card.append(h('div', { class: 'ring-row' }, ring, list), h('div', { class: 'ring-how' }, howButton(sum.moneyOut, 'Show me how (all spending)')));
  return card;
}
