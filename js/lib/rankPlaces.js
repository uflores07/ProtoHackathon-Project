// Ranks the AI's restaurants against everyone in the group. Pure (no DOM), so Node tests can import it.
// Place and member shapes are documented at the top of js/reducer.js.

// Words people (and the AI) use that point at a cuisine, matched as whole words after plurals are
// dropped, so "taco" also catches "Tacos". Keys can be phrases ("dim sum").
const SYNONYMS = {
  'dim sum': 'chinese', dumpling: 'chinese', 'hot pot': 'chinese', cantonese: 'chinese', szechuan: 'chinese', sichuan: 'chinese',
  'korean bbq': 'korean', bibimbap: 'korean', bulgogi: 'korean',
  sushi: 'japanese', ramen: 'japanese', udon: 'japanese', izakaya: 'japanese', teriyaki: 'japanese', 'japanese curry': 'japanese',
  'pad thai': 'thai', 'thai curry': 'thai',
  pho: 'vietnamese', 'banh mi': 'vietnamese',
  poke: 'hawaiian',
  curry: 'indian', biryani: 'indian', dosa: 'indian', tandoori: 'indian',
  shawarma: 'middle eastern', kebab: 'middle eastern', falafel: 'middle eastern', lebanese: 'middle eastern', persian: 'middle eastern',
  taco: 'mexican', burrito: 'mexican', taqueria: 'mexican', 'tex mex': 'mexican',
  pizza: 'italian', pizzeria: 'italian', pasta: 'italian', trattoria: 'italian',
  gyro: 'greek', souvlaki: 'greek',
  burger: 'american', diner: 'american',
  // Cuisines that end in another cuisine's name stay whole, so "Latin American" isn't "American".
  'middle eastern': 'middle eastern', 'latin american': 'latin american', 'south american': 'south american',
  'central american': 'central american', 'west indian': 'caribbean',
};

// Lowercase words without accents ("Phở" is "pho") and without a plural s.
const words = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .split(/[^a-z]+/).filter(Boolean).map((w) => (w.length > 3 ? w.replace(/([^s])s$/, '$1') : w));

// Longest phrase first, so "korean bbq" wins over a shorter key starting with the same word.
const PHRASES = Object.entries(SYNONYMS).map(([k, v]) => [words(k), v]).sort((a, b) => b[0].length - a[0].length);

// A cuisine as a set of terms: each synonym phrase becomes its cuisine, every other word stays itself.
function terms(s) {
  const ws = words(s);
  const out = new Set();
  for (let i = 0; i < ws.length; i++) {
    const hit = PHRASES.find(([p]) => p.every((w, j) => ws[i + j] === w));
    if (hit) i += hit[0].length - 1;
    out.add(hit ? hit[1] : ws[i]);
  }
  return out;
}

export function cuisineMatches(want, placeCuisine) {
  const w = String(want ?? '').trim().toLowerCase();
  if (!w || w === 'any') return true;
  const p = terms(placeCuisine);
  return [...terms(w)].some((t) => p.has(t));
}

export const dietLabel = (d) => String(d).replaceAll('_', '-');

// A missing or non-numeric value is "unknown", which never excludes or fails a place.
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const cents = (n) => Math.round(n * 100);
const dollars = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const nameOf = (m) => m.name || 'Someone';

function failures(place, m) {
  const out = [];
  if (!cuisineMatches(m.cuisine, place.cuisine)) out.push(`${nameOf(m)} wants ${m.cuisine}`);
  const dist = num(place.distanceKm);
  const max = num(m.distanceKm);
  if (dist !== null && max > 0 && dist > max) out.push(`${nameOf(m)}: ${dist} km is past ${max} km`);
  const have = new Set(place.dietOptions ?? []);
  const missing = (m.diet ?? []).filter((d) => !have.has(d));
  if (missing.length) out.push(`${nameOf(m)} needs ${and(missing.map(dietLabel))}`);
  return out;
}

const sortCost = (r) => num(r.place.estCostPerPerson) ?? Infinity;
const sortDist = (r) => num(r.place.distanceKm) ?? Infinity;
const by = (x, y) => (x === y ? 0 : x - y);

// Strict cap: a place over ANY member's budget is out. The rest rank by how many people it fully suits.
// matchPct gives partial credit: each person counts for the share of their 3 checks (cuisine, distance, diet) that pass.
export function rankPlaces(places = [], members = []) {
  const ranked = [];
  const excluded = [];
  for (const place of places) {
    const cost = num(place.estCostPerPerson);
    const over = cost === null ? [] : members.filter((m) => num(m.budget) > 0 && cents(cost) > cents(num(m.budget)));
    if (over.length) {
      excluded.push({ place, reason: `${dollars(cost)}/person is over ${and(over.map((m) => `${nameOf(m)}'s ${dollars(num(m.budget))} cap`))}` });
      continue;
    }
    const satisfied = [];
    const fails = {};
    let passed = 0;
    for (const m of members) {
      const why = failures(place, m);
      passed += 3 - why.length;
      if (why.length) fails[m.id] = why;
      else satisfied.push(m.id);
    }
    const matchPct = members.length ? Math.round((passed / (members.length * 3)) * 100) : 0;
    ranked.push({ place, satisfied, fails, matchPct });
  }
  ranked.sort((a, b) => b.satisfied.length - a.satisfied.length || by(sortCost(a), sortCost(b)) || by(sortDist(a), sortDist(b)));
  return { ranked, excluded };
}

// votes is { [memberId]: placeId }.
export function voteCounts(votes = {}) {
  const counts = {};
  for (const placeId of Object.values(votes)) counts[placeId] = (counts[placeId] ?? 0) + 1;
  return counts;
}

// The ranked row with the most votes; a tie (including no votes at all) goes to the higher rank.
export function winner(ranked = [], votes = {}) {
  const counts = voteCounts(votes);
  let best = null;
  for (const row of ranked) if (!best || (counts[row.place.id] ?? 0) > (counts[best.place.id] ?? 0)) best = row;
  return best;
}

// meals come newest first (history.js), so each restaurant keeps its most recent visit.
export function similarHistory(meals = []) {
  const seen = new Set();
  const out = [];
  for (const meal of meals) {
    const restaurant = String(meal.restaurant ?? '').trim();
    const key = restaurant.toLowerCase();
    if (!restaurant || seen.has(key)) continue;
    seen.add(key);
    const people = Object.keys(meal.members ?? {}).length;
    const perPerson = people ? Math.round(cents(num(meal.total) ?? 0) / people) / 100 : 0;
    out.push({ restaurant, cuisine: meal.cuisine ?? '', perPerson });
  }
  return out;
}
