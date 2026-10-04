// OCR upload preparation only. Never replace the original preview/share File.
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const TARGET_BYTES = 3.5 * 1024 * 1024;
const QUALITIES = [0.92, 0.85, 0.75, 0.65];

export async function prepareReceiptImage(image, {signal} = {}) {
  const checkCancelled = () => {
    if (signal?.aborted) throw new Error('IMAGE_PREPARATION_CANCELLED');
  };
  checkCancelled();
  if (!(image instanceof Blob) || !image.size || !['image/jpeg','image/png'].includes(image.type)) {
    throw new Error('IMAGE_ADJUSTMENT_FAILED');
  }
  if (image.size <= MAX_INPUT_BYTES) return image;

  let bitmap;
  let canvas;
  try {
    bitmap = await createImageBitmap(image);
    checkCancelled();
    if (!bitmap.width || !bitmap.height) throw new Error('IMAGE_ADJUSTMENT_FAILED');
    canvas = document.createElement('canvas');
    let width = bitmap.width;
    let height = bitmap.height;
    // Keep original dimensions first, then at most eight reductions. Do not
    // shrink the longest edge below 1280px just to force an unreadable upload.
    for (let step = 0; step <= 8; step++) {
      checkCancelled();
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('IMAGE_ADJUSTMENT_FAILED');
      // Receipt transparency is not needed: composite it onto white, not black.
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of QUALITIES) {
        checkCancelled();
        // Canvas creates new pixels/encoding; source EXIF/GPS is not copied.
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        checkCancelled();
        if (!blob || blob.type !== 'image/jpeg' || !blob.size) throw new Error('IMAGE_ADJUSTMENT_FAILED');
        if (blob.size <= TARGET_BYTES) return blob;
      }
      const longest = Math.max(width, height);
      if (longest <= 1280) break;
      const scale = Math.max(0.8, 1280 / longest);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    throw new Error('IMAGE_ADJUSTMENT_FAILED');
  } finally {
    bitmap?.close();
    // Release decoded/canvas memory, including on cancellation or failure.
    if (canvas) {canvas.width = 0;canvas.height = 0;}
  }
}
