import { h, s as svg, icon, openSheet } from '../ui.js';
import { app, persist, change, newId } from '../state.js';
import { formatCents, parseAmount } from '../money.js';
import { budgetMonth, shiftBudgetMonth, parseStamp, nowStamp, formatDate } from '../dates.js';
import { on, owedToYou, cashOnHand } from '../extras.js';
import { markRepaid } from '../ops.js';
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
import { weeklyWin, shareAskDue } from '../habits.js';
import { shareApp } from '../sheets/about.js';
import { openQuickAdd } from '../sheets/quick.js';
import { exportBackupNow } from '../sheets/backup.js';
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
      lup.perDay?.value > 0
        ? h('button', { class: 'press', onClick: (e) => openReceipt(lup.perDay, e.currentTarget.closest('.card')) },
          'About ', h('b', { class: 'num' }, formatCents(lup.perDay.value)), ' a day')
        : null,
      h('span', {}, lup.perDay?.value > 0 ? ` · ${when}` : when[0].toUpperCase() + when.slice(1)));
  } else if (lup.reason === 'nopay') {
    sub = h('button', { class: 'perday press', onClick: () => openPaySetup() }, 'Set up your pay to see "Left until payday" ›');
  }
  const casual = casualStatus({ summary: sum, snapshot, progress, period, now });
  const hero = h('section', { class: `card hero${rv}` },
    h('div', { class: 'label' }, lup.ok ? 'Left until payday' : "What's left"),
    // The count-up is for the eyes; screen readers hear the final amount once.
    main.ok ? [h('span', { class: 'sr' }, formatCents(main.value)), (big.setAttribute('aria-hidden', 'true'), big)] : h('p', { class: 'unverified' }, UNVERIFIED),
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
  const backupDays = app.sample ? null : backupDue(st.settings, st.entries.length > 0, now);
  if (!isInstalled() && !app.sample && !st.dismissedAdvice.includes('install')) {
    // A one-time hint: tap for the steps, or dismiss it for good (Settings → Backup keeps the tip).
    advice = h('div', { class: `advice${rv}`, role: 'note' },
      h('button', { class: 'advice-go press', onClick: (e) => openInstallHelp(e.currentTarget) }, 'Add My Budget to your home screen so it opens like a real app and your data stays safe. How?'),
      h('button', { class: 'advice-x', 'aria-label': 'Dismiss this hint', onClick: () => { st.dismissedAdvice.push('install'); persist(); app.render(); } }, icon('close')));
  } else if (!hasVault() && st.entries.length > 0 && !app.sample) {
    advice = h('button', { class: `advice action${rv}`, onClick: () => openPasscodeSetup() },
      h('span', {}, "Your data isn't locked yet. Set a passcode to encrypt it."), icon('right'));
  } else if (backupDays !== null) {
    // The weekly backup, made and ready: one tap opens the phone's Save to Files screen.
    advice = h('button', { class: `advice action${rv}`, onClick: () => exportBackupNow() },
      h('span', {}, backupDays === Infinity ? 'Your first backup is ready. Tap to save it to Files.' : 'Your weekly backup is ready. Tap to save it.'), icon('right'));
  } else if (on(st, 'nudges') || on(st, 'weeklyWins')) {
    // Paycheck notes first (a much bigger paycheck than usual, a bonus-paycheck month), then spending.
    // Each kind of note only shows when its extra is switched on (Settings → Extras).
    const notes = on(st, 'nudges');
    const big2 = notes ? bigPaycheck(st, now) : null;
    const bonus = notes ? bonusHeadsUp(st, now) : null;
    const dismissed = st.dismissedAdvice;
    const due = notes ? checkupDue(st, now) : [];
    const win = on(st, 'weeklyWins') ? weeklyWin(st, now, st.settings.weekStartDay) : null;
    const winNote = win && !dismissed.includes(win.key)
      ? { key: win.key, text: win.text, action: win.result ? (e) => openReceipt(win.result, e.currentTarget) : null }
      : null;
    const checkKey = `checkup:${now.slice(0, 10)}`; // "not now" hides it for today
    // Right after a win (at most every 3 months): "Know someone who'd like it?"
    const askShare = notes && !app.sample && shareAskDue(st, now)
      ? { key: 'share-ask', text: "Glad it's helping! Know someone who'd like My Budget? Tap to share it.",
        action: async () => { st.shareAskAt = now; persist(); app.render(); await shareApp(); },
        dismiss: () => { st.shareAskAt = now; } }
      : null;
    const note = big2 && !dismissed.includes(big2.key)
      ? { key: big2.key, text: `This paycheck is ${formatCents(big2.extra)} more than usual. Put some toward a goal?`, action: () => openGoalSheet(st.goals[0] ?? null, null, big2.extra) }
      : bonus && !dismissed.includes(bonus.key) ? bonus
        : winNote ? winNote
        : askShare ? askShare
        : due.length && !dismissed.includes(checkKey)
          ? { key: checkKey, text: due.length === 1 ? `Subscription check-up: still using ${due[0].name}?` : `Subscription check-up: still using these ${due.length}?`, action: () => openCheckup() }
          : notes ? adviceNote({ budgets: categoryBudgets(st, period, now), summary: sum, snapshot, period, now, dismissed }) : null;
    if (note?.action) {
      advice = h('div', { class: `advice${rv}`, role: 'note' },
        h('button', { class: 'advice-go press', onClick: note.action }, note.text),
        h('button', { class: 'advice-x', 'aria-label': 'Not now', onClick: () => { if (note.dismiss) note.dismiss(); else st.dismissedAdvice.push(note.key); persist(); app.render(); } }, icon('close')));
    } else if (note) {
      advice = h('div', { class: `advice${rv}`, role: 'note' },
        h('span', {}, note.text),
        h('button', { class: 'advice-x', 'aria-label': 'Dismiss note', onClick: () => { st.dismissedAdvice.push(note.key); persist(); app.render(); } }, icon('close')));
    }
  }

  // ---- Month-end summary: offered for the first week of a new month
  const prev = shiftBudgetMonth(period, -1);
  const hadLastMonth = st.entries.some((e) => e.at >= prev.start && e.at < prev.end);
  const recapDue = daysSince(period.start, now) < 7 && hadLastMonth;

  // ---- Decision tools, right under the main card ("Can I afford it?" is a basic; what-if is an extra)
  const tools = h('div', { class: `tools${on(st, 'whatIf') ? '' : ' single'}${rv}` },
    h('button', { class: 'tool press', onClick: (e) => openAfford(e.currentTarget) }, icon('receipt'), 'Can I afford it?'),
    on(st, 'whatIf') ? h('button', { class: 'tool press', onClick: (e) => openWhatIf(e.currentTarget) }, icon('leaf'), 'Try a what-if') : null);

  // Nothing logged yet: one friendly line and one button, instead of a page of zeros.
  if (!st.entries.some((e) => !e.auto && !e.parentId)) {
    const first = h('section', { class: `card${rv}` }, emptyState('plus', 'Nothing logged yet', 'Add what you spend as you go. It takes a few seconds.',
      { label: 'Add your first entry', run: () => openQuickAdd() }));
    return [hero, first, tools, advice];
  }

  // ---- Keep Home calm: one big number, one note, and everything about the month one tap deeper.
  const lines = h('div', { class: `rows home-rows${rv}` },
    h('button', { class: 'row', onClick: (e) => openMonth(prev, recapDue, e.currentTarget) },
      h('span', { class: 'name' }, h('span', {}, 'This month'), recapDue ? h('span', { class: 'row-sub faint small' }, `Your ${prev.short} recap is ready`) : null),
      sum.moneyOut.ok ? money(sum.moneyOut.value, { kind: 'out' }) : null, icon('right')),
    owedRow(st, now), cashRow(st, now));

  return [hero, tools, advice, lines];
}

