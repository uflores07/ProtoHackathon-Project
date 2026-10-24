import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENU } from '../js/fixtures/menu.js';
import { DEFAULT_SETTINGS } from '../js/reducer.js';
import { bestValue, buildOrder, eligible, foodBudget, HUNGER, liveTotals, swap, totals, valueScore } from '../js/lib/orderPlan.js';

// The demo menu with ids, the way js/ai/menu.js hands it to the planner.
const menu = MENU.items.map((it, i) => ({ id: `m${i + 1}`, ...it }));
const byId = (id) => menu.find((m) => m.id === id);
const settings = (patch = {}) => ({ ...DEFAULT_SETTINGS, ...patch });
const toCents = (d) => Math.round(d * 100);

test('food budget leaves room for tax and tip on the pre-tax food', () => {
  assert.equal(foodBudget(settings({ budget: 123, taxPct: 5, tipPct: 18 })), 100);
  const t = totals([{ itemId: 'm5', qty: 1 }], menu, settings({ taxPct: 5, tipPct: 20 }));
  assert.deepEqual([t.subtotal, t.tax, t.tip, t.total], [18, 0.9, 3.6, 22.5]);
  assert.equal(t.perPerson, 5.63);
});

test('a platter that feeds 3 is better value than a single plate', () => {
  assert.ok(valueScore({ price: 22, serves: 3 }) > valueScore({ price: 14, serves: 1 }));
  assert.equal(valueScore({ price: 0, serves: 2 }), 0);
});

test('the order never goes over budget after tax and tip', () => {
  for (const mode of ['family', 'individual']) {
    for (const hunger of Object.keys(HUNGER)) {
      for (let headcount = 1; headcount <= 8; headcount++) {
        for (let budget = 5; budget <= 300; budget += 7) {
          for (const tipPct of [15, 18, 20]) {
            const s = settings({ mode, hunger, headcount, budget, tipPct, taxPct: 5 });
            const { order } = buildOrder(menu, s);
            assert.ok(toCents(totals(order, menu, s).total) <= toCents(budget), `${mode} ${hunger} ${headcount}p $${budget}`);
          }
        }
      }
    }
  }
});

test('a family spread puts mains first, then a side, and a drink if money is left', () => {
  const { order, reason } = buildOrder(menu, settings());
  const cats = order.map((e) => byId(e.itemId).category);
  assert.equal(cats[0], 'main');
  assert.ok(cats.includes('side') || cats.includes('appetizer'));
  assert.equal(cats.at(-1), 'drink');
  assert.ok(totals(order, menu, settings()).servings >= 4);
  assert.match(reason, /portions for 4 people/);
});

test('hunger scales how much food is ordered', () => {
  const portions = (hunger) => {
    const s = settings({ hunger, budget: 500 });
    return totals(buildOrder(menu, s).order, menu, s).servings;
  };
  assert.ok(portions('light') >= 4 * HUNGER.light);
  assert.ok(portions('starving') >= 4 * HUNGER.starving);
  assert.ok(portions('starving') > portions('light'));
});

test('every ordered dish carries every diet tag asked for', () => {
  assert.deepEqual(eligible(menu, ['vegetarian', 'gluten_free']).map((m) => m.name), ['Gluten-Free Penne Primavera']);
  for (const mode of ['family', 'individual']) {
    const s = settings({ mode, diet: ['vegan'], budget: 200 });
    const { order } = buildOrder(menu, s);
    assert.ok(order.length > 0);
    for (const e of order) assert.ok(byId(e.itemId).tags.includes('vegan'), byId(e.itemId).name);
  }
  const none = buildOrder(menu, settings({ diet: ['halal', 'vegan'] }));
  assert.deepEqual(none.order, []);
  assert.match(none.reason, /halal \+ vegan/);
});

