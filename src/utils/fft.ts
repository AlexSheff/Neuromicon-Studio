/**
 * Pure TypeScript in-place Cooley-Tukey Radix-2 FFT for deterministic
 * real-time and offline video-export frequency analysis.
 */
export class Radix2FFT {
  public readonly size: number;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly hannWindow: Float32Array;
  private readonly bitRev: Uint32Array;
  private readonly real: Float32Array;
  private readonly imag: Float32Array;

  constructor(size = 1024) {
    if ((size & (size - 1)) !== 0) {
      throw new Error('FFT size must be a power of 2');
    }
    this.size = size;
    const half = size >> 1;
    this.cosTable = new Float32Array(half);
    this.sinTable = new Float32Array(half);
    this.hannWindow = new Float32Array(size);
    this.bitRev = new Uint32Array(size);
    this.real = new Float32Array(size);
    this.imag = new Float32Array(size);

    for (let i = 0; i < half; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }

    for (let i = 0; i < size; i++) {
      this.hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }

    const bits = Math.log2(size) | 0;
    for (let i = 0; i < size; i++) {
      let x = i;
      let y = 0;
      for (let b = 0; b < bits; b++) {
        y = (y << 1) | (x & 1);
        x >>= 1;
      }
      this.bitRev[i] = y;
    }
  }

  /**
   * Computes normalized magnitude spectrum (length = size / 2) from windowed PCM samples.
   */
  public computeMagnitudes(samples: Float32Array, outMagnitudes: Float32Array): void {
    const n = this.size;
    const real = this.real;
    const imag = this.imag;

    for (let i = 0; i < n; i++) {
      const j = this.bitRev[i];
      real[j] = (i < samples.length ? samples[i] : 0) * this.hannWindow[i];
      imag[j] = 0;
    }

    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < halfLen; k++) {
          const tableIdx = k * step;
          const cos = this.cosTable[tableIdx];
          const sin = this.sinTable[tableIdx];
          const idx1 = i + k;
          const idx2 = idx1 + halfLen;
          const tRe = real[idx2] * cos - imag[idx2] * sin;
          const tIm = real[idx2] * sin + imag[idx2] * cos;
          real[idx2] = real[idx1] - tRe;
          imag[idx2] = imag[idx1] - tIm;
          real[idx1] += tRe;
          imag[idx1] += tIm;
        }
      }
    }

    const half = n >> 1;
    const scale = 2 / n;
    for (let i = 0; i < half; i++) {
      const re = real[i];
      const im = imag[i];
      const mag = Math.sqrt(re * re + im * im) * scale;
      outMagnitudes[i] = mag;
    }
  }
}
