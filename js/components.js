// Pieces shared by every screen: money display, progress bars and "show me how" receipts.
import { h, icon, openSheet } from './ui.js';
import { formatCents } from './money.js';
import { formatDateTime } from './dates.js';
import { receiptMatches } from './calc.js';
import { hoursPay, formatHours, formatExact, formatPercent } from './budget.js';
import { app } from './state.js';
import { reducedMotion } from './motion.js';

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
  return h('button', { class: 'how', onClick: (e) => { e.stopPropagation(); openReceipt(result, e.currentTarget.closest('.card') ?? e.currentTarget); } }, icon('receipt'), label);
}

// Progress bar. With fill: true it fills from left to right when shown.
export function bar(percent, { over = false, gold = false, fill = false, delay = 0 } = {}) {
  const width = `${Math.max(0, Math.min(100, percent))}%`;
  const inner = h('i', { class: over ? 'over' : gold ? 'gold' : '' });
  const el = h('div', { class: `bar${fill ? ' fill' : ''}`, role: 'progressbar', 'aria-valuenow': String(Math.min(100, percent)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, inner);
  if (fill && !reducedMotion()) {
    inner.style.width = '0%'; // CSSOM, allowed by the security policy
    setTimeout(() => requestAnimationFrame(() => { inner.style.width = width; }), 40 + delay);
  } else {
    inner.style.width = width;
  }
  return el;
}

// Ring chart colours come from the app palette (and switch with dark mode).
export function categoryColour(name) {
  let i = app.state.categories.expense.indexOf(name);
  if (i < 0) {
    let x = 0;
    for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
    i = x;
  }
  return `var(--c${(i % 9) + 1})`;
}

const TINTS = ['sage', 'peach', 'lav'];
export const tint = (i) => TINTS[i % TINTS.length];

// Friendly empty state: a small icon, a line or two of text, and (optionally) one button.
export function emptyState(iconName, title, text, action = null) {
  return h('div', { class: 'empty' },
    h('span', { class: 'em-ic' }, icon(iconName)),
    title ? h('b', {}, title) : null,
    text ? h('p', {}, text) : null,
    action ? h('button', { class: 'btn primary narrow empty-go', onClick: action.run }, action.label) : null);
}

const signCls = (c, neutral) => (neutral ? '' : c > 0 ? 'in' : c < 0 ? 'out' : '');

// ---------- "Show me how" ----------
// `from`: the tapped card, which expands smoothly into the receipt.
export function openReceipt(result, from = null) {
  openSheet(result?.receipt?.title ?? 'Show me how', () => receiptBody(result), { from });
}

export function receiptBody(result) {
  if (result?.receipt?.kind === 'product') return productReceipt(result);
  if (result?.receipt?.kind === 'ratio') return ratioReceipt(result);
  if (result?.receipt?.kind === 'divide') return divideReceipt(result);
  if (result?.receipt?.kind === 'forecast') return forecastReceipt(result);
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

// A percentage, shown as column division, then every item behind both numbers.
function ratioReceipt(result) {
  const r = result.receipt;
  const okParts = result.ok && receiptMatches(r.spentReceipt, r.spent) && receiptMatches(r.baseReceipt, r.base)
    && Math.floor((Math.max(0, r.spent) * 100) / r.base) === r.percent;
  if (!okParts) return h('p', { class: 'unverified' }, UNVERIFIED);
  const exactText = `${Math.floor(r.exact / 100)}.${String(r.exact % 100).padStart(2, '0')}%`;
  const line = (l, v) => h('div', { class: 'r-line' }, h('div', { class: 'l' }, l), h('div', { class: 'r' }, v));
  const part = (title, receipt, value) => h('div', { class: 'receipt-part' }, h('h4', {}, title),
    receiptBody({ ok: true, value, receipt }));
  return h('div', {},
    h('div', { class: 'receipt' },
      line(r.spentLabel, formatCents(r.spent)),
      line(`÷ ${r.baseLabel}`, formatCents(r.base)),
      h('hr', { class: 'rule' }),
      line('Exact', exactText),
      h('div', { class: 'r-total' }, h('div', {}, 'Shown as (rounded down)'), h('div', { class: 'r num' }, `${r.percent}%`)),
      h('p', { class: 'receipt-foot' }, 'Rounded down so it never reaches a milestone early · worked out two ways, both match')),
    part(r.spentLabel, r.spentReceipt, r.spent),
    part(r.baseLabel, r.baseReceipt, r.base));
}

// An amount split evenly (per day, or an average), shown as column division, rounded down.
function divideReceipt(result) {
  const r = result.receipt;
  const by = Number(r.by);
  const partsOk = !r.parts || r.parts.reduce((a, p) => a + p.cents, 0) === r.top;
  // Rounded down, or up for "how many paychecks" (you can't wait part of a paycheck).
  const a = r.roundUp ? Math.ceil(r.top / by) : Math.floor(r.top / by);
  const big = BigInt(r.top);
  const q = big / BigInt(by);
  const rem = big % BigInt(by);
  const b = Number(rem === 0n ? q : r.roundUp ? (big > 0n ? q + 1n : q) : (big < 0n ? q - 1n : q));
  if (!result.ok || !Number.isInteger(by) || by < 1 || !partsOk || a !== r.result || b !== result.value) {
    return h('p', { class: 'unverified' }, UNVERIFIED);
  }
  // byMoney: money ÷ money = a count (e.g. $300 short ÷ $120 a paycheck = 3 paychecks, rounded up).
  const left = r.roundUp || r.byMoney ? 0 : r.top - r.result * by;
  const line = (l, v) => h('div', { class: 'r-line' }, h('div', { class: 'l' }, l), h('div', { class: 'r' }, v));
  return h('div', {},
    h('div', { class: 'receipt' },
      line(r.topLabel, formatCents(r.top)),
      line(`÷ ${r.byLabel}`, r.byMoney ? formatCents(by) : String(by)),
      h('hr', { class: 'rule' }),
      h('div', { class: 'r-total' }, h('div', {}, r.resultLabel ?? 'Each (rounded down)'),
        h('div', { class: 'r num' }, r.byMoney ? String(r.result) : formatCents(r.result))),
      h('p', { class: 'receipt-foot' }, `${left ? `${formatCents(left)} left over from rounding down · ` : ''}${r.roundUp ? 'Rounded up, since part of a paycheck isn\'t enough · ' : ''}worked out two ways, both match`)),
    r.parts ? h('div', { class: 'receipt-part' }, h('h4', {}, r.topLabel),
      receiptBody({ ok: true, value: r.top, receipt: { totalLabel: 'Added up', lines: r.parts.map((p) => ({ ...p, type: 'income' })) } })) : null);
}

// A goal's finish date: what's still to go, and how the paychecks and top-ups cover it.
function forecastReceipt(f) {
  const p = f.pace;
  const ok = f.ok && f.toGo === f.target - f.saved && f.fromPays === p.perPaycheck * f.nPays
    && f.fromPays + f.fromTopUps >= f.toGo;
  if (!ok) return h('p', { class: 'unverified' }, UNVERIFIED);
  const line = (l, v, small = null) => h('div', { class: 'r-line' }, h('div', { class: 'l' }, l, small ? h('small', {}, small) : null), h('div', { class: 'r' }, v));
  const each = [
    p.share ? `Auto-save ${formatPercent(p.bp)} of your usual ${formatCents(p.usual)} paycheck = ${formatCents(p.share)}` : null,
    p.extra ? `What-if: ${formatCents(p.extra)} more a paycheck` : null,
  ].filter(Boolean);
  return h('div', { class: 'receipt' },
    line('Goal', formatCents(f.target)),
    line(f.savedDelta ? 'Saved (after taking it out)' : 'Saved so far', formatCents(-f.saved)),
    h('hr', { class: 'rule' }),
    line('Still to go', formatCents(f.toGo)),
    p.perPaycheck ? line(`${f.nPays} ${f.nPays === 1 ? 'paycheck' : 'paychecks'} × ${formatCents(p.perPaycheck)}`, formatCents(f.fromPays), each.join(' · ')) : null,
    p.topUp90 ? line('Your top-ups', formatCents(f.fromTopUps), `${formatCents(p.topUp90)} added in the last 90 days, kept up for ${f.days} days`) : null,
    h('hr', { class: 'rule' }),
    h('div', { class: 'r-total' }, h('div', {}, 'Reached by'), h('div', { class: 'r num' }, f.label)),
    h('p', { class: 'receipt-foot' }, 'A forecast: it moves as your saving changes · worked out two ways, both match'));
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
