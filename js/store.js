// The one place screens read the shared session from and send changes to.
//   store.state       current session (normalized, see reducer.js for the shape)
//   store.me          this phone's person: { id, name, pay: { email, paypal, venmo }, prefs }
//   store.dispatch()  send an action to every phone in the group
//   store.subscribe() get called after every change
import { FIREBASE_CONFIG } from './config.js';
import { initialState, normalize } from './reducer.js';
import * as local from './sync/local.js';
import { toast, uid } from './ui.js';

const ME = 'split.me';
const LAST = 'split.lastSession';
const listeners = new Set();
let transport = null;
let state = null;
let code = null;

const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
let me = { id: uid(), name: '', pay: {}, prefs: {}, ...load(ME) };
localStorage.setItem(ME, JSON.stringify(me));

// The fields of `me` that other people see in the session.
const asMember = (m) => ({ id: m.id, name: m.name, pay: m.pay, ...m.prefs });

async function getTransport() {
  if (transport) return transport;
  if (FIREBASE_CONFIG) {
    try {
      const fb = await import('./sync/firebase.js');
      await fb.init(FIREBASE_CONFIG);
      return (transport = fb);
    } catch (e) {
      console.error('Firebase failed to start, using this device only', e);
      toast('Sync is off', 'Could not reach Firebase. Using this device only.', 'warn');
    }
  }
  return (transport = local);
}

// Session codes skip look-alike characters (0/O, 1/I/L) so they're easy to read out.
const newCode = () => {
  const a = new Uint8Array(5);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
};

export const store = {
  get state() { return state; },
  get me() { return me; },
  get code() { return code; },
  // true when phones sync through Firebase, false when it's this device only.
  get synced() { return transport != null && transport !== local; },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // Join an existing session. Resolves false if the code doesn't exist.
  async open(c) {
    const t = await getTransport();
    t.close();
    const found = await t.connect(c, (s) => {
      state = normalize(s);
      listeners.forEach((fn) => fn(state));
    });
    if (!found) return false;
    code = c;
    localStorage.setItem(LAST, c);
    if (me.name && !state.members[me.id]) await store.dispatch({ type: 'member/join', member: asMember(me) });
    return true;
  },

  async create() {
    const t = await getTransport();
    const c = newCode();
    await t.create(c, initialState(c, Date.now()));
    await store.open(c);
    return c;
  },

  lastCode: () => localStorage.getItem(LAST),

  async dispatch(action) {
    if (!code) return;
    try {
      await transport.dispatch(code, { ...action, at: Date.now() });
    } catch (e) {
      console.error(action, e);
      toast("Couldn't save that", e.message, 'warn');
    }
  },

  // Update this phone's person (name, payment handles, preferences) everywhere.
  async saveMe(patch) {
    me = { ...me, ...patch, pay: { ...me.pay, ...patch.pay }, prefs: { ...me.prefs, ...patch.prefs } };
    localStorage.setItem(ME, JSON.stringify(me));
    if (!state) return;
    if (state.members[me.id]) await store.dispatch({ type: 'member/update', id: me.id, patch: asMember(me) });
    else if (me.name) await store.dispatch({ type: 'member/join', member: asMember(me) });
  },
};
