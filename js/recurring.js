// Recurring entries (rent, bills, subscriptions, paychecks) and calendar files.
// A rule creates a real entry each time its date and time arrive.

import { parseStamp, makeStamp, addDays, daysInMonth } from './dates.js';

export const FREQS = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

// Choices for bills and other repeating entries (twice a month is set up from "Your pay").
export const REPEAT_CHOICES = Object.entries(FREQS).filter(([k]) => k !== 'semimonthly');
export const PAY_CHOICES = Object.entries(FREQS).filter(([k]) => k !== 'yearly');

// Twice a month: two days, e.g. [15, 31]. 31 means "the last day of the month".
export function semiDays(rule) {
  const d = Array.isArray(rule.days) ? rule.days : [15, 31];
  return [Math.min(d[0], d[1]), Math.max(d[0], d[1])];
}

export const KINDS = {
  paycheck: 'Paycheck',
  bill: 'Bill',
  subscription: 'Subscription',
  other: 'Repeating',
};

// The k-th occurrence of a rule (k = 0 is the first). Monthly/yearly dates that
// don't exist in a month (e.g. the 31st) fall on that month's last day.
export function occurrenceAt(rule, k) {
  const p = parseStamp(rule.anchor);
  if (!p) throw new Error(`Bad rule date: ${rule.anchor}`);
  let y, m, d;
  if (rule.freq === 'weekly' || rule.freq === 'biweekly') {
    ({ y, m, d } = addDays(p.y, p.m, p.d, (rule.freq === 'weekly' ? 7 : 14) * k));
  } else if (rule.freq === 'semimonthly') {
    // The first date is one of the two days; after that it alternates between them every month.
    const [d1, d2] = semiDays(rule);
    const startsOnSecond = p.d !== Math.min(d1, daysInMonth(p.y, p.m)) ? 1 : 0;
    const i = k + startsOnSecond;
    const idx = p.y * 12 + (p.m - 1) + Math.floor(i / 2);
    y = Math.floor(idx / 12);
    m = (idx % 12) + 1;
    d = Math.min(i % 2 === 0 ? d1 : d2, daysInMonth(y, m));
  } else if (rule.freq === 'monthly' || rule.freq === 'yearly') {
    const idx = p.y * 12 + (p.m - 1) + (rule.freq === 'monthly' ? k : 12 * k);
    y = Math.floor(idx / 12);
    m = (idx % 12) + 1;
    d = Math.min(p.d, daysInMonth(y, m));
  } else {
    throw new Error(`Unknown schedule: ${rule.freq}`);
  }
  return makeStamp(y, m, d, p.hh, p.mi);
}

export function isActiveAt(rule, at) {
  return !rule.endAt || at < rule.endAt;
}

// Next occurrence that hasn't been added yet (or null if the rule has ended).
export function nextOccurrence(rule) {
  const at = occurrenceAt(rule, rule.nextIndex);
  return isActiveAt(rule, at) ? at : null;
}

// Upcoming dates from the next one onwards (for the Reminders tab).
export function upcoming(rule, count) {
  const out = [];
  for (let k = rule.nextIndex; out.length < count && k < rule.nextIndex + count + 1; k++) {
    const at = occurrenceAt(rule, k);
    if (!isActiveAt(rule, at)) break;
    out.push(at);
  }
  return out;
}

// Work out every occurrence that is now due (date and time have arrived).
// Pure: returns new entries and updated rules without changing the inputs.
export function generateDue(rules, now, makeId, cap = 1000) {
  const entries = [];
  const updated = rules.map((rule) => {
    let k = rule.nextIndex;
    let guard = 0;
    while (guard++ < cap) {
      const at = occurrenceAt(rule, k);
      if (at > now || !isActiveAt(rule, at)) break;
      entries.push({
        id: makeId(),
        type: rule.type,
        name: rule.name,
        cents: rule.cents,
        at,
        category: rule.category,
        note: '',
        recurringId: rule.id,
        occurrence: k,
        auto: true,
      });
      k++;
    }
    return k === rule.nextIndex ? rule : { ...rule, nextIndex: k };
  });
  return { entries, rules: updated };
}