test('individual mode keeps each person under their share and varies the dishes', () => {
  const s = settings({ mode: 'individual', budget: 120, headcount: 4 });
  const cap = toCents(foodBudget(s) / 4);
  const { order } = buildOrder(menu, s, ['a', 'b', 'c']);
  const people = Map.groupBy(order, (e) => e.forMemberId);
  assert.deepEqual([...people.keys()], ['a', 'b', 'c', null]);
  const mains = [];
  for (const lines of people.values()) {
    const spend = lines.reduce((sum, e) => sum + toCents(byId(e.itemId).price) * e.qty, 0);
    assert.ok(spend <= cap, `spent ${spend} of ${cap}`);
    const main = lines.find((e) => byId(e.itemId).category === 'main');
    assert.ok(main, 'everyone gets a main');
    mains.push(main.itemId);
  }
  assert.equal(new Set(mains).size, 4, 'four people, four different mains');
});

test('a budget too small for any main gives an empty order and says why', () => {
  const ind = buildOrder(menu, settings({ mode: 'individual', budget: 80 }));
  assert.deepEqual(ind.order, []);
  assert.match(ind.reason, /Even the cheapest main is over \$16\.26 per person/);
  const fam = buildOrder(menu, settings({ budget: 15 }));
  assert.deepEqual(fam.order, []);
  assert.match(fam.reason, /Even the cheapest main \(\$18\.00\)/);
});

test('an empty menu gives an empty order', () => {
  assert.deepEqual(buildOrder([], settings()).order, []);
  assert.deepEqual(buildOrder(undefined, settings()).order, []);
  assert.deepEqual(totals([], [], settings()), { subtotal: 0, tax: 0, tip: 0, total: 0, perPerson: 0, servings: 0 });
});

test('the same menu and settings always give the same order', () => {
  for (const mode of ['family', 'individual']) {
    const s = settings({ mode, budget: 150 });
    assert.deepEqual(buildOrder(menu, s, ['a', 'b']), buildOrder(structuredClone(menu), s, ['a', 'b']));
  }
});

test('swap keeps the category, changes the dish and respects the diet', () => {
  const s = settings({ budget: 200 });
  const { order } = buildOrder(menu, s);
  const mainId = order.find((e) => byId(e.itemId).category === 'main').itemId;
  const res = swap(order, menu, mainId, s);
  assert.notEqual(res.swappedIn.id, mainId);
  assert.equal(res.swappedIn.category, 'main');
  assert.ok(!res.order.some((e) => e.itemId === mainId));
  assert.ok(!order.some((e) => e.itemId === res.swappedIn.id), 'picks a dish not already ordered');

  const vegan = settings({ budget: 200, diet: ['vegan'] });
  const vo = buildOrder(menu, vegan).order;
  const drink = vo.find((e) => byId(e.itemId).category === 'drink').itemId;
  assert.ok(byId(swap(vo, menu, drink, vegan).swappedIn.id).tags.includes('vegan'));
  // Rigatoni is the only vegan main, so there is nothing to swap it for.
  assert.equal(swap(vo, menu, 'm7', vegan), null);
  assert.equal(swap(vo, menu, 'nope', vegan), null);
});

test('swap stays within budget when it can and cycles past dishes already tried', () => {
  const s = settings();
  const { order } = buildOrder(menu, s);
  let o = order;
  const tried = [];
  for (let i = 0; i < 3; i++) {
    const id = o.find((e) => byId(e.itemId).category === 'main').itemId;
    const res = swap(o, menu, id, s, tried);
    tried.push(id);
    o = res.order;
    assert.ok(toCents(totals(o, menu, s).total) <= toCents(s.budget));
  }
  assert.equal(new Set(tried).size, 3);
});

test('swapping into a dish already on the list merges the lines', () => {
  const small = [byId('m1'), byId('m3')];
  const res = swap([{ itemId: 'm1', qty: 1, forMemberId: null }, { itemId: 'm3', qty: 1, forMemberId: null }], small, 'm1', settings({ budget: 500 }));
  assert.deepEqual(res.order, [{ itemId: 'm3', qty: 2, forMemberId: null }]);
  assert.equal(swap([{ itemId: 'm12', qty: 1, forMemberId: null }], menu, 'm12', settings()), null, 'Garlic Bread is the only side');
});

