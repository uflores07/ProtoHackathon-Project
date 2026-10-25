// The Ledger's math: who owes who across saved meals, and settling (or un-settling) with someone.
// A meal is the receipt/finalize summary saved by js/history.js (amounts in dollars):
// { id, at, restaurant, total, planned, payerId, payerName, members: { [id]: { name, share, paid, pay } } }
// Everything is added up in integer cents so $0.10 + $0.20 stays $0.30, then handed back in dollars.
import { paypalLink, venmoLink } from './payLinks.js';

const cents = (n) => Math.round((Number(n) || 0) * 100);
const dollars = (c) => c / 100;

// People at the meal who didn't pay the bill, with a non-zero share. A positive share is owed to the payer;
// a negative one (they claimed a coupon line) is owed by the payer to them.
const debtors = (meal) => Object.entries(meal.members || {})
  .filter(([id, m]) => id !== meal.payerId && cents(m.share) !== 0);

export const pending = (meal) => debtors(meal).filter(([, m]) => !m.paid).length;

// Debts that involve me, one per person per meal: c > 0 means they owe me, c < 0 means I owe them.
// A negative share flips the sign, so a payer who owes someone their coupon shows up the right way round.
// at is when "Mark settled" marked it paid (settlePatch), so an undo can put back just that settle-up.
function myDebts(meal, myId) {
  if (!meal.payerId) return [];
  const out = [];
  for (const [id, m] of debtors(meal)) {
    const d = { paid: !!m.paid, at: m.settledAt || 0 };
    if (meal.payerId === myId) out.push({ ...d, personId: id, c: cents(m.share) });
    else if (id === myId) out.push({ ...d, personId: meal.payerId, c: -cents(m.share) });
  }
  return out;
}

// Per person: the netted amount, the meals behind it and each meal's part (items, for the breakdown).
// keep(debt) picks which debts count.
function byPerson(meals, myId, keep) {
  const by = new Map();
  for (const meal of meals) {
    for (const d of myDebts(meal, myId)) {
      if (!keep(d)) continue;
      const p = meal.members[d.personId] || {};
      const b = by.get(d.personId) ?? { personId: d.personId, name: p.name || meal.payerName || 'Someone', c: 0, meals: [], items: [], pay: {} };
      b.c += d.c;
      b.meals.push(meal.id);
      b.items.push({ mealId: meal.id, restaurant: meal.restaurant || 'Meal', at: meal.at, amount: dollars(d.c) });
      // Meals come newest first, so the first handle we see is the freshest one.
      for (const [k, v] of Object.entries(p.pay || {})) if (v && !b.pay[k]) b.pay[k] = v;
      by.set(d.personId, b);
    }
  }
  return [...by.values()].map(({ c, ...b }) => ({ ...b, amount: dollars(c) }));
}

// Open balances: positive amount = they owe me, negative = I owe them. People who net to zero drop out.
export const balances = (meals, myId) => byPerson(meals, myId, (d) => !d.paid)
  .filter((b) => b.amount !== 0)
  .sort((a, b) => b.amount - a.amount);

// Each person's latest "Mark settled", newest first: { ...like a balance, at }. Positive amount = they paid me back,
// negative = I paid them back. Meals marked paid any other way (on the Split tab, in the meal sheet) aren't in it.
export function settled(meals, myId) {
  const last = new Map();
  for (const meal of meals) for (const d of myDebts(meal, myId)) if (d.paid && d.at > (last.get(d.personId) || 0)) last.set(d.personId, d.at);
  return byPerson(meals, myId, (d) => d.paid && d.at > 0 && d.at === last.get(d.personId))
    .map((b) => ({ ...b, at: last.get(b.personId) }))
    .sort((a, b) => b.at - a.at);
}

// The history patch that marks this meal's debt between me and personId paid at time `at` (or not paid again),
// or null if they have none.
export function settlePatch(meal, myId, personId, paid = true, at = null) {
  const who = meal.payerId === myId ? personId : meal.payerId === personId ? myId : null;
  if (!who || !meal.members?.[who]) return null;
  return { members: { ...meal.members, [who]: { ...meal.members[who], paid, settledAt: paid ? at : null } } };
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
