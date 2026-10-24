// The phone camera: a live preview in the page (getUserMedia), plus the file picker as a fallback
// for when there's no camera, the user said no, or the page isn't on https (or localhost).
// Every photo is shrunk to a JPEG the AI can read.

const REAR = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };

export const cameraSupported = () => !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia);

// Opens the rear camera. Resolves to a MediaStream, or throws an Error with a friendly message.
export async function startCamera() {
  if (!cameraSupported()) throw new Error('The camera needs the https link. Use the photo button instead.');
  try {
    return await navigator.mediaDevices.getUserMedia(REAR);
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
      throw new Error('Camera access is off. Allow it in your browser settings, or use the photo button.');
    }
    if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') throw new Error('No camera found. Use the photo button instead.');
    if (e.name === 'NotReadableError') throw new Error('Another app is using the camera. Close it and try again.');
    throw new Error("Couldn't start the camera. Use the photo button instead.");
  }
}

export const stopCamera = (stream) => stream?.getTracks().forEach((t) => t.stop());

// Asks for camera permission ahead of time (e.g. right after the welcome screen), so the
// scanner can open straight onto the live view. Does nothing if the answer is already known.
export async function askCameraOnce() {
  if (!cameraSupported()) return;
  try {
    const p = await navigator.permissions?.query({ name: 'camera' });
    if (p && p.state !== 'prompt') return;
  } catch { /* Safari before 16 can't query camera permission; just ask */ }
  try { stopCamera(await navigator.mediaDevices.getUserMedia(REAR)); } catch { /* the scanner explains it later */ }
}

// The current frame of a playing <video> as a photo.
export function grabFrame(video, max = 2048, quality = 0.85) {
  return toJpeg(video, video.videoWidth, video.videoHeight, max, quality);
}

// Must be called from a tap (browsers only open the picker inside a user gesture).
export function pickPhoto() {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

// Long side capped at 2048px keeps small receipt text readable and the upload well under the API's 5 MB image limit.
export async function shrink(file, max = 2048, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("Couldn't open that photo. Try a JPEG or PNG."));
      i.src = url;
    });
    return toJpeg(img, img.naturalWidth, img.naturalHeight, max, quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpeg(source, w, h, max, quality) {
  const k = Math.min(1, max / Math.max(w, h));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' };
}
