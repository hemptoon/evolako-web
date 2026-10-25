// IPS QR as vector: Nayuki's generator (MIT), error correction level M, byte mode UTF-8 (tag C:1).
// The code is drawn as one SVG path of horizontal runs — crisp at any zoom and in the printed PDF
// (the app draws the PDF the same way, QRModulesShape).
import { qrcodegen } from "./qrcodegen";

export interface QrMatrix {
  /** Modules per side, without the quiet zone. */
  size: number;
  /** Row-major, true = dark. */
  dark: boolean[];
}

/** Encodes text at exactly level M (no automatic boost), smallest version that fits. */
export function encodeQr(text: string): QrMatrix {
  const QrCode = qrcodegen.QrCode;
  const segments = qrcodegen.QrSegment.makeSegments(text);
  const code = QrCode.encodeSegments(segments, QrCode.Ecc.MEDIUM, 1, 40, -1, false);
  const dark: boolean[] = [];
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) dark.push(code.getModule(x, y));
  }
  return { size: code.size, dark };
}

/** Error correction level actually used, for tests: 0 = L, 1 = M, 2 = Q, 3 = H. */
export function encodedEccOrdinal(text: string): number {
  const QrCode = qrcodegen.QrCode;
  const code = QrCode.encodeSegments(qrcodegen.QrSegment.makeSegments(text), QrCode.Ecc.MEDIUM, 1, 40, -1, false);
  return code.errorCorrectionLevel.ordinal;
}

/** SVG path data for the dark modules, offset by the quiet zone; one rectangle per horizontal run. */
export function qrPath(matrix: QrMatrix, quiet = 4): string {
  const parts: string[] = [];
  const { size, dark } = matrix;
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!dark[y * size + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && dark[y * size + x]) x++;
      parts.push(`M${start + quiet} ${y + quiet}h${x - start}v1h${start - x}z`);
    }
  }
  return parts.join("");
}

/** Rasterises the matrix into RGBA pixels — used by tests to decode the code back (jsQR). */
export function rasterize(matrix: QrMatrix, scale = 4, quiet = 4): { data: Uint8ClampedArray; width: number } {
  const width = (matrix.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.dark[y * matrix.size + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y + quiet) * scale + dy) * width + (x + quiet) * scale + dx;
          data[px * 4] = 11;
          data[px * 4 + 1] = 18;
          data[px * 4 + 2] = 32;
        }
      }
    }
  }
  return { data, width };
}
