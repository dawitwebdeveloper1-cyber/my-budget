// "Added since your last visit": one calm card listing everything added automatically.
import { h, openSheet } from '../ui.js';
import { app, persist } from '../state.js';
import { formatCents } from '../money.js';
import { formatDate } from '../dates.js';
import { signed } from '../calc.js';
import { money } from '../components.js';
import { openEntrySheet } from './entry.js';

let open = false;

export function openWelcome() {
  const s = app.state;
  const items = s.notice.map((id) => s.entries.find((e) => e.id === id)).filter(Boolean)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  if (!items.length) { if (s.notice.length) { s.notice = []; persist(); } return; }
  if (open || document.querySelector('dialog[open]')) return;
  open = true;
  const clear = () => { app.state.notice = []; persist(); open = false; };
  const sheet = openSheet('Added since your last visit', () => [
    h('div', { class: 'card list flat' }, items.map((e) => {
      const saving = s.entries.find((x) => x.parentId === e.id);
      return h('button', { class: 'entry', onClick: () => { sheet.close(); openEntrySheet(app.state.entries.find((x) => x.id === e.id)); } },
        h('div', {},
          h('div', {}, e.name),
          h('div', { class: 'meta' }, formatDate(e.at, { weekday: true })),
          saving ? h('div', { class: 'meta' }, `${formatCents(-saving.cents)} to ${saving.name.replace(/^To /, '')}`) : null),
        money(signed(e), { kind: e.type === 'income' ? 'in' : 'out' }));
    })),
    h('p', { class: 'faint small-note center' }, 'Tap any item to change it.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => sheet.close() }, 'Looks good')),
  ], { onClose: clear });
}
