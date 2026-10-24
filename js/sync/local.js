// "This device only" sync: the session lives in localStorage. Other tabs in the same
// browser get the 'storage' event, so you can test multi-phone flows with several tabs.
import { reduce } from '../reducer.js';

const key = (code) => `split.session.${code}`;
let current = null; // { code, onState }

const read = (code) => {
  try { return JSON.parse(localStorage.getItem(key(code))); } catch { return null; }
};
const write = (code, s) => localStorage.setItem(key(code), JSON.stringify(s));

addEventListener('storage', (e) => {
  if (current && e.key === key(current.code) && e.newValue) current.onState(JSON.parse(e.newValue));
});

export const name = 'local';

export async function create(code, state) {
  write(code, state);
}

// Resolves false when there is no such session.
export async function connect(code, onState) {
  const s = read(code);
  if (!s) return false;
  current = { code, onState };
  onState(s);
  return true;
}

export async function dispatch(code, action) {
  const next = reduce(read(code), action);
  write(code, next);
  if (current?.code === code) current.onState(next);
}

export function close() {
  current = null;
}
