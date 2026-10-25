import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSampleMeals, sampleMeals } from '../js/fixtures/history.js';
import { listMeals, saveMeal } from '../js/history.js';
import { balances, pending, reminderText, settled, settlePatch } from '../js/lib/ledger.js';

const meal = (id, payerId, total, shares, extra = {}) => ({
  id, at: new Date(2026, 9, 10).getTime(), restaurant: id, total, planned: null, payerId,
  members: Object.fromEntries(shares.map(([mid, share, paid = false, pay = {}]) => [mid, { name: mid.toUpperCase(), share, paid, pay }])),
  ...extra,
});

test('empty history: nothing owed, nothing settled', () => {
  assert.deepEqual(balances([], 'me'), []);
  assert.deepEqual(settled([], 'me'), []);
});

test('when I paid, everyone unpaid owes me their share; paid flags drop out', () => {
  const m = meal('m1', 'me', 60, [['me', 20], ['sam', 18.7], ['jo', 21.3, true]]);
  assert.deepEqual(balances([m], 'me'), [{
    personId: 'sam', name: 'SAM', meals: ['m1'], pay: {}, amount: 18.7,
    items: [{ mealId: 'm1', restaurant: 'm1', at: m.at, amount: 18.7 }],
  }]);
  assert.deepEqual(settled([m], 'me'), [], 'paid at the table, not settled up in the Ledger');
  assert.equal(pending(m), 1);
});

test('when someone else paid, I owe them; debts between other people are ignored', () => {
  const m = meal('m1', 'jo', 50, [['me', 12, false], ['sam', 15], ['jo', 23]]);
  const b = balances([m], 'me');
  assert.equal(b.length, 1);
  assert.equal(b[0].personId, 'jo');
  assert.equal(b[0].amount, -12);
  assert.equal(pending(m), 2);
});

test('the same people across meals net out in cents', () => {
  const meals = [
    meal('m1', 'me', 30, [['me', 10], ['sam', 10.1], ['jo', 9.9]]),
    meal('m2', 'sam', 30, [['me', 10.2], ['sam', 19.8]]),
    meal('m3', 'me', 20, [['me', 10], ['sam', 10]]),
    meal('m4', 'sam', 20, [['me', 9.9], ['sam', 10.1]]),
  ];
  const b = balances(meals, 'me');
  // sam: +10.10 - 10.20 + 10.00 - 9.90 = 0, so sam drops out; jo owes 9.90
  assert.deepEqual(b.map((x) => [x.personId, x.amount]), [['jo', 9.9]]);
});

test('balances are sorted owed-to-me first and keep every involved meal', () => {
  const meals = [
    meal('m1', 'me', 40, [['me', 20], ['sam', 20]]),
    meal('m2', 'jo', 30, [['me', 15], ['jo', 15]]),
    meal('m3', 'me', 10, [['me', 5], ['sam', 5]]),
  ];
  const b = balances(meals, 'me');
  assert.deepEqual(b.map((x) => [x.personId, x.amount, x.meals]), [['sam', 25, ['m1', 'm3']], ['jo', -15, ['m2']]]);
  assert.deepEqual(b[1].items.map((i) => i.amount), [-15]);
});

test('pay handles come from the newest meal that has them', () => {
  const meals = [
    meal('new', 'jo', 20, [['me', 10], ['jo', 10, false, { paypal: 'jo-new' }]]),
    meal('old', 'jo', 20, [['me', 10], ['jo', 10, false, { paypal: 'jo-old', email: 'jo@example.com' }]]),
  ];
  assert.deepEqual(balances(meals, 'me')[0].pay, { paypal: 'jo-new', email: 'jo@example.com' });
});

test('meals with no payer or zero shares owe nothing', () => {
  const meals = [meal('m1', null, 20, [['me', 10], ['sam', 10]]), meal('m2', 'me', 10, [['me', 10], ['sam', 0]])];
  assert.deepEqual(balances(meals, 'me'), []);
  assert.equal(pending(meals[1]), 0);
});

