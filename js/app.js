// Starts the app: joins or creates a group, wires the header and nav, and shows the
// current tab. Each tab is its own module in js/screens/ exporting mount(root) and render(root, state).
import { demoMode, getApiKey, setApiKey, usingServerKey } from './ai/client.js';
import { hasMeal, saveMeal, wasDeleted } from './history.js';
import { current, go, onTab, TABS } from './router.js';
import { askCameraOnce } from './camera.js';
import { openScanner } from './scanner.js';
import * as group from './screens/group.js';
import * as ledger from './screens/ledger.js';
import * as planner from './screens/planner.js';
import * as split from './screens/split.js';
import { store } from './store.js';
import { $, cls, delegate, esc, sheet, toast } from './ui.js';

const screens = { group, planner, split, ledger };

function show(tab) {
  for (const t of TABS) {
    $(`#screen-${t}`).classList.toggle('hidden', t !== tab);
    $(`#screen-${t}`).classList.toggle('flex', t === tab);
    const nav = $(`#nav-${t}`);
    nav.classList.toggle('text-terracotta-500', t === tab);
    nav.classList.toggle('text-gray-400', t !== tab);
    if (t === tab) nav.setAttribute('aria-current', 'page');
    else nav.removeAttribute('aria-current');
  }
  $('#main').scrollTop = 0;
  render();
}

// Leaving a text box saves it (change -> dispatch -> re-render). If that re-render lands between
// the finger going down and the click, the button under the finger is replaced and the tap is lost.
// So while a tap is in progress, hold store-driven renders and run them once it finishes.
let tapping = false;
let queued = false;
let releaseTimer;
function release() {
  clearTimeout(releaseTimer);
  tapping = false;
  if (queued) { queued = false; render(); }
}
addEventListener('pointerdown', () => { tapping = true; clearTimeout(releaseTimer); }, true);
addEventListener('pointerup', () => { clearTimeout(releaseTimer); releaseTimer = setTimeout(release, 450); }, true);
addEventListener('pointercancel', () => setTimeout(release), true);
addEventListener('click', () => setTimeout(release), true); // runs after the click's own handlers
const renderSoon = () => { if (tapping) queued = true; else render(); };

function render() {
  const s = store.state;
  if (!s) return;
  const tab = current();
  screens[tab].render($(`#screen-${tab}`), s);
  $('#memberCount').textContent = Object.keys(s.members).length;
  $('#sessionCode').textContent = s.id;
  $('#groupName').textContent = s.name && s.name !== 'Our crew' ? s.name : 'Plan • Split • Settle';
  keepFinishedMeal(s);
}

// When anyone taps "Finish" on the split, every phone in the group saves the meal to its ledger.
function keepFinishedMeal(s) {
  const summary = s.receipt?.summary;
  if (!s.receipt?.finalizedAt || !summary || hasMeal(summary.id) || wasDeleted(summary.id)) return;
  // Paid marks can change after Finish, so save the current ones (and remember them for split.js's sync).
  const members = Object.fromEntries(Object.entries(summary.members ?? {}).map(([id, m]) => [id, { ...m, paid: id === summary.payerId || !!s.receipt.paid[id] }]));
  saveMeal({ ...summary, members, syncedPaid: { ...s.receipt.paid }, myId: store.me.id });
  toast('Saved to your ledger', `${summary.restaurant || 'Meal'} is in your history.`, 'ok');
}

const joinUrl = (code) => `${location.origin}${location.pathname}?s=${code}`;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function settingsSheet() {
  const me = store.me;
  const field = (id, label, value, attrs = '') => `
    <div><label for="${id}" class="${cls.label}">${label}</label>
    <input id="${id}" value="${esc(value)}" class="${cls.input}" ${attrs}></div>`;
  const { el, close } = sheet({
    title: 'Settings',
    subtitle: 'Saved on this phone',
    icon: 'fa-gear',
    body: `
      <form data-submit="save" class="flex flex-col gap-2.5">
        ${field('setName', 'Your name', me.name, 'required maxlength="24" autocomplete="given-name" placeholder="e.g. Alex"')}
        <p class="text-[9px] font-bold uppercase tracking-wider text-gray-400 pt-1">How friends pay you back (optional)</p>
        ${field('setEmail', 'Interac e-Transfer email', me.pay?.email, 'type="email" autocomplete="email" placeholder="you@email.com"')}
        <div class="grid grid-cols-2 gap-2">
          ${field('setPaypal', 'PayPal.me name', me.pay?.paypal, 'placeholder="yourname"')}
          ${field('setVenmo', 'Venmo name', me.pay?.venmo, 'placeholder="your-name"')}
        </div>
        <p class="text-[9px] font-bold uppercase tracking-wider text-gray-400 pt-1">AI (reads menus and receipts)</p>
        ${field('setKey', 'Gemini API key', getApiKey(), 'type="password" autocomplete="off" placeholder="From aistudio.google.com"')}
        <p class="text-[9px] text-gray-500 leading-snug">${demoMode()
          ? '<b>Demo mode:</b> no key yet, so scans and searches use sample data. Only the person scanning needs a key.'
          : usingServerKey()
            ? '<b>Gemini is on</b> with the app\'s built-in key. Leave this blank to keep using it.'
            : '<b>Gemini is on.</b> The key stays on this phone and is only sent to Google.'}</p>
        <p class="text-[9px] text-gray-500 leading-snug"><b>Sync:</b> ${store.synced
          ? 'phones in your group update live.'
          : 'this device only. Add a Firebase config in js/config.js to sync phones (see TEAM.md).'}</p>
        ${standalone() ? '' : `<div class="p-2.5 rounded-2xl bg-orange-50 border border-orange-100 text-[10px] text-espresso leading-snug">
          <b><i class="fa-solid fa-mobile-screen"></i> Put Split on your home screen</b><br>
          iPhone (Safari): Share <i class="fa-solid fa-arrow-up-from-bracket"></i>, then <b>Add to Home Screen</b>.<br>
          Android (Chrome): <b>⋮</b>, then <b>Install app</b>.</div>`}
        <button class="${cls.btn}"><i class="fa-solid fa-check"></i> Save</button>
      </form>`,
  });
  delegate(el, {
    save: async () => {
      const name = $('#setName', el).value.trim();
      if (!name) return;
      setApiKey($('#setKey', el).value);
      close();
      await store.saveMe({ name, pay: { email: $('#setEmail', el).value.trim(), paypal: $('#setPaypal', el).value.trim(), venmo: $('#setVenmo', el).value.trim() } });
      toast('Saved', demoMode() ? 'Demo mode until you add an API key.' : 'Gemini is ready to read photos.');
      render();
    },
  });
}

