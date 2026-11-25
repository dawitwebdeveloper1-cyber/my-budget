import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalCardText, milestoneOf } from '../js/sharecard.js';
import { shareAskDue } from '../js/habits.js';
import { storyText, feedbackLink } from '../js/sheets/about.js';
import { APP_VERSION, WHATS_NEW } from '../js/config.js';
import { cleanState } from '../js/store.js';

const goal = { id: 'car', name: 'Car', targetCents: 100000 };
const prog = (value) => ({ ok: true, value, percent: Math.min(100, Math.floor((value * 100) / 100000)), reached: value >= 100000 });

test('goal card: no amounts unless chosen', () => {
  const off = goalCardText(goal, prog(52000), false);
  assert.equal(off.kicker, 'Halfway there');
  assert.equal(off.title, '52%');
  assert.equal(off.sub, 'of the way to Car');
  assert.ok(!JSON.stringify(off).includes('$'), 'not a single dollar amount');
  const on = goalCardText(goal, prog(52000), true);
  assert.equal(on.sub, '$520.00 of $1,000.00 for Car');
  const done = goalCardText(goal, prog(100000), false);
  assert.deepEqual([done.kicker, done.title, done.sub], ['Goal reached', 'I did it!', 'Car: 100% saved']);
  assert.ok(!JSON.stringify(done).includes('$'));
  assert.equal(goalCardText(goal, prog(100000), true).title, 'Saved $1,000.00');
});

test('milestones: 25, 50, 75, reached', () => {
  assert.equal(milestoneOf(prog(24999)), 0);
  assert.equal(milestoneOf(prog(25000)), 25);
  assert.equal(milestoneOf(prog(74999)), 50);
  assert.equal(milestoneOf(prog(99999)), 75);
  assert.equal(milestoneOf(prog(100000)), 100);
  assert.equal(milestoneOf({ ok: false }), 0);
  assert.equal(cleanState({}).milestones, null, 'older data: noted quietly the first time');
  assert.deepEqual(cleanState({ milestones: { car: 50, bad: 33 } }).milestones, { car: 50 });
});

test('share ask: only in the 2 days after a win, at most every 3 months', () => {
  const now = '2026-11-25T12:00';
  assert.equal(shareAskDue({ winAt: null }, now), false);
  assert.equal(shareAskDue({ winAt: '2026-11-24T09:00' }, now), true);
  assert.equal(shareAskDue({ winAt: '2026-11-20T09:00' }, now), false, 'too long after the win');
  assert.equal(shareAskDue({ winAt: '2026-11-24T09:00', shareAskAt: '2026-10-01T09:00' }, now), false, 'asked under 3 months ago');
  assert.equal(shareAskDue({ winAt: '2026-11-24T09:00', shareAskAt: '2026-08-20T09:00' }, now), true);
});

test('story and feedback email', () => {
  assert.equal(storyText('Sam')[0], "Hi, I'm Sam, a high school student in Calgary.");
  assert.equal(storyText('')[0], "Hi! I'm a high school student in Calgary.");
  const link = feedbackLink('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)');
  assert.ok(link.startsWith('mailto:'));
  const body = decodeURIComponent(link.split('body=')[1]);
  assert.match(body, new RegExp(`My Budget ${APP_VERSION.replace('.', '\\.')} · iPhone \\(iOS 18\\.2\\)`));
  assert.match(body, /don't include passwords/);
});

test("what's new exists for this version and is short", () => {
  const lines = WHATS_NEW[APP_VERSION];
  assert.ok(lines && lines.length >= 1 && lines.length <= 5);
  assert.ok(lines.every((l) => l.length <= 110));
  assert.equal(cleanState({ settings: { seenVersion: APP_VERSION } }).settings.seenVersion, APP_VERSION);
});
