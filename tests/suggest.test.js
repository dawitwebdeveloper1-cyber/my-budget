import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMerchant, rememberMerchant, merchantCategory, suggestCategories,
  addFavourite, removeFavourite, isFavourite, MAX_FAVOURITES,
} from '../js/suggest.js';
import { addEntry, updateEntry, quickEntry, repeatEntry, deleteEntry } from '../js/ops.js';
import { freshState, cleanState } from '../js/store.js';
import { monthSummary } from '../js/calc.js';
import { budgetMonth } from '../js/dates.js';

let n = 0;
const id = () => `s${++n}`;
const NOW = '2026-11-12T12:30';

function withHistory() {
  const s = freshState();
  const add = (name, cents, at, category) => addEntry(s, { id: id(), type: 'expense', name, cents, at, category, note: '' }, id);
  for (let d = 1; d <= 10; d++) add('Tim Hortons', 450 + d, `2026-11-${String(d).padStart(2, '0')}T08:10`, 'Eating Out');
  for (let d = 1; d <= 6; d++) add('No Frills', 8000 + d * 100, `2026-11-${String(d).padStart(2, '0')}T18:30`, 'Groceries');
  for (let d = 1; d <= 4; d++) add('Bus', 330, `2026-11-${String(d).padStart(2, '0')}T12:15`, 'Transport');
  return s;
}

test('store names are tidied so small differences still match', () => {
  assert.equal(normalizeMerchant('Tim Hortons #1234 '), 'tim hortons');
  assert.equal(normalizeMerchant('TIM HORTONS 04471'), 'tim hortons');
  assert.equal(normalizeMerchant('  Tim  Hortons!! '), 'tim hortons');
  assert.equal(normalizeMerchant("McDonald's"), "mcdonald's");
  assert.equal(normalizeMerchant(''), '');
});

test('merchant memory: once tagged, the same store gets the same category', () => {
  const s = freshState();
  addEntry(s, { id: id(), type: 'expense', name: 'Tim Hortons #12', cents: 450, at: NOW, category: 'Eating Out', note: '' }, id);
  assert.equal(merchantCategory(s, 'TIM HORTONS 0099'), 'Eating Out');
  assert.equal(merchantCategory(s, 'Starbucks'), null);
  // changing the category on an entry updates the memory
  const e = s.entries[0];
  updateEntry(s, { ...e, category: 'Fun' }, id);
  assert.equal(merchantCategory(s, 'Tim Hortons'), 'Fun');
  // entries named after their category teach nothing
  assert.equal(rememberMerchant(s, 'Groceries', 'Groceries'), false);
  // a category that no longer exists is not suggested
  s.categories.expense = s.categories.expense.filter((c) => c !== 'Fun');
  assert.equal(merchantCategory(s, 'Tim Hortons'), null);
});

test('suggestions: three categories, best first, never more', () => {
  const s = withHistory();
  const morning = suggestCategories(s, { cents: 455, now: '2026-11-12T08:05' });
  assert.equal(morning.length, 3);
  assert.equal(morning[0], 'Eating Out', 'morning coffee-sized amount');
  const evening = suggestCategories(s, { cents: 8500, now: '2026-11-12T18:40' });
  assert.equal(evening[0], 'Groceries', 'evening grocery-sized amount');
  const noon = suggestCategories(s, { cents: 330, now: '2026-11-12T12:20' });
  assert.equal(noon[0], 'Transport', 'bus fare at lunchtime');
});

test('suggestions: a known store comes first', () => {
  const s = withHistory();
  assert.equal(suggestCategories(s, { cents: 9000, name: 'tim hortons', now: '2026-11-12T18:40' })[0], 'Eating Out');
});

test('suggestions with no history follow your category order', () => {
  const s = freshState();
  assert.deepEqual(suggestCategories(s, { now: NOW }), s.categories.expense.slice(0, 3));
  assert.deepEqual(suggestCategories(s, { type: 'income', now: NOW }), ['Paycheck', 'Other income']);
});

test('quick entry: only amount and category needed; name defaults to the category', () => {
  const e = quickEntry({ cents: 1250, category: 'Groceries', at: NOW, newId: id });
  assert.equal(e.name, 'Groceries');
  assert.equal(e.cents, 1250);
  assert.equal(e.type, 'expense');
  assert.equal(e.at, NOW);
  assert.ok(cleanState({ entries: [e] }).entries.length === 1, 'a valid entry');
  assert.equal(quickEntry({ cents: 450, category: 'Eating Out', name: '  Tim Hortons ', at: NOW, newId: id }).name, 'Tim Hortons');
});

test('repeat copies an entry to today and it counts', () => {
  const s = freshState();
  const old = { id: id(), type: 'expense', name: 'Bus pass', cents: 330, at: '2026-11-03T08:00', category: 'Transport', note: '' };
  addEntry(s, old, id);
  const copy = repeatEntry(s, old, NOW, id);
  assert.notEqual(copy.id, old.id);
  assert.equal(copy.at, NOW);
  assert.equal(s.entries.length, 2);
  const sum = monthSummary(s.entries, budgetMonth(NOW, 1), NOW);
  assert.equal(sum.moneyOut.value, -660);
  // undoing is just deleting the copy
  deleteEntry(s, copy.id);
  assert.equal(s.entries.length, 1);
});

test('repeating a paycheck also repeats its auto-save', () => {
  const s = freshState();
  s.goals.push({ id: 'g', name: 'Car', targetCents: 100000 });
  s.settings.autoSaveBp = 2000;
  s.settings.autoSaveGoalId = 'g';
  const pay = { id: id(), type: 'income', name: 'Paycheck', cents: 50001, at: '2026-11-06T09:00', category: 'Paycheck', note: '' };
  addEntry(s, pay, id);
  repeatEntry(s, pay, NOW, id);
  assert.deepEqual(s.entries.filter((e) => e.type === 'saving').map((e) => e.cents), [10000, 10000]);
});

test('favourites: add once, no duplicates, limited, removable', () => {
  const s = freshState();
  const bus = { type: 'expense', name: 'Bus pass', cents: 330, category: 'Transport' };
  assert.ok(addFavourite(s, bus, id));
  assert.equal(addFavourite(s, { ...bus, name: 'BUS PASS' }, id), false, 'same favourite');
  assert.ok(isFavourite(s, bus));
  for (let i = 0; i < 20; i++) addFavourite(s, { ...bus, cents: 400 + i }, id);
  assert.equal(s.favourites.length, MAX_FAVOURITES);
  removeFavourite(s, bus);
  assert.ok(!isFavourite(s, bus));
  removeFavourite(s, s.favourites[0].id);
  assert.equal(s.favourites.length, MAX_FAVOURITES - 2);
});

test('favourites and merchant memory survive saving and loading', () => {
  const s = freshState();
  addFavourite(s, { type: 'expense', name: 'Bus pass', cents: 330, category: 'Transport' }, id);
  rememberMerchant(s, 'Tim Hortons', 'Eating Out');
  const back = cleanState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back.favourites, s.favourites);
  assert.deepEqual(back.merchants, s.merchants);
});
