// Friends saved on this phone, so the people you eat with often can join a group in one tap.
// A friend = { id, name, pay: { email, paypal, venmo }, diet: [] }. Only touches localStorage, so Node tests can import it.
import { uid } from './ui.js';

const KEY = 'split.friends';
const text = (v) => String(v ?? '').trim();

export function listFriends() {
  try {
    const all = JSON.parse(localStorage.getItem(KEY));
    // Hand-edited or older data can have a missing pay object or a non-list diet; tidy it so Settings can't break.
    return Array.isArray(all) ? all.filter((f) => f?.id).map((f) => ({
      ...f, name: text(f.name), pay: f.pay && typeof f.pay === 'object' ? f.pay : {}, diet: Array.isArray(f.diet) ? f.diet : [],
    })) : [];
  } catch {
    return [];
  }
}

export const getFriend = (id) => listFriends().find((f) => f.id === id) ?? null;

// Adds a new friend or updates the one with the same id. Returns what was saved.
export function saveFriend(friend) {
  const pay = friend.pay ?? {};
  const saved = {
    id: friend.id || `f-${uid()}`,
    name: text(friend.name),
    pay: { email: text(pay.email), paypal: text(pay.paypal), venmo: text(pay.venmo) },
    diet: Array.isArray(friend.diet) ? [...friend.diet] : [],
  };
  const all = listFriends();
  const i = all.findIndex((f) => f.id === saved.id);
  if (i >= 0) all[i] = saved;
  else all.push(saved);
  localStorage.setItem(KEY, JSON.stringify(all));
  return saved;
}

export function removeFriend(id) {
  localStorage.setItem(KEY, JSON.stringify(listFriends().filter((f) => f.id !== id)));
}
