import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, normalize, reduce } from '../js/reducer.js';

const start = () => {
  let s = initialState('ABCDE', 1);
  s = reduce(s, { type: 'member/join', member: { id: 'a', name: 'Alex' }, at: 2 });
  s = reduce(s, { type: 'member/join', member: { id: 's', name: 'Sam' }, at: 3 });
  return s;
};

test('two people claiming the same item at once both stick', () => {
  let s = start();
  s = reduce(s, { type: 'receipt/set', receipt: { items: [{ id: 'r1', name: 'Fries', qty: 1, price: 12 }] }, at: 4 });
  s = reduce(s, { type: 'receipt/claim', itemId: 'r1', memberId: 'a' });
  s = reduce(s, { type: 'receipt/claim', itemId: 'r1', memberId: 's' });
  assert.deepEqual(s.receipt.claims.r1, { a: true, s: true });
  s = reduce(s, { type: 'receipt/claim', itemId: 'r1', memberId: 'a' });
  assert.deepEqual(s.receipt.claims.r1, { s: true });
});

test('normalize repairs what Firebase does to empty arrays and objects', () => {
  const s = normalize({ id: 'X', members: { a: { name: 'Alex' } }, plan: { settings: { budget: 120 } }, receipt: { items: { 0: { id: 'r1' } } } });
  assert.deepEqual(s.members.a.diet, []);
  assert.equal(s.plan.settings.budget, 120);
  assert.equal(s.plan.settings.tipPct, 18);
  assert.deepEqual(s.plan.menu, []);
  assert.deepEqual(s.receipt.items, [{ id: 'r1' }]);
  assert.deepEqual(s.receipt.claims, {});
});

test('reduce never mutates its input and bumps version', () => {
  const s = start();
  const before = JSON.stringify(s);
  const next = reduce(s, { type: 'session/rename', name: 'Coquitlam Crew' });
  assert.equal(JSON.stringify(s), before);
  assert.equal(next.name, 'Coquitlam Crew');
  assert.equal(next.version, s.version + 1);
});

test('voting twice for the same place takes the vote back', () => {
  let s = start();
  s = reduce(s, { type: 'finder/setPlaces', places: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }], at: 5 });
  s = reduce(s, { type: 'finder/vote', memberId: 'a', placeId: 'p1' });
  s = reduce(s, { type: 'finder/vote', memberId: 'a', placeId: 'p2' });
  assert.equal(s.finder.votes.a, 'p2');
  s = reduce(s, { type: 'finder/vote', memberId: 'a', placeId: 'p2' });
  assert.equal(s.finder.votes.a, undefined);
});

test('locking a place sends it to the planner', () => {
  let s = start();
  s = reduce(s, { type: 'finder/setPlaces', places: [{ id: 'p1', name: 'Trattoria', address: '1 Main St', mapsUrl: 'u', cuisine: 'Italian' }], at: 5 });
  s = reduce(s, { type: 'finder/lock', placeId: 'p1' });
  assert.equal(s.plan.restaurant.name, 'Trattoria');
  assert.equal(s.finder.winnerId, 'p1');
});

test('removing a member clears their votes, claims and payer role', () => {
  let s = start();
  s = reduce(s, { type: 'receipt/set', receipt: { items: [{ id: 'r1', name: 'Pizza', qty: 1, price: 18 }], payerId: 's' }, at: 6 });
  s = reduce(s, { type: 'receipt/claim', itemId: 'r1', memberId: 's' });
  s = reduce(s, { type: 'member/remove', id: 's' });
  assert.equal(s.members.s, undefined);
  assert.deepEqual(s.receipt.claims.r1, {});
  assert.equal(s.receipt.payerId, null);
});

test('new meal keeps the group and settings but clears the bill', () => {
  let s = start();
  s = reduce(s, { type: 'plan/setSettings', patch: { budget: 120 } });
  s = reduce(s, { type: 'receipt/set', receipt: { items: [] }, at: 7 });
  s = reduce(s, { type: 'session/newMeal' });
  assert.equal(Object.keys(s.members).length, 2);
  assert.equal(s.plan.settings.budget, 120);
  assert.equal(s.receipt, null);
});

