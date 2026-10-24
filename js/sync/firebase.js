// Phone-to-phone sync through Firebase Realtime Database.
// Each tap runs reduce() inside a transaction, so two phones claiming items at the
// same moment both land instead of one overwriting the other.
import { reduce } from '../reducer.js';

const V = '12.19.0';
let api = null;
let db = null;
let unsubscribe = null;

export const name = 'firebase';

export async function init(config) {
  const [{ initializeApp }, database] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`),
  ]);
  api = database;
  db = database.getDatabase(initializeApp(config));
}

const node = (code) => api.ref(db, `sessions/${code}`);
// Firebase refuses `undefined` anywhere in the value.
const clean = (s) => JSON.parse(JSON.stringify(s));

export async function create(code, state) {
  await api.set(node(code), clean(state));
}

export async function connect(code, onState) {
  close();
  const snap = await api.get(node(code));
  if (!snap.exists()) return false;
  // Hand over what we just downloaded, so the caller has the state before onValue's first callback.
  onState(snap.val());
  unsubscribe = api.onValue(node(code), (s) => { if (s.exists()) onState(s.val()); });
  return true;
}

export async function dispatch(code, action) {
  // `cur` can be null on the first try before the cache loads; returning it makes
  // Firebase retry with the real server value.
  await api.runTransaction(node(code), (cur) => (cur == null ? cur : clean(reduce(cur, action))));
}

export function close() {
  unsubscribe?.();
  unsubscribe = null;
}
