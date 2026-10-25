// Starts the app: joins or creates a group, wires the header and nav, and shows the
// current tab. Each tab is its own module in js/screens/ exporting mount(root) and render(root, state).
import { hasMeal, saveMeal, wasDeleted } from './history.js';
import { current, go, onTab, TABS } from './router.js';
import { askCameraOnce } from './camera.js';
import { openInvite } from './invite.js';
import { openScanner } from './scanner.js';
import * as group from './screens/group.js';
import * as ledger from './screens/ledger.js';
import * as planner from './screens/planner.js';
import { openSettings } from './screens/settings.js';
import * as split from './screens/split.js';
import { store } from './store.js';
import './theme.js'; // applies the saved light/dark choice and follows the phone's setting
import { $, delegate, esc, toast } from './ui.js';

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

async function boot() {
  // Settings no longer takes an AI key (the team's Worker holds it). A key saved by the old Settings
  // would override the Worker with no way to change it, so drop it.
  try { localStorage.removeItem('split.geminiKey'); } catch { /* storage blocked: nothing saved anyway */ }
  for (const [tab, mod] of Object.entries(screens)) mod.mount?.($(`#screen-${tab}`));
  delegate(document.body, {
    tab: (el) => go(el.dataset.tab),
    scan: () => openScanner(current() === 'planner' ? 'menu' : 'receipt'),
    people: openInvite,
    settings: () => openSettings({ onClose: render }),
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
  // A reload with Settings open leaves its extra history entry behind; drop it so Back works.
  if (history.state?.settings) history.replaceState(null, '');

  // Offline copy for phones. Skipped on localhost so code changes show up on reload while you work.
  if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    navigator.serviceWorker.register('sw.js');
  }
}

boot();
