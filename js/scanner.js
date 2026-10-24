// The full-screen camera scanner. Opens from the big camera button, the planner's "Scan menu"
// and the split tab's "Scan receipt". It shows the live rear camera; the round button takes the
// photo, and the photo button picks one from the library (also the fallback when there's no camera).
// Screens register what to do with a result: onScanned('menu', (data, opts) => ...).
// For receipts, opts.even says whether to split the whole bill evenly between the group.
// A handler can return { title, body } to replace the "scanned!" toast.
import { scanMenu } from './ai/menu.js';
import { scanReceipt } from './ai/receipt.js';
import { grabFrame, pickPhoto, shrink, startCamera, stopCamera } from './camera.js';
import { $, toast } from './ui.js';

const handlers = {};
export const onScanned = (kind, fn) => { handlers[kind] = fn; };

// Remembered per phone: the last way this person chose to split a receipt.
const EVEN_KEY = 'split.evenSplit';
const loadEven = () => { try { return localStorage.getItem(EVEN_KEY) !== '0'; } catch { return true; } };
const saveEven = (on) => { try { localStorage.setItem(EVEN_KEY, on ? '1' : '0'); } catch { /* private mode */ } };

const LABEL = { menu: 'Scan menu', receipt: 'Scan receipt' };
const HINT = {
  menu: 'Fit the whole menu page in the frame',
  receipt: 'Flatten the receipt and fit every line in',
};

const modeBtn = (k, icon) => `
  <button data-act="mode" data-kind="${k}" aria-pressed="false"
    class="py-3 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 border transition-all active:scale-95">
    <i class="fa-solid ${icon}"></i><span>${LABEL[k]}</span>
  </button>`;

// The four corner marks that frame the page.
const corner = (pos, sides) => `<span class="absolute ${pos} w-8 h-8 ${sides} border-white/90 rounded-md"></span>`;

