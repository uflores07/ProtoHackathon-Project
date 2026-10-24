import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

// A tiny in-memory localStorage, since Node has none.
const data = new Map();
globalThis.localStorage = {
  getItem: (k) => (data.has(k) ? data.get(k) : null),
  setItem: (k, v) => data.set(k, String(v)),
  removeItem: (k) => data.delete(k),
};
const { getFriend, listFriends, removeFriend, saveFriend } = await import('../js/friends.js');

beforeEach(() => data.clear());

test('a new friend gets an id, a trimmed name, all three pay fields and a diet list', () => {
  const f = saveFriend({ name: '  Sam  ', pay: { email: ' sam@mail.com ' } });
  assert.match(f.id, /^f-/);
  assert.deepEqual(f, { id: f.id, name: 'Sam', pay: { email: 'sam@mail.com', paypal: '', venmo: '' }, diet: [] });
  assert.deepEqual(listFriends(), [f]);
  assert.deepEqual(getFriend(f.id), f);
  assert.equal(getFriend('nobody'), null);
});

test('saving with the same id updates in place and keeps the id', () => {
  const sam = saveFriend({ name: 'Sam' });
  const jo = saveFriend({ name: 'Jo' });
  const again = saveFriend({ id: sam.id, name: 'Sam M', pay: { venmo: 'sam-m' }, diet: ['vegan'] });
  assert.equal(again.id, sam.id);
  assert.deepEqual(listFriends().map((f) => f.name), ['Sam M', 'Jo']);
  assert.deepEqual(getFriend(sam.id), { id: sam.id, name: 'Sam M', pay: { email: '', paypal: '', venmo: 'sam-m' }, diet: ['vegan'] });
  assert.equal(getFriend(jo.id).name, 'Jo');
});

test('a group member saved as a friend keeps the member id', () => {
  const f = saveFriend({ id: 'abc123', name: 'Taylor', pay: { paypal: 'taylor' }, diet: ['halal'] });
  assert.equal(f.id, 'abc123');
  assert.equal(getFriend('abc123').pay.paypal, 'taylor');
});

test('remove drops only that friend', () => {
  const a = saveFriend({ name: 'A' });
  const b = saveFriend({ name: 'B' });
  removeFriend(a.id);
  assert.deepEqual(listFriends(), [b]);
  removeFriend('nobody');
  assert.deepEqual(listFriends(), [b]);
});

test('bad stored data is ignored instead of crashing', () => {
  for (const bad of ['not json{', '{"a":1}', '"text"', 'null', '[null, 5, {"name":"no id"}]']) {
    data.set('split.friends', bad);
    assert.deepEqual(listFriends(), [], bad);
  }
  data.set('split.friends', 'not json{');
  const f = saveFriend({ name: 'Fresh start' });
  assert.deepEqual(listFriends(), [f]);
});

test('broken saved entries are tidied instead of breaking Settings', () => {
  localStorage.setItem('split.friends', JSON.stringify([{ id: 'a', pay: null }, { id: 'b', diet: 'vegan', name: 7 }, { name: 'no id' }]));
  assert.deepEqual(listFriends(), [
    { id: 'a', name: '', pay: {}, diet: [] },
    { id: 'b', name: '7', pay: {}, diet: [] },
  ]);
});
