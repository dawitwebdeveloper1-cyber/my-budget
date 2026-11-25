// Trust and safety helpers: the spreadsheet export, checking a backup really opens, the lock timer,
// and undoing a whole bank import.

import { formatTime } from './dates.js';
import { parseBackup, readBackup } from './backup.js';
import { decryptData } from './crypto.js';
import { fromSaved } from './store.js';

// ---------- Spreadsheet export (CSV: opens in Numbers, Excel and Google Sheets) ----------
const TYPE_LABEL = { income: 'Money in', expense: 'Money out', saving: 'To savings', refund: 'Refund', repaid: 'Paid back' };

// A cell, quoted when needed. Text that a spreadsheet would treat as a formula (=, +, -, @) gets a
// leading apostrophe, so opening the file can never run anything.
function cell(v, { text = true } = {}) {
  let s = v == null ? '' : String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Signed amount in dollars with exactly two decimals, built from whole cents (no rounding anywhere).
export function centsText(c) {
  const sign = c < 0 ? '-' : '';
  const a = Math.abs(c);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

export function toCSV(state, now) {
  const goals = new Map(state.goals.map((g) => [g.id, g.name]));
  const rules = new Map(state.recurring.map((r) => [r.id, r.name]));
  const rows = [['Date', 'Time', 'Type', 'Name', 'Category', 'Amount', 'Owed to you', 'Cash', 'Goal', 'Repeating', 'Note']];
  const list = state.entries.filter((e) => e.at <= now).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const e of list) {
    const signed = e.type === 'income' || e.type === 'refund' || e.type === 'repaid' ? e.cents : -e.cents;
    rows.push([
      cell(e.at.slice(0, 10)), cell(formatTime(e.at)), cell(TYPE_LABEL[e.type] ?? e.type), cell(e.name), cell(e.category),
      cell(centsText(signed), { text: false }), e.owed ? cell(centsText(e.owed), { text: false }) : '', e.cash ? 'Yes' : '',
      cell(goals.get(e.goalId) ?? ''), cell(rules.get(e.recurringId) ?? ''), cell(e.note ?? ''),
    ]);
  }
  // Excel on Windows needs the byte-order mark to read accents (é, ü) correctly.
  return `﻿${rows.map((r) => r.join(',')).join('\r\n')}\r\n`;
}

// ---------- "Check this backup works" ----------
// Opens the chosen file the same way a restore would, without changing anything, and compares it
// with what's in the app right now. An encrypted backup made on this phone opens with the key in memory.
export async function checkBackup(text, { state, dataKey = null, secret = null }) {
  const parsed = parseBackup(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const b = parsed.backup;
  let opened = null;
  try {
    if (b.encrypted && dataKey) opened = fromSaved(await decryptData(dataKey, b.data));
  } catch { /* a different key: try the passcode below */ }
  if (!opened) {
    if (b.encrypted && !secret) return { ok: false, needsSecret: true };
    const r = await readBackup(b, secret);
    if (!r.ok) return { ok: false, error: r.error };
    opened = r.state;
  }
  const counts = (s) => ({ entries: s.entries.length, goals: s.goals.length, schedules: s.recurring.length });
  const inFile = counts(opened);
  const now = counts(state);
  return { ok: true, encrypted: !!b.encrypted, createdAt: b.createdAt ?? null, inFile, now, same: inFile.entries === now.entries && inFile.goals === now.goals && inFile.schedules === now.schedules };
}

// ---------- Lock timer ----------
export const LOCK_CHOICES = [[0, 'Right away'], [1, 'After 1 minute'], [5, 'After 5 minutes'], [15, 'After 15 minutes']];
export function lockDelayMs(settings) {
  const m = LOCK_CHOICES.some(([v]) => v === settings?.lockAfter) ? settings.lockAfter : 1;
  return m * 60_000;
}

// ---------- Undo a whole bank import ----------
export function undoImport(state, batch) {
  const gone = new Set(state.entries.filter((e) => e.importBatch === batch).map((e) => e.id));
  const before = state.entries.length;
  state.entries = state.entries.filter((e) => !gone.has(e.id) && !gone.has(e.parentId));
  state.notice = state.notice.filter((n) => !gone.has(n));
  if (state.lastImport?.batch === batch) state.lastImport = null;
  return before - state.entries.length;
}