test('best value marks the top dish of each category', () => {
  const best = bestValue(menu);
  assert.ok(best.has('m5'), 'Margherita is the best-value main');
  assert.ok(best.has('m12'), 'Garlic Bread is the best-value side');
  assert.ok(!best.has('m8'));
});

test('the live tab splits each item among its claimers, to the cent', () => {
  const items = [
    { price: 10, qty: 1, claims: { a: true, b: true, c: true } },
    { price: 7, qty: 2, claims: { a: true } },
    { price: 5, qty: 1, claims: {} },
  ];
  const t = liveTotals(items, settings({ taxPct: 0, tipPct: 0 }));
  assert.equal(t.subtotal, 29);
  assert.deepEqual(t.perMember, { a: 17.34, b: 3.33, c: 3.33 });
  assert.equal(t.unclaimed, 5);

  const withTip = liveTotals(items, settings({ taxPct: 5, tipPct: 18 }));
  assert.equal(withTip.total, 35.67);
  assert.equal(withTip.perMember.a, 21.33);
  assert.equal(liveTotals([], settings()).total, 0);
});

test('the food budget is the most food that fits, to the cent', () => {
  // A $34.96 main comes to exactly $43.00 with 5% tax and 18% tip.
  const s = settings({ budget: 43, taxPct: 5, tipPct: 18, headcount: 1 });
  assert.equal(foodBudget(s), 34.96);
  const one = [{ id: 'x', name: 'Steak', price: 34.96, category: 'main', serves: 1, tags: [] }];
  const { order } = buildOrder(one, s);
  assert.deepEqual(order.map((e) => e.itemId), ['x']);
  assert.equal(totals(order, one, s).total, 43);
  // Every budget: the cap fits, and one more cent of food would not.
  const at = (price, st) => toCents(totals([{ itemId: 'x', qty: 1 }], [{ id: 'x', price }], st).total);
  for (let b = 100; b <= 20000; b += 7) {
    for (const [taxPct, tipPct] of [[5, 15], [5, 18], [12, 20], [0, 0], [7.5, 18]]) {
      const st = settings({ budget: b / 100, taxPct, tipPct });
      const cap = toCents(foodBudget(st));
      assert.ok(at(cap / 100, st) <= b, `$${b / 100} ${taxPct}/${tipPct}`);
      assert.ok(at((cap + 1) / 100, st) > b, `$${b / 100} ${taxPct}/${tipPct} leaves a cent`);
    }
  }
});

test('live tab parts always add up to the table total, to the cent', () => {
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor((seed / 2147483648) * n); }; // high bits: the low ones repeat
  for (let round = 0; round < 2000; round++) {
    const items = Array.from({ length: rand(8) }, () => ({
      price: (1 + rand(6000)) / 100,
      qty: 1 + rand(3),
      claims: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].filter(() => rand(2)).map((id) => [id, true])),
    }));
    const t = liveTotals(items, settings({ taxPct: rand(31) / 2, tipPct: rand(26) }));
    const parts = Object.values(t.perMember).reduce((sum, d) => sum + toCents(d), toCents(t.unclaimed));
    assert.equal(parts, toCents(t.total), JSON.stringify(items));
  }
});

test('live tab leftover cents take turns instead of landing on one person', () => {
  const claims = { a: true, b: true, c: true };
  const t = liveTotals([10, 10, 10].map((price) => ({ price, qty: 1, claims })), settings({ taxPct: 0, tipPct: 0 }));
  assert.deepEqual(t.perMember, { a: 10, b: 10, c: 10 });
});

