// First-time setup: three short screens (how you're paid, roughly how much, one goal), done in under
// a minute. Everything else can wait. Or: look around with example data first.
import { h, icon } from '../ui.js';
import { app, change, newId } from '../state.js';
import { parseAmount, formatCents } from '../money.js';
import { nowStamp, isStamp, formatDate } from '../dates.js';
import { PAY_CHOICES } from '../recurring.js';
import { addRule, PAYCHECK } from '../ops.js';
import { cleanRule, cleanGoal } from '../store.js';
import { nextSemiDate } from '../sheets/paysetup.js';

// Brand-new: nothing saved yet and setup never finished or skipped.
export function needsSetup(st) {
  return !app.sample && !st.settings.setupDone && !st.entries.length && !st.recurring.length && !st.goals.length;
}

const d = { step: 1, freq: 'biweekly', date: '', amount: '', goal: '', target: '', error: '' };

export function renderSetup({ onSample }) {
  const now = nowStamp();
  if (!d.date) d.date = now.slice(0, 10);
  const go = (step) => { d.error = ''; d.step = step; app.render(); requestAnimationFrame(() => document.querySelector('.setup input, .setup .chip[aria-pressed="true"]')?.focus()); };
  const dots = h('div', { class: 'setup-dots', 'aria-label': `Step ${d.step} of 3` },
    [1, 2, 3].map((i) => h('span', { class: i <= d.step ? 'on' : '' })));
  const error = d.error ? h('p', { class: 'error', role: 'alert' }, d.error) : null;

  let body;
  if (d.step === 1) {
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'How often you get paid' },
      [...PAY_CHOICES, ['irregular', 'It changes']].map(([v, t]) => h('button', { class: 'chip', 'aria-pressed': String(d.freq === v), onClick: () => { d.freq = v; app.render(); } }, t)));
    body = [
      h('h2', { class: 'setup-q' }, 'How often do you get paid?'),
      chips,
      d.freq === 'irregular'
        ? h('p', { class: 'dim' }, 'No problem. Log each paycheck when it lands, and the app plans with your usual amount.')
        : d.freq === 'semimonthly'
          ? h('p', { class: 'dim' }, `On the 15th and the last day of the month (you can change the days later). Next one: ${formatDate(`${nextSemiDate([15, 31], now)}T00:00`, { weekday: true })}.`)
          : h('label', { class: 'field' }, h('span', {}, 'When is your next payday?'),
            h('input', { class: 'input', type: 'date', value: d.date, min: now.slice(0, 10), onInput: (e) => { d.date = e.target.value; } })),
      error,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => {
        if (d.freq !== 'irregular' && d.freq !== 'semimonthly' && !isStamp(`${d.date}T09:00`)) { d.error = 'Pick the date of your next payday'; app.render(); return; }
        go(d.freq === 'irregular' ? 3 : 2);
      } }, 'Next')),
      h('button', { class: 'link center-link', onClick: onSample }, 'Just look around with example data first'),
    ];
  } else if (d.step === 2) {
    body = [
      h('h2', { class: 'setup-q' }, 'About how much is each paycheck?'),
      h('label', { class: 'field' }, h('span', { class: 'sr' }, 'Paycheck amount'),
        h('div', { class: 'money-input big-money' }, h('span', { class: 'cur' }, '$'),
          h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', value: d.amount, onInput: (e) => { d.amount = e.target.value; } }))),
      h('p', { class: 'faint small-note' }, 'What actually lands in your account. A rough number is fine; you can change it any time.'),
      error,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => {
          if (parseAmount(d.amount) === null) { d.error = 'Enter about how much, like 1200'; app.render(); return; }
          go(3);
        } }, 'Next'),
        h('button', { class: 'btn ghost', onClick: () => go(1) }, 'Back')),
    ];
  } else {
    body = [
      h('h2', { class: 'setup-q' }, 'One thing you\'re saving for?'),
      h('p', { class: 'dim' }, 'Optional. A goal gives your money somewhere to go.'),
      h('label', { class: 'field' }, h('span', {}, 'Goal'), h('input', { class: 'input', maxlength: 60, placeholder: 'e.g. Emergency fund', value: d.goal, onInput: (e) => { d.goal = e.target.value; } })),
      h('label', { class: 'field' }, h('span', {}, 'Amount'),
        h('div', { class: 'money-input' }, h('span', { class: 'cur' }, '$'), h('input', { class: 'input', inputmode: 'decimal', placeholder: '1000', value: d.target, onInput: (e) => { d.target = e.target.value; } }))),
      error,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => finish(true) }, 'Finish'),
        h('button', { class: 'btn ghost', onClick: () => finish(false) }, 'Skip for now'),
        h('button', { class: 'link center-link', onClick: () => go(d.freq === 'irregular' ? 1 : 2) }, 'Back')),
    ];
  }

  return h('section', { class: 'setup' },
    h('div', { class: 'setup-top' },
      h('div', { class: 'setup-logo', 'aria-hidden': 'true' }, icon('leaf')),
      h('p', { class: 'eyebrow' }, 'Set up in under a minute'),
      dots),
    body,
    d.step === 1 ? h('button', { class: 'link center-link faint', onClick: () => finish(false, true) }, 'Skip setup') : null);
}

function finish(withGoal, skipAll = false) {
  const now = nowStamp();
  let goal = null;
  if (withGoal) {
    const target = parseAmount(d.target);
    if (!d.goal.trim() && !d.target.trim()) { finish(false); return; }
    if (!d.goal.trim() || target === null) { d.error = !d.goal.trim() ? 'Give your goal a name' : 'Enter an amount, like 1000'; app.render(); return; }
    goal = cleanGoal({ id: newId(), name: d.goal.trim(), targetCents: target, createdAt: new Date().toISOString() });
  }
  const cents = parseAmount(d.amount);
  change((st) => {
    st.settings.setupDone = true;
    if (skipAll) return;
    if (d.freq === 'irregular') st.settings.payMode = 'irregular';
    else if (cents !== null) {
      const anchor = d.freq === 'semimonthly' ? `${nextSemiDate([15, 31], now)}T09:00` : `${d.date}T09:00`;
      const rule = cleanRule({ id: newId(), type: 'income', kind: 'paycheck', name: 'Paycheck', category: PAYCHECK, cents, freq: d.freq, anchor, nextIndex: 0, endAt: null, ...(d.freq === 'semimonthly' ? { days: [15, 31] } : {}) });
      if (rule) addRule(st, rule, now, newId);
    }
    if (goal) st.goals.push(goal);
  }, skipAll ? null : goal ? `All set. ${goal.name}: ${formatCents(goal.targetCents)}` : 'All set');
}
