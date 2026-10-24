import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuisineMatches, rankPlaces, similarHistory, voteCounts, winner } from '../js/lib/rankPlaces.js';

const member = (id, name, extra = {}) => ({ id, name, budget: 30, cuisine: 'Any', distanceKm: 5, diet: [], ...extra });
const place = (id, extra = {}) => ({ id, name: id, cuisine: 'Italian', estCostPerPerson: 20, distanceKm: 2, dietOptions: [], ...extra });
const ids = (rows) => rows.map((r) => r.place.id);

test('cuisine: Any or empty matches everything', () => {
  assert.ok(cuisineMatches('Any', 'Thai'));
  assert.ok(cuisineMatches('any', ''));
  assert.ok(cuisineMatches('', 'Thai'));
  assert.ok(cuisineMatches(undefined, 'Thai'));
});

test('cuisine: case-insensitive whole words, either way round, plurals and accents ignored', () => {
  assert.ok(cuisineMatches('italian', 'Italian'));
  assert.ok(cuisineMatches('Japanese', 'Japanese Fusion'));
  assert.ok(cuisineMatches('Japanese Fusion', 'Japanese'));
  assert.ok(cuisineMatches('Indian', 'South Indian'));
  assert.ok(cuisineMatches('American', 'New American'));
  assert.ok(cuisineMatches('Burgers', 'Burger'));
  assert.ok(cuisineMatches('Vietnamese', 'Phở'));
  assert.ok(!cuisineMatches('Thai', 'Italian'));
  assert.ok(!cuisineMatches('Thai', ''));
});

test('cuisine: a word inside a different cuisine is not a match', () => {
  assert.ok(!cuisineMatches('American', 'Latin American'));
  assert.ok(!cuisineMatches('Latin American', 'American'));
  assert.ok(!cuisineMatches('American', 'South American'));
  assert.ok(!cuisineMatches('Indian', 'West Indian'));
  assert.ok(!cuisineMatches('Middle Eastern', 'Eastern European'));
  assert.ok(!cuisineMatches('American', 'Korean BBQ'));
  assert.ok(!cuisineMatches('Indian', 'Thai Curry'));
  assert.ok(!cuisineMatches('Thai', 'Thailand Express'));
  assert.ok(cuisineMatches('Latin American', 'Latin American'));
  assert.ok(cuisineMatches('Middle Eastern', 'Middle Eastern'));
});

test('cuisine: dish words map to their cuisine in both directions', () => {
  assert.ok(cuisineMatches('Japanese', 'Sushi'));
  assert.ok(cuisineMatches('Sushi', 'Japanese'));
  assert.ok(cuisineMatches('Ramen', 'Sushi Bar'));
  assert.ok(cuisineMatches('Mexican', 'Tacos'));
  assert.ok(cuisineMatches('Burrito', 'Mexican'));
  assert.ok(cuisineMatches('Italian', 'Pizza'));
  assert.ok(cuisineMatches('Pasta', 'Italian'));
  assert.ok(cuisineMatches('Indian', 'Curry House'));
  assert.ok(cuisineMatches('Middle Eastern', 'Shawarma'));
  assert.ok(cuisineMatches('Kebab', 'Middle Eastern'));
  assert.ok(cuisineMatches('American', 'Burgers'));
  assert.ok(cuisineMatches('Vietnamese', 'Pho'));
  assert.ok(!cuisineMatches('Sushi', 'Mexican'));
});

