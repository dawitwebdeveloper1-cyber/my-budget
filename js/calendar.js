// Hands a calendar file to the phone so it can show its "Add to Calendar" screen.
import { buildICS, alertTriggers } from './recurring.js';
import { formatCents } from './money.js';
import { toast } from './ui.js';
import { app } from './state.js';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function addToCalendar(rule, { noAmount = false, alerts = null, description } = {}) {
  const ics = buildICS(rule, {
    amountText: noAmount ? null : formatCents(rule.cents),
    alerts: alerts ?? alertTriggers(app.state.settings),
    description,
  });
  const filename = `${rule.name.replace(/[^\w\- ]+/g, '').trim() || 'reminder'}.ics`;
  if (isIOS()) {
    // iPhone opens calendar files as an "Add to Calendar" preview.
    const url = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    const w = window.open(url, '_blank');
    if (!w) window.location.href = url;
    return;
  }
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast('Calendar file ready. Open it to add the reminder.');
}
