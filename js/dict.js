// Dictionary model: lemmas (word pages), their forms (subsections), phrases (own pages),
// practice items (taught forms + phrases), search, and progress migration.
// Pure functions, no DOM. Used by the app and by tests.
import { norm, deaccent } from "./grade.js";

const INHERIT = ["scene", "definition_pt", "photo", "photo_credit", "root", "root_image"];
export const key = (s) => deaccent(norm(s));
const stripArticle = (s) => s.replace(/^(o|a|os|as)\s+/i, "");

export function parseComponent(c) {
  const [surface, target = ""] = c.split("=");
  const [lemma = "", form = ""] = target.split("#");
  return { surface: surface.trim(), lemma: lemma.trim(), form: form.trim() };
}

export function hrefFor(idx, id, kind) {
  if ((!kind || kind === "phrase") && idx.P[id]) return `#/phrase/${id}`;
  if ((!kind || kind === "form") && idx.F[id]) return `#/word/${idx.F[id].lemma_id}/${id}`;
  if (idx.L[id]) return `#/word/${id}`;
  return "#/words";
}

/**
 * Short grammatical clue for a form of a multi-form lemma, shown on every practice prompt.
 * Verbs: "querer, eu form (I)", "ter, você / ele / ela form".
 * Gender/number: "feminine", "masculine singular", "masculine plural".
 * Contractions: "em + a", "de + os". Bare de/em: "de (not contracted)".
 * Empty when the lemma has only one form (the caller skips this).
 */
const CONTRACTION = { no: "em + o", na: "em + a", nos: "em + os", nas: "em + as",
  do: "de + o", da: "de + a", dos: "de + os", das: "de + as" };
export function formClue(f, lemma = {}, siblings = []) {
  if (f.id === "cem") return "100, standing alone";
  if (f.id === "cento") return "in 101+, e.g. cento e um";
  if (CONTRACTION[f.id]) return CONTRACTION[f.id];
  if ((f.part_of_speech || "").startsWith("contraction")) {
    const m = (f.part_of_speech + " " + (f.label || "")).match(/\b(de|em)\s*\+\s*(os|as|o|a)\b/i);
    if (m) return `${m[1].toLowerCase()} + ${m[2].toLowerCase()}`;
  }
  if (["de", "em"].includes(f.lemma_id) && !CONTRACTION[f.id]) return `${f.form} (not contracted)`;
  if (f.person) {
    let who = "";
    if (/1st/.test(f.person) && /\beu\b/.test(f.person)) who = "eu form (I)";
    else {
      const m = f.person.match(/\((.+)\)/);
      who = `${(m ? m[1] : f.person).replace(/,\s*/g, " / ")} form`;
    }
    if (f.number === "plur") who = "plural " + who;
    const head = lemma.headword || "";
    return head ? `${head}, ${who}` : who;
  }
  const g = f.gender === "fem" ? "feminine" : f.gender === "masc" ? "masculine" : "";
  const hasPlur = siblings.some((s) => s.number === "plur");
  let n = "";
  if (f.number === "plur") n = "plural";
  else if (f.number === "sing" && hasPlur) n = "singular";
  if (g && n) return `${g} ${n}`;
  return g || n || (f.label || "").split(" · ")[0] || "";
}

