// Dates are stored as local "stamps": "YYYY-MM-DDTHH:mm" (minute precision).
// Stamps sort correctly as plain strings, so comparisons are exact and simple.

const pad = (n, w = 2) => String(n).padStart(w, '0');
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function makeStamp(y, m, d, hh = 0, mm = 0) {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}`;
}

export function toStamp(date) {
  return makeStamp(date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes());
}

export function nowStamp() {
  return toStamp(new Date());
}

export function parseStamp(s) {
  const m = STAMP_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, hh, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || hh > 23 || mi > 59) return null;
  return { y, m: mo, d, hh, mi };
}

export function isStamp(s) {
  return typeof s === 'string' && parseStamp(s) !== null;
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Calendar maths in UTC so daylight-saving changes can never shift a day.
export function addDays(y, m, d, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function weekday(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

function shiftMonth(y, m, delta) {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((n) => n.slice(0, 3));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The day a budget month starts, clamped for short months (e.g. 31st -> Feb 28).
function anchorDay(y, m, startDay) {
  return Math.min(startDay, daysInMonth(y, m));
}

function budgetMonthFrom(y, m, startDay) {
  const next = shiftMonth(y, m, 1);
  const start = makeStamp(y, m, anchorDay(y, m, startDay));
  const end = makeStamp(next.y, next.m, anchorDay(next.y, next.m, startDay));
  let label;
  if (startDay === 1) label = `${MONTHS[m - 1]} ${y}`;
  else {
    const endDay = addDays(next.y, next.m, anchorDay(next.y, next.m, startDay), -1);
    label = `${MON[m - 1]} ${anchorDay(y, m, startDay)} – ${MON[endDay.m - 1]} ${endDay.d}`;
  }
  const short = startDay === 1 ? MONTHS[m - 1] : label;
  return { kind: 'month', start, end, label, short, y, m, startDay };
}

// Budget month containing `stamp`. Period is [start, end).
export function budgetMonth(stamp, startDay = 1) {
  const p = parseStamp(stamp);
  if (!p) throw new Error(`Bad date: ${stamp}`);
  if (p.d >= anchorDay(p.y, p.m, startDay)) return budgetMonthFrom(p.y, p.m, startDay);
  const prev = shiftMonth(p.y, p.m, -1);
  return budgetMonthFrom(prev.y, prev.m, startDay);
}

export function shiftBudgetMonth(period, delta) {
  const t = shiftMonth(period.y, period.m, delta);
  return budgetMonthFrom(t.y, t.m, period.startDay);
}

// Week containing `stamp`. weekStart: 0 = Sunday, 1 = Monday (default) ...
export function weekOf(stamp, weekStart = 1) {
  const p = parseStamp(stamp);
  if (!p) throw new Error(`Bad date: ${stamp}`);
  const back = (weekday(p.y, p.m, p.d) - weekStart + 7) % 7;
  const s = addDays(p.y, p.m, p.d, -back);
  return weekFrom(s.y, s.m, s.d, weekStart);
}

function weekFrom(y, m, d, weekStart) {
  const e = addDays(y, m, d, 7);
  const last = addDays(y, m, d, 6);
  return {
    kind: 'week', y, m, d, weekStart,
    start: makeStamp(y, m, d),
    end: makeStamp(e.y, e.m, e.d),
    label: `${MON[m - 1]} ${d} – ${MON[last.m - 1]} ${last.d}`,
  };
}

export function shiftWeek(period, delta) {
  const s = addDays(period.y, period.m, period.d, 7 * delta);
  return weekFrom(s.y, s.m, s.d, period.weekStart);
}

export function dayOf(stamp) {
  const p = parseStamp(stamp);
  if (!p) throw new Error(`Bad date: ${stamp}`);
  return dayFrom(p.y, p.m, p.d);
}

function dayFrom(y, m, d) {
  const e = addDays(y, m, d, 1);
  return {
    kind: 'day', y, m, d,
    start: makeStamp(y, m, d),
    end: makeStamp(e.y, e.m, e.d),
    label: `${DAYS[weekday(y, m, d)]}, ${MON[m - 1]} ${d}`,
  };
}

export function shiftDay(period, delta) {
  const s = addDays(period.y, period.m, period.d, delta);
  return dayFrom(s.y, s.m, s.d);
}

export function inPeriod(stamp, period) {
  return stamp >= period.start && stamp < period.end;
}

// Display helpers
export function formatTime(stamp) {
  const p = parseStamp(stamp);
  const h12 = p.hh % 12 === 0 ? 12 : p.hh % 12;
  return `${h12}:${pad(p.mi)} ${p.hh < 12 ? 'AM' : 'PM'}`;
}

export function formatDate(stamp, { weekday: wd = false, year = false } = {}) {
  const p = parseStamp(stamp);
  let s = `${MON[p.m - 1]} ${p.d}`;
  if (wd) s = `${DAYS[weekday(p.y, p.m, p.d)].slice(0, 3)}, ${s}`;
  if (year) s += `, ${p.y}`;
  return s;
}

export function formatDateTime(stamp) {
  return `${formatDate(stamp, { weekday: true })}, ${formatTime(stamp)}`;
}

export function dayKey(stamp) {
  return stamp.slice(0, 10);
}

export function monthName(m) {
  return MONTHS[m - 1];
}