test('a negative share (a claimed coupon) means the payer owes that person', () => {
  const m = meal('m1', 'me', 60, [['me', 29.41], ['x', 36.9], ['y', -6.31]]);
  assert.deepEqual(balances([m], 'me').map((b) => [b.personId, b.amount]), [['x', 36.9], ['y', -6.31]]);
  assert.equal(pending(m), 2);
  // From y's phone the payer owes y.
  assert.deepEqual(balances([m], 'y').map((b) => [b.personId, b.amount]), [['me', 6.31]]);
  // Settling with y clears it on both phones.
  const paidY = { ...m, ...settlePatch(m, 'me', 'y', true, 5) };
  assert.equal(paidY.members.y.paid, true);
  assert.deepEqual(balances([paidY], 'me').map((b) => b.personId), ['x']);
  assert.deepEqual(settled([paidY], 'me').map((b) => [b.personId, b.amount, b.at]), [['y', -6.31, 5]]);
  assert.deepEqual(balances([{ ...m, ...settlePatch(m, 'y', 'me') }], 'y'), []);
  assert.equal(pending(paidY), 1);
});

test('settling marks the right person paid on each side of the debt', () => {
  const iPaid = meal('m1', 'me', 30, [['me', 15], ['sam', 15]]);
  assert.equal(settlePatch(iPaid, 'me', 'sam').members.sam.paid, true);
  assert.equal(settlePatch(iPaid, 'me', 'sam').members.me.paid, false);
  const samPaid = meal('m2', 'sam', 30, [['me', 15], ['sam', 15]]);
  assert.equal(settlePatch(samPaid, 'me', 'sam').members.me.paid, true);
  assert.equal(settlePatch(samPaid, 'me', 'jo'), null);
  assert.deepEqual(balances([iPaid, samPaid].map((m) => ({ ...m, ...settlePatch(m, 'me', 'sam') })), 'me'), []);
});

test('settling with a person moves them to settled, and undo puts every meal back', () => {
  const meals = [
    meal('m1', 'me', 40, [['me', 20], ['sam', 20]]),
    meal('m2', 'sam', 30, [['me', 12], ['sam', 18]]),
    meal('m3', 'me', 30, [['me', 15], ['sam', 10], ['jo', 5]]),
  ];
  const sam = balances(meals, 'me').find((b) => b.personId === 'sam');
  assert.equal(sam.amount, 18); // 20 - 12 + 10
  assert.deepEqual(sam.items.map((i) => [i.mealId, i.amount]), [['m1', 20], ['m2', -12], ['m3', 10]]);
  const apply = (all, paid) => all.map((m) => (sam.meals.includes(m.id) ? { ...m, ...settlePatch(m, 'me', 'sam', paid, 100) } : m));
  const done = apply(meals, true);
  assert.deepEqual(balances(done, 'me').map((b) => [b.personId, b.amount]), [['jo', 5]]);
  assert.deepEqual(settled(done, 'me').map((b) => [b.personId, b.amount, b.meals, b.at]), [['sam', 18, ['m1', 'm2', 'm3'], 100]]);
  assert.equal(done[1].members.me.paid, true); // on sam's bill it's my line that gets marked
  const undone = apply(done, false);
  assert.deepEqual(balances(undone, 'me'), balances(meals, 'me'));
  assert.deepEqual(settled(undone, 'me'), []);
  assert.equal(undone[0].members.sam.paid, false);
});

test('undo only touches the debt between me and that person', () => {
  const m = meal('m1', 'me', 30, [['me', 10], ['sam', 10], ['jo', 10]]);
  const both = [['sam', 1], ['jo', 2]].reduce((x, [id, at]) => ({ ...x, ...settlePatch(x, 'me', id, true, at) }), m);
  assert.deepEqual(settled([both], 'me').map((b) => b.personId), ['jo', 'sam']);
  const undone = { ...both, ...settlePatch(both, 'me', 'sam', false) };
  assert.equal(undone.members.sam.paid, false);
  assert.equal(undone.members.sam.settledAt, null);
  assert.equal(undone.members.jo.paid, true);
  assert.deepEqual(balances([undone], 'me').map((b) => [b.personId, b.amount]), [['sam', 10]]);
  assert.deepEqual(settled([undone], 'me').map((b) => b.personId), ['jo']);
});

