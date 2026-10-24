// The full-screen camera scanner from the prototype. Opens from the big camera button,
// the planner's "Scan menu" and the split tab's "Scan receipt".
// Screens register what to do with a result: onScanned('menu', (data) => ...).
import { demoMode } from './ai/client.js';
import { scanMenu } from './ai/menu.js';
import { scanReceipt } from './ai/receipt.js';
import { pickPhoto, shrink } from './camera.js';
import { $, esc, toast } from './ui.js';

const handlers = {};
export const onScanned = (kind, fn) => { handlers[kind] = fn; };

const SAMPLE_PHOTO = {
  menu: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&auto=format&fit=crop&q=80',
  receipt: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80',
};
const LABEL = { menu: 'Menu Scanner', receipt: 'Receipt Scanner' };
const HINT = {
  menu: 'Fit the whole menu page in the photo',
  receipt: 'Flatten the receipt and fit every line in',
};

export function openScanner(kind = 'receipt') {
  let busy = false;
  const wrap = document.createElement('div');
  wrap.className = 'absolute inset-0 z-50 bg-black flex flex-col justify-between p-4 safe-top safe-bottom animate-fade-in';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  $('#sheetRoot').appendChild(wrap);

  const draw = (photoUrl, status, processing = false) => {
    wrap.setAttribute('aria-label', LABEL[kind]);
    wrap.innerHTML = `
      <div class="flex justify-between items-center text-white z-10">
        <button data-act="close" class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs" aria-label="Close scanner"><i class="fa-solid fa-xmark"></i></button>
        <span class="font-display font-bold text-xs bg-white/20 px-3 py-1 rounded-full uppercase tracking-wider">${LABEL[kind]}</span>
        <span class="w-8 h-8 rounded-full ${demoMode() ? 'bg-sky-500/40' : 'bg-sage-500/40'} flex items-center justify-center text-[10px]" title="${demoMode() ? 'Demo mode: sample data' : 'Gemini Vision'}">
          <i class="fa-solid ${demoMode() ? 'fa-flask' : 'fa-wand-magic-sparkles'}"></i>
        </span>
      </div>
      <div class="relative flex-1 my-3 rounded-3xl overflow-hidden border-2 border-dashed border-white/40 flex items-center justify-center">
        <img src="${esc(photoUrl || SAMPLE_PHOTO[kind])}" class="w-full h-full ${photoUrl ? 'object-contain' : 'object-cover opacity-60'}" alt="">
        <div class="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-amberWarm-400 to-transparent shadow-lg animate-laser ${processing ? '' : 'hidden'}"></div>
        <div class="absolute bottom-3 left-3 right-3 bg-black/60 backdrop-blur-md p-2 rounded-2xl border border-white/20 text-center">
          <span class="text-[10px] text-white font-bold" aria-live="polite">${esc(status)}</span>
        </div>
      </div>
      <div class="flex flex-col gap-2 z-10">
        <div class="flex justify-center gap-2 bg-white/10 backdrop-blur-md p-1 rounded-full text-[10px] font-bold text-white">
          <button data-act="mode" data-kind="menu" class="px-3 py-1 rounded-full ${kind === 'menu' ? 'bg-terracotta-500' : 'text-white/80'}">1. Scan Menu</button>
          <button data-act="mode" data-kind="receipt" class="px-3 py-1 rounded-full ${kind === 'receipt' ? 'bg-terracotta-500' : 'text-white/80'}">2. Scan Receipt</button>
        </div>
        <button data-act="capture" ${processing ? 'disabled' : ''} class="w-full py-3 rounded-2xl bg-gradient-to-r from-terracotta-500 to-amberWarm-500 text-white font-extrabold text-xs shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60">
          <i class="fa-solid ${processing ? 'fa-spinner fa-spin' : 'fa-camera'}"></i>
          <span>${processing ? 'Reading with Vision AI…' : 'Take or Choose Photo'}</span>
        </button>
        ${demoMode() && !processing ? `<button data-act="sample" class="text-[10px] text-white/70 font-bold py-1">No API key yet. Tap to use the sample ${kind}.</button>` : ''}
      </div>`;
  };

  const run = async (photo) => {
    busy = true;
    draw(photo?.dataUrl, `Reading the ${kind}…`, true);
    try {
      const data = kind === 'menu' ? await scanMenu(photo) : await scanReceipt(photo);
      wrap.remove();
      await handlers[kind]?.(data);
      toast(kind === 'menu' ? 'Menu scanned!' : 'Receipt scanned!', data.demo ? 'Demo mode: sample data' : 'Check the items look right', 'ok');
    } catch (e) {
      console.error(e);
      busy = false;
      draw(photo?.dataUrl, e.message || 'Something went wrong. Try again.');
    }
  };

  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || busy) return;
    const act = btn.dataset.act;
    if (act === 'close') wrap.remove();
    if (act === 'mode') { kind = btn.dataset.kind; draw(null, HINT[kind]); }
    if (act === 'sample') run(null);
    if (act === 'capture') {
      const file = await pickPhoto();
      if (!file) return;
      try {
        run(await shrink(file));
      } catch (err) {
        draw(null, err.message);
      }
    }
  });

  draw(null, HINT[kind]);
}