// What people and the AI type for each cuisine. Each must match its cuisine both ways round, and not another one.
const DISHES = {
  Chinese: ['Dim Sum', 'Dumplings', 'Hot Pot', 'Cantonese', 'Szechuan'],
  Korean: ['Korean BBQ', 'Bibimbap', 'Bulgogi'],
  Hawaiian: ['Poke', 'Poke Bowls'],
  Thai: ['Pad Thai', 'Thai Curry'],
  Vietnamese: ['Banh Mi', 'Bánh Mì', 'Pho'],
  'Middle Eastern': ['Falafel', 'Shawarma', 'Lebanese'],
  Indian: ['Biryani', 'Dosa', 'Tandoori'],
  Japanese: ['Sushi', 'Ramen', 'Udon', 'Izakaya', 'Japanese Curry'],
  Mexican: ['Tacos', 'Taqueria', 'Tex-Mex'],
  Italian: ['Pizzeria', 'Trattoria'],
  Greek: ['Gyros', 'Souvlaki'],
};
for (const [cuisine, dishes] of Object.entries(DISHES)) {
  test(`cuisine: ${cuisine} dishes`, () => {
    const other = cuisine === 'Mexican' ? 'Italian' : 'Mexican';
    for (const d of dishes) {
      assert.ok(cuisineMatches(cuisine, d), `${cuisine} should match ${d}`);
      assert.ok(cuisineMatches(d, cuisine), `${d} should match ${cuisine}`);
      assert.ok(!cuisineMatches(other, d), `${other} should not match ${d}`);
    }
  });
}

test('budget is a strict cap: equal passes, one cent over is out and names who', () => {
  const members = [member('a', 'Alex', { budget: 25 }), member('j', 'Jordan', { budget: 20 })];
  const { ranked, excluded } = rankPlaces([place('ok', { estCostPerPerson: 20 }), place('over', { estCostPerPerson: 20.01 })], members);
  assert.deepEqual(ids(ranked), ['ok']);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].place.id, 'over');
  assert.match(excluded[0].reason, /Jordan's \$20 cap/);
  assert.doesNotMatch(excluded[0].reason, /Alex/);
});

test('excluded reason lists everyone it is over', () => {
  const members = [member('a', 'Alex', { budget: 25 }), member('j', 'Jordan', { budget: 20 }), member('t', 'Taylor', { budget: 40 })];
  const { excluded } = rankPlaces([place('pricey', { estCostPerPerson: 34 })], members);
  assert.equal(excluded[0].reason, "$34/person is over Alex's $25 cap and Jordan's $20 cap");
});

test('a member is satisfied only when cuisine, distance and every diet fit', () => {
  const members = [
    member('a', 'Alex'),
    member('t', 'Taylor', { cuisine: 'Japanese' }),
    member('s', 'Sam', { distanceKm: 5 }),
    member('j', 'Jordan', { diet: ['halal', 'gluten_free'] }),
  ];
  const { ranked } = rankPlaces([place('p', { cuisine: 'Italian', distanceKm: 8.1, dietOptions: ['vegetarian', 'gluten_free'] })], members);
  const [row] = ranked;
  assert.deepEqual(row.satisfied, []);
  assert.equal(row.matchPct, 50); // 6 of 12 checks pass
  assert.deepEqual(row.fails.t, ['Taylor wants Japanese', 'Taylor: 8.1 km is past 5 km']);
  assert.deepEqual(row.fails.s, ['Sam: 8.1 km is past 5 km']);
  assert.deepEqual(row.fails.j, ['Jordan: 8.1 km is past 5 km', 'Jordan needs halal']);
});

test('distance exactly at the limit counts, and matchPct gives partial credit', () => {
  const members = [member('a', 'Alex', { distanceKm: 4 }), member('b', 'Bo', { diet: ['vegan'] }), member('c', 'Cy')];
  const { ranked } = rankPlaces([place('p', { distanceKm: 4 })], members);
  assert.deepEqual(ranked[0].satisfied, ['a', 'c']);
  assert.equal(ranked[0].matchPct, 89); // 8 of 9 checks pass
  assert.deepEqual(ranked[0].fails, { b: ['Bo needs vegan'] });
});

test('sorts by people satisfied, then cheaper, then closer', () => {
  const members = [member('a', 'Alex', { cuisine: 'Italian' }), member('b', 'Bo')];
  const { ranked } = rankPlaces([
    place('oneFan', { cuisine: 'Thai', estCostPerPerson: 10 }),
    place('far', { estCostPerPerson: 18, distanceKm: 4 }),
    place('pricey', { estCostPerPerson: 22, distanceKm: 1 }),
    place('near', { estCostPerPerson: 18, distanceKm: 1 }),
  ], members);
  assert.deepEqual(ids(ranked), ['near', 'far', 'pricey', 'oneFan']);
});

