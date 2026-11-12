// Reads the total and the store name from a receipt's text (the text comes from the scanner).
// Rule from the plan: look for "TOTAL" first; if there isn't one, use the largest amount.
// Lines about payment and change (CASH 50.00, CHANGE 7.50) are never taken as the total.

// Money with exactly two decimals: "12.50", "$1,234.56", "12,50" (a misread decimal point).
const MONEY = /(?:\$\s?)?(\d{1,3}(?:[ ,]\d{3})*|\d+)[.,](\d{2})(?!\d)/g;

export function amountsIn(text) {
  const out = [];
  for (const m of String(text).matchAll(MONEY)) {
    const whole = m[1].replace(/[ ,]/g, '');
    if (whole.length > 7) continue;
    out.push(Number(whole) * 100 + Number(m[2]));
  }
  return out;
}

const TOTAL_WORDS = /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|total|montant\s*total|total\s*à\s*payer)\b/i;
const NOT_TOTAL = /\b(sub\s*-?\s*total|subtotal|sous[-\s]?total|total\s*(savings|saved|discount|tax|taxes|items?|qty|quantity|points)|tax\s*total|you\s*saved|items?\s*sold)\b/i;
const PAYMENT = /\b(cash|change|tendered|tender|visa|mastercard|master\s*card|debit|interac|amex|credit|card|tip|gratuity|refund|points|balance\s*remaining|rounding)\b/i;

// lines: [{ text, bbox? }] from top to bottom.
export function findTotal(lines) {
  // 1. A line that says TOTAL (the last one wins: totals sit near the bottom; SUBTOTAL is skipped).
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].text;
    if (!TOTAL_WORDS.test(t) || NOT_TOTAL.test(t)) continue;
    let nums = amountsIn(t);
    let at = i;
    if (!nums.length && lines[i + 1]) { nums = amountsIn(lines[i + 1].text); at = i + 1; } // amount on the next line
    if (nums.length) return { cents: nums[nums.length - 1], line: at, how: 'total' };
  }
  // 2. Otherwise the largest amount that isn't a payment or change line.
  let best = null;
  lines.forEach((l, i) => {
    if (PAYMENT.test(l.text)) return;
    for (const c of amountsIn(l.text)) if (!best || c > best.cents) best = { cents: c, line: i, how: 'largest' };
  });
  return best;
}

const ADDRESS = /\b(\d+\s+\w+\s+(st|street|ave|avenue|rd|road|blvd|dr|drive|way|cres|trail|tr|hwy|sw|se|nw|ne)\b|calgary|edmonton|toronto|vancouver|ottawa|montreal|alberta|ontario|\b[a-z]\d[a-z]\s?\d[a-z]\d\b)/i;
const NOISE = /\b(welcome|thank|receipt|store\s*#|tel|phone|www\.|\.com|gst|hst|reg\s*#|cashier|server|table|order|transaction|invoice)\b/i;

// The store name: the first sensible line near the top.
export function findStore(lines) {
  for (const l of lines.slice(0, 6)) {
    if (l.confidence !== undefined && l.confidence < 70) continue; // only lines the reader is sure about
    const t = l.text
      .replace(/#\s*\d+/g, ' ')           // store numbers: "Tim Hortons #4471"
      .replace(/\b(store|no\.?)\s*\d+\b/gi, ' ')
      .replace(/[^\p{L}\p{N}&'. -]+/gu, ' ').replace(/\s+/g, ' ').trim();
    const letters = (t.match(/\p{L}/gu) ?? []).length;
    if (letters < 3 || letters < t.length * 0.5) continue;
    if (ADDRESS.test(t) || NOISE.test(t) || amountsIn(t).length) continue;
    return t.length > 40 ? t.slice(0, 40).trim() : t.replace(/\b(\p{L})(\p{L}*)/gu, (m, a, b) => a.toUpperCase() + b.toLowerCase());
  }
  return '';
}

export function readReceipt(lines) {
  const clean = lines.map((l) => ({ ...l, text: String(l.text ?? '').trim() })).filter((l) => l.text);
  return { total: findTotal(clean), store: findStore(clean), lines: clean };
}
