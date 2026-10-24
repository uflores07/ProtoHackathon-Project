import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSampleMeals, sampleMeals } from '../js/fixtures/history.js';
import { listMeals, saveMeal } from '../js/history.js';
import { balances, monthly, netBalance, pending, reminderText, settlePatch, stats, whoPaysNext } from '../js/lib/ledger.js';

const meal = (id, payerId, total, shares, extra = {}) => ({
  id, at: new Date(2026, 9, 10).getTime(), restaurant: id, total, planned: null, payerId,
  members: Object.fromEntries(shares.map(([mid, share, paid = false, pay = {}]) => [mid, { name: mid.toUpperCase(), share, paid, pay }])),
  ...extra,
});

test('empty history: nothing owed, nobody up next, zero stats', () => {
  assert.deepEqual(balances([], 'me'), []);
  assert.equal(netBalance([], 'me'), 0);
  assert.equal(whoPaysNext([]), null);
  assert.deepEqual(stats([], 'me'), { meals: 0, spent: 0, avgPerMeal: 0, underBudget: 0, saved: 0 });
  assert.equal(monthly([], 'me', 3, new Date(2026, 9, 24).getTime()).every((m) => m.mine === 0 && m.total === 0), true);
});

test('when I paid, everyone unpaid owes me their share; paid flags drop out', () => {
  const m = meal('m1', 'me', 60, [['me', 20], ['sam', 18.7], ['jo', 21.3, true]]);
  assert.deepEqual(balances([m], 'me'), [{ personId: 'sam', name: 'SAM', meals: ['m1'], pay: {}, amount: 18.7 }]);
  assert.equal(netBalance([m], 'me'), 18.7);
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
  assert.equal(netBalance(meals, 'me'), 9.9);
});

test('balances are sorted owed-to-me first and keep every involved meal', () => {
  const meals = [
    meal('m1', 'me', 40, [['me', 20], ['sam', 20]]),
    meal('m2', 'jo', 30, [['me', 15], ['jo', 15]]),
    meal('m3', 'me', 10, [['me', 5], ['sam', 5]]),
  ];
  const b = balances(meals, 'me');
  assert.deepEqual(b.map((x) => [x.personId, x.amount, x.meals]), [['sam', 25, ['m1', 'm3']], ['jo', -15, ['m2']]]);
  assert.equal(netBalance(meals, 'me'), 10);
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

test('who pays next is whoever paid least compared with what they ate', () => {
  const meals = [
    meal('m1', 'me', 60, [['me', 20], ['sam', 20], ['jo', 20]]),
    meal('m2', 'sam', 30, [['me', 10], ['sam', 10], ['jo', 10]]),
  ];
  // me +30, sam 0, jo -30
  assert.deepEqual(whoPaysNext(meals), { personId: 'jo', name: 'JO', gap: -30 });
});

test('who pays next is null when everyone is even', () => {
  assert.equal(whoPaysNext([meal('m1', 'me', 20, [['me', 20]])]), null);
});

test('monthly buckets my share and the bill, oldest first, with empty months', () => {
  const now = new Date(2026, 9, 24).getTime();
  const meals = [
    { ...meal('oct', 'me', 50, [['me', 20], ['sam', 30]]), at: new Date(2026, 9, 2).getTime() },
    { ...meal('oct2', 'sam', 10.1, [['me', 5.05], ['sam', 5.05]]), at: new Date(2026, 9, 20).getTime() },
    { ...meal('aug', 'sam', 40, [['me', 15], ['sam', 25]]), at: new Date(2026, 7, 31).getTime() },
    { ...meal('old', 'sam', 99, [['me', 99]]), at: new Date(2026, 4, 1).getTime() },
  ];
  assert.deepEqual(monthly(meals, 'me', 3, now), [
    { key: '2026-08', label: 'Aug', mine: 15, total: 40 },
    { key: '2026-09', label: 'Sep', mine: 0, total: 0 },
    { key: '2026-10', label: 'Oct', mine: 25.05, total: 60.1 },
  ]);
});

test('monthly crosses the new year', () => {
  const keys = monthly([], 'me', 3, new Date(2027, 0, 5).getTime()).map((m) => m.key);
  assert.deepEqual(keys, ['2026-11', '2026-12', '2027-01']);
});

test('stats count my spend and the net against the plan over every planned meal', () => {
  const meals = [
    meal('a', 'me', 82.3, [['me', 21.5]], { planned: 90 }),
    meal('b', 'jo', 63.75, [['me', 21]], { planned: 60 }),
    meal('c', 'jo', 40, [['me', 10.1]], { planned: 40 }),
    meal('d', 'jo', 50, [['sam', 50]]),
  ];
  // +7.70 - 3.75 + 0 = 3.95; meal d has no plan so it doesn't count
  assert.deepEqual(stats(meals, 'me'), { meals: 4, spent: 52.6, avgPerMeal: 13.15, underBudget: 2, saved: 3.95 });
});

test('stats go negative when the meals came in over plan overall', () => {
  const meals = [
    meal('a', 'me', 95.1, [['me', 30]], { planned: 90 }),
    meal('b', 'me', 58, [['me', 20]], { planned: 60 }),
  ];
  assert.equal(stats(meals, 'me').saved, -3.1);
  assert.equal(stats(meals, 'me').underBudget, 1);
});

test('a negative share (a claimed coupon) means the payer owes that person', () => {
  const m = meal('m1', 'me', 60, [['me', 29.41], ['x', 36.9], ['y', -6.31]]);
  assert.deepEqual(balances([m], 'me').map((b) => [b.personId, b.amount]), [['x', 36.9], ['y', -6.31]]);
  assert.equal(netBalance([m], 'me'), 30.59);
  assert.equal(pending(m), 2);
  // From y's phone the payer owes y.
  assert.deepEqual(balances([m], 'y').map((b) => [b.personId, b.amount]), [['me', 6.31]]);
  assert.equal(netBalance([m], 'y'), 6.31);
  // Settling with y clears it on both phones.
  const settled = { ...m, ...settlePatch(m, 'me', 'y') };
  assert.equal(settled.members.y.paid, true);
  assert.deepEqual(balances([settled], 'me').map((b) => b.personId), ['x']);
  assert.deepEqual(balances([{ ...m, ...settlePatch(m, 'y', 'me') }], 'y'), []);
  assert.equal(pending(settled), 1);
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
  assert.equal(whoPaysNext(meals).name, 'Jordan');
  assert.ok(monthly(meals, 'me', 3, now).reduce((s, m) => s + m.total, 0) > 0);
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
