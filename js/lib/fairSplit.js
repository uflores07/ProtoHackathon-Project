// The fair split: tax, tip, service charges and discounts follow the dishes they belong to,
// so the person who had a salad doesn't pay tax on someone else's steak.
// Pure (no DOM, no store) so Node tests can import it.
// Receipts store dollars (see reducer.js). Everything here converts to integer cents on the
// way in and returns integer cents, so the shares always add up to the bill exactly.

export const cents = (dollars) => Math.round((Number(dollars) || 0) * 100);

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// Split `total` cents by integer weights so the parts add up exactly (largest remainder).
// Leftover cents go to the biggest remainders, ties to the earlier index. All-zero weights split evenly.
export function allocate(total, weights) {
  if (!weights.length) return [];
  let w = weights;
  let whole = sum(w);
  if (whole <= 0) {
    w = w.map(() => 1);
    whole = w.length;
  }
  const parts = w.map((x) => Math.floor((total * x) / whole));
  const rems = w.map((x, i) => total * x - parts[i] * whole);
  let left = total - sum(parts);
  const order = rems.map((_, i) => i).sort((a, b) => rems[b] - rems[a] || a - b);
  for (let k = 0; left > 0; k++, left--) parts[order[k]]++;
  return parts;
}

// Equal split among k people. Extra cents go round-robin from `start` so the same person
// doesn't always pay the odd penny. Returns [shares, where the next extra cent goes].
function splitEven(amount, k, start) {
  const base = Math.floor(amount / k);
  const shares = Array(k).fill(base);
  let at = start;
  for (let extra = amount - base * k; extra > 0; extra--, at = (at + 1) % k) shares[at]++;
  return [shares, at];
}

// A tip printed on the receipt wins; otherwise tipPct of the full-price food, before tax and before
// any discount (the usual etiquette). It's shared by full-price dish too, so one person's coupon
// lowers only their food, never anyone else's tip.
export function tipAmount(receipt) {
  if (Number(receipt?.tip) > 0) return cents(receipt.tip);
  const base = sum((receipt?.items ?? []).map((it) => Math.max(cents(it.price), 0)));
  return Math.max(0, Math.round((base * (Number(receipt?.tipPct) || 0)) / 100));
}

const PARTS = ['food', 'discount', 'tax', 'service', 'tip'];
const blank = () => ({ items: [], food: 0, base: 0, discount: 0, tax: 0, service: 0, tip: 0, total: 0 });

// Who pays what, in cents. discount is negative (it's money off).
// receipt.evenSplit splits the whole bill equally between everyone in memberIds instead of by item.
// base is the full-price food a person had (no minus lines): tax, tip, fees and discounts follow it.
// memberIds are sorted so every phone rounds the same way, whatever order it lists people in.
// Free ($0) lines nobody claimed are left out of `unclaimed`: no money hangs on them.
export function computeShares(receipt, memberIds = []) {
  const ids = [...new Set(memberIds)].sort();
  const items = receipt?.items ?? [];
  const prices = items.map((it) => cents(it.price));
  // Comped and negative lines carry no tax or tip.
  const weights = prices.map((p) => Math.max(p, 0));
  const charges = {
    discount: -Math.abs(cents(receipt?.discount)),
    tax: cents(receipt?.tax),
    service: cents(receipt?.serviceCharge),
    tip: tipAmount(receipt),
  };
  const onItem = Object.fromEntries(Object.entries(charges).map(([k, v]) => [k, allocate(v, weights)]));

  const people = Object.fromEntries(ids.map((id) => [id, blank()]));
  const food = sum(prices);
  const fees = sum(Object.values(charges));
  const totals = { food, base: sum(weights), ...charges, total: food + fees };

  // Split evenly: add up the whole bill and divide it by the number of people, whatever they ate.
  // The extra cents carry on round-robin across every part, so nobody pays more than 1 cent extra.
  if (receipt?.evenSplit && ids.length) {
    let at = 0;
    const [base] = splitEven(totals.base, ids.length, 0);
    for (const [key, amount] of [['food', food], ...Object.entries(charges)]) {
      let shares;
      [shares, at] = splitEven(amount, ids.length, at);
      ids.forEach((id, j) => { people[id][key] += shares[j]; });
    }
    ids.forEach((id, j) => {
      const p = people[id];
      p.base = base[j];
      p.total = p.food + p.discount + p.tax + p.service + p.tip;
      p.items.push({ itemId: null, name: 'Even share of the bill', amount: p.total, split: ids.length });
    });
    return { people, unclaimed: [], totals, allClaimed: true, even: true };
  }

  const unclaimed = [];
  items.forEach((it, i) => {
    const parts = { food: prices[i], discount: onItem.discount[i], tax: onItem.tax[i], service: onItem.service[i], tip: onItem.tip[i] };
    const amount = sum(Object.values(parts));
    const who = ids.filter((id) => receipt.claims?.[it.id]?.[id]);
    if (!who.length) {
      if (amount !== 0) unclaimed.push({ itemId: it.id, name: it.name, amount });
      return;
    }
    const mine = who.map(() => 0);
    let at = i % who.length;
    const [base] = splitEven(weights[i], who.length, at);
    for (const key of PARTS) {
      let shares;
      [shares, at] = splitEven(parts[key], who.length, at);
      who.forEach((id, j) => { people[id][key] += shares[j]; mine[j] += shares[j]; });
    }
    who.forEach((id, j) => {
      people[id].base += base[j];
      people[id].items.push({ itemId: it.id, name: it.name, amount: mine[j], split: who.length });
      people[id].total += mine[j];
    });
  });

  // No lines to carry the fees: keep them visible as unclaimed so the totals still add up.
  if (!items.length && fees) unclaimed.push({ itemId: null, name: 'Tax, tip and fees', amount: fees });

  return { people, unclaimed, totals, allClaimed: !unclaimed.length, even: false };
}

