import { grade, norm, deaccent, align } from "./grade.js";
import * as srs from "./srs.js";
import { buildIndex, search, resolve, hrefFor, migrateProgress, key, formClue } from "./dict.js";
import { hasPlaceMap, placeMapHTML } from "./maps.js";
import { numeralFor, numeralHTML } from "./numerals.js";

const PATTERN = ["type", "blank", "type", "blank", "listen", "blank", "match"];
const ACCENTS = ["ã", "á", "â", "à", "é", "ê", "í", "ó", "ô", "õ", "ú", "ç"];
const LANGS = ["English", "Spanish", "French", "Italian", "German", "Dutch", "Swedish", "Latin", "Spanish/Italian", "Spanish/French", "old English"];

let DATA, IDX, W = {}, IDS = [], SENT = {}, VOCAB = [];
let state = { version: 2, words: {}, log: [] };
const href = (id) => hrefFor(IDX, id);
const lemmaOf = (id) => W[id]?.lemma_id || id;
const lessonOf = (id) => W[id]?.lesson || 99;
const knownLemma = (id) => {
  const lid = lemmaOf(id);
  return (IDX.formsOf[lid] || []).some((f) => f !== id && state.words[f]?.seen);
};
const pickCtx = () => ({ introduced: session?.introduced || new Set(), lemmaOf, lessonOf, knownLemma });
const mapFor = (it) => (it && it.kind === "form" && hasPlaceMap(it.lemma_id) ? it.lemma_id : null);

let session = null;
const app = document.getElementById("app");

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const filled = (s) => { const a = s.sentence_pt.startsWith("___") ? s.answer[0].toUpperCase() + s.answer.slice(1) : s.answer; return s.sentence_pt.split("___").map(esc).join(`<b>${esc(a)}</b>`); };
const pretty = (s) => s.replace(/\?$/, "");
function toast(msg, ms = 2500) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), ms); }

function mask(text, forms) {
  let out = text;
  for (const f of forms) {
    const core = pretty(f).trim();
    if (!core) continue;
    const re = new RegExp(`(^|[^\\p{L}])(${core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[^\\p{L}])`, "giu");
    out = out.replace(re, "$1___");
  }
  return out;
}

const maskForms = (it) => [it.text, ...(it.kind === "form" ? [IDX.L[it.lemma_id].headword, ...IDX.formsOf[it.lemma_id].map((f) => IDX.F[f].form)] : [])];
const wordsIn = (t) => pretty(t || "").trim().split(/\s+/).filter(Boolean).length;
/** Form clue chip only (feminine, eu form, contraction). Word vs phrase is shown by the number of blank slots. */
function clueLine(it) {
  if (!it?.clue) return "";
  return `<div class="kindline"><span class="kdetail cluechip">${esc(it.clue)}</span></div>`;
}

const confusedItem = (t) => Object.values(W).find((i) => norm(i.text) === t || i.accept_also.some((a) => norm(a) === t));

// ---------- audio (blob URLs so playback works from the offline cache on iOS) ----------
const blobs = {};
async function warm(file) {
  if (blobs[file]) return blobs[file];
  const r = await fetch("media/audio/" + file);
  if (!r.ok) throw new Error("audio " + r.status);
  return (blobs[file] = URL.createObjectURL(await r.blob()));
}
let player = null;
function playFile(audio) {
  if (!audio) return;
  const go = (u) => { try { player?.pause(); player = new Audio(u); player.play().catch(() => {}); } catch {} };
  if (blobs[audio]) go(blobs[audio]); else warm(audio).then(go).catch(() => toast("Audio not available"));
}
function play(id) {
  const w = W[id]; if (!w) return;
  playFile(w.audio);
}

// ---------- strength meters ----------
function meters(id, big = false) {
  const p = state.words[id];
  const m = p ? p.mem : 0, s = p ? p.spell : 0;
  const cls = srs.isSolid(p) ? "solid" : "";
  return `<span class="meters ${big ? "big" : ""} ${cls}" title="memory ${Math.round(m * 100)}% · spelling ${Math.round(s * 100)}%">
    <span class="meter"><i style="width:${Math.round(m * 100)}%"></i></span>${big ? '<small>memory</small>' : ""}
    <span class="meter sp"><i style="width:${Math.round(s * 100)}%"></i></span>${big ? '<small>spelling</small>' : ""}</span>`;
}


