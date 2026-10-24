// Past meals, kept on this phone. Feeds the Ledger tab and "places like the ones you liked".
// A meal is the `summary` saved by receipt/finalize, plus myId (who this phone is), all money in dollars:
// { id, at, restaurant, cuisine, area, currency, total, planned (group budget or null/missing), payerId, payerName, myId,
//   members: { [memberId]: { name, share, paid, pay: { email, paypal, venmo } } } }
const KEY = 'split.history';
const GONE = 'split.historyDeleted';

export function listMeals() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

export function saveMeal(meal) {
  const all = listMeals().filter((m) => m.id !== meal.id);
  all.unshift(meal);
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 200)));
}

export function updateMeal(id, patch) {
  localStorage.setItem(KEY, JSON.stringify(listMeals().map((m) => (m.id === id ? { ...m, ...patch } : m))));
}

// Deleted ids are remembered so a meal that's still finished in the open group isn't saved again.
export function deleteMeals(ids) {
  const drop = new Set(ids);
  localStorage.setItem(KEY, JSON.stringify(listMeals().filter((m) => !drop.has(m.id))));
  localStorage.setItem(GONE, JSON.stringify([...new Set([...deletedIds(), ...ids])].slice(-500)));
}

function deletedIds() {
  try { return JSON.parse(localStorage.getItem(GONE)) || []; } catch { return []; }
}

export const wasDeleted = (id) => deletedIds().includes(id);

export function hasMeal(id) {
  return listMeals().some((m) => m.id === id);
}