// One line on how a person's tax, tip and fees were worked out (person and totals from computeShares).
// name null means "you". '' when there's nothing to explain.
export function explainShare(person, totals, name = null) {
  if (!person?.base || !totals?.base) return '';
  const fees = [['tax', totals.tax], ['tip', totals.tip], ['service charge', totals.service], ['discount', totals.discount]]
    .filter(([, v]) => v).map(([k]) => k);
  if (!fees.length) return '';
  const pct = `${Math.round((100 * person.base) / totals.base) || '<1'}%`;
  const list = fees.length > 1 ? `${fees.slice(0, -1).join(', ')} and ${fees.at(-1)}` : fees[0];
  return `${name ?? 'You'} had ${pct} of the food, so ${pct} of the ${list} is on ${name == null ? 'your' : 'their'} share.`;
}

// --- Name matching (receipt lines vs the plan and the live tab) ---

const STOP = new Set(['the', 'an', 'and', 'with', 'of', 'comp', 'comped', 'void']);
const QTY = /^(\d+x?|x\d+)$/;

export function tokens(name) {
  return String(name ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter((t) => t.length > 1 && !STOP.has(t) && !QTY.test(t));
}

// Receipts abbreviate ("MARG PIZZA"), so a 3+ letter prefix counts as the same word.
const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

// 0..1 overlap of the words in two names (Dice coefficient).
export function nameScore(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return 0;
  const hits = Math.min(A.filter((x) => B.some((y) => sameWord(x, y))).length, B.filter((y) => A.some((x) => sameWord(x, y))).length);
  return (2 * hits) / (A.length + B.length);
}

export const MATCH = 0.6;

// Copy who-had-what from the live tab onto the scanned receipt, for confident matches only.
// Several live items with the same name (two lemonades) pool their people onto the one receipt line.
export function prefillClaims(receiptItems, liveItems) {
  const out = {};
  for (const it of receiptItems ?? []) {
    let best = 0;
    let hits = [];
    for (const live of liveItems ?? []) {
      const score = nameScore(it.name, live.name);
      if (score > best) { best = score; hits = [live]; } else if (score === best && score > 0) hits.push(live);
    }
    if (best < MATCH) continue;
    // Two different dishes scoring the same is a coin toss, so leave it for people to tap.
    if (new Set(hits.map((h) => tokens(h.name).join(' '))).size > 1) continue;
    const who = {};
    for (const h of hits) for (const [id, on] of Object.entries(h.claims ?? {})) if (on) who[id] = true;
    if (Object.keys(who).length) out[it.id] = who;
  }
  return out;
}

// Planned budget vs what the bill came to, and what pushed it over. All in cents.
// A plan counts once the planner has built an order; its budget is for the whole group.
export function budgetCheck(receipt, plan) {
  const { totals } = computeShares(receipt, []);
  const order = plan?.order ?? [];
  const planned = order.length ? cents(plan.settings?.budget) : null;
  const plannedNames = order.map((o) => plan.menu?.find((m) => m.id === o.itemId)?.name).filter(Boolean);
  const unplanned = (receipt?.items ?? [])
    .filter((it) => cents(it.price) > 0 && !plannedNames.some((n) => nameScore(it.name, n) >= MATCH))
    .map((it) => ({ itemId: it.id, name: it.name, amount: cents(it.price) }));
  const diff = planned == null ? null : totals.total - planned;
  return { planned, actual: totals.total, diff, over: diff != null && diff > 0, unplanned, tax: totals.tax, tip: totals.tip, service: totals.service };
}