// Owed to you (the Split bills extra): one line, tap to mark bills paid back.
function owedRow(st, now) {
  if (!on(st, 'splits')) return null;
  const o = owedToYou(st, now);
  if (!o.ok || !o.value) return null;
  return h('button', { class: 'row', onClick: (e) => openOwed(e.currentTarget) },
    h('span', { class: 'name' }, h('span', {}, 'Owed to you'), h('span', { class: 'row-sub faint small' }, `${o.open.length} ${o.open.length === 1 ? 'bill' : 'bills'}`)),
    money(o.value, { kind: 'in', plain: true }), icon('right'));
}

// Cash on hand (the Cash extra).
function cashRow(st, now) {
  if (!on(st, 'cash')) return null;
  const c = cashOnHand(st, now);
  return h('button', { class: 'row', onClick: (e) => openCash(e.currentTarget) },
    h('span', { class: 'name' }, h('span', {}, 'Cash on hand')),
    c?.ok ? money(c.value, { kind: c.value < 0 ? 'out' : 'in', plain: true }) : h('span', { class: 'faint small' }, 'Count it'), icon('right'));
}

// "This month": money in and out, what's left this month, carried over, savings, and categories.
function openMonth(prev, recapDue, from) {
  openSheet('This month', () => {
    const st = app.state;
    const now = nowStamp();
    const period = budgetMonth(now, st.settings.monthStartDay);
    const sum = monthSummary(st.entries, period, now);
    const pairCard = (label, result, kind, cls, ic) => h('button', {
      class: `pair-card ${cls}`, disabled: !result.ok,
      onClick: (e) => openReceipt(result, e.currentTarget),
    },
    h('span', { class: 'k' }, h('span', { class: `ic ${kind}` }, icon(ic)), label),
    result.ok ? h('span', { class: `v num ${result.value === 0 ? '' : kind}` }, formatCents(result.value, { sign: 'always' })) : h('span', { class: 'unverified' }, 'Hidden'));
    const row = (label, result, kind) => h('button', { class: 'row', onClick: (e) => openReceipt(result, e.currentTarget.closest('.card')), disabled: !result.ok },
      h('span', { class: 'name' }, h('span', {}, label)),
      result.ok ? money(result.value, { kind: result.value === 0 ? 'zero' : kind }) : h('span', { class: 'unverified' }, 'Hidden'),
      h('span', { class: 'how-ic', 'aria-label': 'Show me how' }, icon('receipt')));
    return [
      recapDue ? h('button', { class: 'recap-link', onClick: () => openRecap(prev, now) }, h('span', {}, `Your ${prev.short} recap`), icon('right')) : null,
      h('div', { class: 'pair' },
        pairCard('Money in', sum.moneyIn, 'in', 'tint-sage', 'up'),
        pairCard('Money out', sum.moneyOut, 'out', 'tint-peach', 'down')),
      h('section', { class: 'card' },
        h('div', { class: 'rows' },
          row(`What's left in ${period.short}`, sum.left, sum.left.value < 0 ? 'out' : 'in'),
          row(`Carried over from ${sum.previousLabel}`, sum.carry, sum.carry.value < 0 ? 'out' : 'in'),
          sum.saved.ok && sum.saved.value !== 0 ? row('Moved to savings', sum.saved, 'save') : null,
          sum.owed.ok && sum.owed.value !== 0 ? row('Split bills (owed and paid back)', sum.owed, sum.owed.value < 0 ? 'out' : 'in') : null)),
      renderRing(sum, false, ''),
    ];
  }, { from });
}

