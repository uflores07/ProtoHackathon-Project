import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECEIPT } from '../js/fixtures/receipt.js';
import { allocate, budgetCheck, computeShares, explainShare, explainTip, nameScore, prefillClaims, tipAmount } from '../js/lib/fairSplit.js';
import { initialState, reduce } from '../js/reducer.js';

const receipt = (items, extra = {}) => ({
  items: items.map(([name, price], i) => ({ id: `r${i + 1}`, name, qty: 1, price })),
  discount: 0, tax: 0, serviceCharge: 0, tip: 0, tipPct: 0, claims: {}, ...extra,
});
const claims = (map) => Object.fromEntries(Object.entries(map).map(([item, ids]) => [item, Object.fromEntries(ids.map((id) => [id, true]))]));
const billTotal = (r) => {
  const food = r.items.reduce((s, it) => s + Math.round(it.price * 100), 0);
  return food - Math.round(r.discount * 100) + Math.round(r.tax * 100) + Math.round(r.serviceCharge * 100) + tipAmount(r);
};
const everyone = (res) => Object.values(res.people).reduce((s, p) => s + p.total, 0) + res.unclaimed.reduce((s, u) => s + u.amount, 0);

// Each person's columns and item lines must both add up to their total.
function assertConsistent(res, r) {
  assert.equal(everyone(res), billTotal(r));
  assert.equal(res.totals.total, billTotal(r));
  for (const p of Object.values(res.people)) {
    assert.equal(p.food + p.discount + p.tax + p.service + p.tip, p.total);
    assert.equal(p.items.reduce((s, i) => s + i.amount, 0), p.total);
  }
}

test('allocate keeps every cent and breaks ties by order', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(-100, [1, 1, 1]), [-33, -33, -34]);
  assert.deepEqual(allocate(5, [0, 0]), [3, 2]);
  assert.deepEqual(allocate(7, []), []);
  assert.deepEqual(allocate(10, [1, 3]), [3, 7]);
});

test('tax and tip follow item prices, not heads', () => {
  const r = receipt([['Salad', 10], ['Steak', 30]], { tax: 2, tipPct: 20, claims: claims({ r1: ['a'], r2: ['b'] }) });
  const res = computeShares(r, ['a', 'b']);
  assert.deepEqual(res.people.a, { items: [{ itemId: 'r1', name: 'Salad', amount: 1250, split: 1 }], food: 1000, base: 1000, discount: 0, tax: 50, service: 0, tip: 200, total: 1250 });
  assert.equal(res.people.b.tax, 150);
  assert.equal(res.people.b.tip, 600);
  assert.equal(res.people.b.total, 3750);
  assert.equal(res.allClaimed, true);
  assertConsistent(res, r);
});

test('the demo receipt splits to the cent', () => {
  const r = receipt(RECEIPT.items.map((it) => [it.name, it.lineTotal]),
    { tax: RECEIPT.tax, tipPct: 18, claims: claims({ r1: ['a', 's'], r2: ['j', 'm'], r3: ['a', 's', 'j', 'm'], r4: ['a', 's', 'j', 'm'], r5: ['m'], r6: ['s'] }) });
  const res = computeShares(r, ['a', 's', 'j', 'm']);
  assert.equal(res.totals.tip, 1332);
  assert.equal(res.totals.total, 7400 + 370 + 1332);
  assert.equal(res.allClaimed, true);
  assertConsistent(res, r);
});

test('a receipt adds no tip of its own: the split comes to what the receipt says was paid', () => {
  const items = RECEIPT.items.map((it, i) => ({ id: `r${i + 1}`, name: it.name, qty: it.qty, price: it.lineTotal }));
  for (const printed of [RECEIPT, { ...RECEIPT, tip: 12, total: 89.7 }]) {
    const s = reduce(initialState('ABCDE', 1), { type: 'receipt/set', receipt: { ...printed, items }, at: 2 });
    assert.equal(s.receipt.tipPct, 0);
    assert.equal(computeShares(s.receipt).totals.total, Math.round(printed.total * 100));
  }
});

