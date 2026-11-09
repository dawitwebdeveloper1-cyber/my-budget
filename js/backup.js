// Backup files: everything in one file you keep somewhere safe.
// If a passcode is set, the file is encrypted and opens with that passcode or your recovery key.

import { encryptData, decryptData, openVault } from './crypto.js';
import { cleanState } from './store.js';
import { parseStamp } from './dates.js';

export const BACKUP_FORMAT = 'my-budget-backup';

export async function makeBackup({ state, vault, dataKey, createdAt = new Date().toISOString() }) {
  const base = { format: BACKUP_FORMAT, version: 1, createdAt, entries: state.entries.length };
  if (vault && dataKey) {
    return { ...base, encrypted: true, passLen: vault.passLen, pass: vault.pass, rec: vault.rec, data: await encryptData(dataKey, state) };
  }
  return { ...base, encrypted: false, state };
}

export function parseBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { return { ok: false, error: "This file isn't a My Budget backup." }; }
  if (!b || b.format !== BACKUP_FORMAT || b.version !== 1) return { ok: false, error: "This file isn't a My Budget backup." };
  if (b.encrypted && !(b.pass && b.rec && b.data)) return { ok: false, error: 'This backup file is damaged.' };
  if (!b.encrypted && !b.state) return { ok: false, error: 'This backup file is damaged.' };
  return { ok: true, backup: b };
}

// Opens a backup. For encrypted ones, secret is the passcode or recovery key it was made with.
export async function readBackup(backup, secret) {
  if (!backup.encrypted) return { ok: true, state: cleanState(backup.state), dataKey: null };
  const dataKey = await openVault(backup, secret ?? '');
  if (!dataKey) return { ok: false, error: "That passcode or recovery key doesn't open this backup." };
  try {
    const state = cleanState(await decryptData(dataKey, backup.data));
    return { ok: true, state, dataKey };
  } catch {
    return { ok: false, error: 'This backup file is damaged.' };
  }
}

// Days since the last backup, or null if no reminder is needed.
export function backupDue(settings, hasData, now) {
  if (!settings.backupReminder || !hasData) return null;
  if (!settings.lastBackupAt) return Infinity;
  const a = parseStamp(settings.lastBackupAt);
  const b = parseStamp(now);
  if (!a || !b) return Infinity;
  const days = Math.floor((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
  return days >= 7 ? days : null;
}
