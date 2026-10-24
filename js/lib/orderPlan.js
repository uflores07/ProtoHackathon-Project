// Order planner: picks a budget-fitting order from a scanned menu, and adds up the live tab.
// Pure (no DOM, no store), so Node tests can import it. Money is integer cents inside;
// inputs and outputs are dollars, like the shared state.
import { allocate } from './fairSplit.js';

// Portions one person eats.
export const HUNGER = { light: 0.7, normal: 1, starving: 1.4 };

const SIDES = ['appetizer', 'side'];
const cents = (d) => Math.round((Number(d) || 0) * 100);
const dollars = (c) => c / 100;
const fmt = (c) => `$${(c / 100).toFixed(2)}`;
const round1 = (n) => Math.round(n * 10) / 10;
const serves = (it) => (Number(it.serves) > 0 ? Number(it.serves) : 1);
const dietName = (d) => d.replace(/_/g, ' ');

function cfg(settings = {}) {
  return {
    headcount: Math.max(1, Math.round(Number(settings.headcount) || 1)),
    // Capped at $1B so the cent-by-cent loops in capCents stay exact (and short) whatever another phone syncs.
    budget: Math.min(Math.max(0, cents(settings.budget)), 1e11),
    taxPct: Math.max(0, Number(settings.taxPct) || 0),
    tipPct: Math.max(0, Number(settings.tipPct) || 0),
    mode: settings.mode === 'individual' ? 'individual' : 'family',
    hunger: HUNGER[settings.hunger] ?? 1,
    diet: settings.diet || [],
    dessert: settings.dessert === true,
  };
}

// Tip goes on the pre-tax food, the way most people tip.
const extras = (sub, c) => ({ tax: Math.round((sub * c.taxPct) / 100), tip: Math.round((sub * c.tipPct) / 100) });
const grand = (sub, c) => { const { tax, tip } = extras(sub, c); return sub + tax + tip; };

// The most food (cents) whose total after tax and tip still fits the budget.
function capCents(c) {
  let cap = Math.floor(c.budget / (1 + (c.taxPct + c.tipPct) / 100));
  while (cap > 0 && grand(cap, c) > c.budget) cap -= 1; // rounding can push the total a cent over
  while (grand(cap + 1, c) <= c.budget) cap += 1; // ...or leave a cent unused
  return cap;
}

export const foodBudget = (settings) => dollars(capCents(cfg(settings)));

// Portions per dollar: a $22 platter that feeds 3 beats a $14 single plate.
export const valueScore = (item) => (cents(item.price) > 0 ? serves(item) / (cents(item.price) / 100) : 0);

// Strict diet filter: a dish must carry every tag asked for.
export const eligible = (menu, diet = []) => (menu || []).filter((it) => diet.every((d) => (it.tags || []).includes(d)));

export function totals(order, menu, settings) {
  const c = cfg(settings);
  const byId = new Map((menu || []).map((m) => [m.id, m]));
  let sub = 0;
  let servings = 0;
  for (const e of order || []) {
    const it = byId.get(e.itemId);
    if (!it) continue;
    sub += cents(it.price) * e.qty;
    if (it.category !== 'drink') servings += serves(it) * e.qty; // food portions only
  }
  const { tax, tip } = extras(sub, c);
  const total = sub + tax + tip;
  return {
    subtotal: dollars(sub), tax: dollars(tax), tip: dollars(tip), total: dollars(total),
    perPerson: dollars(Math.round(total / c.headcount)), servings: round1(servings),
  };
}

// The best-value dish of each category (ties included), for the "Best value" badge.
export function bestValue(menu, diet = []) {
  const top = {};
  for (const it of eligible(menu, diet)) {
    const v = valueScore(it);
    if (v > 0 && v >= (top[it.category]?.v ?? 0)) top[it.category] = { v, ids: v === top[it.category]?.v ? [...top[it.category].ids, it.id] : [it.id] };
  }
  return new Set(Object.values(top).flatMap((t) => t.ids));
}

