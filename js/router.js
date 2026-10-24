// Which tab is showing. Tabs live in the URL hash (#group, #planner, #split, #ledger)
// so the back button and reloads keep you where you were.
export const TABS = ['group', 'planner', 'split', 'ledger'];
const listeners = new Set();

export const current = () => (TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'group');

export function go(tab) {
  if (!TABS.includes(tab)) return;
  if (current() === tab) listeners.forEach((fn) => fn(tab));
  else location.hash = tab;
}

export function onTab(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

addEventListener('hashchange', () => listeners.forEach((fn) => fn(current())));
