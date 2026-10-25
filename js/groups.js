// Groups this phone has been in, newest first, so you can switch between them, leave one, and filter
// friends by group. Saved on this phone: [{ code, name, members: { [memberId]: name }, lastOpened }].
const KEY = 'split.groups';

export function listGroups() {
  try {
    const all = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(all) ? all.filter((g) => g?.code).map((g) => ({ ...g, members: g.members && typeof g.members === 'object' ? g.members : {} })) : [];
  } catch {
    return [];
  }
}

// Called with the session state on every change. Writes only when the name or people changed,
// or when `opened` is set (it then moves to the top of the list).
export function rememberGroup(s, opened = false) {
  if (!s?.id) return;
  const members = Object.fromEntries(Object.values(s.members ?? {}).map((m) => [m.id, String(m.name ?? '')]));
  const all = listGroups();
  const old = all.find((g) => g.code === s.id);
  if (!opened && old && old.name === s.name && JSON.stringify(old.members) === JSON.stringify(members)) return;
  const entry = { code: s.id, name: s.name, members, lastOpened: opened || !old ? Date.now() : old.lastOpened };
  try {
    localStorage.setItem(KEY, JSON.stringify([entry, ...all.filter((g) => g.code !== s.id)].slice(0, 30)));
  } catch { /* storage full or blocked: the list is a convenience */ }
}

export function forgetGroup(code) {
  try { localStorage.setItem(KEY, JSON.stringify(listGroups().filter((g) => g.code !== code))); } catch { /* see above */ }
}
