import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVoice, bestGuess, tokenize, findAmount } from '../js/voice.js';
import { freshState } from '../js/store.js';
import { rememberMerchant } from '../js/suggest.js';

const S = freshState();
const P = (t, s = S) => parseVoice(t, s);
const cents = (t) => findAmount(tokenize(t))?.cents ?? null;

test('amounts written as digits', () => {
  assert.equal(cents('spent 12 dollars on lunch'), 1200);
  assert.equal(cents('spent $12.50 on lunch'), 1250);
  assert.equal(cents('$4.35 coffee'), 435);
  assert.equal(cents('paid 1,200 for rent'), 120000);
  assert.equal(cents('12 dollars and 50 cents'), 1250);
  assert.equal(cents('12 dollars 5'), 1205);
  assert.equal(cents('75 cents for gum'), 75);
  assert.equal(cents('$19.99'), 1999);
});

test('amounts spoken as words', () => {
  assert.equal(cents('spent fifteen dollars'), 1500);
  assert.equal(cents('spent fifty dollars'), 5000);
  assert.equal(cents('twenty five dollars on gas'), 2500);
  assert.equal(cents('a hundred and twenty dollars'), 12000);
  assert.equal(cents('two hundred and five'), 20500);
  assert.equal(cents('one thousand two hundred'), 120000);
  assert.equal(cents('twelve fifty for lunch'), 1250);
  assert.equal(cents('twelve point five'), 1250);
  assert.equal(cents('three thirty bus fare'), 330);
  assert.equal(cents('seventy five cents'), 75);
  assert.equal(cents('twelve dollars and fifty cents'), 1250);
});

test('fifteen and fifty are never confused by the reader itself', () => {
  assert.notEqual(cents('fifteen dollars'), cents('fifty dollars'));
  assert.equal(cents('fifteen'), 1500);
  assert.equal(cents('fifty'), 5000);
});

test('no amount means no amount (nothing invented)', () => {
  assert.equal(cents('lunch with sam'), null);
  assert.equal(P('bought lunch').cents, null);
});

test('spending: category from everyday words, name from "on" / "at"', () => {
  const a = P('spent 12 dollars on lunch');
  assert.deepEqual([a.type, a.cents, a.category, a.name], ['expense', 1200, 'Eating Out', 'Lunch']);
  const b = P('25 dollars on gas');
  assert.deepEqual([b.category, b.name], ['Transport', 'Gas']);
  const c = P('spent 80 dollars on groceries at no frills');
  assert.deepEqual([c.category, c.name], ['Groceries', 'No Frills']);
  const d = P('paid 1100 for rent');
  assert.equal(d.category, 'Housing');
  assert.equal(d.type, 'expense');
});

test('a category said out loud wins', () => {
  const s = freshState();
  s.categories.expense.push('Pets');
  assert.equal(P('spent 30 dollars on pets', s).category, 'Pets');
  assert.equal(P('spent 30 dollars fun', s).category, 'Fun');
});

test('stores you have tagged before are remembered', () => {
  const s = freshState();
  rememberMerchant(s, 'Joes Diner', 'Fun');
  const r = P('spent 20 dollars at joes diner', s);
  assert.equal(r.category, 'Fun');
  assert.equal(r.name, 'Joes Diner');
});

test('money in', () => {
  const a = P('got paid 800 dollars');
  assert.deepEqual([a.type, a.cents, a.category], ['income', 80000, 'Paycheck']);
  const b = P('received 50 dollars from mom');
  assert.deepEqual([b.type, b.cents, b.category, b.name], ['income', 5000, 'Other income', 'Mom']);
  assert.equal(P('got coffee for 5 dollars').type, 'expense');
  assert.equal(P('paid 40 dollars for a refund of shoes').type, 'expense', 'refunds are not income');
});

test('unknown category stays empty so you choose', () => {
  const r = P('spent 9 dollars on stuff');
  assert.equal(r.category, null);
  assert.equal(r.cents, 900);
});

test('the best of the phone\'s guesses is the first with an amount', () => {
  const r = bestGuess(['spent dollars on lunch', 'spent fifteen dollars on lunch', 'spent fifty dollars on lunch'], S);
  assert.equal(r.cents, 1500);
  assert.equal(r.heard, 'spent fifteen dollars on lunch');
});
