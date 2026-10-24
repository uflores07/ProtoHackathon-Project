// Take or choose a photo, then shrink it to a JPEG the AI can read.
// A file input works the same on iPhone and Android: it offers the camera or the photo library.

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
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = Object.assign(document.createElement('canvas'), {
      width: Math.round(img.naturalWidth * k),
      height: Math.round(img.naturalHeight * k),
    });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}
