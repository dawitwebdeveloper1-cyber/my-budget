// Sample files follow each bank's publicly described export layout. Real files can differ a little;
// anything unrecognised falls back to the "which column is which?" screen, which is tested too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCSV, parseMoney, dateParts, detectDateOrder, toISODate, detectLayout, readTransactions,
  signExample, dedupe, importKey, guessCategory, cleanDescription,
} from '../js/bankimport.js';
import { freshState } from '../js/store.js';
import { rememberMerchant } from '../js/suggest.js';

const run = (csv, opts = {}) => {
  const rows = parseCSV(csv);
  const layout = detectLayout(rows);
  return { layout, ...readTransactions(rows, layout, opts) };
};

test('CSV: quotes, commas inside quotes, semicolons, BOM, Windows line endings', () => {
  assert.deepEqual(parseCSV('﻿a,"b, c","say ""hi"""\r\n1,2,3\r\n'), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  assert.deepEqual(parseCSV('Date;Montant;Description\n2026-11-03;-12,50;Café\n'), [['Date', 'Montant', 'Description'], ['2026-11-03', '-12,50', 'Café']]);
  assert.deepEqual(parseCSV('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('money: every way banks write amounts, in exact cents', () => {
  assert.equal(parseMoney('12.50'), 1250);
  assert.equal(parseMoney('-12.50'), -1250);
  assert.equal(parseMoney('(12.50)'), -1250);
  assert.equal(parseMoney('12.50-'), -1250);
  assert.equal(parseMoney('$1,234.56'), 123456);
  assert.equal(parseMoney('12,50'), 1250);
  assert.equal(parseMoney('1 234,56'), 123456);
  assert.equal(parseMoney('-1.234,56'), -123456);
  assert.equal(parseMoney('19.99'), 1999);
  assert.equal(parseMoney('0.00'), 0);
  assert.equal(parseMoney('5'), 500);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
});

test('dates: every format, and day-first vs month-first decided from the whole file', () => {
  assert.deepEqual(dateParts('2026-11-03'), { kind: 'ymd', y: 2026, m: 11, d: 3 });
  assert.deepEqual(dateParts('20261103'), { kind: 'ymd', y: 2026, m: 11, d: 3 });
  assert.deepEqual(dateParts('2026-11-03 14:22:00'), { kind: 'ymd', y: 2026, m: 11, d: 3 });
  assert.deepEqual(dateParts('Nov 3, 2026'), { kind: 'ymd', y: 2026, m: 11, d: 3 });
  assert.deepEqual(dateParts('03 nov. 2026'), { kind: 'ymd', y: 2026, m: 11, d: 3 });
  assert.deepEqual(dateParts('3 août 2026'), { kind: 'ymd', y: 2026, m: 8, d: 3 });
  assert.equal(detectDateOrder(['03/04/2026', '15/04/2026']), 'dmy', 'a day over 12 settles it');
  assert.equal(detectDateOrder(['03/04/2026', '04/15/2026']), 'mdy');
  assert.equal(detectDateOrder(['03/04/2026', '05/06/2026']), 'ask', 'truly ambiguous: ask once');
  assert.equal(detectDateOrder(['2026-03-04']), 'ymd');
  assert.equal(toISODate('03/04/2026', 'dmy'), '2026-04-03');
  assert.equal(toISODate('03/04/2026', 'mdy'), '2026-03-04');
  assert.equal(toISODate('03/04/2026', 'ask'), null);
  assert.equal(toISODate('02/29/2028', 'mdy'), '2028-02-29', 'leap day');
  assert.equal(toISODate('02/29/2027', 'mdy'), null, 'not a leap year');
  assert.equal(toISODate('11/03/26', 'mdy'), '2026-11-03');
});

test('RBC: header with Description 1 / 2 and CAD$', () => {
  const r = run(`"Account Type","Account Number","Transaction Date","Cheque Number","Description 1","Description 2","CAD$","USD$"
Chequing,00000-1234567,11/3/2026,,"TIM HORTONS #1234","CALGARY AB",-4.75,
Chequing,00000-1234567,11/6/2026,,"PAYROLL DEPOSIT","ACME INC",1240.00,
Chequing,00000-1234567,11/14/2026,,"NO FRILLS #3201",,-54.25,`);
  assert.equal(r.layout.bank, 'RBC');
  assert.equal(r.layout.dateOrder, 'mdy');
  assert.ok(r.layout.needsSign);
  assert.deepEqual(r.transactions, [
    { date: '2026-11-03', cents: 475, type: 'expense', description: 'TIM HORTONS #1234 CALGARY AB' },
    { date: '2026-11-06', cents: 124000, type: 'income', description: 'PAYROLL DEPOSIT ACME INC' },
    { date: '2026-11-14', cents: 5425, type: 'expense', description: 'NO FRILLS #3201' },
  ]);
});

test('TD: no header; date, description, money out, money in, balance', () => {
  const r = run(`11/03/2026,TIM HORTONS #1234,4.75,,1995.25
11/06/2026,PAYROLL ACME,,1240.00,3235.25
11/14/2026,NO FRILLS,54.25,,3181.00`);
  assert.equal(r.layout.bank, 'TD');
  assert.equal(r.layout.needsSign, false, 'separate columns: no question needed');
  assert.deepEqual(r.transactions.map((t) => [t.date, t.type, t.cents]), [
    ['2026-11-03', 'expense', 475], ['2026-11-06', 'income', 124000], ['2026-11-14', 'expense', 5425],
  ]);
});

test('CIBC: no header, ISO dates, debit and credit columns', () => {
  const r = run(`2026-11-03,TIM HORTONS #1234,4.75,
2026-11-06,PAYROLL,,1240.00
2026-11-14,NO FRILLS,54.25,`);
  assert.equal(r.layout.bank, 'CIBC');
  assert.deepEqual(r.transactions.map((t) => [t.type, t.cents]), [['expense', 475], ['income', 124000], ['expense', 5425]]);
});

test('Scotiabank-style: no header, one signed amount column, then a description', () => {
  const csv = `11/03/2026,-4.75,-,Point of sale purchase,TIM HORTONS #1234
11/06/2026,1240.00,-,Payroll deposit,ACME INC`;
  assert.equal(run(csv).layout.dateOrder, 'ask', 'early-month dates only: asked once, never guessed');
  const r = run(csv, { dateOrder: 'mdy' });
  assert.ok(r.layout.needsSign);
  assert.deepEqual(r.transactions.map((t) => [t.type, t.cents]), [['expense', 475], ['income', 124000]]);
});

test('BMO credit card: account lines before the header; positive = spending', () => {
  const csv = `Following data is valid as of 20261115123000 (Year/Month/Day/Hour/Minute/Second)


Item #,Card #,Transaction Date,Posting Date,Transaction Amount,Description
1,'5191230000001234',20261103,20261104,4.75,TIM HORTONS #1234 CALGARY AB
2,'5191230000001234',20261108,20261109,-20.00,PAYMENT RECEIVED - THANK YOU`;
  const rows = parseCSV(csv);
  const layout = detectLayout(rows);
  assert.equal(layout.bank, 'BMO');
  assert.equal(layout.headerAt, 1);
  const ex = signExample(rows, layout);
  assert.equal(ex.negative, false);
  // The person answers "yes, that was money out" for a positive example → positive-out
  const { transactions } = readTransactions(rows, layout, { signMode: 'positive-out' });
  assert.deepEqual(transactions.map((t) => [t.date, t.type, t.cents]), [['2026-11-03', 'expense', 475], ['2026-11-08', 'income', 2000]]);
});

test('Tangerine: Transaction date, Transaction, Name, Memo, Amount', () => {
  const r = run(`Transaction date,Transaction,Name,Memo,Amount
11/3/2026,DEBIT,TIM HORTONS #1234,Purchase,-4.75
11/16/2026,CREDIT,PAYROLL,Deposit,1240.00`);
  assert.equal(r.layout.dateOrder, 'mdy');
  assert.equal(r.layout.bank, 'Tangerine');
  assert.deepEqual(r.transactions.map((t) => [t.type, t.cents]), [['expense', 475], ['income', 124000]]);
  assert.match(r.transactions[0].description, /TIM HORTONS/);
});

test('Simplii: Funds Out / Funds In', () => {
  const r = run(`Date,Transaction Details,Funds Out,Funds In
11/03/2026,TIM HORTONS,4.75,
11/20/2026,PAYROLL,,1240.00`);
  assert.equal(r.layout.bank, 'Simplii');
  assert.deepEqual(r.transactions.map((t) => [t.type, t.cents]), [['expense', 475], ['income', 124000]]);
});

test('Wealthsimple: ISO dates and a signed amount', () => {
  const r = run(`date,transaction,description,amount,balance
2026-11-03,PURCHASE,Tim Hortons,-4.75,995.25
2026-11-06,DEPOSIT,Payroll,1240.00,2235.25`);
  assert.deepEqual(r.transactions.map((t) => [t.date, t.type, t.cents]), [['2026-11-03', 'expense', 475], ['2026-11-06', 'income', 124000]]);
});

test('Desjardins-style French headings, day-first dates, decimal commas', () => {
  const r = run(`Date de transaction;Description;Retrait;Dépôt;Solde
03/11/2026;Tim Hortons;4,75;;995,25
15/11/2026;Paie;;1 240,00;2 235,25`);
  assert.equal(r.layout.dateOrder, 'dmy');
  assert.deepEqual(r.transactions.map((t) => [t.date, t.type, t.cents]), [['2026-11-03', 'expense', 475], ['2026-11-15', 'income', 124000]]);
});

test('French single amount column ("Montant")', () => {
  const r = run(`Date;Libellé;Montant
2026-11-03;ACHAT TIM HORTONS;-4,75`);
  assert.equal(r.layout.bank, 'a French-language bank file');
  assert.equal(r.transactions[0].cents, 475);
});

test('ambiguous dates are not guessed', () => {
  const r = run(`Date,Description,Amount
03/04/2026,COFFEE,-4.75
05/06/2026,LUNCH,-12.00`);
  assert.equal(r.layout.dateOrder, 'ask');
  assert.equal(r.transactions.length, 0, 'nothing imported until you answer');
  const fixed = readTransactions(parseCSV(`Date,Description,Amount
03/04/2026,COFFEE,-4.75`), r.layout, { dateOrder: 'dmy' });
  assert.equal(fixed.transactions[0].date, '2026-04-03');
});

test('totals, notes and blank lines are skipped; broken rows are reported', () => {
  const r = run(`Date,Description,Amount
2026-11-03,COFFEE,-4.75
,,
Total,,-4.75
2026-11-04,,-3.00`);
  assert.equal(r.transactions.length, 1);
  assert.deepEqual(r.problems, ['2026-11-04, -3.00'], 'shown so you can see what was left out');
});

test('duplicates are skipped, but two identical bus fares on one day both count', () => {
  const state = freshState();
  state.entries.push({ id: 'a', type: 'expense', name: 'Bus', cents: 330, at: '2026-11-03T08:00', category: 'Transport', note: '' });
  const file = [
    { date: '2026-11-03', cents: 330, type: 'expense', description: 'BUS' },
    { date: '2026-11-03', cents: 330, type: 'expense', description: 'Bus' },
    { date: '2026-11-04', cents: 475, type: 'expense', description: 'TIM HORTONS' },
  ];
  const { fresh, skipped } = dedupe(file, state.entries);
  assert.equal(skipped, 1);
  assert.equal(fresh.length, 2);
  // importing the same file again after saving skips everything
  const after = [...state.entries, ...fresh.map((t, i) => ({ id: `i${i}`, type: t.type, name: cleanDescription(t.description), cents: t.cents, at: `${t.date}T12:00`, importKey: importKey(t) }))];
  assert.equal(dedupe(file, after).skipped, 3);
});

test('your own "Paycheck" and the bank\'s "PAYROLL DEPOSIT" a day later are flagged, not doubled', () => {
  const entries = [
    { id: 'p', type: 'income', name: 'Paycheck', cents: 124000, at: '2026-11-06T09:00', auto: true },
    { id: 'r', type: 'expense', name: 'Rent', cents: 110000, at: '2026-11-01T09:00' },
  ];
  const file = [
    { date: '2026-11-07', cents: 124000, type: 'income', description: 'PAYROLL DEPOSIT ACME' },
    { date: '2026-11-01', cents: 110000, type: 'expense', description: 'E-TRANSFER LANDLORD' },
    { date: '2026-11-20', cents: 124000, type: 'income', description: 'PAYROLL DEPOSIT ACME' }, // a different payday
    { date: '2026-11-05', cents: 110000, type: 'income', description: 'REFUND' },               // opposite direction
  ];
  const { fresh, skipped } = dedupe(file, entries);
  assert.equal(skipped, 0);
  assert.deepEqual(fresh.map((t) => !!t.maybe), [true, true, false, false]);
  assert.equal(fresh[0].maybe.name, 'Paycheck');
});

test('categories: store memory first, then everyday words, then a safe default', () => {
  const s = freshState();
  rememberMerchant(s, 'Tim Hortons', 'Fun');
  assert.deepEqual(guessCategory(s, { type: 'expense', description: 'TIM HORTONS' }), { category: 'Fun', sure: true });
  assert.equal(guessCategory(s, { type: 'expense', description: 'SHELL GAS STATION' }).category, 'Transport');
  assert.equal(guessCategory(s, { type: 'expense', description: 'SHELL #4412 CALGARY AB' }).category, 'Transport');
  assert.equal(guessCategory(s, { type: 'expense', description: 'PETRO-CANADA 1234' }).category, 'Transport');
  assert.equal(guessCategory(s, { type: 'expense', description: 'NO FRILLS #3201' }).category, 'Groceries');
  assert.equal(guessCategory(s, { type: 'expense', description: 'XYZ CORP' }).category, 'Other');
  assert.equal(guessCategory(s, { type: 'income', description: 'PAYROLL DEPOSIT' }).category, 'Paycheck');
  assert.equal(guessCategory(s, { type: 'income', description: 'E-TRANSFER FROM MOM' }).category, 'Other income');
});

// The same format as a real CIBC export (made-up transactions and names).
const CIBC_REAL_FORMAT = `2026-11-10,Point of Sale - Interac RETAIL PURCHASE 631400000001 TRANSIT-CSC CEN,44.10,
2026-11-10,Internet Banking E-TRANSFER 106100000001 JANE SAMPLE,,60.00
2026-11-04,Point of Sale - Interac RETAIL PURCHASE 001001001779 7 ELEVEN STORE,4.19,
2026-11-04,Point of Sale - Interac RETAIL PURCHASE 001001001791 SHOPPERS DRUG M,4.42,
2026-10-30,Branch Transaction SERVICE CHARGE DISCOUNT,,16.95
2026-10-30,Branch Transaction SERVICE CHARGE CAPPED MONTHLY FEE$16.95 RECORD-KEEPING N/A,16.95,
2026-10-30,Point of Sale - Visa Debit VISA DEBIT RETAIL PURCHASE APPLE.COM/BILL 103000000001,29.40,
2026-10-27,Point of Sale - Interac MDSE RETURN 000001001423 WALMART STORE #,,41.92
2026-10-13,Internet Banking E-TRANSFER 106100000002 John Sample,5.00,
2026-08-28,Point of Sale - Visa Debit INTL VISA DEB RETAIL PURCHASE SP HYPEDEPT 624000000001 58.00 CAD @ 1.000000,58.00,
2026-08-25,Point of Sale - Visa Debit INTL VISA DEB RETAIL PURCHASE INFLATION 623700000001 84.99 USD @ 1.420991,120.77,
2026-08-31,Point of Sale - Interac RETAIL PURCHASE 1VMFPV6I0000 FOOT LOCKER CAN,110.25,
2026-07-20,Point of Sale - Visa Debit VISA DEBIT RETAIL PURCHASE BIRD* PENDING.B 620000000001,15.00,
2026-07-13,Point of Sale - Interac RETAIL PURCHASE 619300000001 MCDONALD'S #903,13.64,
2026-06-29,Point of Sale - Visa Debit VISA DEBIT RETAIL PURCHASE LYFT *TEMP AU 617900000001,5.60,
2026-03-16,Point of Sale - Interac RETAIL PURCHASE 607500000001 KRISPYKREME541C,2.05,
2026-03-16,Electronic Funds Transfer DEPOSIT Calgary Minor S,,141.00
2025-12-29,Internet Banking E-TRANSFER RECLAIM011500000001,,4.35
2025-10-31,Branch Transaction OVERDRAFT FEE,10.00,`;

test('a real CIBC-format file: layout, totals and every row read', () => {
  const r = run(CIBC_REAL_FORMAT);
  assert.equal(r.layout.bank, 'CIBC');
  assert.equal(r.layout.dateOrder, 'ymd');
  assert.equal(r.problems.length, 0);
  assert.equal(r.transactions.length, 19);
  const total = (t) => r.transactions.filter((x) => x.type === t).reduce((a, x) => a + x.cents, 0);
  assert.equal(total('expense'), 4410 + 419 + 442 + 1695 + 2940 + 500 + 5800 + 12077 + 11025 + 1500 + 1364 + 560 + 205 + 1000);
  assert.equal(total('income'), 6000 + 14100, 'only real money in counts as income');
  assert.equal(total('refund'), 1695 + 4192 + 435, 'fee discount, return and reclaim are refunds');
});

test('CIBC-format descriptions become clean names in the right categories', () => {
  const s = freshState();
  const r = run(CIBC_REAL_FORMAT);
  const got = Object.fromEntries(r.transactions.map((t) => [t.description, [cleanDescription(t.description), guessCategory(s, t).category]]));
  const pick = (part) => Object.entries(got).find(([d]) => d.includes(part))[1];
  assert.deepEqual(pick('TRANSIT-CSC'), ['Transit-Csc Cen', 'Transport']);
  assert.deepEqual(pick('JANE SAMPLE'), ['Jane Sample', 'Other income']);
  assert.deepEqual(pick('7 ELEVEN'), ['7 Eleven', 'Eating Out']);
  assert.deepEqual(pick('SHOPPERS DRUG'), ['Shoppers Drug', 'Health'], 'the bank\'s cut-off "M" is dropped');
  assert.deepEqual(pick('CAPPED MONTHLY FEE'), ['Service Charge Capped Monthly Fee', 'Bills']);
  assert.deepEqual(pick('APPLE.COM'), ['Apple.com/Bill', 'Bills']);
  assert.deepEqual(pick('John Sample'), ['John Sample', 'Other'], '"Internet Banking" must not mean Bills');
  assert.deepEqual(pick('HYPEDEPT'), ['Sp Hypedept', 'Shopping']);
  assert.deepEqual(pick('INFLATION')[0], 'Inflation', 'currency tail removed');
  assert.deepEqual(pick('FOOT LOCKER'), ['Foot Locker', 'Shopping'], 'reference code removed');
  assert.deepEqual(pick('BIRD*'), ['Bird', 'Transport']);
  assert.deepEqual(pick("MCDONALD'S"), ["Mcdonald's", 'Eating Out']);
  assert.deepEqual(pick('LYFT'), ['Lyft', 'Transport']);
  assert.deepEqual(pick('KRISPYKREME')[1], 'Eating Out');
  assert.deepEqual(pick('Calgary Minor')[0], 'Calgary Minor');
  assert.deepEqual(pick('RECLAIM')[0], 'Reclaim');
  assert.deepEqual(pick('OVERDRAFT FEE'), ['Overdraft Fee', 'Bills']);
  // refunds go back into the category the money was spent in
  assert.deepEqual(pick('CHARGE DISCOUNT'), ['Service Charge Discount', 'Bills'], 'cancels the monthly fee');
  assert.deepEqual(pick('MDSE RETURN'), ['Walmart', 'Shopping']);
});

test('refunds go back to the category you already use for that store', () => {
  const s = freshState();
  rememberMerchant(s, 'Walmart', 'Groceries');
  const t = { type: 'refund', description: 'Point of Sale - Interac MDSE RETURN 000001001423 WALMART STORE #' };
  assert.equal(guessCategory(s, t).category, 'Groceries');
});

test('what counts as a refund in a bank file', () => {
  const r = run(`2026-11-01,Point of Sale - Visa Debit VISA DEBIT PURCHASE REVERSAL SHEIN.COM 208900000001,,26.57
2026-11-01,Point of Sale - Visa Debit CORRECTION GOOGLE *SERVICE 601900000001,,2.00
2026-11-02,Internet Banking E-TRANSFER 106100000003 PAT SAMPLE,,20.00
2026-11-03,Electronic Funds Transfer DEPOSIT ACME PAYROLL,,500.00`);
  assert.deepEqual(r.transactions.map((t) => t.type), ['refund', 'refund', 'income', 'income']);
});

test('bank descriptions become readable names', () => {
  assert.equal(cleanDescription('POS PURCHASE TIM HORTONS #1234 CALGARY AB'), 'Tim Hortons Calgary');
  assert.equal(cleanDescription('NO FRILLS #3201'), 'No Frills');
  assert.equal(cleanDescription("SENIORE'S PIZZA"), "Seniore's Pizza");
});