// The bills friends still owe you for, each with "Paid back".
function openOwed(from) {
  const sheet = openSheet('Owed to you', () => {
    const o = owedToYou(app.state, nowStamp());
    if (!o.ok) return h('p', { class: 'unverified' }, UNVERIFIED);
    if (!o.open.length) return [h('p', { class: 'dim' }, 'Nobody owes you anything right now.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => sheet.close() }, 'Done'))];
    return [
      h('div', { class: 'confirm-card' }, h('div', { class: 'big num in' }, formatCents(o.value)), h('div', { class: 'meta' }, 'owed to you'), howButton(o)),
      ...o.open.map((e) => h('div', { class: 'use-row' },
        h('div', {}, h('div', {}, e.name), h('div', { class: 'meta' }, `${formatCents(e.owed)} of ${formatCents(e.cents)} · ${formatDate(e.at, { weekday: true })}`)),
        h('button', { class: 'btn primary narrow', onClick: () => { change((st) => markRepaid(st, e.id, nowStamp(), newId), `${e.name}: paid back ${formatCents(e.owed)}`); sheet.close(); } }, 'Paid back'))),
      h('p', { class: 'faint small-note' }, 'When friends pay you back, it comes back into your money. It\'s not counted as income.'),
    ];
  }, { from });
}

// Cash on hand: what you counted last, minus cash spending since, plus cash coming in.
function openCash(from) {
  const d = { amount: '' };
  let error = '';
  const sheet = openSheet('Cash on hand', () => view(), { from });
  function view() {
    const c = cashOnHand(app.state, nowStamp());
    return [
      c ? h('div', { class: 'confirm-card' },
        c.ok ? h('div', { class: 'big num' }, formatCents(c.value)) : h('p', { class: 'unverified' }, UNVERIFIED),
        h('div', { class: 'meta' }, `Counted ${formatDate(app.state.settings.cash.at, { weekday: true })}${c.since ? `, then ${c.since} cash ${c.since === 1 ? 'entry' : 'entries'}` : ''}`),
        c.ok ? howButton(c) : null) : h('p', { class: 'dim' }, 'Count the cash in your wallet once, and tag cash spending as you go ("Paid with cash"). This keeps the total for you.'),
      h('label', { class: 'field' }, h('span', {}, c ? 'Count it again' : 'How much cash do you have?'),
        h('div', { class: 'inline' },
          h('div', { class: 'money-input grow' }, h('span', { class: 'cur' }, '$'), h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', value: d.amount, onInput: (e) => { d.amount = e.target.value; } })),
          h('button', { class: 'btn primary narrow', onClick: () => {
            const raw = d.amount.trim();
            const cents = raw === '0' || raw === '0.00' ? 0 : parseAmount(raw);
            if (cents === null) { error = 'Enter an amount, like 45'; sheet.setContent(view()); return; }
            change((st) => { st.settings.cash = { cents, at: nowStamp() }; }, `Cash on hand: ${formatCents(cents)}`);
            sheet.close();
          } }, 'Save'))),
      error ? h('p', { class: 'error' }, error) : null,
    ];
  }
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
    // Screen readers hear every slice: "Spending by category: Groceries $64.50, Eating Out $10.00. Total $74.50."
    svg('svg', { viewBox: '0 0 200 200', role: 'img', 'aria-label': `Spending by category: ${cats.map((c) => `${c.category} ${formatCents(c.value)}`).join(', ')}. Total ${formatCents(total)}.` },
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