// dietById: { [memberId]: [diet] }. In individual mode each person's plate also follows their own diet.
export function buildOrder(menu, settings, memberIds = [], dietById = {}) {
  const c = cfg(settings);
  if (!menu?.length) return { order: [], reason: 'Scan a menu and Split will plan the order.' };
  const pool = eligible(menu, c.diet).filter((it) => cents(it.price) > 0);
  if (!pool.length) {
    return { order: [], reason: c.diet.length ? `Nothing on this menu is marked ${c.diet.map(dietName).join(' + ')}. Try fewer diet filters.` : 'No dishes with prices on this menu.' };
  }
  const mains = pool.filter((it) => it.category === 'main');
  // No mains on the menu (a cafe, a dessert bar): plan with every food item instead.
  const core = mains.length ? mains : pool.filter((it) => it.category !== 'drink');
  if (!core.length) return { order: [], reason: 'This menu only has drinks, so there is no meal to plan.' };
  const kind = mains.length ? 'main' : 'dish';
  const cheapest = Math.min(...core.map((it) => cents(it.price)));
  return c.mode === 'individual'
    ? individual(pool, core, c, memberIds, kind, dietById)
    : family(pool, core, c, kind, cheapest);
}

// Only the portions still needed count, so the planner doesn't overshoot with a giant tray.
const useful = (it, need) => Math.min(serves(it), need) / cents(it.price);
const byPrice = (a, b) => cents(a.price) - cents(b.price);

function family(pool, core, c, kind, cheapest) {
  const cap = capCents(c);
  const target = c.headcount * c.hunger;
  const qty = new Map();
  let sub = 0;
  let servings = 0;
  const add = (it) => {
    qty.set(it.id, (qty.get(it.id) || 0) + 1);
    sub += cents(it.price);
    if (it.category !== 'drink') servings += serves(it);
  };
  // Once the table is fed, a side is judged on feeding the whole table.
  const need = () => (servings < target ? target - servings : target);
  // A repeat of a dish counts a bit less, so the spread mixes dishes but still chases value.
  const best = (cands, n = need()) => cands.filter((it) => sub + cents(it.price) <= cap)
    .sort((a, b) => useful(b, n) / (1 + (qty.get(b.id) || 0) / 2) - useful(a, n) / (1 + (qty.get(a.id) || 0) / 2) || byPrice(a, b))[0];
  const fill = (cands) => { for (let it = best(cands); it && servings < target; it = best(cands)) add(it); };

  fill(core);
  if (!qty.size) return { order: [], reason: `Even the cheapest ${kind} (${fmt(cheapest)}) is over the ${fmt(cap)} you can spend on food once tax and tip are added.` };
  const sides = pool.filter((it) => SIDES.includes(it.category) && !core.includes(it));
  fill(sides);
  if (!sides.some((it) => qty.has(it.id))) { const s = best(sides); if (s) add(s); }
  // Worded before dessert, so a dessert doesn't hide a tight budget.
  const people = `${c.headcount} ${c.headcount === 1 ? 'person' : 'people'}`;
  const reason = servings < target
    ? `Tight budget: about ${round1(servings)} of the ${round1(target)} portions ${people} need. Raise the budget or pick Light.`
    : `About ${round1(servings)} portions for ${people}, picked for the most food per dollar.`;
  // Asked-for dessert goes before the drink, so the drink doesn't take its room.
  const dessert = c.dessert && best(desserts(pool, core), c.headcount);
  if (dessert) add(dessert);
  const drink = best(pool.filter((it) => it.category === 'drink'), c.headcount); // judged on a drink each
  if (drink) add(drink);
  const order = [...qty].map(([itemId, n]) => ({ itemId, qty: n, forMemberId: null }));
  return { order, reason };
}

// On a menu with no mains, desserts are already part of the meal.
const desserts = (pool, core) => pool.filter((it) => it.category === 'dessert' && !core.includes(it));

function individual(pool, core, c, memberIds, kind, dietById) {
  const each = Math.floor(capCents(c) / c.headcount);
  if (!core.some((it) => cents(it.price) <= each)) {
    return { order: [], reason: `Even the cheapest ${kind} is over ${fmt(each)} per person once tax and tip are added.` };
  }
  const used = new Map();
  // Dishes nobody has yet come first, so people get different plates.
  const pick = (cands, room) => cands.filter((it) => cents(it.price) <= room)
    .sort((a, b) => (used.get(a.id) || 0) - (used.get(b.id) || 0) || useful(b, c.hunger) - useful(a, c.hunger) || byPrice(a, b))[0];
  const extrasPool = pool.filter((it) => ['drink', 'side'].includes(it.category) && !core.includes(it));
  const courses = c.dessert ? [core, desserts(pool, core), extrasPool] : [core, extrasPool];
  const order = [];
  // People nothing on the menu fits (their own diet + the cap); the screen names them.
  const unfed = [];
  for (let i = 0; i < c.headcount; i++) {
    const forMemberId = memberIds[i] ?? null;
    const own = dietById[forMemberId] || [];
    let room = each;
    for (const [n, cands] of courses.entries()) {
      const it = pick(eligible(cands, own), room);
      if (!it) {
        if (n === 0) { unfed.push({ forMemberId, diet: own }); break; }
        continue;
      }
      used.set(it.id, (used.get(it.id) || 0) + 1);
      room -= cents(it.price);
      order.push({ itemId: it.id, qty: 1, forMemberId });
    }
  }
  const reason = unfed.length
    ? `A ${kind} for everyone the menu fits, up to ${fmt(each)} of food each. Nothing fits ${unfed.length === 1 ? '1 person' : `${unfed.length} people`}.`
    : `A ${kind} for each person, up to ${fmt(each)} of food each.`;
  return { order, reason, unfed };
}

