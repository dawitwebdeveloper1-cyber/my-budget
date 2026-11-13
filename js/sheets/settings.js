// Settings: four short sections that open when tapped. Everything has a sensible default.
import { h, icon, openSheet, toast } from '../ui.js';
import { app, change, persist } from '../state.js';
import { formatCents, centsToInput, parseAmount } from '../money.js';
import { nowStamp, formatDate, parseStamp, addDays, weekday, makeStamp } from '../dates.js';
import { FREQS, ALERT_DAY_OPTIONS, ALERT_MIN_OPTIONS, nextOccurrence, alertTriggers } from '../recurring.js';
import { parsePercent, formatPercent } from '../budget.js';
import { activeRules, renameCategory, deleteCategory, addCategory, PAYCHECK } from '../ops.js';
import { hasVault, bioEnabled, bioAvailable, enableBio, disableBio, backupParts, adoptBackup } from '../vault.js';
import { makeBackup, parseBackup, readBackup } from '../backup.js';
import { listCopies, restoreCopy } from '../store.js';
import { isPersisted, flushStorage } from '../storage.js';
import { openPasscodeSetup, openChangePasscode, openNewRecoveryKey } from '../lock.js';
import { openRuleSheet } from '../views/reminders.js';
import { openEntrySheet } from './entry.js';
import { openImport } from './import.js';
import { openPaySetup } from './paysetup.js';
import { payRule } from '../pay.js';
import { addToCalendar } from '../calendar.js';

const pad = (n) => String(n).padStart(2, '0');
const ordinal = (n) => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
};
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (hh) => `${hh % 12 === 0 ? 12 : hh % 12}:00 ${hh < 12 ? 'AM' : 'PM'}`;

function select(options, value, onPick, label) {
  const el = h('select', { class: 'input', 'aria-label': label },
    options.map(([v, t]) => h('option', { value: String(v), selected: String(v) === String(value) ? 'selected' : null }, t)));
  el.addEventListener('change', () => onPick(el.value));
  return el;
}

function toggle(on, onFlip, label) {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label, checked: on });
  input.addEventListener('change', () => onFlip(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }));
}

const line = (label, control, note) => h('div', { class: 'set-line' },
  h('div', { class: 'set-text' }, h('div', {}, label), note ? h('div', { class: 'faint small' }, note) : null), control);

const saved = (msg = 'Saved') => toast(msg);