// First run: a full-screen sign-in (no password). Your name is what friends see in the group,
// and the e-Transfer email is where they send your share.
function welcomeScreen() {
  const me = store.me;
  const input = (id, icon, label, value, attrs) => `
    <label for="${id}" class="block">
      <span class="block text-xs font-bold text-gray-500 mb-1.5">${label}</span>
      <span class="relative block">
        <i class="fa-solid ${icon} absolute left-4 top-1/2 -translate-y-1/2 text-terracotta-400"></i>
        <input id="${id}" value="${esc(value)}" required ${attrs}
          class="w-full bg-gray-50 border-2 border-gray-200 rounded-2xl py-3.5 pl-11 pr-4 text-base font-semibold text-espresso placeholder:text-gray-300 placeholder:font-medium focus:outline-none focus:border-terracotta-400 focus:bg-white transition-all">
      </span>
    </label>`;
  const wrap = document.createElement('div');
  wrap.className = 'absolute inset-0 z-[70] bg-creamBg flex flex-col overflow-y-auto no-scrollbar animate-fade-in';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'Sign in to Split');
  wrap.innerHTML = `
    <div class="relative shrink-0 min-h-[38%] bg-gradient-to-br from-terracotta-600 via-amberWarm-600 to-terracotta-700 text-white flex flex-col items-center justify-center gap-3 px-6 pt-10 pb-14 safe-top overflow-hidden">
      <img src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop&q=80" class="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-overlay" alt="">
      <img src="icons/icon.svg" class="relative w-20 h-20 rounded-[22px] shadow-lg ring-2 ring-white/40" alt="">
      <h1 class="relative font-display font-extrabold text-4xl tracking-tight drop-shadow-xs">Split</h1>
      <p class="relative text-sm font-semibold text-amber-100 text-center">Plan the order. Split the bill fairly.</p>
    </div>
    <form class="relative -mt-8 flex-1 bg-white rounded-t-[32px] px-6 pt-7 pb-6 flex flex-col gap-5 safe-bottom shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
      <div>
        <h2 class="font-display font-extrabold text-2xl text-espresso">Sign in</h2>
        <p class="text-sm text-gray-500 mt-1 leading-snug">No password needed. Your friends see your name and send your share to your e-Transfer email.</p>
      </div>
      ${input('welcomeName', 'fa-user', 'Your name', me.name, 'maxlength="24" autocomplete="given-name" autocapitalize="words" placeholder="e.g. Alex"')}
      ${input('welcomeEmail', 'fa-envelope', 'Interac e-Transfer email', me.pay?.email, 'type="email" autocomplete="email" inputmode="email" placeholder="you@email.com"')}
      <button class="mt-1 w-full py-4 rounded-2xl bg-terracotta-500 hover:bg-terracotta-600 text-white font-bold text-base shadow-md active:scale-98 transition-all flex items-center justify-center gap-2">
        Continue <i class="fa-solid fa-arrow-right"></i>
      </button>
      <p class="mt-auto text-xs text-gray-400 text-center"><i class="fa-solid fa-lock"></i> Saved only on this phone. Change it any time in Settings.</p>
    </form>`;
  $('#sheetRoot').appendChild(wrap);
  $('form', wrap).addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#welcomeName', wrap).value.trim();
    const email = $('#welcomeEmail', wrap).value.trim();
    if (!name || !email) return;
    // Ask for the camera now, so the scanner can open straight onto the live view later.
    askCameraOnce();
    wrap.remove();
    await store.saveMe({ name, pay: { email } });
    toast(`Welcome, ${name}!`, 'Start a group or scan a menu.', 'ok');
    render();
  });
  $('#welcomeName', wrap).focus();
}

