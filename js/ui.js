// Small helpers for building the screen safely.
// Text is always set as text (never as HTML), so nothing typed into the app can run as code.
import { reducedMotion, EASE } from './motion.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  setProps(el, props);
  append(el, children);
  return el;
}

function setProps(el, props) {
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

// Line icons (24x24, drawn with strokes)
const ICONS = {
  home: ['M3.5 10.5 12 4l8.5 6.5', 'M5.5 9v10.5h13V9', 'M10 19.5v-5h4v5'],
  list: ['M8 6.5h12', 'M8 12h12', 'M8 17.5h12', 'M4 6.5h.01', 'M4 12h.01', 'M4 17.5h.01'],
  goal: ['M12 3.5a8.5 8.5 0 1 0 8.5 8.5', 'M12 7.5a4.5 4.5 0 1 0 4.5 4.5', 'M12 12l7-7', 'M16 5h3v3'],
  bell: ['M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z', 'M10 20.5a2.2 2.2 0 0 0 4 0'],
  gear: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.5 7.5 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.4z'],
  plus: ['M12 5v14', 'M5 12h14'],
  up: ['M12 19V5', 'M6 11l6-6 6 6'],
  down: ['M12 5v14', 'M6 13l6 6 6-6'],
  receipt: ['M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z', 'M9 8.5h6', 'M9 12h6', 'M9 15.5h3'],
  left: ['M15 5l-7 7 7 7'],
  right: ['M9 5l7 7-7 7'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  face: ['M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8', 'M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8', 'M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16', 'M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16', 'M9 9.5v1', 'M15 9.5v1', 'M12 9.5v3.5h-1', 'M9.5 15.5a3.5 3.5 0 0 0 5 0'],
  lock: ['M6.5 11h11v9h-11z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  edit: ['M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16z', 'M13.5 6.5l4 4'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  leaf: ['M5 19c0-8 5-14 15-14 0 10-6 15-14 15', 'M5 19l8-8'],
  sparkle: ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M6 6l2.5 2.5', 'M15.5 15.5 18 18', 'M18 6l-2.5 2.5', 'M8.5 15.5 6 18'],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  repeat: ['M4 11V9a3 3 0 0 1 3-3h12', 'M16 3l3 3-3 3', 'M20 13v2a3 3 0 0 1-3 3H5', 'M8 21l-3-3 3-3'],
  star: ['M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z'],
};

export function icon(name, cls = '') {
  return s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: cls, 'aria-hidden': 'true' },
    ...ICONS[name].map((d) => s('path', { d })));
}

// Bottom sheet (pop-up panel). Returns { el, body, close, setContent }.
// With `from` (the tapped card), the card smoothly expands into the panel and shrinks back on close.
export function openSheet(title, buildBody, { onClose, from = null } = {}) {
  const body = h('div');
  const titleEl = h('h3', {}, title);
  const inner = h('div', { class: 'sheet-inner' },
    h('div', { class: 'grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' }, titleEl,
      h('button', { class: 'round-btn', 'aria-label': 'Close', onClick: () => close() }, icon('close'))),
    body);
  const dlg = h('dialog', { class: 'sheet', 'aria-label': title }, inner);
  const still = reducedMotion();
  const origin = !still && from instanceof Element && from.isConnected ? from : null;
  if (!origin && !still) dlg.classList.add('slide');
  let closed = false;

  // Transform that maps the open panel onto the tapped card.
  const flipFrom = () => {
    const a = origin.getBoundingClientRect();
    const b = dlg.getBoundingClientRect();
    if (!a.width || !b.width) return null;
    return `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
  };

  function close() {
    if (closed) return;
    closed = true;
    const finish = () => { dlg.close(); dlg.remove(); onClose?.(); };
    if (still) { finish(); return; }
    if (origin?.isConnected) {
      const t = flipFrom();
      if (t) {
        inner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: EASE, fill: 'forwards' });
        dlg.animate([{ transform: 'none', opacity: 1 }, { transform: t, opacity: 0.4 }], { duration: 260, easing: EASE, fill: 'forwards' })
          .finished.then(finish, finish);
        return;
      }
    }
    dlg.classList.add('closing', 'slide');
    setTimeout(finish, 210);
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // tap outside
  const api = {
    el: dlg, body, close,
    setTitle: (t) => { titleEl.textContent = t; dlg.setAttribute('aria-label', t); },
    setContent: (...nodes) => { body.replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false)); },
  };
  api.setContent(buildBody(api));
  document.body.append(dlg);
  dlg.showModal();
  if (origin) {
    const t = flipFrom();
    if (t) {
      dlg.style.transformOrigin = 'top left';
      dlg.animate([{ transform: t, opacity: 0.5 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: EASE });
      inner.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: 380, easing: EASE });
    }
  }
  return api;
}

// ---------- Hold for options ----------
// Pressing and holding calls `open`; the normal tap that follows is swallowed.
export function onHold(el, open) {
  let timer = null;
  let fired = false;
  let sx = 0;
  let sy = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    fired = false;
    sx = e.clientX; sy = e.clientY;
    cancel();
    timer = setTimeout(() => { fired = true; open(); }, 480);
  });
  el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, cancel));
  el.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!fired) { fired = true; cancel(); open(); } });
}

// Small menu next to a held item; everything else dims a little.
export function holdMenu(el, items) {
  closeHoldMenu();
  const rect = el.getBoundingClientRect();
  const scrim = h('div', { class: 'hold-scrim' });
  // A lifted copy of the item sits above the dimmed screen.
  const lifted = el.cloneNode(true);
  lifted.classList.add('held');
  lifted.setAttribute('aria-hidden', 'true');
  // Widen it by its card's side padding so the text stays exactly where it was.
  const padX = 18;
  Object.assign(lifted.style, { position: 'fixed', left: `${rect.left - padX}px`, top: `${rect.top}px`, width: `${rect.width + padX * 2}px`, height: `${rect.height}px`, margin: '0', pointerEvents: 'none', padding: `0 ${padX}px` });
  if (!reducedMotion()) lifted.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.96)' }], { duration: 200, easing: EASE, fill: 'forwards' });
  const menu = h('div', { class: 'hold-menu', role: 'menu' },
    items.map((it) => h('button', { role: 'menuitem', class: it.danger ? 'danger' : '', onClick: () => { closeHoldMenu(); it.run(); } }, icon(it.icon), it.label)));
  document.body.append(scrim, lifted, menu);
  const mh = menu.offsetHeight;
  const below = rect.bottom + 8 + mh < innerHeight - 90;
  menu.style.top = `${below ? rect.bottom + 8 : Math.max(12, rect.top - mh - 8)}px`;
  menu.style.right = `${Math.max(12, innerWidth - rect.right)}px`;
  if (!below) menu.classList.add('up');
  const off = () => closeHoldMenu();
  scrim.addEventListener('click', off);
  addEventListener('scroll', off, { once: true, passive: true });
  const esc = (e) => { if (e.key === 'Escape') off(); };
  document.addEventListener('keydown', esc);
  holdState = { scrim, lifted, menu, esc };
  menu.querySelector('button')?.focus({ preventScroll: true });
}

let holdState = null;
export function closeHoldMenu() {
  if (!holdState) return;
  const { scrim, lifted, menu, esc } = holdState;
  holdState = null;
  document.removeEventListener('keydown', esc);
  scrim.remove(); lifted.remove(); menu.remove();
}

let toastTimer = null;
export function toast(message, action) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status' },
    h('span', {}, message),
    action ? h('button', { onClick: () => { el.remove(); action.run(); } }, action.label) : null);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), action ? 5000 : 3000); // Undo stays for 5 seconds
}
