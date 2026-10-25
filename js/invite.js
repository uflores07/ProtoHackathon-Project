// The invite sheet: QR code, the group code, share/copy the join link, the group name, join another
// group, new meal and new group. Opened from the header's people button and code chip, and the Group tab's gear.
import { go } from './router.js';
import { store } from './store.js';
import { $, cls, delegate, esc, sheet, toast } from './ui.js';

const joinUrl = (code) => `${location.origin}${location.pathname}?s=${code}`;

// Open another group. A failed store.open() has already dropped the live link to the current group,
// so this reconnects to it; otherwise the app would stop updating after a mistyped code.
export async function switchGroup(code) {
  const was = store.code;
  if (await store.open(code)) return true;
  if (was) await store.open(was);
  return false;
}

export async function openInvite() {
  const s = store.state;
  if (!s) return;
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
      if (await switchGroup(c)) { close(); toast('Joined!', `You're in ${store.state.name}.`); }
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
