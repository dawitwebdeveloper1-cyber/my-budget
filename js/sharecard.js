// Shareable goal cards: a clean picture for an Instagram or TikTok story. No amounts unless you choose.
import { h, openSheet, toast } from './ui.js';
import { app } from './state.js';
import { formatCents } from './money.js';
import { nowStamp } from './dates.js';
import { goalProgress } from './budget.js';

const W = 1080;
const H = 1920;

// The words on the card. Amounts only when showAmount is on.
export function goalCardText(goal, progress, showAmount) {
  const reached = progress.reached;
  const pct = Math.min(100, progress.percent);
  if (reached) {
    return {
      kicker: 'Goal reached',
      title: showAmount ? `Saved ${formatCents(goal.targetCents)}` : 'I did it!',
      sub: showAmount ? `for ${goal.name}` : `${goal.name}: 100% saved`,
      percent: 100,
    };
  }
  return {
    kicker: pct >= 50 ? (pct >= 75 ? 'Almost there' : 'Halfway there') : 'On my way',
    title: `${pct}%`,
    sub: showAmount ? `${formatCents(progress.value)} of ${formatCents(goal.targetCents)} for ${goal.name}` : `of the way to ${goal.name}`,
    percent: pct,
  };
}

// Splits a line so it fits the card's width.
function wrap(ctx, text, max) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

export function drawGoalCard(canvas, text) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const font = (size, weight = 800) => `${weight} ${size}px ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif`;
  // Calm charcoal background with a soft light in one corner.
  ctx.fillStyle = '#23272B';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.12, 0, W * 0.85, H * 0.12, W);
  glow.addColorStop(0, 'rgba(163, 205, 184, 0.28)');
  glow.addColorStop(1, 'rgba(163, 205, 184, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const left = 110;
  ctx.fillStyle = '#A3CDB8';
  ctx.font = font(52, 700);
  ctx.fillText(text.kicker.toUpperCase(), left, 640);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(text.title.length > 9 ? 150 : 230);
  ctx.fillText(text.title, left - 8, 860);

  ctx.fillStyle = '#C5CAD0';
  ctx.font = font(66, 600);
  wrap(ctx, text.sub, W - left * 2).forEach((line, i) => ctx.fillText(line, left, 990 + i * 86));

  // Progress bar.
  const y = 1300;
  const bw = W - left * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, left, y, bw, 34, 17);
  ctx.fill();
  ctx.fillStyle = '#A3CDB8';
  roundRect(ctx, left, y, Math.max(34, (bw * text.percent) / 100), 34, 17);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = font(48, 700);
  ctx.fillText('My Budget', left, H - 170);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = font(38, 600);
  ctx.fillText('budgeting by paycheck, data stays on your phone', left, H - 112);
}

function roundRect(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hh, r);
  ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function openShareCard(goal, from = null) {
  const progress = goalProgress(goal, app.state.entries, nowStamp());
  if (!progress.ok) { toast("Couldn't double-check this goal, so there's no card."); return; }
  let showAmount = false;
  const canvas = h('canvas', { class: 'share-card', 'aria-label': 'Preview of the picture card' });
  const sheet = openSheet('Share your goal', () => view(), { from });

  function view() {
    drawGoalCard(canvas, goalCardText(goal, progress, showAmount));
    const box = h('input', { type: 'checkbox', id: 'show-amt', checked: showAmount });
    box.addEventListener('change', () => { showAmount = box.checked; sheet.setContent(view()); });
    return [
      canvas,
      h('label', { class: 'check', for: 'show-amt' }, box, h('span', {}, 'Show the dollar amounts')),
      h('p', { class: 'faint small-note' }, 'Amounts stay off unless you turn them on. Nothing else from the app is in the picture.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: share }, 'Share picture')),
    ];
  }

  async function share() {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) { toast("Couldn't make the picture"); return; }
    const name = `my-budget-${goal.name.replace(/[^\w-]+/g, '-').toLowerCase()}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); sheet.close(); return; }
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    sheet.close();
  }
}

// Milestones worth a card: 25%, 50%, 75% and reached.
export const MILESTONES = [25, 50, 75, 100];
export function milestoneOf(progress) {
  if (!progress.ok) return 0;
  if (progress.reached) return 100;
  return MILESTONES.filter((m) => m < 100 && progress.percent >= m).at(-1) ?? 0;
}
