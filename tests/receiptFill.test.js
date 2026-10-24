import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeShares } from '../js/lib/fairSplit.js';
import { fillUnitemized } from '../js/lib/receiptFill.js';

const receipt = (items, extra = {}) => ({
  restaurant: 'Cafe', items: items.map(([name, price], i) => ({ id: `r${i + 1}`, name, qty: 1, price })),
  subtotal: 0, discount: 0, tax: 0, serviceCharge: 0, tip: 0, total: 0, ...extra,
});
const loose = (r) => r.items.filter((it) => it.unitemized);

test('a card slip with only a total becomes one Not itemized line', () => {
  const r = fillUnitemized(receipt([], { total: 42.5 }));
  assert.deepEqual(r.items, [{ id: 'r-unitemized', name: 'Not itemized', qty: 1, price: 42.5, unitemized: true }]);
  assert.equal(r.subtotal, 42.5);
});

test('a handwritten tip is taken off the total, and the split still adds up to it', () => {
  const r = fillUnitemized(receipt([], { total: 50, tip: 8 }));
  assert.equal(loose(r)[0].price, 42);
  assert.equal(r.subtotal, 42);
  const res = computeShares({ ...r, claims: { 'r-unitemized': { a: true, b: true } } }, ['a', 'b']);
  assert.equal(res.totals.total, 5000);
  assert.equal(res.people.a.total + res.people.b.total, 5000);
});

test('known tax, fees and discounts are worked out of the total', () => {
  assert.equal(loose(fillUnitemized(receipt([], { total: 52.5, tax: 2.5 })))[0].price, 50);
  assert.equal(loose(fillUnitemized(receipt([], { total: 46.1, tax: 1.1, serviceCharge: 3, discount: 8 })))[0].price, 50);
});

test('a partly itemized receipt gets the rest as Not itemized', () => {
  const r = fillUnitemized(receipt([['Latte', 5.25], ['Muffin', 3.5]], { subtotal: 20, tax: 1, total: 21 }));
  assert.equal(r.items.length, 3);
  assert.equal(r.items.at(-1).price, 11.25);
  assert.equal(r.subtotal, 20);
});

test('a fully itemized receipt gets no extra line, even a few cents off', () => {
  const items = [['Pizza', 18], ['Salad', 14]];
  assert.equal(fillUnitemized(receipt(items, { subtotal: 32, total: 33.6, tax: 1.6 })).items.length, 2);
  assert.equal(fillUnitemized(receipt(items, { subtotal: 32.05 })).items.length, 2);
  // No printed subtotal: the implied one is filled in so the warnings line up.
  const r = fillUnitemized(receipt(items, { total: 33.6, tax: 1.6 }));
  assert.equal(r.items.length, 2);
  assert.equal(r.subtotal, 32);
});

test('items over the subtotal are left as they are', () => {
  const input = receipt([['Steak', 30], ['Wine', 20]], { subtotal: 40, total: 42 });
  const r = fillUnitemized(input);
  assert.deepEqual(r.items, input.items);
  assert.equal(r.subtotal, 40);
});

test('nothing readable adds nothing, and the input is never changed', () => {
  const input = receipt([]);
  const r = fillUnitemized(input);
  assert.deepEqual(r.items, []);
  assert.equal(r.subtotal, 0);
  const slip = receipt([], { total: 10 });
  assert.notEqual(fillUnitemized(slip), slip);
  assert.deepEqual(slip.items, []);
  assert.equal(slip.subtotal, 0);
});