async function peopleSheet() {
  const s = store.state;
  const url = joinUrl(s.id);
  const { el, close } = sheet({
    title: 'Invite your group',
    subtitle: `${Object.keys(s.members).length} in ${s.name}`,
    icon: 'fa-user-group',
    body: `
      ${store.synced ? '' : `<div class="p-2.5 rounded-2xl bg-amberWarm-100 text-amberWarm-800 text-[10px] font-semibold leading-snug">
        <i class="fa-solid fa-triangle-exclamation"></i> Phones won't sync yet: Split is running on this device only.
        Add your Firebase config to js/config.js (TEAM.md, Person 4). Other tabs in this browser still sync.</div>`}
      <div class="flex flex-col items-center gap-1.5">
        <div id="qr" class="w-44 h-44 bg-white rounded-2xl border border-gray-100 p-2 flex items-center justify-center text-[10px] text-gray-400">Loading QR…</div>
        <p class="text-[9px] text-gray-400">Scan with the phone camera, or enter the code in Split</p>
        <p class="font-display font-extrabold text-2xl tracking-[0.3em] text-espresso">${esc(s.id)}</p>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button data-click="share" class="${cls.btn}"><i class="fa-solid fa-share-nodes"></i> Share link</button>
        <button data-click="copy" class="${cls.btnGhost}"><i class="fa-regular fa-copy"></i> Copy link</button>
      </div>
      <div><label for="groupNameInput" class="${cls.label}">Group name</label>
        <input id="groupNameInput" data-change="rename" value="${esc(s.name)}" maxlength="30" class="${cls.input}"></div>
      <form data-submit="join" class="flex gap-2 items-end">
        <div class="flex-1"><label for="joinCode" class="${cls.label}">Join another group</label>
          <input id="joinCode" placeholder="CODE" maxlength="5" autocapitalize="characters" class="${cls.input} uppercase tracking-widest"></div>
        <button class="px-3 py-2 rounded-xl bg-espresso text-white font-bold text-xs">Join</button>
      </form>
      <div class="grid grid-cols-2 gap-2">
        <button data-click="newMeal" class="${cls.btnGhost}"><i class="fa-solid fa-rotate"></i> New meal</button>
        <button data-click="newGroup" class="${cls.btnGhost}"><i class="fa-solid fa-plus"></i> New group</button>
      </div>`,
  });
  delegate(el, {
    share: async () => {
      if (navigator.share) await navigator.share({ title: 'Join my Split group', text: `Join "${s.name}" on Split (code ${s.id})`, url }).catch(() => {});
      else navigator.clipboard.writeText(url).then(() => toast('Link copied', url));
    },
    copy: () => navigator.clipboard.writeText(url).then(() => toast('Link copied', url)),
    rename: (input) => input.value.trim() && store.dispatch({ type: 'session/rename', name: input.value.trim() }),
    join: async () => {
      const c = $('#joinCode', el).value.trim().toUpperCase();
      if (!c) return;
      if (await store.open(c)) { close(); toast('Joined!', `You're in ${store.state.name}.`); render(); }
      else toast('No group with that code', 'Check the code and try again.', 'warn');
    },
    newMeal: () => {
      if (!confirm('Start a new meal with the same people? This clears the plan and the receipt.')) return;
      store.dispatch({ type: 'session/newMeal' });
      close();
      go('group');
    },
    newGroup: async () => {
      if (!confirm('Start a brand new group?')) return;
      await store.create();
      close();
      go('group');
      toast('New group', `Code ${store.code}`);
    },
  });
  try {
    const { default: qrcode } = await import('https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.mjs');
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('#qr', el).innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch {
    $('#qr', el).textContent = 'QR needs internet';
  }
}

async function boot() {
  for (const [tab, mod] of Object.entries(screens)) mod.mount?.($(`#screen-${tab}`));
  delegate(document.body, {
    tab: (el) => go(el.dataset.tab),
    scan: () => openScanner(current() === 'planner' ? 'menu' : 'receipt'),
    people: () => store.state && peopleSheet(),
    settings: () => settingsSheet(),
  });
  store.subscribe(renderSoon);
  onTab(show);

  const params = new URLSearchParams(location.search);
  const joining = params.get('s')?.trim().toUpperCase();
  let ok = false;
  try {
    if (joining) {
      ok = await store.open(joining);
      if (!ok) toast('Group not found', `No group with code ${joining}, so we started a new one.`, 'warn');
      history.replaceState(null, '', location.pathname + location.hash);
    }
    if (!ok && store.lastCode()) ok = await store.open(store.lastCode());
    if (!ok) await store.create();
  } catch (e) {
    console.error(e);
    toast("Couldn't start", e.message, 'warn');
  }
  show(current());
  if (!store.me.name) welcomeScreen();

  // Offline copy for phones. Skipped on localhost so code changes show up on reload while you work.
  if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    navigator.serviceWorker.register('sw.js');
  }
}

boot();