test('matchPct: one miss in a group of 4 is 92%, everyone fully happy is 100%', () => {
  const members = [member('a', 'Alex'), member('b', 'Bo'), member('c', 'Cy'), member('d', 'Di', { cuisine: 'Thai' })];
  const { ranked } = rankPlaces([place('miss'), place('all', { cuisine: 'Thai' })], members);
  const pct = Object.fromEntries(ranked.map((r) => [r.place.id, r.matchPct]));
  assert.deepEqual(pct, { all: 100, miss: 92 });
  assert.equal(rankPlaces([place('p')], []).ranked[0].matchPct, 0);
});

test('sort stays on people fully happy, even when another place has a higher match %', () => {
  // threeHappy: Di misses all 3 checks (9/12 = 75%). twoHappy: Cy and Di miss one each (10/12 = 83%).
  const members = [member('a', 'Alex'), member('b', 'Bo'), member('c', 'Cy', { diet: ['vegan'] }),
    member('d', 'Di', { cuisine: 'Thai', distanceKm: 1, diet: ['halal'] })];
  const { ranked } = rankPlaces([
    place('twoHappy', { cuisine: 'Thai', distanceKm: 1, estCostPerPerson: 10 }),
    place('threeHappy', { distanceKm: 3, dietOptions: ['vegan'], estCostPerPerson: 25 }),
  ], members);
  assert.deepEqual(ids(ranked), ['threeHappy', 'twoHappy']);
  assert.deepEqual(ranked.map((r) => r.matchPct), [75, 83]);
});

test('unknown cost or distance never excludes a place', () => {
  const { ranked, excluded } = rankPlaces([place('p', { estCostPerPerson: undefined, distanceKm: null })], [member('a', 'Alex', { budget: 10 })]);
  assert.equal(excluded.length, 0);
  assert.deepEqual(ranked[0].satisfied, ['a']);
});

test('voteCounts tallies votes per place', () => {
  assert.deepEqual(voteCounts({ a: 'p1', b: 'p2', c: 'p1' }), { p1: 2, p2: 1 });
  assert.deepEqual(voteCounts({}), {});
});

test('winner: most votes wins, ties go to the higher rank', () => {
  const ranked = [{ place: { id: 'p1' } }, { place: { id: 'p2' } }, { place: { id: 'p3' } }];
  assert.equal(winner(ranked, { a: 'p3', b: 'p3', c: 'p1' }).place.id, 'p3');
  assert.equal(winner(ranked, { a: 'p3', b: 'p2' }).place.id, 'p2');
  assert.equal(winner(ranked, {}).place.id, 'p1');
  // A vote for a place that isn't ranked (now over budget) doesn't count.
  assert.equal(winner(ranked, { a: 'gone', b: 'gone', c: 'p2' }).place.id, 'p2');
  assert.equal(winner([], { a: 'p1' }), null);
});

test('similarHistory: one entry per restaurant, most recent visit, per-person cost', () => {
  const meals = [
    { restaurant: 'Trattoria Bella', cuisine: 'Italian', total: 100, members: { a: {}, b: {}, c: {} } },
    { restaurant: 'trattoria bella ', cuisine: 'Italian', total: 50, members: { a: {} } },
    { restaurant: '', total: 20, members: { a: {} } },
    { restaurant: 'El Taquero', total: 45.5, members: {} },
  ];
  assert.deepEqual(similarHistory(meals), [
    { restaurant: 'Trattoria Bella', cuisine: 'Italian', perPerson: 33.33 },
    { restaurant: 'El Taquero', cuisine: '', perPerson: 0 },
  ]);
  assert.deepEqual(similarHistory([]), []);
});
