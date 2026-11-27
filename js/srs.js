// Two scores per word (Membean-style memory + spelling), stored in localStorage.
// memory   0..1  can you produce the word at all?
// spelling 0..1  can you produce it letter-perfect (accents included)?
// A word is "solid" only when both are >= SOLID.

export const KEY = "pt-practice-progress-v1";
export const SOLID = 0.8;
const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { words: {}, log: [] }; }
  catch { return { words: {}, log: [] }; }
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

/** Higher = more urgent. Weak memory weighs most, weak spelling next, overdue items rise. */
export function priority(state, id, now = Date.now()) {
  const w = state.words[id];
  if (!w || !w.seen) return 2.2 + Math.random() * 0.3; // unseen: early, but not before very weak ones
  const weak = (1 - w.mem) * 2 + (1 - w.spell) * 1.2;
  const overdue = w.due <= now ? 0.6 + Math.min(1.5, (now - w.due) / Math.max(w.ivl, MIN) * 0.2) : -0.8;
  const recent = now - w.last < 45 * 1000 ? -3 : 0; // never repeat back-to-back
  return weak + overdue + recent + Math.random() * 0.35;
}

/** Pick the next word id, honoring in-session re-queues ({id: itemsUntilDue}). */
export function pick(state, ids, requeue = {}, exclude = new Set()) {
  for (const [id, n] of Object.entries(requeue)) if (n <= 0 && !exclude.has(id)) { delete requeue[id]; return id; }
  let best = null, bestP = -Infinity;
  for (const id of ids) {
    if (exclude.has(id) || id in requeue) continue;
    const p = priority(state, id);
    if (p > bestP) { bestP = p; best = id; }
  }
  return best ?? ids[Math.floor(Math.random() * ids.length)];
}
export function tick(requeue) { for (const k in requeue) requeue[k]--; }