// Replace a dish with the most similar one: same category, closest price, passes the diet.
// Prefers (in order) staying within budget, a dish not already ordered, and one not in `avoid`
// (dishes the user already swapped away from, so repeated taps cycle through the menu).
// dietById: the new dish also follows the own diet of everyone it was for (individual plates).
export function swap(order, menu, itemId, settings, avoid = [], dietById = {}) {
  const c = cfg(settings);
  const old = (menu || []).find((m) => m.id === itemId);
  if (!old || !order.some((e) => e.itemId === itemId)) return null;
  const own = order.filter((e) => e.itemId === itemId).flatMap((e) => dietById[e.forMemberId] || []);
  const cands = eligible(menu, [...c.diet, ...own]).filter((it) => it.id !== itemId && it.category === old.category && cents(it.price) > 0);
  if (!cands.length) return null;
  const byId = new Map(menu.map((m) => [m.id, m]));
  let base = 0;
  let n = 0;
  for (const e of order) {
    if (e.itemId === itemId) n += e.qty;
    else base += cents(byId.get(e.itemId)?.price) * e.qty;
  }
  const ordered = new Set(order.map((e) => e.itemId));
  const key = (it) => [
    grand(base + cents(it.price) * n, c) > c.budget ? 1 : 0,
    ordered.has(it.id) ? 1 : 0,
    avoid.includes(it.id) ? 1 : 0,
    Math.abs(cents(it.price) - cents(old.price)),
    -valueScore(it),
  ];
  const cmp = (a, b) => { const ka = key(a); const kb = key(b); return ka.reduce((r, v, i) => r || v - kb[i], 0); };
  const swappedIn = [...cands].sort(cmp)[0];

  // Merge with a line of the same dish for the same person (family mode has one line per dish).
  const merged = [];
  for (const e of order) {
    const next = e.itemId === itemId ? { ...e, itemId: swappedIn.id } : e;
    const same = merged.find((m) => m.itemId === next.itemId && m.forMemberId === next.forMemberId);
    if (same) same.qty += next.qty;
    else merged.push({ ...next });
  }
  return { order: merged, swappedIn };
}

// Running totals at the table: each item split evenly among the people who tapped it,
// plus their share of the estimated tax and tip. items: [{ price (per unit), qty, claims }].
export function liveTotals(items, settings) {
  const c = cfg(settings);
  const share = {};
  let sub = 0;
  let unclaimed = 0;
  (items || []).forEach((it, n) => {
    const line = cents(it.price) * (it.qty || 1);
    sub += line;
    const who = Object.keys(it.claims || {}).sort();
    if (!who.length) { unclaimed += line; return; }
    // Split to the cent; leftover cents start at a different person on each item, so no one always pays them.
    who.forEach((id, i) => { share[id] = (share[id] || 0) + Math.floor(line / who.length) + ((i - n % who.length + who.length) % who.length < line % who.length ? 1 : 0); });
  });
  const { tax, tip } = extras(sub, c);
  // Tax and tip follow the food, by largest remainder, so every part adds up to the table total.
  const ids = Object.keys(share);
  const extra = allocate(tax + tip, [...ids.map((id) => share[id]), unclaimed]);
  return {
    subtotal: dollars(sub), tax: dollars(tax), tip: dollars(tip), total: dollars(sub + tax + tip),
    perMember: Object.fromEntries(ids.map((id, i) => [id, dollars(share[id] + extra[i])])),
    unclaimed: dollars(unclaimed + extra[ids.length]),
  };
}