test('individual plates follow each person\'s own diet', () => {
  const dietById = { a: ['vegetarian'], b: [], c: ['vegan'] };
  for (let budget = 60; budget <= 300; budget += 10) {
    for (const dessert of [false, true]) {
      const s = settings({ mode: 'individual', budget, headcount: 3, dessert });
      for (const e of buildOrder(menu, s, ['a', 'b', 'c'], dietById).order) {
        for (const d of dietById[e.forMemberId]) assert.ok(byId(e.itemId).tags.includes(d), `${e.forMemberId} got ${byId(e.itemId).name}`);
      }
    }
  }
  // Swapping a vegetarian's main gives them another vegetarian main.
  const s = settings({ mode: 'individual', budget: 200, headcount: 3 });
  const { order } = buildOrder(menu, s, ['a', 'b', 'c'], dietById);
  const mine = order.find((e) => e.forMemberId === 'a' && byId(e.itemId).category === 'main');
  let o = order;
  for (let i = 0; i < 4; i++) {
    const id = o.find((e) => e.forMemberId === 'a' && byId(e.itemId).category === 'main').itemId;
    const res = swap(o, menu, id, s, [mine.itemId], dietById);
    if (!res) break;
    assert.ok(res.swappedIn.tags.includes('vegetarian'), res.swappedIn.name);
    o = res.order;
  }
});

test('dessert is added only when asked and only if it fits', () => {
  const isDessert = (e) => byId(e.itemId).category === 'dessert';
  assert.ok(!buildOrder(menu, settings({ budget: 200 })).order.some(isDessert));
  const fam = buildOrder(menu, settings({ budget: 200, dessert: true })).order;
  assert.deepEqual(fam.filter(isDessert).map((e) => e.itemId), ['m15']);
  // $60 for 4 leaves $48.78 for food: two pizzas and garlic bread ($46) leave no room for a $10 tiramisu.
  assert.ok(!buildOrder(menu, settings({ budget: 60, dessert: true })).order.some(isDessert));
  for (let budget = 5; budget <= 300; budget += 3) {
    for (const mode of ['family', 'individual']) {
      const s = settings({ budget, mode, dessert: true });
      assert.ok(toCents(totals(buildOrder(menu, s).order, menu, s).total) <= toCents(budget), `${mode} $${budget}`);
    }
  }
  // Individual: everyone gets one when their share allows it, nobody goes over their share when it doesn't.
  const rich = buildOrder(menu, settings({ mode: 'individual', budget: 400, dessert: true }), ['a', 'b', 'c', 'd']).order;
  for (const id of ['a', 'b', 'c', 'd']) assert.equal(rich.filter((e) => e.forMemberId === id && isDessert(e)).length, 1, id);
  const s = settings({ mode: 'individual', budget: 120, dessert: true });
  const cap = toCents(foodBudget(s) / 4);
  for (const lines of Map.groupBy(buildOrder(menu, s, ['a', 'b', 'c', 'd']).order, (e) => e.forMemberId).values()) {
    assert.ok(lines.reduce((sum, e) => sum + toCents(byId(e.itemId).price), 0) <= cap);
  }
});

test('individual mode names the people nothing on the menu fits instead of dropping them', () => {
  const s = settings({ mode: 'individual', headcount: 3, budget: 150 });
  const res = buildOrder(menu, s, ['a', 'b', 'c'], { b: ['vegan', 'nut_free'] });
  assert.deepEqual(res.unfed, [{ forMemberId: 'b', diet: ['vegan', 'nut_free'] }]);
  assert.ok(res.order.every((o) => o.forMemberId !== 'b'));
  assert.match(res.reason, /Nothing fits 1 person/);
  assert.deepEqual(buildOrder(menu, s, ['a', 'b', 'c']).unfed, []);
});

test('a huge synced budget returns straight away instead of looping forever', () => {
  const started = Date.now();
  assert.ok(foodBudget({ budget: 1e15, taxPct: 13, tipPct: 18 }) > 0);
  assert.ok(buildOrder(menu, settings({ budget: 1e300 })).order.length > 0);
  assert.ok(Date.now() - started < 1000);
});