test('settled shows only the latest settle-up, so undo leaves earlier paid meals alone', () => {
  // jo paid me back at the table for m1; I owe jo for m2 and settle it, then undo.
  const meals = [
    meal('m2', 'jo', 30, [['me', 12], ['jo', 18]]),
    meal('m1', 'me', 40, [['me', 20], ['jo', 20, true]]),
  ];
  const jo = balances(meals, 'me')[0];
  assert.deepEqual([jo.amount, jo.meals], [-12, ['m2']]);
  const settle = (all, ids, paid, at) => all.map((m) => (ids.includes(m.id) ? { ...m, ...settlePatch(m, 'me', 'jo', paid, at) } : m));
  const done = settle(meals, jo.meals, true, 50);
  const last = settled(done, 'me');
  assert.deepEqual(last.map((b) => [b.personId, b.amount, b.meals]), [['jo', -12, ['m2']]]);
  const undone = settle(done, last[0].meals, false);
  assert.deepEqual(balances(undone, 'me').map((b) => [b.personId, b.amount]), [['jo', -12]]);
  assert.equal(undone[1].members.jo.paid, true);
  // Two settle-ups with the same person: only the newer one shows, and undoing it brings the older one back.
  const twice = settle(settle(meals, ['m2'], true, 50), ['m1'], true, 60);
  assert.deepEqual(settled(twice, 'me').map((b) => [b.meals, b.at]), [[['m1'], 60]]);
  assert.deepEqual(settled(settle(twice, ['m1'], false), 'me').map((b) => [b.meals, b.at]), [[['m2'], 50]]);
});

test('a reminder names the meals and lists my ways to get paid', () => {
  const text = reminderText({
    name: 'Sam', amountCents: 3690, places: ['Trattoria Bella', 'Urban Ramen'], currency: 'USD',
    pay: { paypal: '@alex', venmo: 'alex-r', email: ' alex@example.com ' },
  });
  assert.equal(text, [
    'Hey Sam, you still owe me $36.90 for Trattoria Bella and Urban Ramen.',
    'PayPal: https://paypal.me/alex/36.90USD',
    'Venmo: https://venmo.com/?txn=pay&recipients=alex-r&amount=36.90&note=Split%3A%20Trattoria%20Bella%20and%20Urban%20Ramen',
    'e-Transfer: alex@example.com',
    'Thanks! (via Split)',
  ].join('\n'));
});

test('a reminder without pay handles or places still reads well', () => {
  assert.equal(reminderText({ name: 'Jo', amountCents: 500, pay: { paypal: ' ', email: '' } }),
    'Hey Jo, you still owe me $5.00 for dinner.\nThanks! (via Split)');
});

test('sample meals add up and show both sides of the ledger', () => {
  const now = new Date(2026, 9, 24).getTime();
  const meals = sampleMeals('me', now);
  for (const m of meals) {
    const sum = Object.values(m.members).reduce((s, x) => s + Math.round(x.share * 100), 0);
    assert.equal(sum, Math.round(m.total * 100), m.restaurant);
    assert.equal(m.myId, 'me');
  }
  const b = balances(meals, 'me');
  assert.ok(b.some((x) => x.amount > 0) && b.some((x) => x.amount < 0));
  assert.deepEqual(settled(meals, 'me'), []);
});

test('loading sample meals keeps history newest first, real meals included', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const now = new Date(2026, 9, 24).getTime();
  saveMeal({ ...meal('real', 'me', 20, [['me', 20]]), at: now - 1000 });
  addSampleMeals('me', now);
  const ats = listMeals().map((m) => m.at);
  assert.equal(ats.length, 5);
  assert.deepEqual(ats, [...ats].sort((a, b) => b - a));
  assert.equal(listMeals()[0].id, 'real');
  assert.equal(listMeals()[1].restaurant, 'Trattoria Bella');
  delete globalThis.localStorage;
});
