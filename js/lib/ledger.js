// The Ledger's math: who owes who across saved meals, who should pay next, and spending.
// A meal is the receipt/finalize summary saved by js/history.js (amounts in dollars):
// { id, at, restaurant, total, planned, payerId, payerName, members: { [id]: { name, share, paid, pay } } }
// Everything is added up in integer cents so $0.10 + $0.20 stays $0.30, then handed back in dollars.
import { paypalLink, venmoLink } from './payLinks.js';

const cents = (n) => Math.round((Number(n) || 0) * 100);
const dollars = (c) => c / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// People at the meal who didn't pay the bill and aren't settled yet. A positive share is owed to the payer;
// a negative one (they claimed a coupon line) is owed by the payer to them.
const debtors = (meal) => Object.entries(meal.members || {})
  .filter(([id, m]) => id !== meal.payerId && !m.paid && cents(m.share) !== 0);

export const pending = (meal) => debtors(meal).length;

// Positive amount = they owe me, negative = I owe them. Only debts that involve me.
// A negative share flips the sign, so a payer who owes someone their coupon shows up the right way round.
export function balances(meals, myId) {
  const by = new Map();
  for (const meal of meals) {
    if (!meal.payerId) continue;
    for (const [id, m] of debtors(meal)) {
      let personId, sign;
      if (meal.payerId === myId) [personId, sign] = [id, 1];
      else if (id === myId) [personId, sign] = [meal.payerId, -1];
      else continue;
      const p = meal.members[personId] || {};
      const b = by.get(personId) ?? { personId, name: p.name || meal.payerName || 'Someone', c: 0, meals: [], pay: {} };
      b.c += sign * cents(m.share);
      if (!b.meals.includes(meal.id)) b.meals.push(meal.id);
      // Meals come newest first, so the first handle we see is the freshest one.
      for (const [k, v] of Object.entries(p.pay || {})) if (v && !b.pay[k]) b.pay[k] = v;
      by.set(personId, b);
    }
  }
  return [...by.values()]
    .filter((b) => b.c !== 0)
    .sort((a, b) => b.c - a.c)
    .map(({ c, ...b }) => ({ ...b, amount: dollars(c) }));
}

export function netBalance(meals, myId) {
  return dollars(balances(meals, myId).reduce((sum, b) => sum + cents(b.amount), 0));
}

// The person furthest behind: what they've paid for minus what they've eaten, most negative wins.
// null when nobody is behind.
export function whoPaysNext(meals) {
  const gaps = new Map();
  const add = (id, name, c) => {
    const g = gaps.get(id) ?? { personId: id, name: '', c: 0 };
    g.name ||= name || '';
    g.c += c;
    gaps.set(id, g);
  };
  for (const meal of meals) {
    if (!meal.payerId) continue;
    add(meal.payerId, meal.members?.[meal.payerId]?.name || meal.payerName, cents(meal.total));
    for (const [id, m] of Object.entries(meal.members || {})) add(id, m.name, -cents(m.share));
  }
  let best = null;
  for (const g of gaps.values()) {
    if (g.c < 0 && (!best || g.c < best.c || (g.c === best.c && g.name < best.name))) best = g;
  }
  return best && { personId: best.personId, name: best.name || 'Someone', gap: dollars(best.c) };
}

// The last `months` calendar months up to `now`, oldest first, empty months included.
export function monthly(meals, myId, months, now) {
  const end = new Date(now);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    out.push({ key: monthKey(d), label: MONTHS[d.getMonth()], mine: 0, total: 0 });
  }
  const byKey = new Map(out.map((m) => [m.key, m]));
  for (const meal of meals) {
    const m = byKey.get(monthKey(new Date(meal.at)));
    if (!m) continue;
    m.mine += cents(meal.members?.[myId]?.share);
    m.total += cents(meal.total);
  }
  return out.map((m) => ({ ...m, mine: dollars(m.mine), total: dollars(m.total) }));
}

// saved is the net against the plan over every planned meal: negative means over plan overall.
export function stats(meals, myId) {
  let spent = 0;
  let underBudget = 0;
  let saved = 0;
  for (const meal of meals) {
    spent += cents(meal.members?.[myId]?.share);
    if (meal.planned == null) continue;
    const diff = cents(meal.planned) - cents(meal.total);
    saved += diff;
    if (diff >= 0) underBudget += 1;
  }
  return {
    meals: meals.length,
    spent: dollars(spent),
    avgPerMeal: meals.length ? dollars(Math.round(spent / meals.length)) : 0,
    underBudget,
    saved: dollars(saved),
  };
}

// The history patch that settles this meal's debt between me and personId, or null if they have none.
export function settlePatch(meal, myId, personId) {
  const who = meal.payerId === myId ? personId : meal.payerId === personId ? myId : null;
  if (!who || !meal.members?.[who]) return null;
  return { members: { ...meal.members, [who]: { ...meal.members[who], paid: true } } };
}

// "Hey Sam, you still owe me $X for ..." plus how to pay me (my handles from Settings). amountCents is what they owe.
export function reminderText({ name, amountCents, places = [], currency = 'CAD', pay = {} }) {
  const where = places.length ? new Intl.ListFormat('en').format(places) : 'dinner';
  const paypal = paypalLink(pay.paypal, amountCents, currency);
  const venmo = venmoLink(pay.venmo, amountCents, `Split: ${where}`);
  const email = String(pay.email ?? '').trim();
  return [
    `Hey ${name}, you still owe me $${(amountCents / 100).toFixed(2)} for ${where}.`,
    paypal && `PayPal: ${paypal}`,
    venmo && `Venmo: ${venmo}`,
    email && `e-Transfer: ${email}`,
    'Thanks! (via Split)',
  ].filter(Boolean).join('\n');
}
