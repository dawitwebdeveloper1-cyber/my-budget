// "Can I afford it?" and "Try a what-if" (practice mode). Neither one ever changes your data.
import { h, openSheet } from '../ui.js';
import { app } from '../state.js';
import { parseAmount, formatCents } from '../money.js';
import { nowStamp, formatDate } from '../dates.js';
import { canAfford, whatIf, usualCategorySpend, forecastText } from '../decide.js';
import { howButton } from '../components.js';
import { openPaySetup } from './paysetup.js';

const VERDICT = { yes: 'Yes', yesbut: 'Yes, but…', notyet: 'Not yet' };

export function openAfford(from = null) {
  const d = { price: '' };
  let result = null;
  let error = '';
  const sheet = openSheet('Can I afford it?', () => view(), { from });

  function view() {
    const input = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', value: d.price, onInput: (e) => { d.price = e.target.value; },
      onKeydown: (e) => { if (e.key === 'Enter') check(); } });
    queueMicrotask(() => { if (!result) input.focus(); });
    return [
      h('label', { class: 'field' }, h('span', {}, 'What does it cost?'),
        h('div', { class: 'inline' },
          h('div', { class: 'money-input grow' }, h('span', { class: 'cur' }, '$'), input),
          h('button', { class: 'btn primary narrow', onClick: check }, 'Check'))),
      error ? h('p', { class: 'error' }, error) : null,
      result ? answer(result) : h('p', { class: 'faint small-note' }, 'Just a question. Nothing is saved or spent.'),
    ];
  }

  function check() {
    error = '';
    const cents = parseAmount(d.price);
    if (cents === null) { error = 'Enter a price, like 120'; result = null; sheet.setContent(view()); return; }
    result = canAfford(app.state, nowStamp(), cents);
    sheet.setContent(view());
  }

  function answer(r) {
    if (!r.ok && r.reason === 'nopay') {
      return h('div', { class: 'afford' },
        h('p', { class: 'dim' }, 'Set up your pay first, so the app knows when your next payday is.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => { sheet.close(); openPaySetup(); } }, 'Set up your pay')));
    }
    if (!r.ok) return h('p', { class: 'unverified' }, "Couldn't double-check this answer, so it isn't shown.");
    let text;
    const hows = [howButton(r)];
    if (r.verdict === 'yes') {
      const when = r.lup.nextLabel ? ` until ${r.lup.nextLabel}` : ' until payday';
      text = `You'd have ${formatCents(r.after)} left${when}${r.perDay ? `, about ${formatCents(r.perDay.value)} a day` : ''}.`;
      if (r.perDay) hows.push(howButton(r.perDay, 'The daily amount'));
    } else if (r.verdict === 'yesbut') {
      const back = r.pushed === null ? '' : r.pushed === 0 ? ', and it still finishes on the same day' : `, which pushes it back ${r.pushed} ${r.pushed === 1 ? 'day' : 'days'} (to ${r.after.label})`;
      text = `It takes ${formatCents(r.gap)} from ${r.goal.name}${back}.`;
      if (r.after.receipt) hows.push(howButton(r.after, `${r.goal.name}'s new date`));
    } else if (r.paychecks) {
      const n = r.paychecks.value;
      text = `You could in ${n} ${n === 1 ? 'paycheck' : 'paychecks'}${r.paychecks.when ? ` (by ${formatDate(r.paychecks.when, { weekday: true })})` : ''}. You're ${formatCents(r.gap)} short right now.`;
      hows.push(howButton(r.paychecks, 'How many paychecks'));
    } else {
      text = `You're ${formatCents(r.gap)} short until payday. Once a full pay period is logged with something left over, this will say how many paychecks it takes.`;
    }
    return h('div', { class: `afford ${r.verdict}` },
      h('div', { class: 'verdict' }, VERDICT[r.verdict]),
      h('p', { class: 'afford-text' }, text),
      r.stale ? h('p', { class: 'faint small-note' }, `${r.stale} Log anything newer for a sharper answer.`) : null,
      h('div', { class: 'hows' }, hows));
  }
}

// ---------- What-if practice ----------
export function openWhatIf(from = null) {
  const s = app.state;
  const cats = s.categories.expense;
  const d = { category: cats.includes('Eating Out') ? 'Eating Out' : cats[0], amount: '40', goalId: s.goals[0]?.id ?? null };
  let error = '';
  const sheet = openSheet('Try a what-if', () => view(), { from });

  function view() {
    const head = h('div', { class: 'practice-badge' }, 'Practice mode · nothing here is saved');
    if (!s.goals.length) {
      return h('div', { class: 'practice' }, head, h('p', { class: 'dim' }, 'Create a savings goal first (in Goals), then see how a change would move its finish date.'));
    }
    const now = nowStamp();
    const chips = (label, options, value, pick) => h('div', { class: 'chips', role: 'group', 'aria-label': label }, options.map(([v, t]) =>
      h('button', { class: 'chip', 'aria-pressed': String(value === v), onClick: () => { pick(v); sheet.setContent(view()); } }, t)));
    const usual = usualCategorySpend(s, now, d.category);
    const out = h('div', { class: 'whatif-out' });
    const fill = () => {
      const c = parseAmount(d.amount);
      if (c === null) { out.replaceChildren(h('p', { class: 'faint small-note' }, 'Enter an amount, like 40')); return; }
      const w = whatIf(s, now, { goalId: d.goalId, perPaycheck: c });
      out.replaceChildren(...result(w, c));
    };
    const amountInput = h('input', { class: 'input', inputmode: 'decimal', value: d.amount, onInput: (e) => { d.amount = e.target.value; fill(); } });
    const parts = h('div', { class: 'practice' },
      head,
      h('div', { class: 'field' }, h('span', {}, 'What if I cut back on'), chips('Category', cats.map((c) => [c, c]), d.category, (v) => { d.category = v; })),
      h('label', { class: 'field' }, h('span', {}, 'By this much each paycheck'),
        h('div', { class: 'money-input' }, h('span', { class: 'cur' }, '$'), amountInput)),
      usual ? h('p', { class: 'faint small-note' }, `You usually spend ${formatCents(usual)} on ${d.category} a paycheck.`) : null,
      h('div', { class: 'field' }, h('span', {}, 'And put it toward'), chips('Goal', s.goals.map((g) => [g.id, g.name]), d.goalId, (v) => { d.goalId = v; })),
      out);
    fill();
    return parts;
  }

  function result(w, c) {
    if (!w.ok) return [h('p', { class: 'unverified' }, "Couldn't double-check this, so it isn't shown.")];
    if (w.before.done) return [h('p', { class: 'dim' }, `${w.goal.name} is already reached.`)];
    if (w.noPaydays) return [h('p', { class: 'dim' }, 'Set up your pay (Settings → Money → Your pay) so the app knows when paychecks come.')];
    const was = w.before.label ?? (w.before.beyond ? 'more than 10 years' : 'no date yet');
    const now = w.after.label ?? 'more than 10 years';
    return [
      h('div', { class: 'whatif-dates' },
        h('div', {}, h('div', { class: 'faint small' }, 'Now'), h('div', { class: 'num big-ish' }, was)),
        h('div', { class: 'arrow-r', 'aria-hidden': 'true' }, '→'),
        h('div', {}, h('div', { class: 'faint small' }, `With ${formatCents(c)} more`), h('div', { class: 'num big-ish' }, now))),
      h('p', { class: 'afford-text' }, w.sooner ? `${w.goal.name} would be reached ${w.sooner} ${w.sooner === 1 ? 'day' : 'days'} sooner.` : forecastText(w.after) ?? ''),
      w.after.receipt ? h('div', { class: 'hows' }, howButton(w.after, 'Show me how')) : null,
      h('p', { class: 'faint small-note' }, 'To make it real, lower your spending and add the money to the goal, or raise its auto-save.'),
    ];
  }
}
