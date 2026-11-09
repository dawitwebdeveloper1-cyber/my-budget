import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatCents, centsToInput, sumCents, MAX_ENTRY_CENTS } from '../js/money.js';

test('parseAmount reads normal amounts as exact cents', () => {
  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('12.05'), 1205);
  assert.equal(parseAmount('0.01'), 1);
  assert.equal(parseAmount('.5'), 50);
  assert.equal(parseAmount('12.'), 1200);
  assert.equal(parseAmount('$1,234.56'), 123456);
  assert.equal(parseAmount(' 7.99 '), 799);
  assert.equal(parseAmount('19.99'), 1999); // classic float trap: 19.99*100 = 1998.9999...
  assert.equal(parseAmount('4.35'), 435); // 4.35*100 = 434.99999...
});

test('parseAmount rejects anything that is not a clean positive amount', () => {
  for (const bad of ['', ' ', '.', 'abc', '12.345', '-5', '0', '0.00', '1e3', '12.3.4', '$', '1 2x', null, undefined, 12]) {
    assert.equal(parseAmount(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(parseAmount('10000000.00'), MAX_ENTRY_CENTS);
  assert.equal(parseAmount('10000000.01'), null);
  assert.equal(parseAmount('9999999999'), null);
});

test('decimal pennies add up exactly (no 0.1 + 0.2 problem)', () => {
  assert.equal(parseAmount('0.10') + parseAmount('0.20'), parseAmount('0.30'));
  assert.equal(sumCents(Array(1000).fill(parseAmount('0.01'))), parseAmount('10'));
});

test('formatCents shows signs and commas correctly', () => {
  assert.equal(formatCents(0), '$0.00');
  assert.equal(formatCents(5), '$0.05');
  assert.equal(formatCents(123456), '$1,234.56');
  assert.equal(formatCents(100000000), '$1,000,000.00');
  assert.equal(formatCents(-6000), '−$60.00');
  assert.equal(formatCents(1250, { sign: 'always' }), '+$12.50');
  assert.equal(formatCents(-1250, { sign: 'always' }), '−$12.50');
  assert.equal(formatCents(0, { sign: 'always' }), '$0.00');
});

test('format and parse round-trip for 10,000 random amounts', () => {
  for (let i = 0; i < 10000; i++) {
    const c = 1 + Math.floor(Math.random() * MAX_ENTRY_CENTS);
    assert.equal(parseAmount(formatCents(c)), c);
    assert.equal(parseAmount(centsToInput(c)), c);
  }
});

test('money helpers refuse non-cent values', () => {
  assert.throws(() => formatCents(1.5));
  assert.throws(() => sumCents([100, 0.5]));
  assert.throws(() => sumCents([Number.MAX_SAFE_INTEGER, 1]));
});
