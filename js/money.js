// Money is always whole cents (integers). Never floats.

export const MAX_ENTRY_CENTS = 10_000_000_00; // $10,000,000.00 per entry

export function isCents(n) {
  return Number.isSafeInteger(n);
}

export function assertCents(n) {
  if (!isCents(n)) throw new TypeError(`Money must be whole cents, got ${n}`);
  return n;
}

// Turn what the user typed ("12.5", "$1,234.56", ".99") into cents.
// Returns a positive integer, or null if it isn't a valid amount.
export function parseAmount(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/[\s,$]/g, '');
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1];
  const frac = m[2] ?? '';
  if (whole === '' && frac === '') return null;
  if (whole.length > 9) return null;
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!isCents(cents) || cents <= 0 || cents > MAX_ENTRY_CENTS) return null;
  return cents;
}

const MINUS = '−'; // a proper minus sign, not a hyphen

// 123456 -> "$1,234.56". sign: 'auto' (minus only) or 'always' (+ for positive).
export function formatCents(cents, { sign = 'auto' } = {}) {
  assertCents(cents);
  const abs = Math.abs(cents);
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `$${dollars}.${String(abs % 100).padStart(2, '0')}`;
  if (cents < 0) return MINUS + body;
  if (sign === 'always' && cents > 0) return '+' + body;
  return body;
}

// For input fields: 1250 -> "12.50"
export function centsToInput(cents) {
  assertCents(cents);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

// Add up a list of cent values, refusing anything that isn't whole cents.
export function sumCents(values) {
  let total = 0;
  for (const v of values) {
    total += assertCents(v);
    assertCents(total);
  }
  return total;
}
