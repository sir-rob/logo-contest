/**
 * Deterministic, dependency-free randomness for the IRV tie-break of last
 * resort.
 *
 * WHY hand-rolled rather than a library: the contest stores a seed on the
 * contest record and promises that *any* recount — this year, next year, on a
 * different machine, in a different Node version — reproduces the identical
 * result. `Math.random()` cannot promise that, and an npm PRNG could silently
 * change its algorithm across a patch bump. Thirty lines of well-known integer
 * arithmetic is auditable and frozen forever.
 */

/**
 * cyrb128 — expands an arbitrary string seed into four well-mixed 32-bit
 * integers. WHY: sfc32 needs 128 bits of state; feeding it a naive hash (e.g.
 * summed char codes) makes nearby seeds produce correlated streams.
 */
function cyrb128(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < seed.length; i += 1) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);

  // `>>> 0` forces the unsigned 32-bit reading; the bitwise ops above produce
  // signed values and sfc32's state must be unsigned to stay reproducible.
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/**
 * Builds a pure PRNG returning floats in [0, 1). The same seed always yields
 * the same sequence; two generators made from the same seed are independent of
 * each other (each closes over its own state).
 *
 * Algorithm: sfc32 (Chris Doty-Humphrey's "Small Fast Counter"), chosen because
 * it is 32-bit-integer only — no floats in the state — so it cannot drift
 * between engines the way a float-based LCG can.
 */
export function makeRng(seed: string): () => number {
  const [s0, s1, s2, s3] = cyrb128(seed);
  let a = s0;
  let b = s1;
  let c = s2;
  let d = s3;

  return function next(): number {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * Deterministically shuffles `items`.
 *
 * WHY the canonical sort first: the caller's array order must not be able to
 * influence who gets eliminated. Two admins recounting the same contest may
 * hand us the tied candidates in different orders (Set iteration order, a
 * Firestore query, a UI list). Sorting to a canonical ascending order before
 * the Fisher–Yates pass makes the outcome a function of (contents, seed) only.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  // Compare on the string form: the IRV engine shuffles submission ids, and a
  // plain code-unit comparison is locale-independent (unlike localeCompare).
  const out = [...items].sort((x, y) => {
    const a = String(x);
    const b = String(y);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });

  const rng = makeRng(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const vi = out[i];
    const vj = out[j];
    // Guarded rather than asserted with `!`: this must never throw, because it
    // is the terminal tie-break that always has to produce an answer.
    if (vi !== undefined && vj !== undefined) {
      out[i] = vj;
      out[j] = vi;
    }
  }
  return out;
}
