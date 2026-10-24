// Sample meals for the Ledger in demo mode ("Load sample meals"), in the receipt/finalize summary shape.
// Four dinners over the last two months with three friends: two owe you, you owe one,
// one meal is fully settled, and one has a debt between two other people.
// Handles are made up; example.com emails go nowhere.
import { listMeals, saveMeal } from '../history.js';

const DAY = 86400000;

const SAM = { id: 'demo-sam', name: 'Sam', pay: { email: 'sam@example.com', paypal: '', venmo: '' } };
const JORDAN = { id: 'demo-jordan', name: 'Jordan', pay: { email: 'jordan@example.com', paypal: 'SplitDemoJordan', venmo: 'SplitDemoJordan' } };
const PRIYA = { id: 'demo-priya', name: 'Priya', pay: { email: 'priya@example.com', paypal: '', venmo: '' } };

const MEALS = [
  { daysAgo: 4, restaurant: 'Trattoria Bella', cuisine: 'Italian', total: 82.3, planned: 90, payer: 'me',
    shares: [['me', 21.5], [SAM, 18.7], [JORDAN, 22.1, true], [PRIYA, 20.0]] },
  { daysAgo: 18, restaurant: 'El Taquero Taco Bar', cuisine: 'Mexican', total: 42.05, planned: 50, payer: JORDAN,
    shares: [['me', 12.0], [SAM, 15.25, true], [JORDAN, 14.8]] },
  { daysAgo: 39, restaurant: 'Urban Ramen Bar', cuisine: 'Japanese', total: 63.75, planned: 60, payer: SAM,
    shares: [['me', 21.0, true], [SAM, 19.5], [PRIYA, 23.25, true]] },
  { daysAgo: 60, restaurant: 'Saffron Grill House', cuisine: 'Middle Eastern', total: 76.7, planned: null, payer: PRIYA,
    shares: [['me', 19.8, true], [SAM, 18.4, true], [JORDAN, 20.6], [PRIYA, 17.9]] },
];

export function sampleMeals(myId, now) {
  const me = { id: myId, name: 'You', pay: {} };
  const who = (p) => (p === 'me' ? me : p);
  return MEALS.map((m, i) => {
    const at = now - m.daysAgo * DAY;
    const payer = who(m.payer);
    const members = {};
    for (const [p, share, paid = false] of m.shares) {
      const person = who(p);
      members[person.id] = { name: person.name, share, paid, pay: { ...person.pay } };
    }
    return {
      id: `SAMPLE-${i + 1}-${at}`, at, restaurant: m.restaurant, cuisine: m.cuisine, area: 'Coquitlam', currency: 'CAD',
      total: m.total, planned: m.planned, payerId: payer.id, payerName: payer.name, members, myId, demo: true,
    };
  });
}

// Adds the samples to this phone's history. saveMeal puts each meal first, so everything is saved
// oldest-first to leave the list newest-first (the Group tab's "Places like..." reads the first one).
export function addSampleMeals(myId, now) {
  const all = [...listMeals(), ...sampleMeals(myId, now)].sort((a, b) => (a.at || 0) - (b.at || 0));
  for (const m of all) saveMeal(m);
}
