// Pieces shared by every screen: money display, progress bars and "show me how" receipts.
import { h, icon, openSheet } from './ui.js';
import { formatCents } from './money.js';
import { formatDateTime } from './dates.js';
import { receiptMatches } from './calc.js';
import { hoursPay, formatHours, formatExact } from './budget.js';
import { app } from './state.js';

export const UNVERIFIED = "Couldn't double-check this number, so it's hidden.";

// Money in: gold, plus sign, up arrow. Money out: coral, minus sign, down arrow.
export function money(cents, { kind, plain = false } = {}) {
  const k = kind ?? (cents > 0 ? 'in' : cents < 0 ? 'out' : 'zero');
  const cls = k === 'in' ? 'in' : k === 'out' ? 'out' : k === 'save' ? 'dim' : '';
  return h('span', { class: `amt num ${cls}` },
    !plain && k === 'in' ? icon('up', 'arrow') : !plain && (k === 'out' || k === 'save') ? icon('down', 'arrow') : null,
    formatCents(cents, { sign: plain ? 'auto' : 'always' }));
}

export function howButton(result, label = 'Show me how') {
  return h('button', { class: 'how', onClick: (e) => { e.stopPropagation(); openReceipt(result); } }, icon('receipt'), label);
}

export function bar(percent, { over = false, gold = false } = {}) {
  const fill = h('i', { class: over ? 'over' : gold ? 'gold' : '' });
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`; // CSSOM, allowed by the security policy
  return h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(Math.min(100, percent)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
}

const COLOURS = ['#8FB39A', '#7FA6B8', '#A890B4', '#6FA8A0', '#C9BFA8', '#9AA77A', '#B48FA0', '#8C9DC0', '#A3A39A'];
export function categoryColour(name) {
  const i = app.state.categories.expense.indexOf(name);
  if (i >= 0) return COLOURS[i % COLOURS.length];
  let x = 0;
  for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOURS[x % COLOURS.length];
}

const signCls = (c, neutral) => (neutral ? '' : c > 0 ? 'in' : c < 0 ? 'out' : '');

// ---------- "Show me how" ----------
export function openReceipt(result) {
  openSheet(result?.receipt?.title ?? 'Show me how', () => receiptBody(result));
}

export function receiptBody(result) {
  if (result?.receipt?.kind === 'product') return productReceipt(result);
  if (!result?.ok || !receiptMatches(result.receipt, result.value)) return h('p', { class: 'unverified' }, UNVERIFIED);
  const r = result.receipt;
  const lines = r.lines.map((l) => h('div', { class: 'r-line' },
    h('div', { class: 'l' }, l.label,
      l.at ? h('small', {}, `${formatDateTime(l.at)}${l.category && l.type === 'expense' ? ` · ${l.category}` : ''}`) : null),
    h('div', { class: `r ${signCls(l.cents, l.neutral)}` }, formatCents(l.cents, { sign: 'always' }))));
  const neutralTotal = r.lines.length > 0 && r.lines.every((l) => l.neutral);
  return h('div', { class: 'receipt' },
    h('div', { class: 'receipt-scroll' }, lines.length ? lines : h('div', { class: 'r-empty' }, 'Nothing yet.')),
    h('hr', { class: 'rule' }),
    h('div', { class: 'r-total' }, h('div', {}, r.totalLabel),
      h('div', { class: `r num ${signCls(result.value, neutralTotal)}` }, formatCents(result.value, { sign: 'always' }))),
    h('p', { class: 'receipt-foot' }, `${r.lines.length} ${r.lines.length === 1 ? 'item' : 'items'} · worked out two ways, both match`));
}

// Hours × hourly pay, shown as column multiplication.
function productReceipt(result) {
  const r = result.receipt;
  const again = hoursPay(r.hours, r.rateCents);
  if (!result.ok || !again.ok || again.value !== r.total) return h('p', { class: 'unverified' }, UNVERIFIED);
  const exact = formatExact(r.exact);
  const rounded = formatCents(r.total);
  const line = (l, v, cls = '') => h('div', { class: 'r-line' }, h('div', { class: 'l' }, l), h('div', { class: `r ${cls}` }, v));
  return h('div', { class: 'receipt' },
    line('Hours worked', formatHours(r.hours)),
    line('× Hourly pay', formatCents(r.rateCents)),
    h('hr', { class: 'rule' }),
    line('Exact pay', exact),
    h('div', { class: 'r-total' }, h('div', {}, 'Rounded to the cent'), h('div', { class: 'r num in' }, `+${rounded}`)),
    h('p', { class: 'receipt-foot' }, exact.replace(/0+$/, '') === rounded || exact === rounded
      ? 'No rounding needed · worked out two ways, both match'
      : 'Half a cent or more rounds up · worked out two ways, both match'));
}