export function buildIndex(data) {
  const L = {}, F = {}, P = {}, I = {}, formsOf = {}, usedIn = {}, formUsedIn = {};
  for (const w of data.words) { L[w.id] = w; formsOf[w.id] = []; usedIn[w.id] = []; }
  for (const f of data.forms) { F[f.id] = f; formsOf[f.lemma_id].push(f.id); formUsedIn[f.id] = []; }
  for (const p of data.phrases) {
    P[p.id] = p;
    p.parts_list = p.components.map(parseComponent);
    for (const c of p.parts_list) {
      if (c.lemma && usedIn[c.lemma] && !usedIn[c.lemma].includes(p.id)) usedIn[c.lemma].push(p.id);
      if (c.form && formUsedIn[c.form]) formUsedIn[c.form].push(p.id);
    }
  }
  const byText = (a, b) => key(a).localeCompare(key(b), "pt");
  const lemmaOrder = Object.keys(L).sort((a, b) => byText(L[a].headword, L[b].headword));
  const phraseOrder = Object.keys(P).sort((a, b) => byText(P[a].phrase, P[b].phrase));
  // practice items
  const items = [];
  for (const f of data.forms) {
    const w = L[f.lemma_id];
    const it = { id: f.id, kind: "form", lemma_id: w.id, text: f.form, english: f.english, audio: f.audio,
      accept_also: f.accept_also, lesson: f.lesson, taught: f.taught, clue: formsOf[w.id].length > 1 ? formClue(f, w, formsOf[w.id].map((id) => F[id])) : "",
      pos: f.part_of_speech || w.part_of_speech, own: {} };
    for (const k of INHERIT) { it[k] = f[k] || w[k]; it.own[k] = !!f[k]; }
    I[f.id] = it;
    if (f.taught) items.push(f.id);
  }
  for (const p of data.phrases) {
    I[p.id] = { id: p.id, kind: "phrase", text: p.phrase, english: p.english, audio: p.audio, accept_also: p.accept_also,
      lesson: p.lesson, taught: true, clue: "", pos: p.part_of_speech, scene: p.scene, definition_pt: p.definition_pt,
      photo: p.photo, photo_credit: p.photo_credit, root: p.root, root_image: p.root_image, own: {} };
    items.push(p.id);
  }
  // search entries: [key, target]
  const entries = [];
  for (const id of lemmaOrder) {
    const w = L[id];
    entries.push({ k: key(w.headword), text: w.headword, type: "lemma", lemma: id });
    for (const fid of formsOf[id]) {
      const f = F[fid];
      for (const t of [f.form, stripArticle(f.form), ...f.accept_also]) entries.push({ k: key(t), text: t, type: "form", lemma: id, form: fid });
      // pronoun + verb forms ("eu tenho") are also found by the bare verb ("tenho")
      const bare = f.form.split(" ").slice(-1)[0];
      if (f.person && bare !== f.form) entries.push({ k: key(bare), text: bare, type: "form", lemma: id, form: fid });
    }
  }
  for (const id of phraseOrder) for (const t of [P[id].phrase, ...P[id].accept_also]) entries.push({ k: key(t), text: t, type: "phrase", phrase: id });
  const vocab = [...data.forms.flatMap((f) => [f.form, ...f.accept_also]), ...data.phrases.flatMap((p) => [p.phrase, ...p.accept_also])];
  const idMap = Object.fromEntries((data.id_map || []).map((m) => [m.old_id, m.new_id]));
  // Spelling & sounds contrasts
  const C = {}, CI = {}, contrastsByItem = {};
  for (const c of data.contrasts || []) C[c.id] = c;
  for (const it of (data.contrast_items || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0))) {
    CI[it.id] = it;
    if (it.item_id) (contrastsByItem[it.item_id] ||= []).push(it.contrast_id);
  }
  const contrastOrder = (data.contrasts || []).map((c) => c.id);
  const CMP = {}, cmpItemsOf = {}, comparisonsByLemma = {};
  for (const c of data.comparisons || []) { CMP[c.id] = c; cmpItemsOf[c.id] = []; }
  for (const it of (data.comparison_items || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0))) {
    (cmpItemsOf[it.comparison_id] ||= []).push(it);
  }
  for (const c of data.comparisons || []) {
    for (const lid of c.lemma_ids || []) (comparisonsByLemma[lid] ||= []).push(c.id);
  }
  return { L, F, P, I, items, formsOf, usedIn, formUsedIn, lemmaOrder, phraseOrder, entries, vocab, idMap, types: data.word_types || {}, C, CI, contrastsByItem, contrastOrder, CMP, cmpItemsOf, comparisonsByLemma };
}

