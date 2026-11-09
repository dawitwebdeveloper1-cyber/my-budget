// Small helpers for building the screen safely.
// Text is always set as text (never as HTML), so nothing typed into the app can run as code.

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
};

export function icon(name, cls = '') {
  return s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: cls, 'aria-hidden': 'true' },
    ...ICONS[name].map((d) => s('path', { d })));
}

// Bottom sheet (pop-up panel). Returns { el, body, close, setContent }.
export function openSheet(title, buildBody, { onClose } = {}) {
  const body = h('div');
  const titleEl = h('h3', {}, title);
  const dlg = h('dialog', { class: 'sheet', 'aria-label': title },
    h('div', { class: 'sheet-inner' },
      h('div', { class: 'grabber', 'aria-hidden': 'true' }),
      h('div', { class: 'sheet-head' }, titleEl,
        h('button', { class: 'round-btn', 'aria-label': 'Close', onClick: () => close() }, icon('close'))),
      body));
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    dlg.close();
    dlg.remove();
    onClose?.();
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
  return api;
}

let toastTimer = null;
export function toast(message, action) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status' },
    h('span', {}, message),
    action ? h('button', { onClick: () => { el.remove(); action.run(); } }, action.label) : null);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), action ? 7000 : 3000);
}
