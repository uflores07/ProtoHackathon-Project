import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { forgetGroup, listGroups, rememberGroup } = await import('../js/groups.js');

beforeEach(() => mem.clear());
const session = (id, name, members) => ({ id, name, members: Object.fromEntries(members.map(([mid, n]) => [mid, { id: mid, name: n }])) });

test('remembers groups newest first with who is in them', () => {
  rememberGroup(session('AAAAA', 'Lunch', [['a', 'Alex']]), true);
  rememberGroup(session('BBBBB', 'Dinner', [['a', 'Alex'], ['s', 'Sam']]), true);
  assert.deepEqual(listGroups().map((g) => g.code), ['BBBBB', 'AAAAA']);
  assert.deepEqual(listGroups()[0].members, { a: 'Alex', s: 'Sam' });
});

test('a change updates the entry; opening moves it to the top', () => {
  rememberGroup(session('AAAAA', 'Lunch', [['a', 'Alex']]), true);
  rememberGroup(session('BBBBB', 'Dinner', [['a', 'Alex']]), true);
  rememberGroup(session('AAAAA', 'Lunch crew', [['a', 'Alex']]));
  assert.equal(listGroups().find((g) => g.code === 'AAAAA').name, 'Lunch crew');
  rememberGroup(session('BBBBB', 'Dinner', [['a', 'Alex']]), true);
  assert.equal(listGroups()[0].code, 'BBBBB');
});

test('forgetting a group and bad stored data', () => {
  rememberGroup(session('AAAAA', 'Lunch', []), true);
  forgetGroup('AAAAA');
  assert.deepEqual(listGroups(), []);
  mem.set('split.groups', '{nope');
  assert.deepEqual(listGroups(), []);
  mem.set('split.groups', JSON.stringify([{ code: 'X', members: null }, { name: 'no code' }]));
  assert.deepEqual(listGroups(), [{ code: 'X', members: {} }]);
});
