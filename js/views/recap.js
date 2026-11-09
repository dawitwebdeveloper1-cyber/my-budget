// Month-end summary: a short recap of a finished month.
import { h, openSheet } from '../ui.js';
import { app } from '../state.js';
import { formatCents } from '../money.js';
import { monthSummary } from '../calc.js';
import { categoryBudgets } from '../budget.js';
import { money, openReceipt, UNVERIFIED } from '../components.js';

export function openRecap(period, now) {
  const st = app.state;
  const sum = monthSummary(st.entries, period, now);
  const budgets = categoryBudgets(st, period, now);
  openSheet(`${period.short} recap`, () => {
    if (!sum.left.ok || !sum.net.ok) return h('p', { class: 'unverified' }, UNVERIFIED);
    const row = (label, result, kind) => h('button', { class: 'row', onClick: () => openReceipt(result) },
      h('span', { class: 'name' }, h('span', {}, label)),
      money(result.value, { kind: result.value === 0 ? 'zero' : kind }));
    const net = sum.net.value;
    const headline = net > 0 ? `You finished ${period.short} ${formatCents(net)} ahead.`
      : net < 0 ? `You finished ${period.short} ${formatCents(-net)} behind.`
        : `You finished ${period.short} even.`;
    const top = sum.byCategory[0];
    const over = budgets.rows.filter((r) => r.over > 0);
    const savedTotal = sum.saved.ok ? -sum.saved.value : 0;
    const facts = [
      top ? `Biggest spending: ${top.category}, ${formatCents(top.value)}.` : 'No spending recorded.',
      savedTotal > 0 ? `You moved ${formatCents(savedTotal)} to savings.` : null,
      over.length ? `Over the limit: ${over.map((r) => `${r.category} (${formatCents(r.over)})`).join(', ')}.`
        : budgets.rows.some((r) => r.limit !== null) ? 'Every category stayed within its limit.' : null,
    ].filter(Boolean);
    return [
      h('p', { class: 'recap-head' }, headline),
      h('div', { class: 'card flat' }, h('div', { class: 'rows' },
        row('Started with', sum.carry, sum.carry.value < 0 ? 'out' : 'in'),
        row('Money in', sum.moneyIn, 'in'),
        sum.saved.value !== 0 ? row('Moved to savings', sum.saved, 'save') : null,
        row('Money out', sum.moneyOut, 'out'),
        row('Ended with', sum.left, sum.left.value < 0 ? 'out' : 'in'))),
      h('ul', { class: 'facts' }, facts.map((f) => h('li', {}, f))),
    ];
  });
}