// ---------- Calendar (.ics) files ----------

export const ALERT_DAY_OPTIONS = [[0, 'None'], [1, '1 day before'], [2, '2 days before'], [3, '3 days before'], [7, '1 week before']];
export const ALERT_MIN_OPTIONS = [[0, 'None'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before'], [120, '2 hours before']];

// "1 day and 1 hour before", for messages.
export function alertText(settings = {}) {
  const parts = [];
  const d = ALERT_DAY_OPTIONS.find(([v]) => v === (settings.alertDays ?? 1));
  const m = ALERT_MIN_OPTIONS.find(([v]) => v === (settings.alertMinutes ?? 60));
  if (d && d[0]) parts.push(d[1].replace(' before', ''));
  if (m && m[0]) parts.push(m[1].replace(' before', ''));
  return parts.length ? `${parts.join(' and ')} before` : 'with no alerts';
}

// Calendar alert times from Settings → Alerts (default: 1 day and 1 hour before).
export function alertTriggers(settings = {}) {
  const days = settings.alertDays ?? 1;
  const mins = settings.alertMinutes ?? 60;
  const out = [];
  if (days > 0) out.push(`-P${days}D`);
  if (mins > 0) out.push(mins % 60 === 0 ? `-PT${mins / 60}H` : `-PT${mins}M`);
  return out;
}

const pad = (n) => String(n).padStart(2, '0');

function icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 bytes must be folded (RFC 5545).
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    if (curLen + len > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; curLen = 0; }
    cur += ch;
    curLen += len;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

function icsLocal(stamp) {
  const p = parseStamp(stamp);
  return `${p.y}${pad(p.m)}${pad(p.d)}T${pad(p.hh)}${pad(p.mi)}00`;
}

function icsUtc(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function rrule(rule) {
  const p = parseStamp(rule.anchor);
  switch (rule.freq) {
    case 'weekly': return 'FREQ=WEEKLY';
    case 'biweekly': return 'FREQ=WEEKLY;INTERVAL=2';
    case 'semimonthly': {
      const [d1, d2] = semiDays(rule);
      return `FREQ=MONTHLY;BYMONTHDAY=${d1},${d2 === 31 ? -1 : d2}`;
    }
    case 'monthly':
      if (p.d <= 28) return `FREQ=MONTHLY;BYMONTHDAY=${p.d}`;
      // e.g. the 31st: "the last of the 28th–31st that exists" = last day in short months
      return `FREQ=MONTHLY;BYMONTHDAY=${Array.from({ length: p.d - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1`;
    case 'yearly':
      if (p.m === 2 && p.d === 29) return 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1';
      return 'FREQ=YEARLY';
    default: throw new Error(`Unknown schedule: ${rule.freq}`);
  }
}

// Builds a repeating calendar event with alerts (default: 1 day and 1 hour before).
export function buildICS(rule, { amountText, alerts = ['-P1D', '-PT1H'], stampNow = new Date() } = {}) {
  const start = nextOccurrence(rule) ?? occurrenceAt(rule, 0);
  const title = amountText ? `${rule.name} – ${amountText}` : rule.name;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//My Budget//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${rule.id}@my-budget`,
    `DTSTAMP:${icsUtc(stampNow)}`,
    `DTSTART:${icsLocal(start)}`,
    'DURATION:PT15M',
    `RRULE:${rrule(rule)}`,
    `SUMMARY:${icsText(title)}`,
    `DESCRIPTION:${icsText('Reminder from My Budget')}`,
    'TRANSP:TRANSPARENT',
  ];
  alerts.forEach((trigger, i) => {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(title)}`, `TRIGGER:${trigger}`, `X-WR-ALARMUID:${rule.id}-${i}`, 'END:VALARM');
  });
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
