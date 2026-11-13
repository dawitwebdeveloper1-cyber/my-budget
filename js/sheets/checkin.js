// The payday check-in: one short screen, once per paycheck. It takes the place of
// "Added since your last visit" that day, and lists anything else that was added too.
import { h, openSheet } from '../ui.js';
import { app, persist } from '../state.js';
import { formatCents } from '../money.js';
import { formatDate } from '../dates.js';
import { signed } from '../calc.js';
import { money, howButton } from '../components.js';

let open = false;

export function openCheckin(ci) {
  if (open || document.querySelector('dialog[open]')) return;
  open = true;
  const s = app.state;
  const p = ci.paycheck;
  const skip = new Set([p.id, ...ci.saved.map((e) => e.id)]);
  const others = s.notice.map((id) => s.entries.find((e) => e.id === id)).filter((e) => e && !skip.has(e.id));
  const done = () => { app.state.lastCheckin = p.id; app.state.notice = []; persist(); open = false; };

  const sheet = openSheet('Payday check-in', () => [
    h('div', { class: 'confirm-card' },
      h('div', { class: 'big num in' }, formatCents(p.cents, { sign: 'always' })),
      h('div', { class: 'what' }, p.name),
      h('div', { class: 'meta' }, `Came in ${formatDate(p.at, { weekday: true })}`)),
    h('ul', { class: 'facts checkin' },
      ci.saved.length
        ? h('li', {}, `Saved: ${ci.saved.map((e) => `${formatCents(e.cents)} ${e.name.replace(/^To /, 'to ')}`).join(', ')}.`)
        : s.goals.length ? h('li', {}, 'Nothing set aside automatically. You can turn on auto-save from any goal.') : null,
      ci.lup ? h('li', {}, `To spend until next payday: ${formatCents(ci.lup.value)}${ci.lup.perDay ? `, about ${formatCents(ci.lup.perDay.value)} a day` : ''}.`) : null,
      ci.compare ? h('li', {}, ci.compare.text) : null),
    h('div', { class: 'hows' },
      ci.lup ? howButton(ci.lup, 'Until payday') : null,
      ci.compare?.receipt ? howButton(ci.compare, 'Last two paychecks') : null),
    others.length ? h('div', { class: 'field' }, h('span', {}, 'Also added since your last visit'),
      h('div', { class: 'card list flat' }, others.map((e) => h('div', { class: 'entry' },
        h('div', {}, h('div', {}, e.name), h('div', { class: 'meta' }, formatDate(e.at, { weekday: true }))),
        money(signed(e), { kind: e.type === 'income' ? 'in' : 'out' }))))) : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => sheet.close() }, 'Got it')),
  ], { onClose: done });
}
