// The Group tab's gear: the group's name, invite, live sync, new meal, the groups you're in
// (tap one to switch), join by code, a new group, and leaving this group.
import { forgetGroup, listGroups } from '../groups.js';
import { openInvite, switchGroup } from '../invite.js';
import { go } from '../router.js';
import { store } from '../store.js';
import { $, cls, delegate, esc, sheet, toast } from '../ui.js';

const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;
const chevron = '<i class="fa-solid fa-chevron-right text-[10px] text-gray-300 shrink-0"></i>';

// label, sub and value are HTML: esc() anything a person typed. A row with `click` is a button.
function row({ icon, tint = 'bg-terracotta-100 text-terracotta-600', label, sub = '', value = '', click = '', attrs = '' }) {
  const inner = `<span class="w-8 h-8 shrink-0 rounded-xl ${tint} flex items-center justify-center text-xs"><i class="fa-solid ${icon}"></i></span>
    <span class="flex-1 min-w-0">
      <span class="block text-xs font-bold text-espresso truncate">${label}</span>
      ${sub ? `<span class="block text-[10px] text-gray-500 leading-snug">${sub}</span>` : ''}
    </span>
    ${value ? `<span class="text-[10px] font-semibold text-gray-500 truncate max-w-[45%]">${value}</span>` : ''}`;
  const look = 'w-full min-h-[3.25rem] flex items-center gap-3 px-3.5 py-2.5 text-left';
  return click
    ? `<button type="button" data-click="${click}" ${attrs} class="${look} hover:bg-orange-50/60 active:bg-orange-50 transition-colors">${inner}${chevron}</button>`
    : `<div class="${look}">${inner}</div>`;
}
const list = (rows) => `<div class="bg-white rounded-3xl border border-orange-100 shadow-sm overflow-hidden divide-y divide-gray-100">${rows.join('')}</div>`;

export function openGroupSettings() {
  const s = store.state;
  if (!s) return;

  // The open group first, then the others newest first.
  const groups = listGroups().filter((g) => g.code !== s.id);
  const groupRows = [{ code: s.id, name: s.name, members: s.members }, ...groups].map((g) => {
    const here = g.code === s.id;
    return row({
      icon: here ? 'fa-location-dot' : 'fa-user-group',
      tint: here ? 'bg-sage-100 text-sage-600' : 'bg-amberWarm-100 text-amberWarm-600',
      label: esc(g.name || 'Unnamed group'),
      sub: `${people(Object.keys(g.members).length)} • ${esc(g.code)}`,
      value: here ? '<span class="text-sage-600 font-bold">You\'re here</span>' : '',
      click: here ? '' : 'switch',
      attrs: here ? '' : `data-code="${esc(g.code)}"`,
    });
  });

  const { el, close } = sheet({
    title: s.name || 'Group settings',
    subtitle: `${people(Object.keys(s.members).length)} • Code ${s.id}`,
    icon: 'fa-gear',
    body: `
      <div><label for="gsName" class="${cls.label}">Group name</label>
        <input id="gsName" data-change="rename" value="${esc(s.name)}" maxlength="30" class="${cls.input}"></div>
      ${list([
        row({ icon: 'fa-qrcode', label: 'Invite people', sub: 'QR code, link or code', value: `<span class="font-display font-extrabold tracking-widest text-espresso">${esc(s.id)}</span>`, click: 'invite' }),
        row({ icon: 'fa-tower-broadcast', tint: 'bg-sage-100 text-sage-600', label: 'Live sync', value: store.synced ? 'Live between phones' : 'This phone only' }),
        row({ icon: 'fa-rotate', tint: 'bg-amberWarm-100 text-amberWarm-600', label: 'Start a new meal', sub: 'Same people, fresh plan and receipt', click: 'newMeal' }),
      ])}
      <div><h4 class="${cls.label}">Your groups</h4>${list(groupRows)}</div>
      <form data-submit="join" class="flex gap-2 items-end">
        <div class="flex-1"><label for="gsJoin" class="${cls.label}">Join a group by code</label>
          <input id="gsJoin" placeholder="CODE" maxlength="5" autocapitalize="characters" autocomplete="off" class="${cls.input} uppercase tracking-widest"></div>
        <button class="px-3 py-2 rounded-xl bg-espresso text-white font-bold text-xs">Join</button>
      </form>
      <button type="button" data-click="newGroup" class="${cls.btnGhost}"><i class="fa-solid fa-plus"></i> Start a new group</button>
      <button type="button" data-click="leave" class="w-full py-2.5 rounded-2xl bg-terracotta-50 border border-terracotta-200 text-terracotta-700 font-bold text-xs active:scale-98 transition-all flex items-center justify-center gap-1.5">
        <i class="fa-solid fa-right-from-bracket"></i> Leave this group</button>`,
  });

  const opened = (ok, title) => {
    if (!ok) { toast('No group with that code', 'Check the code and try again.', 'warn'); return; }
    close();
    go('group');
    toast(title, `You're in ${store.state.name}.`);
  };

  delegate(el, {
    rename: (input) => {
      const name = input.value.trim();
      if (!name) { input.value = store.state?.name ?? ''; return; }
      store.dispatch({ type: 'session/rename', name });
      el.parentElement.querySelector('h3').textContent = name; // the sheet's title
    },
    invite: () => { close(); openInvite(); },
    newMeal: () => {
      if (!confirm('Start a new meal with the same people? This clears the plan and the receipt.')) return;
      store.dispatch({ type: 'session/newMeal' });
      close();
      go('group');
      toast('New meal', 'Same group, fresh start.');
    },
    switch: async (btn) => {
      const ok = await switchGroup(btn.dataset.code);
      if (!ok && store.synced) { forgetGroup(btn.dataset.code); close(); } // it's gone from the database
      opened(ok, 'Switched groups');
    },
    join: async () => {
      const c = $('#gsJoin', el).value.trim().toUpperCase();
      if (!c) return;
      if (c === store.code) { toast("You're already in this group", '', 'info'); return; }
      opened(await switchGroup(c), 'Joined!');
    },
    newGroup: async () => {
      if (!confirm('Start a brand new group?')) return;
      await store.create();
      close();
      go('group');
      toast('New group', `Code ${store.code}`);
    },
    leave: async () => {
      const name = store.state?.name || 'this group';
      const r = store.state?.receipt;
      const onBill = r && !r.finalizedAt && (r.payerId === store.me.id || Object.values(r.claims).some((who) => who[store.me.id]));
      const warn = onBill ? ' Your claimed items and payer role on the unfinished bill will be cleared for everyone.' : '';
      if (!confirm(`Leave ${name}? You'll be taken out of it on every phone, and it's removed from your groups here. You can rejoin with its code.${warn}`)) return;
      close();
      await store.leave();
      go('group');
      toast(`You left ${name}`, `You're in ${store.state?.name ?? 'a new group'} now.`);
    },
  });
}