export function openSettings(openSection = null, from = null) {
  const opened = new Set(openSection ? [openSection] : []);
  let logTime = null; // evening reminder time being picked (declared before the sheet draws)
  const sheet = openSheet('Settings', () => body(), { from });

  function redraw() { sheet.setContent(body()); }

  function section(id, title, sub, content) {
    const d = h('details', { class: 'set-section', open: opened.has(id) ? true : null },
      h('summary', {}, h('div', {}, h('div', { class: 'set-title' }, title), h('div', { class: 'faint small' }, sub)), icon('right')),
      h('div', { class: 'set-body' }, content()));
    d.addEventListener('toggle', () => { if (d.open) opened.add(id); else opened.delete(id); });
    return d;
  }

  function body() {
    const st = app.state.settings;
    return [
      section('money', 'Money', 'Pay, categories, auto-save, month and week', money),
      section('alerts', 'Alerts', `Calendar alerts${st.adviceOn ? ', advice notes on' : ''}${st.logReminder ? ', evening reminder' : ''}`, alerts),
      ...(app.sample ? [h('p', { class: 'faint small-note' }, 'Passcode and backup are off while you look around with example data.')] : [
        section('security', 'Security', hasVault() ? `Passcode on${bioEnabled() ? ' · Face ID on' : ''}` : 'No passcode yet', security),
        section('backup', 'Backup', st.lastBackupAt ? `Last backup ${formatDate(st.lastBackupAt, { year: true })}` : 'No backup yet', backup)]),
    ];
  }

  // ---------- Money ----------
  function money() {
    const s = app.state;
    const st = s.settings;
    const pay = payRule(s);
    const payLine = h('button', { class: 'row', onClick: () => openPaySetup() },
      h('span', { class: 'name' }, h('span', {}, st.payMode === 'irregular' ? 'Irregular (changes each time)'
        : pay ? `${formatCents(pay.cents)} · ${FREQS[pay.freq]}` : 'Set up your pay schedule')),
      pay ? h('span', { class: 'faint small' }, `next ${formatDate(nextOccurrence(pay), { weekday: true })}`) : null,
      icon('right'));

    const catList = (kind, title) => h('div', { class: 'field' }, h('span', {}, title),
      h('div', { class: 'rows' }, s.categories[kind].map((c) => h('button', { class: 'row', onClick: () => openCategory(kind, c) },
        h('span', { class: 'name' }, h('span', {}, c)),
        h('span', { class: 'faint small' }, kind === 'expense' && Number.isSafeInteger(s.limits[c]) ? `limit ${formatCents(s.limits[c])}` : kind === 'income' && c === PAYCHECK ? 'fixed' : ''),
        icon('right')))),
      h('button', { class: 'add-line', onClick: () => openCategory(kind, null) }, icon('plus'), 'Add a category'));

    // Auto-save: each goal gets its own percentage of every paycheck.
    const plan = new Map((st.autoSave ?? []).map((p) => [p.goalId, p.bp]));
    const pcts = new Map(s.goals.map((g) => [g.id, plan.get(g.id) ? formatPercent(plan.get(g.id)).replace('%', '') : '']));
    const autoErr = h('p', { class: 'error' });
    const auto = s.goals.length
      ? h('div', { class: 'field' }, h('span', {}, 'Auto-save from each paycheck'),
        h('div', { class: 'rows auto-rows' }, s.goals.map((g) => h('div', { class: 'set-line' },
          h('div', { class: 'set-text' }, g.name),
          h('div', { class: 'pct-input' }, h('input', { class: 'input', inputmode: 'decimal', placeholder: '0', 'aria-label': `Percent to ${g.name}`, value: pcts.get(g.id), onInput: (e) => { pcts.set(g.id, e.target.value); } }), h('span', { class: 'cur-r' }, '%'))))),
        h('p', { class: 'faint small-note' }, 'Each goal gets its share of every paycheck. Leftover cents from rounding go to the first goal.'),
        autoErr,
        h('button', { class: 'btn ghost', onClick: () => {
          const next = [];
          for (const g of s.goals) {
            const bp = parsePercent(pcts.get(g.id) || '0');
            if (bp === null) { autoErr.textContent = `Enter a percentage for ${g.name}, like 10`; return; }
            if (bp > 0) next.push({ goalId: g.id, bp });
          }
          const total = next.reduce((a, p) => a + p.bp, 0);
          if (total > 10000) { autoErr.textContent = `That adds up to ${formatPercent(total)}. Keep it at 100% or less.`; return; }
          change((x) => { x.settings.autoSave = next; }, null);
          saved(total ? `Auto-save: ${formatPercent(total)} of each paycheck` : 'Auto-save off');
          redraw();
        } }, 'Save auto-save'))
      : h('div', { class: 'field' }, h('span', {}, 'Auto-save from each paycheck'), h('p', { class: 'faint small-note' }, 'Create a savings goal in the Goals tab first.'));

    return [
      h('div', { class: 'field' }, h('span', {}, 'Bank file'),
        h('div', { class: 'rows' }, h('button', { class: 'row', onClick: () => openImport() },
          h('span', { class: 'name' }, h('span', {}, 'Import from your bank (CSV)')), icon('right')))),
      h('div', { class: 'field' }, h('span', {}, 'Your pay'), h('div', { class: 'rows' }, payLine)),
      auto,
      catList('expense', 'Spending categories and limits'),
      catList('income', 'Income categories'),
      line('Budget month starts on the', select(Array.from({ length: 31 }, (_, i) => [i + 1, ordinal(i + 1)]), st.monthStartDay, (v) => {
        change((x) => { x.settings.monthStartDay = Number(v); }, null); saved(); redraw();
      }, 'Budget month start day'), st.monthStartDay > 28 ? 'In shorter months it starts on the last day.' : null),
      line('Week starts on', select([1, 2, 3, 4, 5, 6, 0].map((d) => [d, DAY_NAMES[d]]), st.weekStartDay, (v) => {
        change((x) => { x.settings.weekStartDay = Number(v); }, null); saved(); redraw();
      }, 'Week start day')),
    ];
  }

  function openCategory(kind, name) {
    const s = app.state;
    const fixed = kind === 'income' && name === PAYCHECK;
    const d = { name: name ?? '', limit: kind === 'expense' && name && Number.isSafeInteger(s.limits[name]) ? centsToInput(s.limits[name]) : '' };
    const err = h('p', { class: 'error' });
    const cs = openSheet(name ?? 'New category', () => [
      h('label', { class: 'field' }, h('span', {}, 'Name'), h('input', { class: 'input', maxlength: 40, value: d.name, disabled: fixed ? true : null, onInput: (e) => { d.name = e.target.value; } })),
      fixed ? h('p', { class: 'faint small-note' }, 'Paycheck is used for auto-save and the paycheck logger, so it can\'t be renamed.') : null,
      kind === 'expense' ? h('label', { class: 'field' }, h('span', {}, 'Monthly limit (leave empty for no limit)'),
        h('div', { class: 'money-input' }, h('span', { class: 'cur' }, '$'), h('input', { class: 'input', inputmode: 'decimal', placeholder: 'No limit', value: d.limit, onInput: (e) => { d.limit = e.target.value; } }))) : null,
      err,
      h('div', { class: 'actions' },
        fixed ? null : h('button', { class: 'btn primary', onClick: saveCat }, name ? 'Save' : 'Add category'),
        name && !fixed ? h('button', { class: 'btn danger', onClick: delCat }, 'Delete category') : null),
    ]);
    function saveCat() {
      const newName = d.name.trim();
      const raw = d.limit.trim();
      const cents = raw === '' ? null : parseAmount(raw);
      if (!newName) { err.textContent = 'Give it a name'; return; }
      if (raw !== '' && cents === null) { err.textContent = 'Enter a limit, like 200'; return; }
      if (newName !== name && s.categories[kind].includes(newName)) { err.textContent = 'You already have a category with that name'; return; }
      change((x) => {
        let final = name;
        if (!name) { addCategory(x, kind, newName); final = newName; } else if (newName !== name) { renameCategory(x, kind, name, newName); final = newName; }
        if (kind === 'expense') { if (cents === null) delete x.limits[final]; else x.limits[final] = cents; }
      }, null);
      cs.close(); saved(); redraw();
    }
    function delCat() {
      cs.setTitle(`Delete ${name}?`);
      cs.setContent(
        h('p', { class: 'dim' }, 'It will be removed from your list. Past entries keep this category, so your totals don\'t change.'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', onClick: () => {
            if (s.categories[kind].length <= 1) { toast('You need at least one category'); return; }
            change((x) => deleteCategory(x, kind, name), 'Category deleted'); cs.close(); redraw();
          } }, 'Delete'),
          h('button', { class: 'btn ghost', onClick: () => cs.close() }, 'Keep it')));
    }
  }

  // ---------- Alerts ----------
  function alerts() {
    const st = app.state.settings;
    const setS = (k, v) => { change((x) => { x.settings[k] = v; }, null); saved(); redraw(); };
    return [
      line('First alert', select(ALERT_DAY_OPTIONS, st.alertDays, (v) => setS('alertDays', Number(v)), 'First alert')),
      line('Second alert', select(ALERT_MIN_OPTIONS, st.alertMinutes, (v) => setS('alertMinutes', Number(v)), 'Second alert')),
      line('Reminder time for bills', select(Array.from({ length: 17 }, (_, i) => [i + 6, hourLabel(i + 6)]), st.eventHour, (v) => setS('eventHour', Number(v)), 'Reminder time')),
      h('p', { class: 'faint small-note' }, 'Applies to calendar reminders you add from now on. To update one you already added, tap it in Reminders and add it again.'),
      line('Gentle advice notes', toggle(st.adviceOn, (on) => setS('adviceOn', on), 'Advice notes')),
      ...logReminder(),
    ];
  }

  // The evening "Log today?" reminder: one daily Calendar event at a time you pick. Never more than one a day.
  function logReminder() {
    const st = app.state.settings;
    const times = Array.from({ length: 13 }, (_, i) => { const m = 17 * 60 + i * 30; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; });
    const label = (t) => { const [hh, mm] = t.split(':').map(Number); return `${hh % 12 === 0 ? 12 : hh % 12}:${pad(mm)} ${hh < 12 ? 'AM' : 'PM'}`; };
    logTime = logTime ?? st.logReminder ?? '20:00';
    if (st.logReminder) {
      return [
        h('div', { class: 'set-line' }, h('div', { class: 'set-text' }, h('div', {}, 'Evening reminder'),
          h('div', { class: 'faint small' }, `"Log today?" at ${label(st.logReminder)}, once a day`))),
        h('p', { class: 'faint small-note' }, 'To turn it off: open Calendar, tap the "Log today?" event, then Delete Event → Delete All Future Events. To change the time, delete it there first, then add it again here.'),
        h('button', { class: 'btn ghost', onClick: () => { change((x) => { x.settings.logReminder = null; }, null); saved('Reminder marked as removed'); redraw(); } }, "I've removed it from Calendar"),
      ];
    }
    return [
      line('Evening reminder', select(times.map((t) => [t, label(t)]), logTime, (v) => { logTime = v; }, 'Evening reminder time'),
        'A "Log today?" alert once a day, through your Calendar.'),
      h('button', { class: 'btn ghost', onClick: addLogReminder }, 'Add "Log today?" to Calendar'),
    ];
  }

  function addLogReminder() {
    const now = nowStamp();
    const today = now.slice(0, 10);
    let anchor = `${today}T${logTime}`;
    if (anchor <= now) { const p = parseStamp(now); const d = addDays(p.y, p.m, p.d, 1); anchor = `${makeStamp(d.y, d.m, d.d).slice(0, 10)}T${logTime}`; }
    addToCalendar({ id: 'my-budget-log-today', name: 'Log today?', cents: 0, freq: 'daily', anchor, nextIndex: 0, endAt: null },
      { noAmount: true, alerts: ['PT0S'], description: 'Open My Budget and add anything you spent today.' });
    change((x) => { x.settings.logReminder = logTime; }, null);
    redraw();
  }

  // ---------- Security ----------
  function security() {
    if (!hasVault()) {
      return [
        h('p', { class: 'dim' }, 'Set a passcode to lock and encrypt everything in My Budget. You\'ll also get a recovery key in case you forget it.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => { sheet.close(); openPasscodeSetup(); } }, 'Set a passcode')),
      ];
    }
    const bioMsg = h('p', { class: 'error' });
    return [
      h('p', { class: 'faint small-note' }, 'Your data is encrypted on this phone. It locks when you leave the app for more than a minute.'),
      bioAvailable() ? line('Unlock with Face ID', toggle(bioEnabled(), async (on) => {
        if (on) {
          const r = await enableBio();
          if (!r.ok) { bioMsg.textContent = r.error; redraw(); return; }
          saved('Face ID is on');
        } else { disableBio(); saved('Face ID is off'); }
        redraw();
      }, 'Face ID')) : null,
      bioMsg,
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onClick: () => openChangePasscode() }, 'Change passcode'),
        h('button', { class: 'btn ghost', onClick: () => openNewRecoveryKey() }, 'Make a new recovery key'),
        h('button', { class: 'btn ghost', onClick: () => { sheet.close(); app.lockNow?.(); } }, 'Lock now')),
    ];
  }

  // ---------- Backup ----------
  function backup() {
    const st = app.state.settings;
    const copies = listCopies();
    const file = h('input', { type: 'file', accept: '.json,application/json', class: 'sr' });
    file.addEventListener('change', () => { const f = file.files?.[0]; if (f) importFile(f); file.value = ''; });
    return [
      h('p', { class: 'dim' }, hasVault()
        ? 'Saves everything into one encrypted file. It opens with your passcode or recovery key. Keep it in Files, iCloud Drive or email it to yourself.'
        : 'Saves everything into one file. Set a passcode first if you want the file encrypted.'),
      h('p', { class: 'faint small-note' }, st.lastBackupAt ? `Last backup: ${formatDate(st.lastBackupAt, { weekday: true, year: true })}` : 'No backup yet.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: exportBackup }, 'Export backup'),
        h('button', { class: 'btn ghost', onClick: () => file.click() }, 'Import backup'), file),
      line('Weekly backup reminder', toggle(st.backupReminder, (on) => { change((x) => { x.settings.backupReminder = on; }, null); saved(); redraw(); }, 'Weekly backup reminder'),
        'A gentle line in the app after 7 days.'),
      h('button', { class: 'btn ghost', onClick: addBackupReminder }, 'Add weekly reminder to Calendar'),
      h('p', { class: 'faint small-note' }, isPersisted()
        ? 'This phone is set to keep My Budget\'s data, even when storage runs low.'
        : 'Tip: add My Budget to your home screen so the phone keeps its data safe.'),
      copies.length ? h('button', { class: 'btn ghost', onClick: () => confirmRestoreCopy(copies[0]) },
        `Restore data from before the last update (${new Date(copies[0].savedAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })})`) : null,
    ];
  }

  // A copy of the data is kept automatically before an update converts it.
  function confirmRestoreCopy(copy) {
    const cs = openSheet('Restore older data?', () => [
      h('p', { class: 'dim' }, 'Before an update changed how your data is saved, My Budget kept a copy. Restoring puts that copy back exactly as it was, and the app restarts.'),
      h('p', { class: 'faint small-note' }, 'Anything added since that update will be replaced. Export a backup first if you want to keep it.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: async () => { await restoreCopy(copy.key); await flushStorage(); location.reload(); } }, 'Restore and restart'),
        h('button', { class: 'btn ghost', onClick: () => cs.close() }, 'Cancel')),
    ]);
  }

  async function exportBackup() {
    const parts = backupParts();
    const b = await makeBackup({ state: app.state, vault: hasVault() ? parts.vault : null, dataKey: parts.dataKey });
    const text = JSON.stringify(b);
    const name = `my-budget-backup-${nowStamp().slice(0, 10)}.json`;
    const blob = new Blob([text], { type: 'application/json' });
    let done = false;
    try {
      const f = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare?.({ files: [f] })) {
        await navigator.share({ files: [f], title: 'My Budget backup' });
        done = true;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return; // cancelled: not backed up
    }
    if (!done) {
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    app.state.settings.lastBackupAt = nowStamp();
    persist();
    saved('Backup saved');
    redraw();
    app.render();
  }

  async function importFile(f) {
    const text = await f.text();
    const parsed = parseBackup(text);
    if (!parsed.ok) { toast(parsed.error); return; }
    const b = parsed.backup;
    if (!b.encrypted) { confirmRestore(b, null); return; }
    const msg = h('p', { class: 'error' });
    const input = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Passcode or recovery key' });
    const ask = openSheet('Open backup', () => [
      h('p', { class: 'dim' }, 'Enter the passcode you had when this backup was made, or your recovery key.'),
      input, msg,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: async () => {
        msg.textContent = 'Checking…';
        const r = await readBackup(b, input.value.trim());
        if (!r.ok) { msg.textContent = r.error; return; }
        ask.close();
        confirmRestore(b, r);
      } }, 'Open')),
    ]);
  }

  async function confirmRestore(b, opened) {
    const r = opened ?? await readBackup(b);
    if (!r.ok) { toast(r.error); return; }
    const when = b.createdAt ? new Date(b.createdAt) : null;
    const whenText = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : 'an unknown date';
    const cs = openSheet('Restore this backup?', () => [
      h('div', { class: 'confirm-card' },
        h('div', { class: 'what' }, `Backup from ${whenText}`),
        h('div', { class: 'meta' }, [
          [r.state.entries.length, 'entry', 'entries'], [r.state.goals.length, 'goal', 'goals'], [r.state.recurring.length, 'schedule', 'schedules'],
        ].map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(' · '))),
      h('p', { class: 'dim' }, 'Everything currently in My Budget on this phone will be replaced by this backup.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: async () => {
          if (!hasVault() && b.encrypted && opened?.dataKey) await adoptBackup(b, opened.dataKey, r.state);
          app.state = r.state;
          persist();
          cs.close();
          sheet.close();
          app.render();
          toast('Backup restored');
        } }, 'Replace with backup'),
        h('button', { class: 'btn ghost', onClick: () => cs.close() }, 'Cancel')),
    ]);
  }

  function addBackupReminder() {
    const st = app.state.settings;
    const now = parseStamp(nowStamp());
    const ahead = (7 - weekday(now.y, now.m, now.d)) % 7 || 7; // next Sunday
    const d = addDays(now.y, now.m, now.d, ahead);
    addToCalendar({ id: 'my-budget-weekly-backup', name: 'My Budget: back up', cents: 0, freq: 'weekly', anchor: makeStamp(d.y, d.m, d.d, st.eventHour, 0), nextIndex: 0, endAt: null }, { noAmount: true });
  }
}

export { alertTriggers };