// ---------- spelling & sounds ----------
function contrastsForLemma(lemmaId) {
  const ids = [];
  const seen = new Set();
  const add = (cid) => { if (cid && !seen.has(cid) && IDX.C[cid]) { seen.add(cid); ids.push(cid); } };
  for (const fid of IDX.formsOf[lemmaId] || []) for (const c of IDX.contrastsByItem[fid] || []) add(c);
  for (const c of IDX.contrastsByItem[lemmaId] || []) add(c);
  return ids;
}
function contrastLinks(lemmaId) {
  const ids = contrastsForLemma(lemmaId);
  if (!ids.length) return "";
  const lis = ids.map((id) => {
    const c = IDX.C[id];
    const forms = (c.item_ids || []).map((i) => IDX.CI[i]?.form).filter(Boolean).join(", ");
    return `<li><a href="#/sound/${id}"><b>${esc(c.title)}</b>${forms ? `<span class="muted"> · ${esc(forms)}</span>` : ""}</a></li>`;
  }).join("");
  return sec("Spelling &amp; sounds", `<ul class="cx-links">${lis}</ul>`);
}
function compareSection(lemmaId) {
  const ids = IDX.comparisonsByLemma[lemmaId] || [];
  if (!ids.length) return "";
  const blocks = ids.map((cid) => {
    const c = IDX.CMP[cid];
    const others = (c.lemma_ids || []).filter((id) => id !== lemmaId && IDX.L[id]);
    const heading = others.length
      ? "Compare with " + others.map((id) => `<a href="#/word/${id}">${esc(IDX.L[id].headword)}</a>`).join(", ")
      : esc(c.title);
    const rows = (IDX.cmpItemsOf[cid] || []).map((it) => {
      const form = it.form_id && IDX.F[it.form_id];
      const label = form ? form.form : (IDX.L[it.lemma_id]?.headword || it.lemma_id);
      const href = form ? `#/word/${it.lemma_id}/${it.form_id}` : `#/word/${it.lemma_id}`;
      const cur = it.lemma_id === lemmaId ? ' class="current"' : "";
      return `<tr${cur}><th><a href="${href}">${esc(label)}</a></th><td><span class="pt">${esc(it.example_pt)}</span><span class="en">${esc(it.example_en)}</span></td></tr>`;
    }).join("");
    return `<div class="compare-card" data-compare="${esc(cid)}"><h4>${heading}</h4><p>${esc(c.explanation)}</p><table class="compare-ex">${rows}</table></div>`;
  }).join("");
  return sec("Related, not the same", blocks, "compare-sec");
}
function markForm(form, highs) {
  const ranges = [];
  for (const h of highs || []) {
    if (!h) continue;
    let i = 0;
    while ((i = form.indexOf(h, i)) !== -1) { ranges.push([i, i + h.length]); i += h.length; }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const kept = [];
  let end = -1;
  for (const r of ranges) { if (r[0] >= end) { kept.push(r); end = r[1]; } }
  let html = "", at = 0;
  for (const [a, b] of kept) {
    html += esc(form.slice(at, a)) + "<mark>" + esc(form.slice(a, b)) + "</mark>";
    at = b;
  }
  return html + esc(form.slice(at));
}
function itemHref(itemId) {
  if (!itemId) return "";
  if (IDX.F[itemId]) return `#/word/${IDX.F[itemId].lemma_id}/${itemId}`;
  if (IDX.L[itemId]) return `#/word/${itemId}`;
  if (IDX.P[itemId]) return `#/phrase/${itemId}`;
  return "";
}
function renderSounds() {
  const cards = (IDX.contrastOrder || []).map((id) => {
    const c = IDX.C[id];
    const forms = (c.item_ids || []).map((i) => IDX.CI[i]?.form).filter(Boolean).join(" · ");
    return `<li><a href="#/sound/${id}"><span class="pt">${esc(c.title)}</span><span class="en">${esc(forms)}</span><p class="muted small">${esc((c.explanation || "").split(". ")[0])}.</p></a></li>`;
  }).join("");
  app.innerHTML = `<article class="cx-index">
    <a class="back" href="#/words">← Dictionary</a>
    <h1>Spelling &amp; sounds</h1>
    <p class="lead">Look-alike spellings that are pronounced differently. Each set puts the words side by side, with syllables, a simple respelling, IPA for Rio / São Paulo, and audio.</p>
    <ul class="words cx-list">${cards}</ul>
  </article>`;
}
function renderContrast(id) {
  const c = IDX.C[id];
  const items = (c.item_ids || []).map((i) => IDX.CI[i]).filter(Boolean);
  const cards = items.map((it) => {
    const highs = it.spelling_highlight || [];
    const sounds = it.sound_highlight || [];
    const pairs = highs.map((h, i) => `<li><span class="sp">${esc(h)}</span> <span class="arrow">→</span> <span class="sd">${esc(sounds[i] || "")}</span></li>`).join("");
    const href = itemHref(it.item_id);
    const lemma = it.item_id && IDX.F[it.item_id] ? IDX.L[IDX.F[it.item_id].lemma_id] : (IDX.L[it.item_id] || null);
    const link = href ? `<a href="${href}">${esc(it.form)}${lemma ? ` · ${esc(lemma.headword)}` : ""}</a>` : "";
    return `<article class="cx-item" data-cx-item="${esc(it.id)}">
      <header>
        <h2><span class="cx-form">${markForm(it.form, highs)}</span><button type="button" class="play" data-audio="${esc(it.audio)}" aria-label="Play ${esc(it.form)}">▶︎</button></h2>
        <p class="cx-phon"><span class="syl">${esc(it.syllables)}</span><span class="respell">${esc(it.respelling)}</span><span class="ipa">${esc(it.ipa)}</span></p>
      </header>
      ${pairs ? `<ul class="cx-hl">${pairs}</ul>` : ""}
      ${it.note ? `<p class="cx-note">${esc(it.note)}</p>` : ""}
      ${link ? `<p class="cx-wordlink">${link}</p>` : ""}
    </article>`;
  }).join("");
  app.innerHTML = `<article class="cx-page" data-contrast="${esc(id)}">
    ${backLink()}
    <h1>${esc(c.title)}</h1>
    <p class="cx-expl">${esc(c.explanation)}</p>
    <p class="muted small">Pronunciation: Brazilian Portuguese, Rio / São Paulo (neutral).</p>
    <div class="cx-grid${(c.tags || []).includes("pattern") ? " pattern" : ""}" data-n="${items.length}">${cards}</div>
  </article>`;
  $$("[data-audio]").forEach((b) => (b.onclick = () => playFile(b.dataset.audio)));
}

// ---------- routing ----------
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [view, a1, a2] = h.split("/").map((x) => decodeURIComponent(x || ""));
  const tab = (view === "sounds" || view === "sound") ? "sounds"
    : (view === "word" || view === "phrase" ? "words" : (view || "home"));
  $$("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === tab));
  window.scrollTo(0, 0);
  if (view === "play") return renderPlay();
  if (view === "words") return renderIndex(a1);
  if (view === "sounds") return renderSounds();
  if (view === "sound" && IDX.C[a1]) return renderContrast(a1);
  if (view === "word" && IDX.L[a1]) return renderWord(a1, IDX.F[a2]?.lemma_id === a1 ? a2 : null);
  if (view === "phrase" && IDX.P[a1]) return renderPhrase(a1);
  // old links (#/word/<old id>) and phrase ids under /word/ -> their new home
  if ((view === "word" || view === "phrase") && (IDX.F[a1] || IDX.P[a1] || IDX.idMap[a1])) {
    const id = IDX.F[a1] || IDX.P[a1] ? a1 : IDX.idMap[a1];
    return location.replace(href(id));
  }
  if (view === "about") return renderAbout();
  return renderHome();
}

// ---------- home ----------
function stats() {
  const seen = IDS.filter((id) => state.words[id]?.seen);
  const solid = IDS.filter((id) => srs.isSolid(state.words[id]));
  const spellWeak = seen.filter((id) => state.words[id].mem >= 0.4 && state.words[id].spell < 0.6);
  return { seen, solid, spellWeak };
}
function renderHome() {
  const { seen, solid, spellWeak } = stats();
  app.innerHTML = `
  <section class="hero">
    <p class="motto">Not translating — relating.</p>
    <h1>Think the picture.<br>Say it in Portuguese.</h1>
    <button class="primary big" id="start">${session && !session.done ? "Resume session" : "Begin session"}</button>
    <p class="sub">Type · fill the blank · matching</p>
  </section>
  <section class="stats">
    <div><b>${IDX.lemmaOrder.length}</b><span>words</span></div>
    <div><b>${IDX.phraseOrder.length}</b><span>phrases</span></div>
    <div><b>${seen.length}</b><span>practiced</span></div>
    <div><b>${solid.length}</b><span>solid</span></div>
  </section>
  ${spellWeak.length ? `<section class="card"><h3>Spelling to lock in</h3><div class="chips">${spellWeak.map((id) => `<a class="chip" href="${href(id)}">${esc(W[id].text)}</a>`).join("")}</div></section>` : ""}
  <section class="card legend">
    <h3>How grading works</h3>
    <p><span class="tag exact">Exact</span> right word, right spelling.</p>
    <p><span class="tag close">Close</span> right word, a typo or missing accent: memory counts, the letters are highlighted and spelling is marked to practice.</p>
    <p><span class="tag wrong">Wrong</span> you see the picture, root, and answer, and it comes back soon.</p>
    <p class="muted">Each word has two bars: <span class="meter inline"><i style="width:70%"></i></span> memory and <span class="meter sp inline"><i style="width:40%"></i></span> spelling. A word is solid when both are full.</p>
  </section>
  <p class="center"><a href="#/words">Browse the dictionary: ${IDX.lemmaOrder.length} words, ${IDX.phraseOrder.length} phrases →</a></p>
  <p class="center"><a href="#/sounds">Spelling &amp; sounds</a> — how tem, tenho, and entende differ, and more</p>`;
  $("#start").onclick = () => { if (!session || session.done) session = null; location.hash = "#/play"; };
}

// ---------- play ----------
function newSession() {
  return { start: Date.now(), step: 0, results: [], requeue: {}, current: null, done: false, introduced: new Set() };
}
function renderPlay() {
  if (!session || session.done) session = newSession();
  if (session.current && !session.current.finished) return renderItem(session.current);
  nextItem();
}
function nextItem() {
  const mode = PATTERN[session.step % PATTERN.length];
  session.step++;
  srs.tick(session.requeue);
  if (mode === "match") {
    session.current = { mode: "match", ids: pickMatchSet(5), found: [], mistakes: {} };
    return renderItem(session.current);
  }
  const recent = new Set(session.results.slice(-2).map((r) => r.id));
  let id = srs.pick(state, IDS, session.requeue, recent, pickCtx());
  if (id && srs.isUnseen(state, id)) session.introduced.add(id);
  let m = mode;
  let sentence = null;
  if (m === "blank") {
    const list = SENT[id] || [];
    if (list.length) sentence = list[Math.floor(Math.random() * list.length)];
    else m = "type";
  }
  session.current = { mode: m, id, sentence, hints: 0, lookedUp: false, finished: false, answered: false };
  renderItem(session.current);
}

function sessionBar() {
  const n = session.results.length;
  return `<div class="sbar"><span class="scount">${n ? `${n} done` : "Session"}</span><button class="link" id="endsession">End session</button></div>`;
}

function answersFor(cur) {
  const w = W[cur.id];
  if (cur.mode === "blank") return [cur.sentence.answer, ...cur.sentence.accept_also];
  return [w.text, ...w.accept_also];
}

function promptVisual(w, { blank = true } = {}) {
  const place = mapFor(w);
  if (place) return placeMapHTML(place, { named: !blank });
  const num = numeralFor(w);
  if (num) return numeralHTML(num, { named: !blank, word: !blank ? pretty(w.text) : "" });
  return w.photo ? `<img class="photo" src="media/img/${esc(w.photo)}" alt="">` : "";
}

function slotWidthCh(word) {
  const n = [...(word || "")].length;
  if (n <= 3) return 5;
  if (n <= 6) return 8;
  if (n <= 9) return 11;
  return 14;
}
function answerWords(answer) {
  return pretty(answer || "").trim().split(/\s+/).filter(Boolean);
}
function slotsHTML(answer, { prefix = "inp", label = "Answer" } = {}) {
  const words = answerWords(answer);
  const n = Math.max(1, words.length);
  return `<span class="slots" data-n="${n}">${(words.length ? words : [""]).map((w, i) => {
    const id = i === 0 ? ` id="${prefix}"` : "";
    const hint = i === n - 1 ? "go" : "next";
    return `<input class="slot" type="text" lang="pt-BR" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" inputmode="text"${id} data-i="${i}" style="width:${slotWidthCh(w)}ch" enterkeyhint="${hint}" aria-label="${label}, box ${i + 1} of ${n}">`;
  }).join("")}</span>`;
}
function readSlots(root) {
  return [...(root || document).querySelectorAll("input.slot")].map((el) => el.value.trim()).join(" ").replace(/\s+/g, " ").trim();
}
function fillSlots(root, text) {
  const slots = [...root.querySelectorAll("input.slot")];
  const words = pretty(text || "").trim().split(/\s+/);
  slots.forEach((el, i) => { el.value = words[i] || ""; });
}
function distributeSlots(from, slots, i) {
  const raw = from.value;
  if (!raw.includes(" ")) return;
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return;
  from.value = parts[0];
  for (let k = 1; k < parts.length; k++) {
    const dest = slots[i + k];
    if (!dest) break;
    dest.value = parts[k];
  }
  const last = slots[Math.min(i + parts.length - 1, slots.length - 1)];
  last?.focus();
  if (last) last.setSelectionRange(last.value.length, last.value.length);
}
let lastSlot = null;
function wireSlots(root) {
  const slots = [...root.querySelectorAll("input.slot")];
  slots.forEach((el, i) => {
    el.addEventListener("focus", () => { lastSlot = el; });
    el.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        if (i < slots.length - 1) {
          slots[i + 1].focus();
          slots[i + 1].setSelectionRange(slots[i + 1].value.length, slots[i + 1].value.length);
        }
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && !el.value && i > 0 && (el.selectionStart === 0 || e.key === "Backspace")) {
        e.preventDefault();
        const prev = slots[i - 1];
        prev.focus();
        prev.setSelectionRange(prev.value.length, prev.value.length);
      }
    });
    el.addEventListener("input", () => distributeSlots(el, slots, i));
  });
  if (slots[0]) lastSlot = slots[0];
}
function promptHTML(cur) {
  const w = W[cur.id];
  const forms = answersFor(cur).concat(maskForms(w));
  const visual = promptVisual(w, { blank: true });
  const ans = answersFor(cur)[0];
  if (cur.mode === "blank") {
    const [a, b] = cur.sentence.sentence_pt.split("___");
    return `<div class="prompt blank">
      ${clueLine(w)}
      <div class="sentence" id="blank-sentence">${esc(a)}<span class="gap-slots">${slotsHTML(ans)}</span>${esc(b)}</div>
      <div class="clue">${visual}<p class="scene">${esc(w.scene)}</p></div>
    </div>`;
  }
  if (cur.mode === "listen") {
    return `<div class="prompt listen">
      ${clueLine(w)}
      <button class="play huge" id="say" aria-label="Play audio">▶︎</button>
      <div class="clue">${visual}<p class="scene">${esc(w.scene)}</p></div>
    </div>`;
  }
  return `<div class="prompt">
    ${clueLine(w)}
    ${visual}
    <p class="scene big">${esc(w.scene)}</p>
    <p class="def">${esc(mask(w.definition_pt, forms))}</p>
    <p class="form-en">${esc(w.english)}</p>
  </div>`;
}

function formTableHint(it) {
  if (it.kind !== "form") return "";
  const fids = IDX.formsOf[it.lemma_id] || [];
  if (fids.length < 2) return "";
  const head = IDX.L[it.lemma_id].headword;
  const rows = fids.map((id) => {
    const f = IDX.F[id], row = W[id];
    const clue = row.clue || f.label || "";
    const text = id === it.id ? "___" : f.form;
    return `<tr class="${id === it.id ? "target" : ""}"><td class="mono">${esc(text)}</td><td>${esc(clue)}</td></tr>`;
  }).join("");
  return `<div class="form-hint"><p><b>Forms of ${esc(head)}</b></p><table>${rows}</table><a href="${href(it.id)}">Word page →</a></div>`;
}
function hintHTML(cur) {
  const w = W[cur.id];
  const ans = pretty(answersFor(cur)[0]);
  const forms = answersFor(cur).concat(maskForms(w));
  const table = formTableHint(w);
  const out = [];
  if (cur.hints >= 1) {
    if (table) out.push(table);
    out.push(`<p><b>Root</b> ${esc(mask(w.root, forms))}${w.root_image ? `<br><span class="muted">${esc(mask(w.root_image, forms))}</span>` : ""}</p>`);
  }
  if (cur.hints >= 2) out.push(`<p><b>Starts with</b> <span class="mono">${esc(ans[0])}…</span></p>`);
  if (cur.hints >= 3) out.push(`<p><b>Shape</b> <span class="mono">${esc([...ans].map((c, i) => (c === " " ? "  " : i === 0 ? c : "_")).join(" "))}</span></p>`);
  if (cur.hints >= 4) out.push(`<p><b>English</b> ${esc(cur.mode === "blank" ? cur.sentence.sentence_en : w.english)}</p>`);
  return out.join("");
}

function accentBar() {
  return `<div class="accents" role="group" aria-label="Accented letters">${ACCENTS.map((c) => `<button type="button" data-ch="${c}">${c}</button>`).join("")}</div>`;
}
function insertAtCursor(input, ch) {
  if (!input || input.readOnly) return;
  const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
  input.value = input.value.slice(0, a) + ch + input.value.slice(b);
  input.focus(); input.setSelectionRange(a + ch.length, a + ch.length);
  input.dispatchEvent(new Event("input"));
}
function wireAccents(scope = document) {
  $$(".accents button", scope).forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => e.preventDefault()); // keep keyboard open
    btn.addEventListener("click", () => {
      const el = (document.activeElement?.classList.contains("slot") ? document.activeElement : lastSlot)
        || scope.querySelector?.(".slot") || $("#inp") || $("#rinp");
      insertAtCursor(el, btn.dataset.ch);
    });
  });
}

const INPUT_ATTRS = `type="text" lang="pt-BR" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="go"`;

function renderItem(cur) {
  if (cur.mode === "match") return renderMatch(cur);
  const w = W[cur.id];
  const ans = answersFor(cur)[0];
  const inlineSlots = cur.mode === "blank";
  app.innerHTML = `${sessionBar()}
  <section class="playview">
    <form id="f" class="play-form" autocomplete="off">
      ${promptHTML(cur)}
      <div class="hints" id="hints">${hintHTML(cur)}</div>
      <div class="answer">
        ${inlineSlots ? "" : slotsHTML(ans)}
        <button class="primary" id="check">Check</button>
      </div>
    </form>
    ${accentBar()}
    <div class="tools">
      <button type="button" class="ghost" id="hint">${cur.hints >= 4 ? "No more hints" : "Hint"}</button>
      <a class="ghost" href="${href(cur.id)}" id="look">${W[cur.id].kind === "phrase" ? "Phrase page" : "Word page"}</a>
      <button type="button" class="ghost" id="skip">I don't know</button>
    </div>
    <div id="fb"></div>
  </section>`;
  const form = $("#f");
  const slotRoot = form;
  wireSlots(slotRoot);
  wireAccents();
  const focusFirst = () => $("#inp")?.focus();
  $("#endsession").onclick = renderSummary;
  $("#hint").onclick = () => { if (cur.hints < 4) cur.hints++; $("#hints").innerHTML = hintHTML(cur); if (cur.hints >= 4) $("#hint").textContent = "No more hints"; focusFirst(); };
  $("#look").onclick = () => { cur.lookedUp = true; };
  $("#skip").onclick = () => submit(cur, "");
  $("#say")?.addEventListener("click", () => play(cur.id));
  form.onsubmit = (e) => { e.preventDefault(); submit(cur, readSlots(slotRoot)); };
  if (cur.mode === "listen") play(cur.id);
  if (cur.answered) showFeedback(cur); else setTimeout(focusFirst, 50);
}

function submit(cur, typed) {
  if (cur.answered) return;
  const g = grade(typed, answersFor(cur), VOCAB);
  cur.answered = true; cur.g = g; cur.typed = typed;
  const hinted = cur.hints + (cur.lookedUp ? 3 : 0);
  srs.record(state, cur.id, g.result, { hinted, mode: cur.mode });
  srs.save(state);
  if (g.result === "close") session.requeue[cur.id] = 4;
  if (g.result === "wrong") session.requeue[cur.id] = 2;
  session.results.push({ id: cur.id, mode: cur.mode, result: g.result, kind: g.kind, typed, hinted });
  play(cur.id);
  showFeedback(cur);
}

function opsHTML(ops, side) {
  if (side === "ans") {
    return ops.map((o) => o.op === "eq" ? esc(o.a) : o.op === "sub" ? `<mark class="${o.accent ? "acc" : "fix"}">${esc(o.a)}</mark>` : o.op === "del" ? `<mark class="miss">${esc(o.a)}</mark>` : "").join("");
  }
  return ops.map((o) => o.op === "eq" ? esc(o.t) : o.op === "sub" ? `<mark class="bad">${esc(o.t)}</mark>` : o.op === "ins" ? `<mark class="extra">${esc(o.t)}</mark>` : `<span class="hole">·</span>`).join("");
}
function diffHTML(g) {
  return `<div class="diff"><div><small>you typed</small><span class="mono">${opsHTML(g.ops, "typed") || "—"}</span></div><div><small>correct</small><span class="mono">${opsHTML(g.ops, "ans")}</span></div></div>`;
}
function wordCells(g) {
  const ansW = (g.answer || "").split(" ").filter(Boolean);
  const typW = (g.typed || "").split(" ").filter(Boolean);
  const n = Math.max(ansW.length, typW.length, 1);
  const cells = [];
  for (let i = 0; i < n; i++) {
    const a = ansW[i] || "", t = typW[i] || "";
    cells.push({ a, t, ops: align(t, a) });
  }
  return cells;
}
function slotDiffHTML(g) {
  const cells = wordCells(g);
  return `<div class="slots diffs">${cells.map((c) => {
    const typed = opsHTML(c.ops, "typed") || "<span class=\"hole\">·</span>";
    const ans = opsHTML(c.ops, "ans") || "—";
    return `<div class="slot-diff"><div class="you"><small>you typed</small><span class="mono">${typed}</span></div><div class="ok"><small>correct</small><span class="mono">${ans}</span></div></div>`;
  }).join("")}</div>`;
}

function showFeedback(cur) {
  const w = W[cur.id], g = cur.g;
  const slotRoot = $("#blank-sentence") || $("#f");
  fillSlots(slotRoot, cur.typed);
  $$("input.slot", slotRoot).forEach((el) => { el.readOnly = true; });
  $("#check").hidden = true; $(".tools").hidden = true; $(".playview > .accents").hidden = true;
  const full = cur.mode === "blank" ? filled(cur.sentence) : "";
  const heads = {
    exact: `<p class="verdict exact">✓ Exato${cur.hints || cur.lookedUp ? ' <small>(with hints)</small>' : ""}</p>`,
    close: `<p class="verdict close">≈ Quase — ${g.kind === "accent" ? "check the accent" : "check the spelling"}</p>`,
    wrong: `<p class="verdict wrong">${g.kind === "blank" ? "Here it is" : "✗ Not quite"}</p>`,
  };
  const confused = g.kind === "other-word" ? `<p class="note">You typed <b>${esc(g.confusedWith)}</b>, which is a different word. ${confusedItem(g.confusedWith)?.english ? `It means “${esc(confusedItem(g.confusedWith).english)}”.` : ""}</p>` : "";
  const needRetype = g.result !== "exact";
  $("#fb").innerHTML = `<div class="feedback ${g.result}">
    ${heads[g.result]}
    <p class="word"><button class="play" id="replay" aria-label="Play">▶︎</button> ${esc(w.text)} <span class="muted">· ${esc(w.english)}</span></p>
    ${full ? `<p class="sentence small">${full}</p><p class="muted small">${esc(cur.sentence.sentence_en)}</p>` : ""}
    ${g.result !== "exact" && g.kind !== "blank" ? slotDiffHTML(g) : ""}
    ${confused}
    ${g.result === "wrong" && cur.mode !== "type" ? `<p class="scene">${esc(w.scene)}</p>` : ""}${g.result === "wrong" ? `<p class="root"><b>Root</b> ${esc(w.root)}</p>` : ""}
    ${needRetype ? `<form id="rf" class="answer retype">${slotsHTML(cur.mode === "blank" ? cur.sentence.answer : w.text, { prefix: "rinp", label: "Retype" })}<button class="primary">OK</button></form>${accentBar()}` : ""}
    <div class="row"><a href="${href(cur.id)}">${w.kind === "phrase" ? "Phrase page" : "Word page"} →</a><button class="${needRetype ? "ghost" : "primary"}" id="next">${needRetype ? "Skip" : "Continue"}</button></div>
  </div>`;
  $("#replay").onclick = () => play(cur.id);
  const next = () => { cur.finished = true; nextItem(); };
  $("#next").onclick = next;
  if (needRetype) {
    const rf = $("#rf");
    wireSlots(rf);
    wireAccents(rf);
    const target = cur.mode === "blank" ? cur.sentence.answer : w.text;
    rf.onsubmit = (e) => {
      e.preventDefault();
      if (norm(readSlots(rf)) === norm(target)) { cur.retyped = true; next(); }
      else { rf.classList.remove("shake"); void rf.offsetWidth; rf.classList.add("shake"); }
    };
    setTimeout(() => $("#rinp")?.focus(), 50);
  } else {
    $("#next").focus();
  }
}

// ---------- matching ----------
function similar(a, b) {
  const A = new Set(norm(a).split(" ")), B = new Set(norm(b).split(" "));
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / Math.min(A.size, B.size) > 0.5;
}
function pickMatchSet(n) {
  const seen = IDS.filter((id) => state.words[id]?.seen);
  const pool = seen.length >= n ? seen : IDS;
  const chosen = [];
  const excl = new Set();
  let guard = 0;
  const ctx = { ...pickCtx(), introBudget: seen.length >= n ? 0 : srs.introBudget(state, IDS) };
  while (chosen.length < n && guard++ < 200) {
    const id = srs.pick(state, pool, {}, excl, ctx);
    if (!id) break;
    excl.add(id);
    if (chosen.some((c) => similar(W[c].scene, W[id].scene) || deaccent(norm(W[c].text)) === deaccent(norm(W[id].text)))) continue;
    chosen.push(id);
    if (srs.isUnseen(state, id)) session.introduced.add(id);
  }
  return chosen;
}
function matchTileMeta(id) {
  const it = W[id];
  return it.clue ? `<span class="kdetail cluechip">${esc(it.clue)}</span>` : "";
}
function tileVisual(it) {
  if (mapFor(it)) return placeMapHTML(mapFor(it), { named: false });
  if (numeralFor(it)) return numeralHTML(it, { named: false });
  return it.photo ? `<img src="media/img/${esc(it.photo)}" alt="">` : "";
}
function renderMatch(cur) {
  if (!cur.left) { cur.left = shuffle(cur.ids); cur.right = shuffle(cur.ids); }
  app.innerHTML = `${sessionBar()}
  <section class="playview match">
    <div class="mhead"><p class="kicker">Match each picture to a word or phrase</p></div>
    <div class="mgrid">
      <div class="col">${cur.left.map((id) => `<button class="tile scene-tile" data-side="L" data-id="${id}" data-kind="${W[id].kind}">${tileVisual(W[id])}<span class="tile-body"><span class="tile-meta">${matchTileMeta(id)}</span><span>${esc(W[id].scene)}</span></span></button>`).join("")}</div>
      <div class="col">${cur.right.map((id) => `<button class="tile word-tile" data-side="R" data-id="${id}" data-kind="${W[id].kind}"><span class="tile-meta">${matchTileMeta(id)}</span><span class="tile-pt">${esc(pretty(W[id].text))}</span></button>`).join("")}</div>
    </div>
    <div id="mfb"></div>
  </section>`;
  $("#endsession").onclick = renderSummary;
  for (const id of cur.found) $$(`.tile[data-id="${id}"]`).forEach((t) => t.classList.add("done"));
  let sel = null;
  $$(".tile").forEach((t) => t.addEventListener("click", () => {
    if (t.classList.contains("done")) return;
    if (!sel || sel.dataset.side === t.dataset.side) { $$(".tile.sel").forEach((x) => x.classList.remove("sel")); sel = t; t.classList.add("sel"); if (t.dataset.side === "R") play(t.dataset.id); return; }
    const a = sel, b = t; sel = null; a.classList.remove("sel");
    const L = a.dataset.side === "L" ? a : b, R = a.dataset.side === "R" ? a : b;
    if (L.dataset.id === R.dataset.id) {
      [L, R].forEach((x) => x.classList.add("done"));
      cur.found.push(L.dataset.id);
      if (R !== a) play(R.dataset.id);
      if (cur.found.length === cur.ids.length) finishMatch(cur);
    } else {
      cur.mistakes[L.dataset.id] = (cur.mistakes[L.dataset.id] || 0) + 1;
      [L, R].forEach((x) => { x.classList.remove("shake"); void x.offsetWidth; x.classList.add("shake", "miss"); setTimeout(() => x.classList.remove("miss"), 500); });
    }
  }));
  if (cur.finishedAt) finishMatch(cur, true);
}
function finishMatch(cur, again = false) {
  if (!again) {
    cur.finishedAt = true;
    for (const id of cur.ids) {
      const res = cur.mistakes[id] ? "wrong" : "exact";
      srs.record(state, id, res, { mode: "match" });
      session.results.push({ id, mode: "match", result: res, kind: res });
    }
    srs.save(state);
  }
  const miss = Object.values(cur.mistakes).reduce((a, b) => a + b, 0);
  $("#mfb").innerHTML = `<div class="feedback ${miss ? "close" : "exact"}"><p class="verdict ${miss ? "close" : "exact"}">${miss ? miss + " miss" + (miss > 1 ? "es" : "") : "clean"}</p>
    <div class="row"><span></span><button class="primary" id="next">Continue</button></div></div>`;
  $("#next").onclick = () => { cur.finished = true; nextItem(); };
  $("#next").focus();
}

// ---------- summary ----------
function renderSummary() {
  if (!session) return renderHome();
  session.done = true;
  const typed = session.results.filter((r) => r.mode !== "match");
  const c = (k) => typed.filter((r) => r.result === k).length;
  const spell = [...new Set(typed.filter((r) => r.result === "close").map((r) => r.id))];
  const missed = [...new Set(typed.filter((r) => r.result === "wrong").map((r) => r.id))];
  const matched = session.results.filter((r) => r.mode === "match");
  app.innerHTML = `<section class="card summary">
    <h2>Session ended</h2>
    <p class="muted">${typed.length} typed · ${matched.length} matched</p>
    <div class="stats"><div><b class="g">${c("exact")}</b><span>exact</span></div><div><b class="a">${c("close")}</b><span>close</span></div><div><b class="r">${c("wrong")}</b><span>wrong</span></div></div>
    ${spell.length ? `<h3>Spelling to lock in</h3><div class="chips">${spell.map((id) => `<a class="chip close" href="${href(id)}">${esc(W[id].text)}</a>`).join("")}</div>` : ""}
    ${missed.length ? `<h3>Coming back soon</h3><div class="chips">${missed.map((id) => `<a class="chip wrong" href="${href(id)}">${esc(W[id].text)}</a>`).join("")}</div>` : ""}
    <div class="row"><a class="ghost" href="#/">Home</a><button class="primary" id="again">Begin session</button></div>
  </section>`;
  $("#again").onclick = () => { session = newSession(); location.hash = "#/play"; renderPlay(); };
}

// ---------- dictionary index ----------
let filter = "all";
function lemmaMeters(id) {
  // aggregate of the taught forms (memory, spelling averaged)
  const ids = IDX.formsOf[id].filter((f) => IDX.F[f].taught);
  if (!ids.length) return "";
  const ps = ids.map((f) => state.words[f]).filter(Boolean);
  if (!ps.length) return meters("__none__");
  const avg = (k) => ps.reduce((a, p) => a + p[k], 0) / ids.length;
  const p = { mem: avg("mem"), spell: avg("spell") };
  return `<span class="meters ${srs.isSolid(p) ? "solid" : ""}" title="memory ${Math.round(p.mem * 100)}% · spelling ${Math.round(p.spell * 100)}%"><span class="meter"><i style="width:${Math.round(p.mem * 100)}%"></i></span><span class="meter sp"><i style="width:${Math.round(p.spell * 100)}%"></i></span></span>`;
}
function typeLabel(t) { return IDX.types[t] || t; }
function renderIndex(initial = "") {
  const present = [...new Set(IDX.lemmaOrder.map((id) => IDX.L[id].word_type))];
  const order = Object.keys(IDX.types).filter((t) => present.includes(t));
  const chip = (f, label, n) => `<button type="button" class="fchip${filter === f ? " on" : ""}" data-f="${f}">${esc(label)} <small>${n}</small></button>`;
  app.innerHTML = `<section class="index">
    <form id="sf"><input id="q" class="search" type="search" placeholder="Search a word, any form (uma, tenho), a phrase, or English" ${INPUT_ATTRS.replace('enterkeyhint="go"', 'enterkeyhint="search"')}></form>
    <p class="sounds-banner"><a href="#/sounds">Spelling &amp; sounds</a> — look-alike spellings that sound different</p>
    <div class="filters" role="group" aria-label="Show">
      ${chip("all", "All", IDX.lemmaOrder.length + IDX.phraseOrder.length)}${chip("words", "Words", IDX.lemmaOrder.length)}${chip("phrases", "Phrases", IDX.phraseOrder.length)}
      ${order.map((t) => chip("t:" + t, typeLabel(t), IDX.lemmaOrder.filter((id) => IDX.L[id].word_type === t).length)).join("")}
    </div>
    <div id="list"></div></section>`;
  const q = $("#q");
  q.value = initial;
  const draw = () => {
    const r = search(IDX, q.value);
    const showWords = filter !== "phrases", showPhrases = filter === "all" || filter === "phrases";
    const lem = r.lemmas.filter((x) => !filter.startsWith("t:") || IDX.L[x.id].word_type === filter.slice(2));
    const wordsHTML = showWords && lem.length ? `<h3 class="lesson">Words <small>${lem.length}</small></h3><ul class="words">${lem.map(({ id, viaForm }) => {
      const w = IDX.L[id];
      const forms = IDX.formsOf[id].map((f) => IDX.F[f].form).filter((t) => t !== w.headword);
      const via = viaForm ? `<span class="via">${esc(IDX.F[viaForm].form)} → </span>` : "";
      return `<li data-kind="word" data-id="${id}" data-type="${w.word_type}"><a href="#/word/${id}${viaForm ? "/" + viaForm : ""}"><span class="pt">${via}${esc(w.headword)}${forms.length ? `<span class="forms"> · ${esc(forms.join(", "))}</span>` : ""}</span><span class="en"><span class="wt">${esc(typeLabel(w.word_type))}</span> ${esc(w.english)}</span>${lemmaMeters(id)}</a></li>`;
    }).join("")}</ul>` : "";
    const ph = showPhrases ? r.phrases : [];
    const phrasesHTML = ph.length ? `<h3 class="lesson">Phrases <small>${ph.length}</small></h3><ul class="words">${ph.map((id) => `<li data-kind="phrase" data-id="${id}"><a href="#/phrase/${id}"><span class="pt">${esc(IDX.P[id].phrase)}</span><span class="en">${esc(IDX.P[id].english)}</span>${meters(id)}</a></li>`).join("")}</ul>` : "";
    $("#list").innerHTML = wordsHTML + phrasesHTML || `<p class="muted center">No match.</p>`;
  };
  q.oninput = draw;
  $("#sf").onsubmit = (e) => { e.preventDefault(); const to = resolve(IDX, q.value); if (to) location.hash = to; };
  $$(".fchip").forEach((b) => (b.onclick = () => { filter = b.dataset.f; $$(".fchip").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  draw();
}

// ---------- word (lemma) page ----------
function linkify(item) {
  // Link family/synonym items whose Portuguese head is a known word, form, or phrase.
  const head = item.split(" (")[0].trim();
  const k = key(pretty(head));
  const e = IDX.entries.find((x) => x.k.replace(/\s*\?$/, "") === k);
  const rest = item.slice(head.length);
  if (!e) return `<b class="pt-inline">${esc(head)}</b>${esc(rest)}`;
  const to = e.type === "phrase" ? `#/phrase/${e.phrase}` : e.type === "form" ? `#/word/${e.lemma}/${e.form}` : `#/word/${e.lemma}`;
  return `<a href="${to}">${esc(head)}</a>${esc(rest)}`;
}
function cognate(item) {
  const lang = LANGS.find((l) => item.startsWith(l + " "));
  return lang ? `<b>${esc(lang)}</b> ${esc(item.slice(lang.length + 1))}` : esc(item);
}
const sec = (title, body, cls = "") => (body ? `<section class="sec ${cls}"><h3>${title}</h3>${body}</section>` : "");
const ul = (items, f = esc) => (items && items.length ? `<ul>${items.map((x) => `<li>${f(x)}</li>`).join("")}</ul>` : "");
const sentList = (id) => (SENT[id] || []).map((s) => `<li>${filled(s)}<br><span class="muted">${esc(s.sentence_en)}</span></li>`).join("");
const fromPlay = () => session && session.current && !session.current.finished && !session.done;
const backLink = () => {
  if (fromPlay()) return `<a class="back" href="#/play">← Back to practice</a>`;
  if (location.hash.startsWith("#/sound/")) return `<a class="back" href="#/sounds">← Spelling &amp; sounds</a>`;
  return `<a class="back" href="#/words">← Dictionary</a>`;
};
const photoFig = (photo, credit, alt) => (photo ? `<figure><img class="photo" src="media/img/${esc(photo)}" alt="${esc(alt)}"><figcaption>${esc((credit || "").split(" / Wikimedia")[0])}</figcaption></figure>` : "");
const phraseLinks = (ids) => (ids.length ? `<ul class="plinks">${ids.map((p) => `<li><a href="#/phrase/${p}">${esc(IDX.P[p].phrase)}</a> <span class="muted">${esc(IDX.P[p].english)}</span></li>`).join("")}</ul>` : "");