export function openScanner(kind = 'receipt') {
  let stream = null;
  let busy = false;
  let state = 'starting'; // starting | live | still | nocam
  let even = loadEven();

  const wrap = document.createElement('div');
  wrap.className = 'absolute inset-0 z-50 bg-black flex flex-col p-4 gap-3 safe-top safe-bottom animate-fade-in';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `
    <div class="flex justify-between items-center text-white">
      <button data-act="close" class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-base" aria-label="Close scanner"><i class="fa-solid fa-xmark"></i></button>
      <span id="scanTitle" class="font-display font-bold text-sm bg-white/20 px-4 py-1.5 rounded-full"></span>
      <span class="w-10 h-10" aria-hidden="true"></span>
    </div>
    <div class="relative flex-1 rounded-3xl overflow-hidden bg-neutral-900">
      <video id="scanVideo" class="absolute inset-0 w-full h-full object-cover" playsinline muted autoplay></video>
      <img id="scanStill" class="absolute inset-0 w-full h-full object-contain bg-black hidden" alt="Your photo">
      <div class="absolute top-5 left-5 right-5 bottom-20 pointer-events-none">
        ${corner('top-0 left-0', 'border-t-4 border-l-4')}${corner('top-0 right-0', 'border-t-4 border-r-4')}
        ${corner('bottom-0 left-0', 'border-b-4 border-l-4')}${corner('bottom-0 right-0', 'border-b-4 border-r-4')}
      </div>
      <div id="scanLaser" class="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-amberWarm-400 to-transparent shadow-lg animate-laser hidden"></div>
      <div class="absolute bottom-3 left-3 right-3 bg-black/70 backdrop-blur-md px-3 py-2.5 rounded-2xl text-center">
        <span id="scanStatus" class="text-sm text-white font-semibold leading-snug" aria-live="polite"></span>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-2">${modeBtn('menu', 'fa-book-open')}${modeBtn('receipt', 'fa-receipt')}</div>
    <div id="scanSplit" class="flex items-center gap-2 text-white">
      <span class="text-[11px] font-semibold text-white/70 shrink-0">Then split</span>
      <div class="flex-1 grid grid-cols-2 gap-1 p-1 rounded-2xl bg-white/10" role="group" aria-label="How to split the receipt">
        <button data-act="even" data-on="1" class="py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"><i class="fa-solid fa-equals"></i> Evenly</button>
        <button data-act="even" data-on="" class="py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"><i class="fa-solid fa-hand-pointer"></i> By item</button>
      </div>
    </div>
    <div class="grid grid-cols-3 items-center">
      <button data-act="pick" class="justify-self-start flex flex-col items-center gap-1 text-white text-xs font-semibold" aria-label="Choose a photo">
        <span class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-lg"><i class="fa-regular fa-image"></i></span>Photos
      </button>
      <button data-act="shoot" id="scanShoot" class="justify-self-center w-[72px] h-[72px] rounded-full bg-white ring-4 ring-white/40 ring-offset-4 ring-offset-black flex items-center justify-center text-espresso text-2xl active:scale-90 transition-all disabled:opacity-50"></button>
      <span></span>
    </div>`;
  $('#sheetRoot').appendChild(wrap);

  const video = $('#scanVideo', wrap);
  const still = $('#scanStill', wrap);
  const status = (text) => { $('#scanStatus', wrap).textContent = text; };

  // Everything that depends on the mode or state, without rebuilding the video element.
  const paint = () => {
    wrap.setAttribute('aria-label', LABEL[kind]);
    $('#scanTitle', wrap).textContent = LABEL[kind];
    wrap.querySelectorAll('[data-act="mode"]').forEach((b) => {
      const on = b.dataset.kind === kind;
      b.setAttribute('aria-pressed', on);
      b.classList.toggle('bg-white', on);
      b.classList.toggle('text-espresso', on);
      b.classList.toggle('border-white', on);
      b.classList.toggle('bg-white/10', !on);
      b.classList.toggle('text-white', !on);
      b.classList.toggle('border-white/40', !on);
    });
    $('#scanSplit', wrap).classList.toggle('hidden', kind !== 'receipt');
    wrap.querySelectorAll('[data-act="even"]').forEach((b) => {
      const on = !!b.dataset.on === even;
      b.setAttribute('aria-pressed', on);
      b.classList.toggle('bg-white', on);
      b.classList.toggle('text-espresso', on);
      b.classList.toggle('text-white', !on);
    });
    video.classList.toggle('hidden', state !== 'live' && state !== 'starting');
    still.classList.toggle('hidden', state !== 'still');
    $('#scanLaser', wrap).classList.toggle('hidden', !busy);
    const shoot = $('#scanShoot', wrap);
    shoot.disabled = busy || state === 'starting';
    shoot.innerHTML = busy ? '<i class="fa-solid fa-spinner fa-spin"></i>'
      : state === 'still' ? '<i class="fa-solid fa-rotate-right"></i>'
      : state === 'nocam' ? '<i class="fa-solid fa-camera"></i>' : '';
    shoot.setAttribute('aria-label', state === 'still' ? 'Retake' : 'Take photo');
  };

  const goLive = async () => {
    state = 'starting';
    status('Starting the camera…');
    paint();
    try {
      stream ??= await startCamera();
      if (!wrap.isConnected) return stopCamera(stream);
      video.srcObject = stream;
      await video.play().catch(() => {});
      state = 'live';
      status(HINT[kind]);
    } catch (e) {
      state = 'nocam';
      status(e.message);
    }
    paint();
  };

  const close = () => { stopCamera(stream); stream = null; wrap.remove(); };

  const run = async (photo) => {
    busy = true;
    if (photo) { still.src = photo.dataUrl; state = 'still'; }
    status(`Reading the ${kind}…`);
    paint();
    try {
      const data = kind === 'menu' ? await scanMenu(photo) : await scanReceipt(photo);
      close();
      const msg = await handlers[kind]?.(data, { even: kind === 'receipt' && even });
      toast(msg?.title ?? (kind === 'menu' ? 'Menu scanned!' : 'Receipt scanned!'),
        msg?.body ?? (data.demo ? 'Demo mode: sample data' : 'Check the items look right'), 'ok');
    } catch (e) {
      console.error(e);
      busy = false;
      status(`${e.message || 'Something went wrong.'} Tap ↻ to retake.`);
      paint();
    }
  };

  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') return close();
    if (busy) return;
    if (act === 'mode') {
      kind = btn.dataset.kind;
      if (state === 'live') status(HINT[kind]);
      paint();
    }
    if (act === 'even') {
      even = !!btn.dataset.on;
      saveEven(even);
      paint();
    }
    if (act === 'shoot' && state === 'live' && video.videoWidth) run(grabFrame(video));
    else if (act === 'shoot' && state === 'still') goLive();
    if (act === 'pick' || (act === 'shoot' && state === 'nocam')) {
      const file = await pickPhoto();
      if (!file) return;
      try {
        run(await shrink(file));
      } catch (err) {
        status(err.message);
      }
    }
  });

  paint();
  goLive();
}