/** Exact hit for a typed query (headword, any form, any phrase) -> href, else null. */
export function resolve(idx, q) {
  const raw = norm(q).replace(/\s*\?$/, "");
  const k = key(q).replace(/\s*\?$/, "");
  if (!k) return null;
  const exact = (e) => norm(e.text || "").replace(/\s*\?$/, "") === raw;
  const loose = (e) => e.k.replace(/\s*\?$/, "") === k;
  const href = (e) => e.type === "lemma" ? `#/word/${e.lemma}` : e.type === "form" ? `#/word/${e.lemma}/${e.form}` : `#/phrase/${e.phrase}`;
  const pick = (type, pred) => idx.entries.find((e) => e.type === type && pred(e));
  const hit = pick("lemma", exact) || pick("form", exact) || pick("phrase", exact)
    || pick("lemma", loose) || pick("form", loose) || pick("phrase", loose);
  return hit ? href(hit) : null;
}

/**
 * search(idx, q) -> { lemmas: [{id, viaForm}], phrases: [id] }
 * A lemma matches on its headword, any form (uma, quer, tenho, reais, sua), or its English.
 * viaForm is the form id that matched (so the result can link straight to that subsection).
 */
export function search(idx, q) {
  const k = key(q);
  if (!k) return { lemmas: idx.lemmaOrder.map((id) => ({ id, viaForm: null })), phrases: [...idx.phraseOrder] };
  const lem = new Map();
  const score = (ek) => (ek === k ? 3 : ek.startsWith(k) ? 2 : ek.includes(k) ? 1 : 0);
  for (const e of idx.entries) {
    if (e.type === "phrase") continue;
    const s = score(e.k); if (!s) continue;
    const prev = lem.get(e.lemma);
    const viaForm = e.type === "form" && key(idx.L[e.lemma].headword) !== e.k ? e.form : null;
    if (!prev || s > prev.s) lem.set(e.lemma, { id: e.lemma, viaForm, s });
  }
  for (const id of idx.lemmaOrder) {
    const w = idx.L[id];
    const en = [w.english, ...idx.formsOf[id].map((f) => idx.F[f].english)].map(norm).join(" ; ");
    if (!lem.has(id) && en.includes(norm(q))) lem.set(id, { id, viaForm: null, s: 0.5 });
  }
  const lemmas = [...lem.values()].sort((a, b) => b.s - a.s || idx.lemmaOrder.indexOf(a.id) - idx.lemmaOrder.indexOf(b.id)).map(({ id, viaForm }) => ({ id, viaForm }));
  const phrases = idx.phraseOrder.filter((id) => {
    const p = idx.P[id];
    return key(p.phrase).includes(k) || [...p.accept_also].some((a) => key(a).includes(k)) || norm(p.english).includes(norm(q));
  });
  return { lemmas, phrases };
}

/**
 * Migrate saved progress to the v2 item ids.
 * old: a v1 state ({words:{oldId: stats}, log:[[t, oldId, …]]}) or a v2 state.
 * Known ids are mapped through id_map (old_id -> new_id); ids that are already valid items are kept;
 * anything unknown is parked in state.orphans so nothing is ever thrown away.
 */
export function migrateProgress(old, idx) {
  const valid = new Set(Object.keys(idx.I));
  const out = { version: 2, words: {}, log: [], orphans: { ...(old.orphans || {}) } };
  if (old.bestMatch) out.bestMatch = old.bestMatch;
  const mapId = (id) => (valid.has(id) ? id : idx.idMap[id] && valid.has(idx.idMap[id]) ? idx.idMap[id] : null);
  let mapped = 0;
  for (const [id, st] of Object.entries(old.words || {})) {
    const nid = mapId(id);
    if (!nid) { out.orphans[id] = st; continue; }
    if (out.words[nid]) { // two old ids landed on one item: keep the stronger record
      const a = out.words[nid]; out.words[nid] = (st.seen || 0) > (a.seen || 0) ? st : a;
    } else out.words[nid] = st;
    mapped++;
  }
  for (const e of old.log || []) { const nid = mapId(e[1]); out.log.push(nid ? [e[0], nid, ...e.slice(2)] : e); }
  out.migrated = { from: old.version || 1, at: Date.now(), mapped, orphans: Object.keys(out.orphans).length };
  return out;
}
