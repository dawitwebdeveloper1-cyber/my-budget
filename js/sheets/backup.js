// Backups you can trust: one tap to save, a check that the file really opens, a spreadsheet of
// everything, and a privacy page in plain words.
import { h, openSheet, toast } from '../ui.js';
import { app, persist } from '../state.js';
import { nowStamp } from '../dates.js';
import { makeBackup } from '../backup.js';
import { hasVault, backupParts } from '../vault.js';
import { toCSV, checkBackup } from '../trust.js';

// Hands a file to the phone: the share screen on iPhone (Save to Files, iCloud Drive…), a download elsewhere.
async function shareOrDownload(name, blob, title) {
  try {
    const f = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [f] })) {
      await navigator.share({ files: [f], title });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

// The backup file, ready to save. Returns true when it was saved (not cancelled).
export async function exportBackupNow({ thenCheck = true } = {}) {
  if (app.sample) { toast('Backups are off while you look around with example data.'); return false; }
  const parts = backupParts();
  const b = await makeBackup({ state: app.state, vault: hasVault() ? parts.vault : null, dataKey: parts.dataKey });
  const name = `my-budget-backup-${nowStamp().slice(0, 10)}.json`;
  const how = await shareOrDownload(name, new Blob([JSON.stringify(b)], { type: 'application/json' }), 'My Budget backup');
  if (how === 'cancelled') return false;
  app.state.settings.lastBackupAt = nowStamp();
  persist();
  app.render();
  // The first time: make sure the file really opens (people rarely test restoring).
  if (thenCheck && !app.state.settings.backupChecked) offerCheck();
  else toast('Backup saved');
  return true;
}

function offerCheck() {
  const s = openSheet('Backup saved', () => [
    h('p', { class: 'dim' }, 'One quick step, just this once: pick the file you saved, and the app will open it to make sure everything is inside. Nothing on this phone changes.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onClick: () => { s.close(); openBackupCheck(); } }, 'Check this backup works'),
      h('button', { class: 'btn ghost', onClick: () => s.close() }, 'Later')),
  ]);
}

// "Check this backup works": open a backup file without restoring it, and compare.
export function openBackupCheck() {
  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'sr' });
  let result = null;
  let text = null;
  const secret = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Passcode or recovery key' });
  const sheet = openSheet('Check a backup', () => view());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    text = await f.text();
    await run();
  });

  async function run(withSecret = null) {
    result = { busy: true };
    sheet.setContent(view());
    result = await checkBackup(text, { state: app.state, dataKey: backupParts().dataKey, secret: withSecret });
    if (result.ok) { app.state.settings.backupChecked = true; persist(); }
    sheet.setContent(view());
  }

  function view() {
    const line = (label, a, b) => h('div', { class: 'r-line' }, h('div', { class: 'l' }, label), h('div', { class: 'r' }, `${a}${b !== undefined && a !== b ? ` (now ${b})` : ''}`));
    let body;
    if (!result) {
      body = [h('p', { class: 'dim' }, 'Pick a My Budget backup file (from Files or iCloud Drive). The app opens it to check it, and changes nothing.')];
    } else if (result.busy) {
      body = [h('p', { class: 'dim' }, 'Opening the backup…')];
    } else if (result.needsSecret) {
      body = [h('p', { class: 'dim' }, 'This backup was made with a different passcode. Enter that passcode or your recovery key to check it.'),
        secret, h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => run(secret.value.trim()) }, 'Check'))];
    } else if (!result.ok) {
      body = [h('p', { class: 'error' }, result.error)];
    } else {
      const when = result.createdAt ? new Date(result.createdAt) : null;
      const whenText = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : 'an unknown date';
      body = [
        h('div', { class: 'confirm-card' },
          h('div', { class: 'verdict ok' }, 'This backup works'),
          h('div', { class: 'meta' }, `Made ${whenText}${result.encrypted ? ' · encrypted' : ''}`)),
        h('div', { class: 'receipt' },
          line('Entries', result.inFile.entries, result.now.entries),
          line('Goals', result.inFile.goals, result.now.goals),
          line('Repeating items', result.inFile.schedules, result.now.schedules)),
        h('p', { class: 'faint small-note' }, result.same
          ? 'It matches what\'s in the app right now. If this phone is ever lost, this file brings everything back (Settings → Backup → Restore from a backup).'
          : 'It opens fine. The numbers differ from the app because things changed since it was made; a new backup will include them.'),
      ];
    }
    return [
      ...body,
      h('div', { class: 'actions' },
        result?.ok ? h('button', { class: 'btn primary', onClick: () => sheet.close() }, 'Done')
          : h('button', { class: result?.needsSecret ? 'btn ghost' : 'btn primary', onClick: () => file.click() }, result ? 'Pick another file' : 'Pick the backup file'),
        file),
    ];
  }
}

// ---------- Spreadsheet export ----------
export async function exportSpreadsheet() {
  const csv = toCSV(app.state, nowStamp());
  const how = await shareOrDownload(`my-budget-${nowStamp().slice(0, 10)}.csv`, new Blob([csv], { type: 'text/csv' }), 'My Budget spreadsheet');
  if (how !== 'cancelled') toast(`Spreadsheet ready: ${app.state.entries.filter((e) => e.at <= nowStamp()).length} entries`);
}

// ---------- Privacy, in plain words ----------
export function openPrivacy(from = null) {
  openSheet('Your privacy', () => [
    h('p', { class: 'recap-head' }, 'Your data stays on your phone. We don\'t collect anything.'),
    h('ul', { class: 'facts privacy' },
      h('li', {}, 'No account, no sign-up, no email, no name.'),
      h('li', {}, 'Everything you enter is saved only on this phone. It is never sent to us or anyone else, because there is no "us" server to send it to.'),
      h('li', {}, 'No ads, no tracking, no analytics, no cookies that follow you.'),
      h('li', {}, 'With a passcode on, your data is encrypted on the phone. Without your passcode or recovery key, nobody can read it, including us.'),
      h('li', {}, 'Receipt scanning works on the phone itself. Photos are never uploaded.'),
      h('li', {}, 'Voice entry uses your iPhone\'s own speech recognition (the same as the keyboard microphone, run by Apple). My Budget only gets the words, never the recording.'),
      h('li', {}, 'Bank files you import are read on the phone and never leave it.'),
      h('li', {}, 'Calendar reminders go to your own Calendar app. Backups and spreadsheets go only where you choose to save them.'),
      h('li', {}, 'The app itself is loaded from GitHub Pages, like any website, so GitHub sees that the page was opened. It never sees your data.')),
    h('p', { class: 'faint small-note' }, 'Because nothing is stored anywhere else, a backup is the only way to get your data back if this phone is lost. Settings → Backup.'),
  ], { from });
}
