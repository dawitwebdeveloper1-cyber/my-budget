// Lock screen, passcode keypad, and the passcode / recovery key / Face ID set-up steps.
import { h, icon, openSheet, toast } from './ui.js';
import { app } from './state.js';
import { newRecoveryKey, validPasscode, normalizeRecoveryKey } from './crypto.js';
import {
  unlock, unlockBio, bioEnabled, bioAvailable, enableBio, passLength, waitSeconds,
  setupVault, changePasscode, checkPasscode, replaceRecoveryKey,
} from './vault.js';
import { cleanState } from './store.js';

// ---------- Keypad ----------
// length: exact number of digits (auto-submits), or null for 6–12 digits with a Continue button.
export function keypad({ length = null, onComplete, extra = null, label = 'Passcode' }) {
  let code = '';
  const dots = h('div', { class: 'dots', 'aria-label': `${label}: ${code.length} digits entered` });
  const cont = length ? null : h('button', { class: 'btn primary', disabled: true, onClick: () => submit() }, 'Continue');
  const busy = { on: false };
  function draw() {
    const n = length ?? Math.max(6, code.length);
    dots.replaceChildren(...Array.from({ length: n }, (_, i) => h('i', { class: i < code.length ? 'on' : '' })));
    dots.setAttribute('aria-label', `${label}: ${code.length} digits entered`);
    if (cont) cont.disabled = !validPasscode(code);
  }
  async function submit() {
    if (busy.on) return;
    busy.on = true;
    const c = code;
    const keep = await onComplete(c, reset);
    busy.on = false;
    if (!keep) reset();
  }
  function reset(shake = false) {
    code = '';
    draw();
    if (shake) { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); }
  }
  function press(d) {
    if (busy.on) return;
    if (code.length >= (length ?? 12)) return;
    code += d;
    draw();
    if (length && code.length === length) submit();
  }
  function back() { if (!busy.on) { code = code.slice(0, -1); draw(); } }
  const key = (d) => h('button', { class: 'key', onClick: () => press(d) }, d);
  const pad = h('div', { class: 'keypad' },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key),
    extra ?? h('span'),
    key('0'),
    h('button', { class: 'key fn', 'aria-label': 'Delete', onClick: back }, icon('left')));
  // physical keyboards too
  const onKey = (e) => {
    if (!pad.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') back();
    else if (e.key === 'Enter' && cont && !cont.disabled) submit();
  };
  document.addEventListener('keydown', onKey);
  draw();
  return { el: h('div', { class: 'pad-wrap' }, dots, pad, cont), reset };
}

// ---------- Lock screen ----------
export function showLock(onUnlocked) {
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  document.querySelector('.toast')?.remove();
  document.getElementById('app').replaceChildren();
  document.querySelector('.lock')?.remove();

  const msg = h('p', { class: 'lock-msg', role: 'status' });
  const screen = h('div', { class: 'lock', role: 'dialog', 'aria-label': 'My Budget is locked' });
  const done = (state) => { screen.remove(); onUnlocked(cleanState(state)); };

  const tryBio = async () => {
    msg.textContent = '';
    const r = await unlockBio();
    if (r.ok) done(r.state);
    else msg.textContent = r.wait ? `Try again in ${r.wait} seconds.` : 'Face ID didn\'t work. Use your passcode.';
  };

  function passView() {
    const faceBtn = bioEnabled() ? h('button', { class: 'key fn', 'aria-label': 'Unlock with Face ID', onClick: tryBio }, icon('face')) : null;
    const pad = keypad({
      length: passLength(),
      extra: faceBtn,
      onComplete: async (code, reset) => {
        msg.textContent = 'Checking…';
        const r = await unlock(code);
        if (r.ok) { done(r.state); return true; }
        reset(true);
        msg.textContent = r.damaged ? 'Your saved data could not be opened. Restore a backup from Settings after unlocking with your recovery key.'
          : r.wait ? `Too many tries. Wait ${r.wait} seconds.` : 'That passcode is not right.';
        return true;
      },
    });
    screen.replaceChildren(
      h('div', { class: 'lock-inner' },
        h('img', { src: 'icons/icon-192.png', alt: '', class: 'lock-logo' }),
        h('h1', {}, 'My Budget'),
        h('p', { class: 'dim' }, 'Enter your passcode'),
        pad.el, msg,
        h('button', { class: 'link', onClick: recoveryView }, 'Forgot passcode?')));
    const w = waitSeconds();
    if (w) msg.textContent = `Too many tries. Wait ${w} seconds.`;
  }

  function recoveryView() {
    msg.textContent = '';
    const input = h('textarea', { class: 'input mono', rows: 2, placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' });
    screen.replaceChildren(h('div', { class: 'lock-inner' },
      h('h1', {}, 'Use your recovery key'),
      h('p', { class: 'dim' }, 'Type the recovery key you saved when you set up your passcode.'),
      input, msg,
      h('button', { class: 'btn primary', onClick: async () => {
        if (!normalizeRecoveryKey(input.value)) { msg.textContent = 'That doesn\'t look like a recovery key. It has 32 letters and numbers.'; return; }
        msg.textContent = 'Checking…';
        const r = await unlock(input.value);
        if (!r.ok) { msg.textContent = r.wait ? `Too many tries. Wait ${r.wait} seconds.` : 'That recovery key is not right.'; return; }
        newPassView(r.state);
      } }, 'Unlock'),
      h('button', { class: 'link', onClick: passView }, 'Back to passcode')));
  }

  function newPassView(state) {
    let first = null;
    const title = h('p', { class: 'dim' }, 'Choose a new passcode (6 to 12 digits)');
    const box = h('div');
    const step1 = () => {
      title.textContent = 'Choose a new passcode (6 to 12 digits)';
      box.replaceChildren(keypad({ onComplete: async (c) => { first = c; step2(); return true; } }).el);
    };
    const step2 = () => {
      title.textContent = 'Enter it again';
      box.replaceChildren(keypad({ length: first.length, onComplete: async (c, reset) => {
        if (c !== first) { reset(true); msg.textContent = "Those didn't match. Try again."; setTimeout(step1, 900); return true; }
        await changePasscode(c);
        toast('New passcode set');
        done(state);
        return true;
      } }).el);
    };
    screen.replaceChildren(h('div', { class: 'lock-inner' }, h('h1', {}, 'New passcode'), title, box, msg));
    step1();
  }

  passView();
  document.body.append(screen);
}

// ---------- Setting up a passcode (Settings → Security, or the card on Home) ----------
export function openPasscodeSetup() {
  let first = null;
  const recoveryKey = newRecoveryKey();
  const sheet = openSheet('Choose a passcode', () => choose());

  function choose() {
    return [
      h('p', { class: 'dim center' }, '6 to 12 digits. Longer is stronger.'),
      keypad({ onComplete: async (c) => { first = c; sheet.setTitle('Enter it again'); sheet.setContent(confirm()); return true; } }).el,
    ];
  }

  function confirm() {
    const msg = h('p', { class: 'error center' });
    return [
      h('p', { class: 'dim center' }, 'Type the same passcode again.'),
      keypad({ length: first.length, onComplete: async (c, reset) => {
        if (c !== first) { reset(true); msg.textContent = "Those didn't match. Start again."; setTimeout(() => { sheet.setTitle('Choose a passcode'); sheet.setContent(choose()); }, 1000); return true; }
        sheet.setTitle('Your recovery key');
        sheet.setContent(showRecovery(recoveryKey, async () => {
          await setupVault(app.state, first, recoveryKey);
          app.render();
          faceStep();
        }));
        return true;
      } }).el,
      msg,
    ];
  }

  function faceStep() {
    if (!bioAvailable()) { finish(); return; }
    sheet.setTitle('Use Face ID?');
    const msg = h('p', { class: 'error center' });
    sheet.setContent(
      h('p', { class: 'dim' }, 'Unlock with Face ID instead of typing your passcode. Your passcode and recovery key still work too.'),
      msg,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: async () => {
          const r = await enableBio();
          if (r.ok) finish('Face ID is on');
          else msg.textContent = r.error;
        } }, 'Turn on Face ID'),
        h('button', { class: 'btn ghost', onClick: () => finish() }, 'Not now')));
  }

  function finish(extra) {
    sheet.close();
    app.render();
    toast(extra ? `Passcode set · ${extra}` : 'Passcode set. Your data is now encrypted.');
  }
}