test('the demo receipt adds up and matches the demo plan (4 people, $80)', () => {
  const lines = RECEIPT.items.reduce((s, it) => s + Math.round(it.lineTotal * 100), 0);
  assert.equal(lines, Math.round(RECEIPT.subtotal * 100));
  assert.equal(Math.round((RECEIPT.subtotal - RECEIPT.discount + RECEIPT.tax + RECEIPT.serviceCharge + RECEIPT.tip) * 100), Math.round(RECEIPT.total * 100));
  const planned = ['Margherita Pizza', 'Diavola Pizza', 'Garlic Bread', 'Lemonade Pitcher'];
  const items = RECEIPT.items.map((it, i) => ({ id: `r${i + 1}`, name: it.name, qty: it.qty, price: it.lineTotal }));
  const live = planned.map((name, i) => ({ id: `l${i}`, name, claims: { [`p${i}`]: true } }));
  assert.deepEqual(prefillClaims(items, live), { r1: { p0: true }, r2: { p1: true }, r3: { p2: true }, r4: { p3: true } });
  const plan = { settings: { budget: 80 }, menu: planned.map((name, i) => ({ id: `m${i}`, name })), order: planned.map((_, i) => ({ itemId: `m${i}`, qty: 1 })) };
  assert.deepEqual(budgetCheck({ ...receipt([]), items, tax: RECEIPT.tax, tipPct: 0 }, plan).unplanned, [{ itemId: 'r5', name: 'Caesar Salad', amount: 1400 }]);
});

test('comped items get no tax or tip', () => {
  const r = receipt([['Pasta', 20], ['Dessert (comp)', 0]], { tax: 1, tipPct: 15, claims: claims({ r1: ['a'], r2: ['b'] }) });
  const res = computeShares(r, ['a', 'b']);
  assert.equal(res.people.b.total, 0);
  assert.deepEqual(res.people.b.items, [{ itemId: 'r2', name: 'Dessert (comp)', amount: 0, split: 1 }]);
  assert.equal(res.people.a.total, 2000 + 100 + 300);
});

test('everything comped: nothing owed, and a printed tip still lands somewhere', () => {
  const free = receipt([['A', 0], ['B', 0]], { claims: claims({ r1: ['a'], r2: ['b'] }) });
  assert.equal(computeShares(free, ['a', 'b']).totals.total, 0);
  const tipped = receipt([['A', 0], ['B', 0]], { tip: 5, claims: claims({ r1: ['a'], r2: ['b'] }) });
  const res = computeShares(tipped, ['a', 'b']);
  assert.equal(res.people.a.total + res.people.b.total, 500);
  assertConsistent(res, tipped);
});

test('a bill-level discount comes off each dish in proportion; the tip is on the price before it', () => {
  const r = receipt([['A', 20], ['B', 20]], { discount: 10, tipPct: 10, claims: claims({ r1: ['a'], r2: ['b'] }) });
  const res = computeShares(r, ['a', 'b']);
  assert.equal(res.totals.discount, -1000);
  assert.equal(res.totals.tip, 400);
  assert.equal(res.people.a.discount, -500);
  assert.equal(res.people.a.total, 2000 - 500 + 200);
  assertConsistent(res, r);
});

test('service charge is shared by item like tax', () => {
  const r = receipt([['A', 30], ['B', 10]], { serviceCharge: 8, claims: claims({ r1: ['a'], r2: ['b'] }) });
  const res = computeShares(r, ['a', 'b']);
  assert.equal(res.people.a.service, 600);
  assert.equal(res.people.b.service, 200);
  assertConsistent(res, r);
});

test('unclaimed items are listed with their full cost, free ones are not', () => {
  const r = receipt([['A', 10], ['B', 10], ['Free bread', 0]], { tax: 1, claims: claims({ r1: ['a'] }) });
  const res = computeShares(r, ['a', 'b']);
  assert.equal(res.allClaimed, false);
  assert.deepEqual(res.unclaimed, [{ itemId: 'r2', name: 'B', amount: 1050 }]);
  assert.equal(res.people.b.total, 0);
  assertConsistent(res, r);
});

test('a dish shared three ways spreads the odd cents around', () => {
  const r = receipt([['Nachos', 10], ['Fries', 1], ['Wings', 1]], { claims: claims({ r1: ['a', 'b', 'c'], r2: ['a', 'b', 'c'], r3: ['a', 'b', 'c'] }) });
  const res = computeShares(r, ['a', 'b', 'c']);
  const totals = ['a', 'b', 'c'].map((id) => res.people[id].total);
  assert.equal(totals.reduce((s, t) => s + t, 0), 1200);
  assert.deepEqual(totals, [400, 400, 400]);
  assert.deepEqual(res.people.a.items.map((i) => i.amount), [334, 33, 33]);
});