function formCard(fid, hl) {
  const f = IDX.F[fid], it = W[fid];
  const ety = [["Root", f.root], ["Root image", f.root_image], ["Literally", f.literal], ["Parts", f.parts], ["What the parts mean", f.parts_meaning], ["History", f.origin]].filter((x) => x[1]);
  const used = IDX.formUsedIn[fid];
  const sents = sentList(fid);
  return `<section class="form-card${hl ? " hl" : ""}" id="f-${fid}" data-form="${fid}">
    <header><button class="play sm" data-say="${fid}" aria-label="Play ${esc(f.form)}">▶︎</button><h4>${esc(f.form)}</h4>${f.label ? `<span class="flabel">${esc(f.label)}</span>` : ""}${meters(fid)}</header>
    <p class="fen">${esc(f.english)}${f.tense ? ` <span class="muted">· ${esc(f.tense)}</span>` : ""}</p>
    ${it.own.photo ? photoFig(f.photo, f.photo_credit, f.english) : ""}
    ${it.own.scene ? `<p class="scene">${esc(f.scene)}</p>` : ""}
    ${it.own.definition_pt ? `<p><span class="lang">PT</span> ${esc(f.definition_pt)}</p>` : ""}
    ${ety.length ? `<details><summary>About this form</summary><dl>${ety.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl></details>` : ""}
    ${f.notes.length ? ul(f.notes) : ""}
    ${sents ? `<ul class="sents">${sents}</ul>` : ""}
    ${used.length ? `<p class="small">In phrases: ${used.map((p) => `<a href="#/phrase/${p}">${esc(IDX.P[p].phrase)}</a>`).join(" · ")}</p>` : ""}
  </section>`;
}


function wordHero(id, w) {
  const photo = w.photo ? photoFig(w.photo, w.photo_credit, w.english) : "";
  const map = hasPlaceMap(id) ? placeMapHTML(id, { named: true }) : "";
  const num = numeralFor({ id, lemma_id: id }) && !map ? numeralHTML(numeralFor({ id, lemma_id: id }), { named: true, word: w.headword }) : "";
  return (photo || num || "") + map;
}

function renderWord(id, formId = null) {
  const w = IDX.L[id];
  const i = IDX.lemmaOrder.indexOf(id), prev = IDX.lemmaOrder[i - 1], next = IDX.lemmaOrder[i + 1];
  const fids = IDX.formsOf[id];
  const first = fids[0];
  const lessons = [...new Set(fids.map((f) => IDX.F[f].lesson).filter((x) => x != null))].sort((a, b) => a - b);
  const single = fids.length === 1 && IDX.F[fids[0]].form === w.headword;
  app.innerHTML = `<article class="wordpage" data-lemma="${id}">
    ${backLink()}
    <header class="whead">
      <h1>${esc(w.headword)}</h1>
      <button class="play" id="say" aria-label="Play audio">▶︎</button>
    </header>
    <p class="meta"><span class="wt">${esc(typeLabel(w.word_type))}</span> ${esc(w.part_of_speech)} · Lesson ${lessons.join(", ") || w.lesson}</p>
    <p class="en-head">${esc(w.english)}</p>
    <section class="sec scene-sec">
      ${wordHero(id, w)}
      <p class="scene big">${esc(w.scene)}</p>
    </section>
    ${sec(single ? "Practice" : `Forms <small>${fids.length}</small>`, fids.map((f) => formCard(f, f === formId)).join(""), "forms-sec")}
    ${sec("Root", `<p class="rootline">${esc(w.root)} <span class="chip src">${esc(w.source_language)}</span></p>${w.root_image ? `<p>${esc(w.root_image)}</p>` : ""}`)}
    ${sec("Definition", `<p><span class="lang">PT</span> ${esc(w.definition_pt)}</p><p><span class="lang">EN</span> ${esc(w.english)}</p>${w.literal ? `<p class="muted">Literally: ${esc(w.literal)}</p>` : ""}`)}
    ${compareSection(id)}
    ${sec("Etymology", `${w.parts || w.parts_meaning || w.origin ? `<dl>${w.parts ? `<dt>Parts</dt><dd>${esc(w.parts)}</dd>` : ""}${w.parts_meaning ? `<dt>What the parts mean</dt><dd>${esc(w.parts_meaning)}</dd>` : ""}${w.origin ? `<dt>History</dt><dd>${esc(w.origin)}</dd>` : ""}</dl>` : ""}${ul(w.history)}`)}
    ${sec("Used in phrases", phraseLinks(IDX.usedIn[id]), "used-sec")}
    ${sec("In other languages", ul(w.cognates, cognate))}
    ${sec("Portuguese family", ul(w.pt_family, linkify))}
    ${sec("Synonyms", ul(w.synonyms, linkify))}
    ${sec("Antonyms", ul(w.antonyms, linkify))}
    ${sec("Culture", ul(w.culture))}
    ${sec("Notes", ul(w.notes))}
    ${contrastLinks(id)}
    <nav class="pager">${prev ? `<a href="#/word/${prev}">← ${esc(IDX.L[prev].headword)}</a>` : "<span></span>"}${next ? `<a href="#/word/${next}">${esc(IDX.L[next].headword)} →</a>` : "<span></span>"}</nav>
  </article>`;
  $("#say").onclick = () => play(formId || first);
  $$("[data-say]").forEach((b) => (b.onclick = () => play(b.dataset.say)));
  if (formId) requestAnimationFrame(() => $(`#f-${formId}`)?.scrollIntoView({ block: "center" }));
}

// ---------- phrase page ----------
function renderPhrase(id) {
  const p = IDX.P[id];
  const i = IDX.phraseOrder.indexOf(id), prev = IDX.phraseOrder[i - 1], next = IDX.phraseOrder[i + 1];
  const parts = p.parts_list;
  const allLinked = parts.every((c) => c.lemma);
  const words = parts.map((c) => {
    if (!c.lemma) return `<li class="nolink"><b class="pt-inline">${esc(c.surface)}</b> <span class="muted">· no word page yet</span></li>`;
    const w = IDX.L[c.lemma], f = c.form ? IDX.F[c.form] : null;
    const to = f ? `#/word/${c.lemma}/${c.form}` : `#/word/${c.lemma}`;
    return `<li><a href="${to}" data-lemma="${c.lemma}">${esc(c.surface)}</a> → <b>${esc(w.headword)}</b> <span class="muted">${esc(f && f.label ? f.label : typeLabel(w.word_type))}</span><br><span class="small">${esc(w.english)} · <span class="muted">${esc(w.root)}</span></span></li>`;
  }).join("");
  const sents = sentList(id);
  app.innerHTML = `<article class="wordpage phrasepage" data-phrase="${id}">
    ${backLink()}
    <header class="whead"><h1>${esc(p.phrase)}</h1><button class="play" id="say" aria-label="Play audio">▶︎</button></header>
    <p class="meta"><span class="wt">Phrase</span> ${esc(p.part_of_speech)} · Lesson ${p.lesson}</p>
    ${meters(id, true)}
    <section class="sec scene-sec">${photoFig(p.photo, p.photo_credit, p.english)}<p class="scene big">${esc(p.scene)}</p></section>
    ${sec("Meaning", `<p><span class="lang">PT</span> ${esc(p.definition_pt)}</p><p><span class="lang">EN</span> ${esc(p.english)}</p>${p.literal ? `<p class="muted">Literally: ${esc(p.literal)}</p>` : ""}`)}
    ${sec("Words in this phrase", `<ul class="components">${words}</ul>`, "components-sec")}
    ${sec("How it's built", `<dl>${!allLinked && p.root ? `<dt>Roots</dt><dd>${esc(p.root)}${p.source_language ? ` <span class="chip src">${esc(p.source_language)}</span>` : ""}</dd>` : ""}${p.root_image ? `<dt>Root image</dt><dd>${esc(p.root_image)}</dd>` : ""}${p.parts ? `<dt>Parts</dt><dd>${esc(p.parts)}</dd>` : ""}${p.parts_meaning ? `<dt>What the parts mean</dt><dd>${esc(p.parts_meaning)}</dd>` : ""}${p.origin ? `<dt>History</dt><dd>${esc(p.origin)}</dd>` : ""}</dl>${ul(p.history)}`)}
    ${sec("In use", sents ? `<ul class="sents">${sents}</ul>` : "")}
    ${sec("In other languages", ul(p.cognates, cognate))}
    ${sec("Related", ul(p.pt_family, linkify))}
    ${sec("Synonyms", ul(p.synonyms, linkify))}
    ${sec("Antonyms", ul(p.antonyms, linkify))}
    ${sec("Culture", ul(p.culture))}
    ${sec("Notes", ul(p.notes))}
    <nav class="pager">${prev ? `<a href="#/phrase/${prev}">← ${esc(IDX.P[prev].phrase)}</a>` : "<span></span>"}${next ? `<a href="#/phrase/${next}">${esc(IDX.P[next].phrase)} →</a>` : "<span></span>"}</nav>
  </article>`;
  $("#say").onclick = () => play(id);
}

// ---------- about ----------
function renderAbout() {
  const photos = [...Object.values(IDX.L).filter((w) => w.photo).map((w) => [w.headword, w.photo_credit]),
    ...Object.values(IDX.F).filter((f) => f.photo).map((f) => [f.form, f.photo_credit])];
  const lessons = IDS.map((i) => W[i].lesson);
  app.innerHTML = `<section class="card about">
    <h2>About</h2>
    <p>${IDX.lemmaOrder.length} words (${Object.keys(IDX.F).length} forms) and ${IDX.phraseOrder.length} phrases from Pimsleur Brazilian Portuguese, lessons ${Math.min(...lessons)}–${Math.max(...lessons)}. Audio: Microsoft Edge neural voice pt-BR-AntonioNeural. Works offline once loaded.</p>
    <p id="offline" class="muted">Checking offline status…</p>
    <h3>Your progress</h3>
    <p class="muted">Saved on this device only. Export it to move it to another phone or browser.</p>
    <div class="row wrap"><button class="ghost" id="exp">Export progress</button><label class="ghost file">Import<input type="file" id="imp" accept="application/json" hidden></label><button class="ghost danger" id="reset">Reset</button></div>
    <h3>Photo credits</h3>
    <ul class="small">${photos.map(([t, c]) => `<li><b>${esc(t)}</b>: ${esc(c)}</li>`).join("")}</ul>
    <p class="muted small">Data version ${esc(DATA.data_hash)}</p>
  </section>`;
  navigator.serviceWorker?.getRegistration().then((r) => { $("#offline") && ($("#offline").textContent = r?.active ? "✓ Ready for offline use." : "Not cached for offline yet: open once with a connection."); });
  $("#exp").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `raiz-progress-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  $("#imp").onchange = async (e) => {
    try {
      const s = JSON.parse(await e.target.files[0].text()); if (!s.words) throw 0;
      state = s.version === 2 ? s : migrateProgress(s, IDX); // older exports are migrated to the new ids
      srs.save(state); toast("Progress imported");
    } catch { toast("That file isn't a progress export"); }
  };
  $("#reset").onclick = () => { if (confirm("Erase all progress on this device?")) { state = { version: 2, words: {}, log: [] }; srs.save(state); toast("Progress reset"); } };
}

// ---------- boot ----------
async function init() {
  DATA = await (await fetch("data/words.json")).json();
  IDX = buildIndex(DATA);
  W = IDX.I; IDS = IDX.items;
  for (const s of DATA.sentences) (SENT[s.item_id] ||= []).push(s);
  VOCAB = IDX.vocab;
  state = srs.load((old) => migrateProgress(old, IDX));
  window.addEventListener("hashchange", route);
  route();
  // warm the audio blobs in the background
  (async () => { for (const id of Object.keys(W)) { try { await warm(W[id].audio); } catch {} } })();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("sw", e));
    let had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (had) toast("Updated: new words load next time you open the app.", 4000); had = true; });
  }
}
window.__raiz = { grade, srs, dict: { buildIndex, search, resolve, hrefFor, migrateProgress, formClue }, maps: { hasPlaceMap, placeMapHTML }, numerals: { numeralFor, numeralHTML }, get state() { return state; }, get session() { return session; }, get W() { return W; }, get IDX() { return IDX; } };
init();