// Shows a recovery key and waits until the person confirms they saved it.
export function showRecovery(key, onSaved) {
  const check = h('input', { type: 'checkbox', id: 'saved-key' });
  const go = h('button', { class: 'btn primary', disabled: true, onClick: async () => { go.disabled = true; go.textContent = 'Encrypting…'; await onSaved(); } }, 'Continue');
  check.addEventListener('change', () => { go.disabled = !check.checked; });
  return [
    h('p', { class: 'dim' }, 'If you ever forget your passcode, this key is the only way back in. Save it somewhere safe: Notes on another device, a screenshot sent to yourself, or written on paper.'),
    h('div', { class: 'recovery mono', 'aria-label': `Recovery key: ${key}` },
      h('div', {}, key.slice(0, 19)), h('div', {}, key.slice(20))),
    h('button', { class: 'btn ghost', onClick: async () => {
      try { await navigator.clipboard.writeText(key); toast('Recovery key copied'); } catch { toast('Couldn\'t copy. Write it down instead.'); }
    } }, 'Copy recovery key'),
    h('label', { class: 'check', for: 'saved-key' }, check, h('span', {}, "I've saved my recovery key somewhere safe")),
    h('div', { class: 'actions' }, go),
  ];
}

// Settings → Security → Change passcode
export function openChangePasscode() {
  let next = null;
  const msg = h('p', { class: 'error center' });
  const sheet = openSheet('Current passcode', () => current());
  function current() {
    return [keypad({ length: passLength(), onComplete: async (c, reset) => {
      msg.textContent = 'Checking…';
      if (!(await checkPasscode(c))) { reset(true); msg.textContent = 'That passcode is not right.'; return true; }
      msg.textContent = '';
      sheet.setTitle('New passcode');
      sheet.setContent(choose());
      return true;
    } }).el, msg];
  }
  function choose() {
    return [h('p', { class: 'dim center' }, '6 to 12 digits.'),
      keypad({ onComplete: async (c) => { next = c; sheet.setTitle('Enter it again'); sheet.setContent(again()); return true; } }).el];
  }
  function again() {
    return [keypad({ length: next.length, onComplete: async (c, reset) => {
      if (c !== next) { reset(true); msg.textContent = "Those didn't match. Start again."; setTimeout(() => { sheet.setTitle('New passcode'); sheet.setContent(choose()); }, 1000); return true; }
      await changePasscode(c);
      sheet.close();
      toast('Passcode changed');
      return true;
    } }).el, msg];
  }
}

// Settings → Security → New recovery key
export async function openNewRecoveryKey() {
  const r = await replaceRecoveryKey();
  const sheet = openSheet('New recovery key', () => [
    h('p', { class: 'faint small-note' }, 'Your old recovery key will stop working for this phone. Backups made earlier still open with the old key.'),
    ...showRecovery(r.key, async () => { await r.save(); sheet.close(); toast('New recovery key saved'); }),
  ]);
}