test('a negative line (coupon) lowers the claimers share and carries no tax', () => {
  const r = receipt([['Burger', 20], ['Coupon', -5]], { tax: 1, claims: claims({ r1: ['a'], r2: ['a', 'b'] }) });
  const res = computeShares(r, ['a', 'b']);
  assert.equal(res.people.a.total, 2000 + 100 - 250);
  assert.equal(res.people.b.total, -250);
  assertConsistent(res, r);
});

test('empty receipt: all zero, and stray fees stay visible', () => {
  const none = computeShares(receipt([]), ['a']);
  assert.deepEqual(none.people.a, { items: [], food: 0, base: 0, discount: 0, tax: 0, service: 0, tip: 0, total: 0 });
  assert.equal(none.allClaimed, true);
  const fees = computeShares(receipt([], { tax: 2 }), ['a']);
  assert.deepEqual(fees.unclaimed, [{ itemId: null, name: 'Tax, tip and fees', amount: 200 }]);
  assert.equal(computeShares(null, ['a']).totals.total, 0);
});

test('a single item claimed by one person is the whole bill', () => {
  const r = receipt([['Ramen', 16.5]], { tax: 0.83, tipPct: 18, claims: claims({ r1: ['a'] }) });
  const res = computeShares(r, ['a', 'b']);
  assert.equal(res.people.a.total, 1650 + 83 + 297);
  assert.equal(res.people.b.total, 0);
});

test('claims by people not in the group are ignored', () => {
  const r = receipt([['A', 10]], { claims: claims({ r1: ['a', 'gone'] }) });
  const res = computeShares(r, ['a']);
  assert.equal(res.people.a.total, 1000);
  assert.equal(res.people.gone, undefined);
});

test('every phone gets the same pennies whatever order it lists people in', () => {
  const r = receipt([['A', 10], ['B', 0.01]], { tax: 0.5, claims: claims({ r1: ['x', 'y', 'z'], r2: ['x', 'y', 'z'] }) });
  assert.deepEqual(computeShares(r, ['z', 'x', 'y']), computeShares(r, ['x', 'y', 'z']));
});

test('a printed tip wins over the percentage', () => {
  assert.equal(tipAmount(receipt([['A', 50]], { tip: 7.25, tipPct: 20 })), 725);
  assert.equal(tipAmount(receipt([['A', 50]], { tipPct: 15 })), 750);
  assert.equal(tipAmount(receipt([['A', 50]], { tip: 0, tipPct: 0 })), 0);
});

test('the tip line says the amount and how it was worked out', () => {
  assert.equal(explainTip(receipt([['A', 74]], { tipPct: 18 })), 'Tip $13.32 (18% of $74.00 food)');
  assert.equal(explainTip(receipt([['A', 40], ['Coupon', -10]], { tipPct: 12.5 })), 'Tip $5.00 (12.5% of $40.00 food)');
  assert.equal(explainTip(receipt([['A', 74]], { tip: 12, tipPct: 18 })), 'Tip $12.00 (16.2% of the food)');
  assert.equal(explainTip(receipt([], { tip: 5 })), 'Tip $5.00');
  assert.equal(explainTip(receipt([['A', 74]], { tip: 0, tipPct: 0 })), 'No tip');
  assert.equal(explainTip(receipt([], { tipPct: 18 })), 'No tip');
});

test('the tip is on the full-price food: no discount of either kind lowers it', () => {
  assert.equal(tipAmount(receipt([['A', 50], ['Coupon', -10]], { tipPct: 10 })), 500);
  assert.equal(tipAmount(receipt([['A', 50], ['Coupon', -10]], { discount: 5, tipPct: 10 })), 500);
  assert.equal(tipAmount(receipt([['A', 10]], { discount: 20, tipPct: 15 })), 150);
});

test("one person's coupon never changes anyone else's tip", () => {
  const withCoupon = receipt([['Steak', 30], ['Coffee', 3], ['Birthday coupon', -33]], { tipPct: 18, claims: claims({ r1: ['x'], r2: ['y'], r3: ['y'] }) });
  const without = receipt([['Steak', 30], ['Coffee', 3]], { tipPct: 18, claims: claims({ r1: ['x'], r2: ['y'] }) });
  assert.equal(computeShares(withCoupon, ['x', 'y']).people.x.tip, computeShares(without, ['x', 'y']).people.x.tip);
  assert.equal(computeShares(withCoupon, ['x', 'y']).people.x.tip, 540);
});

