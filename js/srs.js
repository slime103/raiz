// Two scores per word (Membean-style memory + spelling), stored in localStorage.
// memory   0..1  can you produce the word at all?
// spelling 0..1  can you produce it letter-perfect (accents included)?
// A word is "solid" only when both are >= SOLID.

export const KEY = "raiz-progress-v2";
export const OLD_KEY = "pt-practice-progress-v1"; // v1 (one id per taught word/phrase); kept untouched as a backup
export const SOLID = 0.8;
const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const fresh = () => ({ version: 2, words: {}, log: [] });
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
/** migrate(oldState) -> v2 state (see dict.js migrateProgress). Called once when only v1 progress exists. */
export function load(migrate) {
  const cur = read(KEY);
  if (cur && cur.words) return cur;
  const old = read(OLD_KEY);
  if (old && old.words && migrate) { const s = migrate(old); save(s); return s; }
  return fresh();
}
export function save(state) { localStorage.setItem(KEY, JSON.stringify(state)); }

export function get(state, id) {
  return (state.words[id] ||= { mem: 0, spell: 0, seen: 0, exact: 0, close: 0, wrong: 0, due: 0, ivl: 0, last: 0 });
}

const up = (x, rate) => x + (1 - x) * rate;

/** result: 'exact' | 'close' | 'wrong'; opts.hinted: number of hints used; opts.mode */
export function record(state, id, result, opts = {}) {
  const w = get(state, id), now = opts.now ?? Date.now();
  const hinted = (opts.hinted || 0) > 0;
  w.seen++; w.last = now;
  if (opts.mode === "match") {
    if (result === "exact") w.mem = up(w.mem, 0.1);
    else w.mem *= 0.85;
  } else if (result === "exact") {
    w.exact++;
    w.mem = up(w.mem, hinted ? 0.15 : 0.4);
    w.spell = up(w.spell, hinted ? 0.2 : 0.35);
    w.ivl = hinted ? 10 * MIN : w.ivl >= DAY ? w.ivl * 2.5 : w.ivl >= HOUR ? DAY : w.ivl > 0 ? 4 * HOUR : DAY;
  } else if (result === "close") {
    w.close++;
    w.mem = up(w.mem, hinted ? 0.08 : 0.2); // remembered: memory still grows
    w.spell *= 0.5;                       // but spelling is flagged weak
    w.ivl = 10 * MIN;
  } else {
    w.wrong++;
    w.mem *= 0.4;
    w.spell *= 0.7;
    w.ivl = 2 * MIN;
  }
  w.due = now + w.ivl;
  state.log.push([now, id, result[0], opts.mode || "", opts.hinted || 0]);
  if (state.log.length > 5000) state.log.splice(0, state.log.length - 5000);
  return w;
}

export const isSolid = (w) => w && w.mem >= SOLID && w.spell >= SOLID;
export const isUnseen = (state, id) => !state.words[id]?.seen;

/**
 * How many brand-new (unseen) items a session may introduce.
 * Starts a little higher when the user knows almost nothing, then tightens so
 * new forms of already-known lemmas trickle in beside review, never all at once.
 */
export function introBudget(state, ids) {
  const seen = ids.filter((id) => state.words[id]?.seen).length;
  if (seen < 8) return 5;
  if (seen < 25) return 3;
  return 2;
}

/** Higher = more urgent. Weak memory weighs most, weak spelling next, overdue items rise. */
export function priority(state, id, now = Date.now()) {
  const w = state.words[id];
  if (!w || !w.seen) return 0; // unseen is handled in pick() so it can be budgeted
  const weak = (1 - w.mem) * 2 + (1 - w.spell) * 1.2;
  const overdue = w.due <= now ? 0.6 + Math.min(1.5, (now - w.due) / Math.max(w.ivl, MIN) * 0.2) : -0.8;
  const recent = now - w.last < 45 * 1000 ? -3 : 0; // never repeat back-to-back
  return weak + overdue + recent + Math.random() * 0.35;
}

/**
 * Pick the next item id.
 * ctx.introduced: Set of unseen ids already shown this session
 * ctx.lemmaOf(id): lemma id (or the item id for a phrase) — at most one new form per lemma per session
 * ctx.lessonOf(id): lesson number, used to introduce earlier material first
 * ctx.knownLemma(id): true if some other form of this lemma has already been practiced
 * ctx.introBudget: override; default from introBudget()
 */
export function pick(state, ids, requeue = {}, exclude = new Set(), ctx = {}) {
  for (const [id, n] of Object.entries(requeue)) if (n <= 0 && !exclude.has(id)) { delete requeue[id]; return id; }
  const introduced = ctx.introduced || new Set();
  const lemmaOf = ctx.lemmaOf || ((id) => id);
  const lessonOf = ctx.lessonOf || (() => 99);
  const knownLemma = ctx.knownLemma || (() => false);
  const budget = ctx.introBudget ?? introBudget(state, ids);
  const lemmasIntroduced = new Set([...introduced].map(lemmaOf));

  let best = null, bestP = -Infinity;
  for (const id of ids) {
    if (exclude.has(id) || id in requeue) continue;
    let p;
    if (!isUnseen(state, id)) {
      p = priority(state, id);
    } else {
      if (introduced.size >= budget) continue;
      if (lemmasIntroduced.has(lemmaOf(id))) continue;
      // Sibling of a known word comes in sooner than a brand-new lemma; earlier lessons first.
      const sibling = knownLemma(id) ? 1.15 : 0.7;
      const early = 0.25 / (1 + (lessonOf(id) || 9));
      p = sibling + early + Math.random() * 0.2;
    }
    if (p > bestP) { bestP = p; best = id; }
  }
  return best ?? ids.find((id) => !exclude.has(id)) ?? ids[Math.floor(Math.random() * ids.length)];
}
export function tick(requeue) { for (const k in requeue) requeue[k]--; }
