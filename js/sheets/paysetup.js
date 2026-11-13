// "Your pay": how often you're paid, roughly how much, and when the next payday is.
import { h, openSheet } from '../ui.js';
import { app, change, newId } from '../state.js';
import { parseAmount, formatCents, centsToInput } from '../money.js';
import { nowStamp, parseStamp, makeStamp, daysInMonth, formatDate, isStamp } from '../dates.js';
import { PAY_CHOICES, nextOccurrence } from '../recurring.js';
import { addRule, editRule, stopRule, PAYCHECK } from '../ops.js';
import { cleanRule } from '../store.js';
import { payRule, irregularStats, bonusMonths } from '../pay.js';
import { howButton } from '../components.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n) => (n === 31 ? 'Last day' : `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`);

// The next date (today or later) that falls on one of the two twice-a-month days.
export function nextSemiDate(days, now) {
  const p = parseStamp(now);
  for (let i = 0; i < 3; i++) {
    const idx = p.y * 12 + (p.m - 1) + i;
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    for (const d of days) {
      const day = Math.min(d, daysInMonth(y, m));
      const stamp = makeStamp(y, m, day);
      if (stamp.slice(0, 10) >= now.slice(0, 10)) return stamp.slice(0, 10);
    }
  }
  return now.slice(0, 10);
}

export function openPaySetup(from = null) {
  const s = app.state;
  const rule = payRule(s);
  const now = nowStamp();
  const next = rule ? nextOccurrence(rule) : null;
  const d = {
    freq: s.settings.payMode === 'irregular' ? 'irregular' : rule?.freq ?? 'biweekly',
    amount: rule ? centsToInput(rule.cents) : '',
    date: (next ?? now).slice(0, 10),
    time: (next ?? `${now.slice(0, 10)}T09:00`).slice(11),
    days: rule?.freq === 'semimonthly' && Array.isArray(rule.days) ? [...rule.days] : [15, 31],
  };
  let error = '';
  let bonusNote = null;
  const sheet = openSheet('Your pay', () => view(), { from });

  function fillBonusNote() {
    if (!bonusNote) return;
    const anchor = `${d.date}T${d.time || '09:00'}`;
    const bonus = isStamp(anchor) ? bonusMonths({ freq: d.freq, anchor, nextIndex: 0, endAt: null }, now, 12) : [];
    bonusNote.textContent = bonus.length
      ? `Bonus-paycheck months in the next year: ${bonus.map((b) => `${MONTHS[b.m - 1]} ${b.y}`).join(', ')}.`
      : '';
  }

  function view() {
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'How often you get paid' },
      [...PAY_CHOICES, ['irregular', 'It changes']].map(([v, t]) => h('button', { class: 'chip', 'aria-pressed': String(d.freq === v), onClick: () => { d.freq = v; error = ''; sheet.setContent(view()); } }, t)));
    const parts = [h('div', { class: 'field' }, h('span', {}, 'How often do you get paid?'), chips)];

    if (d.freq === 'irregular') {
      const st = irregularStats(s, now);
      parts.push(
        h('p', { class: 'dim' }, "For gig work or changing shifts. Log each paycheck when it lands (tap +, Money in, Paycheck). The app plans with the average of your last 3 and estimates when the next one will come."),
        st ? h('div', { class: 'confirm-card' },
          h('div', { class: 'meta' }, 'Your usual paycheck'),
          h('div', { class: 'big num' }, formatCents(st.avg)),
          h('div', { class: 'meta' }, `between ${formatCents(st.low)} and ${formatCents(st.high)} (last ${st.count})`),
          howButton({ ok: true, value: st.avg, receipt: st.receipt })) : h('p', { class: 'faint small-note' }, 'After two paychecks, your usual amount and range show here.'),
        rule ? h('p', { class: 'faint small-note' }, `Your repeating ${formatCents(rule.cents)} paycheck will stop being added automatically. Past paychecks stay.`) : null);
    } else {
      parts.push(h('label', { class: 'field' }, h('span', {}, 'About how much is each paycheck?'),
        h('div', { class: 'money-input' }, h('span', { class: 'cur' }, '$'), h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', value: d.amount, onInput: (e) => { d.amount = e.target.value; } }))));
      if (d.freq === 'semimonthly') {
        const sel = (i, options) => {
          const el = h('select', { class: 'input', 'aria-label': i === 0 ? 'First payday of the month' : 'Second payday of the month' },
            options.map((n) => h('option', { value: String(n), selected: d.days[i] === n ? 'selected' : null }, ordinal(n))));
          el.addEventListener('change', () => { d.days[i] = Number(el.value); if (d.days[1] <= d.days[0]) d.days[1] = d.days[0] === 28 ? 31 : d.days[0] + 1; sheet.setContent(view()); });
          return el;
        };
        parts.push(h('div', { class: 'field' }, h('span', {}, 'Which days of the month?'),
          h('div', { class: 'two' },
            sel(0, Array.from({ length: 28 }, (_, i) => i + 1)),
            sel(1, [...Array.from({ length: 28 - d.days[0] }, (_, i) => d.days[0] + 1 + i), 31]))),
        h('p', { class: 'faint small-note' }, `Next payday: ${formatDate(`${nextSemiDate(d.days, now)}T00:00`, { weekday: true })}. In short months "Last day" is the 28th, 29th or 30th.`));
      } else {
        parts.push(h('div', { class: 'two' },
          h('label', { class: 'field' }, h('span', {}, 'Next payday'), h('input', { class: 'input', type: 'date', value: d.date, onInput: (e) => { d.date = e.target.value; fillBonusNote(); } })),
          h('label', { class: 'field' }, h('span', {}, 'Usually lands at'), h('input', { class: 'input', type: 'time', value: d.time, onInput: (e) => { d.time = e.target.value; fillBonusNote(); } }))));
      }
      if (d.freq === 'biweekly' || d.freq === 'weekly') {
        // Worked out from what's typed right now, and updated as the date or time changes.
        bonusNote = h('p', { class: 'faint small-note' });
        fillBonusNote();
        parts.push(bonusNote);
      } else {
        bonusNote = null;
      }
    }
    parts.push(error ? h('p', { class: 'error' }, error) : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: save }, 'Save')));
    return parts;
  }

  function save() {
    if (d.freq === 'irregular') {
      change((st) => { st.settings.payMode = 'irregular'; const r = payRule({ ...st, settings: { ...st.settings, payMode: 'schedule' } }); if (r) stopRule(st, r.id); }, 'Pay set to irregular');
      sheet.close();
      return;
    }
    const cents = parseAmount(d.amount);
    if (cents === null) { error = 'Enter your usual paycheck, like 1240'; sheet.setContent(view()); return; }
    const anchor = d.freq === 'semimonthly' ? `${nextSemiDate(d.days, now)}T${d.time || '09:00'}` : `${d.date}T${(d.time || '09:00').slice(0, 5)}`;
    if (!isStamp(anchor)) { error = 'Pick the date of your next payday'; sheet.setContent(view()); return; }
    const fields = { freq: d.freq, cents, anchor, ...(d.freq === 'semimonthly' ? { days: [...d.days] } : {}) };
    change((st) => {
      st.settings.payMode = 'schedule';
      const existing = payRule(st);
      if (existing) editRule(st, existing.id, fields, nowStamp(), newId);
      else addRule(st, cleanRule({ id: newId(), type: 'income', kind: 'paycheck', name: 'Paycheck', category: PAYCHECK, nextIndex: 0, endAt: null, ...fields }), nowStamp(), newId);
    }, 'Pay schedule saved');
    sheet.close();
  }
}