test('a menu from a different restaurant replaces the locked one instead of mixing them', () => {
  let s = start();
  s = reduce(s, { type: 'finder/setPlaces', places: [{ id: 'p1', name: 'El Taquero', address: '2929 Barnet', mapsUrl: 'm', cuisine: 'Mexican' }], at: 5 });
  s = reduce(s, { type: 'finder/lock', placeId: 'p1' });
  const same = reduce(s, { type: 'plan/setMenu', restaurant: 'el taquero ', menu: [] });
  assert.equal(same.plan.restaurant.cuisine, 'Mexican');
  const other = reduce(s, { type: 'plan/setMenu', restaurant: 'Trattoria Bella', menu: [] });
  assert.deepEqual(other.plan.restaurant, { name: 'Trattoria Bella', address: '', mapsUrl: '', cuisine: '' });
  const unnamed = reduce(s, { type: 'plan/setMenu', restaurant: '', menu: [] });
  assert.equal(unnamed.plan.restaurant.name, 'El Taquero');
});

test('locking a different place clears the other restaurant\'s menu; the same place keeps it', () => {
  let s = start();
  s = reduce(s, { type: 'plan/setMenu', restaurant: 'Trattoria Bella', menu: [{ id: 'm1', name: 'Pizza', price: 18 }] });
  s = reduce(s, { type: 'plan/setOrder', order: [{ itemId: 'm1', qty: 1 }] });
  s = reduce(s, { type: 'finder/setPlaces', places: [{ id: 'p1', name: 'Trattoria Bella' }, { id: 'p2', name: 'Saffron Grill' }], at: 5 });
  const same = reduce(s, { type: 'finder/lock', placeId: 'p1' });
  assert.equal(same.plan.menu.length, 1);
  const other = reduce(s, { type: 'finder/lock', placeId: 'p2' });
  assert.deepEqual([other.plan.menu, other.plan.order, other.plan.restaurant.name], [[], [], 'Saffron Grill']);
  const rescanned = reduce(other, { type: 'plan/setMenu', restaurant: 'Trattoria Bella', menu: [] });
  assert.equal(rescanned.finder.winnerId, null);
});

test('paid marks reset when the bill changes before Finish, but not after', () => {
  let s = start();
  s = reduce(s, { type: 'receipt/set', receipt: { items: [{ id: 'r1', name: 'A', qty: 1, price: 10 }, { id: 'r2', name: 'B', qty: 1, price: 5 }], payerId: 'a' }, at: 4 });
  s = reduce(s, { type: 'receipt/claim', itemId: 'r1', memberId: 's' });
  s = reduce(s, { type: 'receipt/markPaid', memberId: 's', paid: true });
  assert.equal(reduce(s, { type: 'receipt/update', patch: { warnings: [] } }).receipt.paid.s, true);
  assert.equal(reduce(s, { type: 'receipt/claim', itemId: 'r2', memberId: 's' }).receipt.paid.s, undefined);
  assert.equal(reduce(s, { type: 'receipt/update', patch: { tipPct: 20 } }).receipt.paid.s, undefined);
  const done = reduce(s, { type: 'receipt/finalize', summary: {}, at: 9 });
  assert.equal(reduce(done, { type: 'receipt/update', patch: { tipPct: 20 } }).receipt.paid.s, true);
});

test('normalize forces synced numbers and names back to safe types', () => {
  const s = normalize({
    members: { a: { name: 42, color: 'x', budget: '25' }, b: { color: -3 } },
    plan: { settings: { headcount: '"><b>', budget: '120', mode: 'evil', hunger: 'starving' } },
  });
  assert.equal(s.members.a.name, '42');
  assert.equal(s.members.a.color, 0);
  assert.equal(s.members.a.budget, 25);
  assert.equal(s.members.b.color, 3);
  assert.equal(s.members.b.name, 'Guest');
  assert.equal(s.plan.settings.headcount, 4);
  assert.equal(s.plan.settings.budget, 120);
  assert.equal(s.plan.settings.mode, 'family');
  assert.equal(s.plan.settings.hunger, 'starving');
});

test('unknown actions fail loudly', () => {
  assert.throws(() => reduce(start(), { type: 'nope' }), /Unknown action/);
});
