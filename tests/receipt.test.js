import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountsIn, findTotal, findStore, readReceipt } from '../js/receipt.js';

const L = (text) => text.trim().split('\n').map((t) => ({ text: t.trim() }));

test('amounts on a line', () => {
  assert.deepEqual(amountsIn('MILK 2L        4.99'), [499]);
  assert.deepEqual(amountsIn('TOTAL $1,234.56'), [123456]);
  assert.deepEqual(amountsIn('2 @ 1.25    2.50'), [125, 250]);
  assert.deepEqual(amountsIn('TOTAL 12,50'), [1250], 'comma misread as decimal point');
  assert.deepEqual(amountsIn('STORE #1234 TEL 403 555 1234'), []);
  assert.deepEqual(amountsIn('19.99'), [1999]);
});

test('grocery receipt: TOTAL wins over SUBTOTAL, tax, card and change lines', () => {
  const r = readReceipt(L(`
    REAL CANADIAN SUPERSTORE
    3575 20 AVE NE CALGARY AB
    STORE #1564 TEL 403-280-8222
    BANANAS            1.84
    MILK 2L 4L         6.29
    BREAD              3.49
    SUBTOTAL          11.62
    GST                0.17
    TOTAL             11.79
    VISA              11.79
    CHANGE             0.00
  `));
  assert.equal(r.total.cents, 1179);
  assert.equal(r.total.how, 'total');
  assert.equal(r.store, 'Real Canadian Superstore');
});

test('coffee receipt with a tip and the total on the next line', () => {
  const r = readReceipt(L(`
    Tim Hortons #4471
    Welcome!
    1 Med Coffee        2.19
    1 Bagel BELT        6.49
    Subtotal            8.68
    GST 5%              0.43
    Total
    $9.11
    Tip                 1.00
    Debit              10.11
  `));
  assert.equal(r.total.cents, 911);
  assert.equal(r.total.line, 7);
  assert.equal(r.store, 'Tim Hortons');
});

test('no TOTAL line: the largest amount, but never cash or change', () => {
  const r = readReceipt(L(`
    Corner Store
    CHIPS          3.29
    POP            2.49
    AMOUNT        5.78
    CASH          20.00
    CHANGE        14.22
  `));
  assert.equal(r.total.cents, 578);
  assert.equal(r.total.how, 'largest');
});

test('"Total savings" and "Total items" are not the total', () => {
  const t = findTotal(L(`
    TOTAL SAVINGS   5.00
    TOTAL ITEMS 3
    TOTAL          42.10
  `));
  assert.equal(t.cents, 4210);
});

test('grand total beats an earlier total', () => {
  assert.equal(findTotal(L(`
    Food total      30.00
    Tax              1.50
    GRAND TOTAL     31.50
  `)).cents, 3150);
});

test('French receipt (Desjardins area): montant total, sous-total skipped', () => {
  const r = readReceipt(L(`
    Dépanneur Chez Marie
    Sous-total      10,00
    TPS              0,50
    Montant total   10,50
  `));
  assert.equal(r.total.cents, 1050);
  assert.equal(r.store, 'Dépanneur Chez Marie');
});

test('blurry receipt: nothing readable means no total (never invented)', () => {
  const r = readReceipt(L(`
    ~~ ,, ' ;
    l1l |||
  `));
  assert.equal(r.total, null);
  assert.equal(r.store, '');
});

test('a shaky guess is never used as the store name', () => {
  assert.equal(findStore([{ text: 'Fr Foil E-', confidence: 22 }, { text: 'TOTAL 4.00', confidence: 40 }]), '');
  assert.equal(findStore([{ text: 'blurry bits', confidence: 30 }, { text: 'SAFEWAY', confidence: 91 }]), 'Safeway');
});

test('store name skips addresses, phone numbers and greetings', () => {
  assert.equal(findStore(L(`
    WELCOME TO
    123 Main St SW
    (403) 555-0199
    SHOPPERS DRUG MART
  `)), 'Shoppers Drug Mart');
  assert.equal(findStore(L('Calgary AB T2P 1J9\nNO FRILLS')), 'No Frills');
});