test('a coupon bigger than what someone had leaves them a negative share', () => {
  const r = receipt([['Steak', 30], ['Coffee', 3], ['Birthday coupon', -10]], { tax: 1.65, tipPct: 18, claims: claims({ r1: ['x'], r2: ['y'], r3: ['y'] }) });
  const res = computeShares(r, ['x', 'y', 'me']);
  assert.equal(res.totals.tip, 594);
  assert.equal(res.people.x.total, 3000 + 150 + 540);
  assert.equal(res.people.y.total, 300 + 15 + 54 - 1000);
  assert.equal(res.people.me.total, 0);
  assertConsistent(res, r);
});

test('base is the full-price food each person had, and the explainer uses it', () => {
  const r = receipt([['Pizza', 20], ['Salad', 20], ['Coupon', -5]], { tax: 2, tipPct: 15, claims: claims({ r1: ['a', 'b'], r2: ['c'], r3: ['c'] }) });
  const res = computeShares(r, ['a', 'b', 'c']);
  assert.equal(res.totals.base, 4000);
  assert.deepEqual(['a', 'b', 'c'].map((id) => res.people[id].base), [1000, 1000, 2000]);
  assert.equal(explainShare(res.people.a, res.totals), 'You had 25% of the food, so 25% of the tax and tip is on your share.');
  assert.equal(explainShare(res.people.c, res.totals, 'Cat'), 'Cat had 50% of the food, so 50% of the tax and tip is on their share.');
});

test('the explainer lists only the fees on the bill, and stays quiet when there is nothing to explain', () => {
  const all = { base: 3300, tax: 165, tip: 414, service: 200, discount: -100 };
  assert.equal(explainShare({ base: 3000 }, all), 'You had 91% of the food, so 91% of the tax, tip, service charge and discount is on your share.');
  assert.equal(explainShare({ base: 1 }, { base: 100000, tax: 5 }, 'Sam'), 'Sam had <1% of the food, so <1% of the tax is on their share.');
  assert.equal(explainShare({ base: 1000 }, { base: 1000, tax: 0, tip: 0, service: 0, discount: 0 }), '');
  assert.equal(explainShare({ base: 0 }, all), '');
  assert.equal(explainShare(undefined, all), '');
});

// Seeded so a failure reproduces.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('random receipts always add up to the cent', () => {
  const rand = mulberry32(251);
  const int = (n) => Math.floor(rand() * n);
  const ids = ['a', 'b', 'c', 'd', 'e'];
  for (let n = 0; n < 2000; n++) {
    const items = Array.from({ length: int(9) }, (_, i) => {
      const roll = rand();
      const price = roll < 0.1 ? 0 : roll < 0.15 ? -int(1000) / 100 : int(8000) / 100;
      return [`Item ${i}`, price];
    });
    const r = receipt(items, {
      discount: rand() < 0.2 ? int(1500) / 100 : 0, tax: int(1200) / 100, serviceCharge: rand() < 0.2 ? int(2000) / 100 : 0,
      tip: rand() < 0.2 ? int(3000) / 100 : 0, tipPct: [0, 15, 18, 20, 22][int(5)],
    });
    for (const it of r.items) if (rand() < 0.9) r.claims[it.id] = Object.fromEntries(ids.filter(() => rand() < 0.4).map((id) => [id, true]));
    const res = computeShares(r, ids.slice(0, 1 + int(5)));
    assertConsistent(res, r);
    // People sharing a dish are never more than a cent apart on it.
    for (const it of r.items) {
      const amounts = Object.values(res.people).flatMap((p) => p.items.filter((x) => x.itemId === it.id).map((x) => x.amount));
      if (amounts.length) assert.ok(Math.max(...amounts) - Math.min(...amounts) <= 1, `item ${it.id} in run ${n}`);
    }
  }
});

