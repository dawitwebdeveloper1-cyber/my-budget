// Gentle animations, built with plain CSS, SVG and JavaScript.
// All of them are skipped when the phone's "Reduce Motion" setting is on.

export const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'; // smooth ease-out, no overshoot

export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const easeOut = (t) => 1 - (1 - t) ** 3;

// Counts a number up from 0. The last frame always shows the exact final value.
export function countUp(el, target, format, { duration = 900, delay = 0 } = {}) {
  el.textContent = format(target);
  if (reducedMotion() || !Number.isSafeInteger(target) || target === 0) return;
  el.textContent = format(0);
  const start = performance.now() + delay;
  let done = false;
  const finish = () => { if (!done) { done = true; el.textContent = format(target); } };
  const step = (now) => {
    if (!el.isConnected || done) return;
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    if (t >= 1) { finish(); return; }
    el.textContent = format(Math.round(target * easeOut(t)));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // Safety net: if the screen isn't drawing frames (app in the background), still land on the exact number.
  setTimeout(finish, delay + duration + 80);
}

// Cards fade in and slide up a little as they scroll into view, one after another.
let observer = null;
export function reveal(root) {
  const items = [...root.querySelectorAll('.reveal')];
  if (reducedMotion() || typeof IntersectionObserver !== 'function') {
    items.forEach((el) => el.classList.add('shown'));
    return;
  }
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    let i = 0;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.style.transitionDelay = `${Math.min(i++, 6) * 70}ms`;
      e.target.classList.add('shown');
      observer.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -24px 0px' });
  items.forEach((el) => observer.observe(el));
  // Safety net: anything already on screen is shown even if the browser isn't drawing frames.
  setTimeout(() => {
    for (const el of items) {
      if (!el.isConnected || el.classList.contains('shown')) continue;
      if (el.getBoundingClientRect().top < innerHeight) { el.classList.add('shown'); observer?.unobserve(el); }
    }
  }, 1200);
}

// A short confetti burst in the app's colours.
export function confetti() {
  if (reducedMotion()) return;
  const css = getComputedStyle(document.documentElement);
  const colours = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'].map((v) => css.getPropertyValue(v).trim());
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  document.body.append(wrap);
  const x0 = innerWidth / 2;
  const y0 = innerHeight * 0.34;
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.background = colours[i % colours.length];
    if (i % 3 === 0) { p.style.borderRadius = '50%'; p.style.height = '8px'; }
    wrap.append(p);
    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 170;
    const x1 = x0 + Math.cos(angle) * dist;
    const y1 = y0 + Math.sin(angle) * dist * 0.7 + 140 + Math.random() * 120;
    p.animate([
      { transform: `translate(${x0}px, ${y0}px) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${x1}px, ${y1}px) rotate(${Math.random() * 540 - 270}deg)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 400, easing: EASE, fill: 'forwards' });
  }
  setTimeout(() => wrap.remove(), 1500);
}
