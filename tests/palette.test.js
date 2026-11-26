// Every palette, light and dark: text at least 4.5:1, chart colours at least 3:1 (WCAG AA).
// The colours below must match css/app.css; the last test checks that they do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const shared = {
  light: { text: '#23211E', label: '#5E5A55', idle: '#6B665F', in: '#3F5139', out: '#94533A', inbg: '#E3EADD', outbg: '#F3E1D3', onAccent: '#FFFFFF', extra: ['#5D7A8C', '#8A6B2E', '#6E5A8A', '#3D6B61', '#8A5A6A'] },
  dark: { text: '#F2EEE8', label: '#A8A39B', idle: '#A8A39B', in: '#AFCBA3', out: '#EBA88B', inbg: '#29342A', outbg: '#3D2A23', onAccent: '#FFFFFF', extra: ['#9DBFD2', '#D8BF85', '#BFAEDC', '#8DCDBE', '#D9A3B4'] },
};
const P = {
  forest: { light: { accent: '#2F4A3A', pill: '#44614F', lab: '#D3E0D6', bg: '#F4F2EC', card: '#FFFDF9', chart: ['#26453B', '#E3721D', '#9E5D35', '#7B8FB0'] },
    dark: { accent: '#3C5C49', pill: '#4C755D', lab: '#D3E0D6', bg: '#151A17', card: '#1E2420', chart: ['#84B699', '#F2B55B', '#D67C57', '#B9B0D0'] } },
  charcoal: { light: { accent: '#3A3631', pill: '#4F4A44', lab: '#D9D2C8', bg: '#F4F0EA', card: '#FFFDF9', chart: ['#9B270D', '#C98310', '#68945E', '#6A252E'] },
    dark: { accent: '#5B554D', pill: '#716A60', lab: '#D9D2C8', bg: '#1B1917', card: '#25221F', chart: ['#CC4123', '#EEAF31', '#9FC67B', '#AC535D'] } },
  navy: { light: { accent: '#2E3A66', pill: '#44518A', lab: '#D5DAEE', bg: '#F6F3EE', card: '#FFFDF9', chart: ['#2B3964', '#D07D1E', '#759B61', '#A3748F'] },
    dark: { accent: '#404F97', pill: '#4C5EB3', lab: '#D5DAEE', bg: '#16181F', card: '#20232C', chart: ['#9398DD', '#F3C368', '#85DCBD', '#CC7564'] } },
  plum: { light: { accent: '#4A3556', pill: '#614A6E', lab: '#E2D6E8', bg: '#F6F2F0', card: '#FFFDF9', chart: ['#4A3556', '#BC8916', '#6A9E77', '#983D23'] },
    dark: { accent: '#634873', pill: '#79588C', lab: '#E2D6E8', bg: '#1A1619', card: '#241F24', chart: ['#B79BCB', '#EDB45A', '#8FC29A', '#B96043'] } },
};

const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8').toUpperCase();

for (const [name, modes] of Object.entries(P)) {
  for (const [mode, p] of Object.entries(modes)) {
    test(`contrast: ${name} ${mode}`, () => {
      const s = shared[mode];
      const need = (label, a, b, min) => assert.ok(ratio(a, b) >= min, `: ${a} on ${b} is ${ratio(a, b).toFixed(2)}:1, needs ${min}:1`);
      for (const bgc of [p.bg, p.card]) { need('text', s.text, bgc, 4.5); need('label', s.label, bgc, 4.5); need('inactive tab', s.idle, bgc, 4.5); }
      need('money in', s.in, s.inbg, 4.5); need('money out', s.out, s.outbg, 4.5);
      need('white on main card', s.onAccent, p.accent, 4.5); need('label on main card', p.lab, p.accent, 4.5); need('white on pill', s.onAccent, p.pill, 4.5);
      [...p.chart, ...s.extra].forEach((c, i) => need(`chart colour ${i + 1}`, c, p.card, 3));
    });
  }
}

test('the checked colours are the ones in the stylesheet', () => {
  const all = [...Object.values(shared).flatMap((s) => [s.text, s.label, s.idle, s.in, s.out, s.inbg, s.outbg, ...s.extra]),
    ...Object.values(P).flatMap((m) => Object.values(m).flatMap((p) => [p.accent, p.pill, p.lab, p.bg, p.card, ...p.chart]))];
  for (const c of new Set(all)) assert.ok(css.includes(c.toUpperCase()), `missing from app.css: ${c}`);
});