test('name matching handles case, punctuation, plurals and receipt abbreviations', () => {
  assert.equal(nameScore('MARG PIZZA', 'Margherita Pizza'), 1);
  assert.equal(nameScore('Caesar Salad!', 'caesar salad'), 1);
  assert.equal(nameScore('2x Lemonades', 'Lemonade'), 1);
  assert.equal(nameScore('Crème Brûlée', 'Creme Brulee'), 1);
  assert.ok(nameScore('Garlic Bread', 'Truffle Garlic Fries') < 0.6);
  assert.equal(nameScore('', 'Fries'), 0);
});

test('prefill copies live-tab claims only when the match is confident', () => {
  const live = [
    { id: 'l1', name: 'Margherita Pizza', claims: { a: true, s: true } },
    { id: 'l2', name: 'Lemonade', claims: { a: true } },
    { id: 'l3', name: 'Lemonade', claims: { j: true } },
    { id: 'l4', name: 'Diavola Pizza', claims: { m: true } },
    { id: 'l5', name: 'Truffle Garlic Fries', claims: {} },
  ];
  const items = [
    { id: 'r1', name: 'MARG PIZZA' },
    { id: 'r2', name: 'Lemonade x2' },
    { id: 'r3', name: 'Pizza' },
    { id: 'r4', name: 'Garlic Bread' },
    { id: 'r5', name: 'Truffle Fries' },
  ];
  assert.deepEqual(prefillClaims(items, live), { r1: { a: true, s: true }, r2: { a: true, j: true } });
  assert.deepEqual(prefillClaims(items, []), {});
});

test('budget check: planned vs actual and what pushed it over', () => {
  const plan = {
    settings: { budget: 30 },
    menu: [{ id: 'm1', name: 'Margherita Pizza' }, { id: 'm2', name: 'Caesar Salad' }],
    order: [{ itemId: 'm1', qty: 1 }, { itemId: 'm2', qty: 1 }],
  };
  const r = receipt([['MARG PIZZA', 18], ['Caesar Salad', 14], ['Tiramisu', 10], ['Bread (comp)', 0]], { tax: 2.1, tipPct: 18 });
  const b = budgetCheck(r, plan);
  assert.equal(b.planned, 3000);
  assert.equal(b.actual, 4200 + 210 + 756);
  assert.equal(b.diff, b.actual - 3000);
  assert.equal(b.over, true);
  assert.deepEqual(b.unplanned, [{ itemId: 'r3', name: 'Tiramisu', amount: 1000 }]);
  assert.equal(b.tax, 210);
  assert.equal(b.tip, 756);

  assert.equal(budgetCheck(r, { ...plan, settings: { budget: 100 } }).over, false);
  assert.deepEqual(budgetCheck(r, { settings: { budget: 80 }, menu: [], order: [] }).planned, null);
  assert.equal(budgetCheck(r, null).diff, null);
});

test('split evenly: the whole bill divided by the group, to the cent', () => {
  const r = receipt([['Pizza', 18], ['Salad', 14], ['Wine', 40]], { tax: 3.6, tipPct: 18, evenSplit: true });
  const res = computeShares(r, ['a', 'b', 'c']);
  assertConsistent(res, r);
  assert.equal(res.allClaimed, true);
  assert.equal(res.even, true);
  assert.deepEqual(res.unclaimed, []);
  const totals = Object.values(res.people).map((p) => p.total);
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 1, `shares ${totals} differ by more than a cent`);
});

test('split evenly ignores who claimed what', () => {
  const base = receipt([['Steak', 60], ['Fries', 6]], { tax: 3.3, tipPct: 15, claims: claims({ r1: ['a'], r2: ['b'] }) });
  const even = computeShares({ ...base, evenSplit: true }, ['a', 'b']);
  assert.equal(even.people.a.total, even.people.b.total);
  assert.notEqual(computeShares(base, ['a', 'b']).people.a.total, computeShares(base, ['a', 'b']).people.b.total);
});

test('split evenly keeps every cent on awkward bills', () => {
  for (const n of [1, 2, 3, 4, 6, 7]) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const r = receipt([['A', 10.01], ['B', 0], ['Coupon', -2.5]], { tax: 0.53, serviceCharge: 1.11, discount: 0.99, tip: 4.07, evenSplit: true });
    const res = computeShares(r, ids);
    assertConsistent(res, r);
    const totals = Object.values(res.people).map((p) => p.total);
    assert.ok(Math.max(...totals) - Math.min(...totals) <= 1);
  }
});
