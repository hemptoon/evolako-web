// A photo as it leaves the browser: drawn to a canvas and encoded again as JPEG — the longest side within a limit,
// the file within a size, and no EXIF (location, device): only pixels are sent.

async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/jpeg", quality);
  });
}

/** JPEG with the longest side ≤ `maxSide` and at most `maxBytes`: the quality goes down, then the size, until it fits. */
export async function prepareJpeg(file: Blob, maxSide: number, maxBytes: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    let side = maxSide;
    for (;;) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.8, 0.7, 0.6, 0.5]) {
        const blob = await encode(canvas, quality);
        if (blob.size <= maxBytes) return blob;
      }
      if (side <= 640) return encode(canvas, 0.4);
      side = Math.round(side * 0.75);
    }
  } finally {
    bitmap.close();
  }
}
