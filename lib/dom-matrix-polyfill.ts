/**
 * A minimal 2D `DOMMatrix` for the server. pdfjs (inside pdf-parse) expects the
 * browser's DOMMatrix and, in Node, borrows one from the native @napi-rs/canvas
 * package — which a serverless bundle (Vercel) may not ship, and then the module
 * throws `DOMMatrix is not defined` while loading. Text extraction never renders,
 * so a plain 2D affine matrix is all it needs. Installed only when nothing else
 * provides a DOMMatrix (see installDomMatrixPolyfill).
 */

type Init = number[] | Float32Array | Float64Array | string | undefined;

class DOMMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: Init) {
    if (Array.isArray(init) || ArrayBuffer.isView(init)) {
      const v = Array.from(init as ArrayLike<number>);
      if (v.length === 6) [this.a, this.b, this.c, this.d, this.e, this.f] = v;
      else if (v.length === 16) [this.a, this.b, this.c, this.d, this.e, this.f] = [v[0], v[1], v[4], v[5], v[12], v[13]];
    }
  }

  // 4x4 aliases for the 2D entries.
  get m11() { return this.a; }
  get m12() { return this.b; }
  get m21() { return this.c; }
  get m22() { return this.d; }
  get m41() { return this.e; }
  get m42() { return this.f; }
  get is2D() { return true; }
  get isIdentity() {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  private set6(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
    return this;
  }

  /** this = this × other */
  multiplySelf(o: { a: number; b: number; c: number; d: number; e: number; f: number }): this {
    return this.set6(
      this.a * o.a + this.c * o.b,
      this.b * o.a + this.d * o.b,
      this.a * o.c + this.c * o.d,
      this.b * o.c + this.d * o.d,
      this.a * o.e + this.c * o.f + this.e,
      this.b * o.e + this.d * o.f + this.f,
    );
  }

  /** this = other × this */
  preMultiplySelf(o: { a: number; b: number; c: number; d: number; e: number; f: number }): this {
    const copy = new DOMMatrixPolyfill([o.a, o.b, o.c, o.d, o.e, o.f]).multiplySelf(this);
    return this.set6(copy.a, copy.b, copy.c, copy.d, copy.e, copy.f);
  }

  multiply(o: DOMMatrixPolyfill) {
    return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(o);
  }

  translateSelf(tx = 0, ty = 0): this {
    return this.multiplySelf(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty]));
  }

  translate(tx = 0, ty = 0) {
    return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).translateSelf(tx, ty);
  }

  scaleSelf(sx = 1, sy = sx): this {
    return this.multiplySelf(new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0]));
  }

  scale(sx = 1, sy = sx) {
    return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).scaleSelf(sx, sy);
  }

  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c;
    if (!det) return this.set6(NaN, NaN, NaN, NaN, NaN, NaN);
    return this.set6(
      this.d / det,
      -this.b / det,
      -this.c / det,
      this.a / det,
      (this.c * this.f - this.d * this.e) / det,
      (this.b * this.e - this.a * this.f) / det,
    );
  }

  inverse() {
    return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).invertSelf();
  }

  transformPoint(p: { x?: number; y?: number } = {}) {
    const x = p.x ?? 0;
    const y = p.y ?? 0;
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
  }

  toFloat64Array() {
    return new Float64Array([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]);
  }
}

/** Puts the polyfill on globalThis unless a real DOMMatrix (browser, or @napi-rs/canvas) is already there. */
export function installDomMatrixPolyfill(): void {
  const g = globalThis as { DOMMatrix?: unknown };
  if (!g.DOMMatrix) g.DOMMatrix = DOMMatrixPolyfill;
}
