// Answer grading: exact / close / wrong, with character-level diff.
// Pure functions, no DOM. Used by the app and by tests.

const PUNCT = /[?!.,;:¿¡"“”'‘’()…—–]/g;

export function norm(s) {
  return (s || "").normalize("NFC").toLowerCase().replace(PUNCT, " ").replace(/\s+/g, " ").trim();
}
export function deaccent(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
}

// Allowed edits (on accent-free strings) before a typo becomes "wrong".
export function threshold(len) {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 10) return 2;
  return 3;
}

export function levenshtein(a, b) {
  const A = [...a], B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[B.length];
}

// Align typed vs answer. Returns ops: {op:'eq'|'sub'|'del'|'ins', a, t, accent}
//  eq: same char; sub: typed t where answer has a (accent=true if only the accent differs);
//  del: answer char a missing from typed; ins: extra typed char t.
export function align(typed, answer) {
  const T = [...typed], A = [...answer];
  const n = T.length, m = A.length;
  const cost = (x, y) => (x === y ? 0 : deaccent(x) === deaccent(y) ? 0.5 : 1);
  const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) D[i][0] = i;
  for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + cost(T[i - 1], A[j - 1]));
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + cost(T[i - 1], A[j - 1])) {
      const t = T[i - 1], a = A[j - 1];
      ops.push(t === a ? { op: "eq", a, t } : { op: "sub", a, t, accent: deaccent(t) === deaccent(a) });
      i--; j--;
    } else if (j > 0 && D[i][j] === D[i][j - 1] + 1) {
      ops.push({ op: "del", a: A[j - 1] }); j--;
    } else {
      ops.push({ op: "ins", t: T[i - 1] }); i--;
    }
  }
  return ops.reverse();
}

/**
 * grade(typed, answers, vocab)
 *  answers: accepted spellings (first is the canonical one shown on screen)
 *  vocab:   all known Portuguese entries; an exact hit on a *different* known word
 *           (obrigada vs obrigado, um vs uma) is graded wrong, not close.
 * returns {result, kind, answer, typed, ops, distance, confusedWith}
 */
export function grade(typed, answers, vocab = []) {
  const t = norm(typed);
  const accepted = answers.map(norm).filter(Boolean);
  const canonical = accepted[0];
  if (!t) return { result: "wrong", kind: "blank", answer: canonical, typed: t, ops: align("", canonical) };
  const hit = accepted.find((a) => a === t);
  if (hit) return { result: "exact", kind: "exact", answer: hit, typed: t, ops: align(t, hit) };

  const other = vocab.map(norm).find((v) => v === t && !accepted.includes(v));
  if (other) return { result: "wrong", kind: "other-word", confusedWith: other, answer: canonical, typed: t, ops: align(t, canonical) };

  let best = null;
  for (const a of accepted) {
    const d = levenshtein(deaccent(t), deaccent(a));
    if (!best || d < best.d) best = { a, d };
  }
  const a = best.a;
  if (best.d === 0) return { result: "close", kind: "accent", answer: a, typed: t, ops: align(t, a), distance: 0 };
  if (best.d <= threshold([...deaccent(a)].length))
    return { result: "close", kind: "typo", answer: a, typed: t, ops: align(t, a), distance: best.d };
  return { result: "wrong", kind: "wrong", answer: canonical, typed: t, ops: align(t, canonical), distance: best.d };
}
