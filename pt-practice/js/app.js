import { grade, norm, deaccent } from "./grade.js";
import * as srs from "./srs.js";

const SESSION_MS = 5 * 60 * 1000;
const PATTERN = ["type", "blank", "type", "blank", "listen", "blank", "match"];
const ACCENTS = ["ã", "á", "â", "à", "é", "ê", "í", "ó", "ô", "õ", "ú", "ç"];
const LANGS = ["English", "Spanish", "French", "Italian", "German", "Dutch", "Swedish", "Latin", "Spanish/Italian", "Spanish/French", "old English"];

let DATA, W = {}, IDS = [], SENT = {}, VOCAB = [];
let state = srs.load();
let session = null;
const app = document.getElementById("app");

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const filled = (s) => { const a = s.sentence_pt.startsWith("___") ? s.answer[0].toUpperCase() + s.answer.slice(1) : s.answer; return s.sentence_pt.split("___").map(esc).join(`<b>${esc(a)}</b>`); };
const pretty = (s) => s.replace(/\?$/, "");
const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
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

// ---------- audio (blob URLs so playback works from the offline cache on iOS) ----------
const blobs = {};
async function warm(file) {
  if (blobs[file]) return blobs[file];
  const r = await fetch("media/audio/" + file);
  if (!r.ok) throw new Error("audio " + r.status);
  return (blobs[file] = URL.createObjectURL(await r.blob()));
}
let player = null;
function play(id) {
  const w = W[id]; if (!w) return;
  const go = (u) => { try { player?.pause(); player = new Audio(u); player.play().catch(() => {}); } catch {} };
  if (blobs[w.audio]) go(blobs[w.audio]); else warm(w.audio).then(go).catch(() => toast("Audio not available"));
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

// ---------- routing ----------
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [view, arg] = h.split("/");
  $$("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === (view || "home")));
  window.scrollTo(0, 0);
  if (view === "play") return renderPlay();
  if (view === "words") return renderIndex();
  if (view === "word" && W[decodeURIComponent(arg)]) return renderWord(decodeURIComponent(arg));
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
    <button class="primary big" id="start">${session && !session.done ? "Resume session" : "Start a 5-minute session"}</button>
    <p class="sub">Type the word · fill the blank · timed matching</p>
  </section>
  <section class="stats">
    <div><b>${IDS.length}</b><span>words</span></div>
    <div><b>${seen.length}</b><span>practiced</span></div>
    <div><b>${solid.length}</b><span>solid</span></div>
  </section>
  ${spellWeak.length ? `<section class="card"><h3>Spelling to lock in</h3><div class="chips">${spellWeak.map((id) => `<a class="chip" href="#/word/${id}">${esc(W[id].portuguese)}</a>`).join("")}</div></section>` : ""}
  <section class="card legend">
    <h3>How grading works</h3>
    <p><span class="tag exact">Exact</span> right word, right spelling.</p>
    <p><span class="tag close">Close</span> right word, a typo or missing accent: memory counts, the letters are highlighted and spelling is marked to practice.</p>
    <p><span class="tag wrong">Wrong</span> you see the picture, root, and answer, and it comes back soon.</p>
    <p class="muted">Each word has two bars: <span class="meter inline"><i style="width:70%"></i></span> memory and <span class="meter sp inline"><i style="width:40%"></i></span> spelling. A word is solid when both are full.</p>
  </section>
  <p class="center"><a href="#/words">Browse all ${IDS.length} words →</a></p>`;
  $("#start").onclick = () => { if (!session || session.done) session = null; location.hash = "#/play"; };
}

// ---------- play ----------
function newSession() {
  return { start: Date.now(), end: Date.now() + SESSION_MS, step: 0, results: [], requeue: {}, current: null, done: false };
}
function renderPlay() {
  if (!session || session.done) session = newSession();
  if (session.current && !session.current.finished) return renderItem(session.current);
  nextItem();
}
function nextItem() {
  if (Date.now() >= session.end && session.results.length) return renderSummary();
  const mode = PATTERN[session.step % PATTERN.length];
  session.step++;
  srs.tick(session.requeue);
  if (mode === "match") {
    session.current = { mode: "match", ids: pickMatchSet(5), found: [], mistakes: {}, t0: Date.now() };
    return renderItem(session.current);
  }
  const recent = new Set(session.results.slice(-2).map((r) => r.id));
  let id = srs.pick(state, IDS, session.requeue, recent);
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
  const left = session.end - Date.now();
  const pct = Math.min(100, ((Date.now() - session.start) / SESSION_MS) * 100);
  return `<div class="sbar"><div class="track"><i style="width:${pct}%"></i></div><span id="clock">${left > 0 ? fmt(left) : "last one"}</span><button class="link" id="endnow">End</button></div>`;
}
let clockTimer;
function startClock() {
  clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    const c = $("#clock"); if (!c || !session) return clearInterval(clockTimer);
    const left = session.end - Date.now();
    c.textContent = left > 0 ? fmt(left) : "last one";
    const bar = $(".sbar .track i"); if (bar) bar.style.width = Math.min(100, ((Date.now() - session.start) / SESSION_MS) * 100) + "%";
  }, 1000);
}

function answersFor(cur) {
  const w = W[cur.id];
  if (cur.mode === "blank") return [cur.sentence.answer, ...cur.sentence.accept_also];
  return [w.portuguese, ...w.accept_also];
}

function promptHTML(cur) {
  const w = W[cur.id];
  const forms = answersFor(cur).concat([w.portuguese]);
  const photo = w.photo ? `<img class="photo" src="media/img/${esc(w.photo)}" alt="">` : "";
  if (cur.mode === "blank") {
    const [a, b] = cur.sentence.sentence_pt.split("___");
    return `<div class="prompt blank">
      <p class="kicker">Fill in the blank</p>
      <p class="sentence">${esc(a)}<span class="gap">_____</span>${esc(b)}</p>
      <div class="clue">${photo}<p class="scene">${esc(w.scene)}</p></div>
    </div>`;
  }
  if (cur.mode === "listen") {
    return `<div class="prompt listen">
      <p class="kicker">Listen and type</p>
      <button class="play huge" id="say" aria-label="Play audio">▶︎</button>
      <div class="clue">${photo}<p class="scene">${esc(w.scene)}</p></div>
    </div>`;
  }
  return `<div class="prompt">
    <p class="kicker">Type the word</p>
    ${photo}
    <p class="scene big">${esc(w.scene)}</p>
    <p class="def">${esc(mask(w.definition_pt, forms))}</p>
  </div>`;
}

function hintHTML(cur) {
  const w = W[cur.id];
  const ans = pretty(answersFor(cur)[0]);
  const forms = answersFor(cur).concat([w.portuguese]);
  const out = [];
  if (cur.hints >= 1) out.push(`<p><b>Root</b> ${esc(mask(w.root, forms))}${w.root_image ? `<br><span class="muted">${esc(mask(w.root_image, forms))}</span>` : ""}</p>`);
  if (cur.hints >= 2) out.push(`<p><b>Starts with</b> <span class="mono">${esc(ans[0])}…</span></p>`);
  if (cur.hints >= 3) out.push(`<p><b>Shape</b> <span class="mono">${esc([...ans].map((c, i) => (c === " " ? "  " : i === 0 ? c : "_")).join(" "))}</span></p>`);
  if (cur.hints >= 4) out.push(`<p><b>English</b> ${esc(cur.mode === "blank" ? cur.sentence.sentence_en : w.english)}</p>`);
  return out.join("");
}

function accentBar() {
  return `<div class="accents" role="group" aria-label="Accented letters">${ACCENTS.map((c) => `<button type="button" data-ch="${c}">${c}</button>`).join("")}</div>`;
}
function wireAccents(input) {
  $$(".accents button").forEach((b) => {
    b.addEventListener("pointerdown", (e) => e.preventDefault()); // keep keyboard open
    b.addEventListener("click", () => {
      const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
      input.value = input.value.slice(0, s) + b.dataset.ch + input.value.slice(e);
      input.focus(); input.setSelectionRange(s + 1, s + 1);
      input.dispatchEvent(new Event("input"));
    });
  });
}

const INPUT_ATTRS = `type="text" lang="pt-BR" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="go"`;

function renderItem(cur) {
  if (cur.mode === "match") return renderMatch(cur);
  const w = W[cur.id];
  app.innerHTML = `${sessionBar()}
  <section class="playview">
    ${promptHTML(cur)}
    <div class="hints" id="hints">${hintHTML(cur)}</div>
    <form id="f" class="answer" autocomplete="off">
      <input id="inp" ${INPUT_ATTRS} placeholder="${cur.mode === "blank" ? "missing word(s)" : "em português"}" aria-label="Your answer">
      <button class="primary" id="check">Check</button>
    </form>
    ${accentBar()}
    <div class="tools">
      <button type="button" class="ghost" id="hint">${cur.hints >= 4 ? "No more hints" : "Hint"}</button>
      <a class="ghost" href="#/word/${cur.id}" id="look">Word page</a>
      <button type="button" class="ghost" id="skip">I don't know</button>
    </div>
    <div id="fb"></div>
  </section>`;
  startClock();
  const inp = $("#inp");
  wireAccents(inp);
  $("#endnow").onclick = renderSummary;
  $("#hint").onclick = () => { if (cur.hints < 4) cur.hints++; $("#hints").innerHTML = hintHTML(cur); if (cur.hints >= 4) $("#hint").textContent = "No more hints"; inp.focus(); };
  $("#look").onclick = () => { cur.lookedUp = true; };
  $("#skip").onclick = () => submit(cur, "");
  $("#say")?.addEventListener("click", () => play(cur.id));
  $("#f").onsubmit = (e) => { e.preventDefault(); submit(cur, inp.value); };
  if (cur.mode === "listen") play(cur.id);
  if (cur.answered) showFeedback(cur); else setTimeout(() => inp.focus(), 50);
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

function diffHTML(g) {
  const ans = g.ops.map((o) => o.op === "eq" ? esc(o.a) : o.op === "sub" ? `<mark class="${o.accent ? "acc" : "fix"}">${esc(o.a)}</mark>` : o.op === "del" ? `<mark class="miss">${esc(o.a)}</mark>` : "").join("");
  const typed = g.ops.map((o) => o.op === "eq" ? esc(o.t) : o.op === "sub" ? `<mark class="bad">${esc(o.t)}</mark>` : o.op === "ins" ? `<mark class="extra">${esc(o.t)}</mark>` : `<span class="hole">·</span>`).join("");
  return `<div class="diff"><div><small>you typed</small><span class="mono">${typed || "—"}</span></div><div><small>correct</small><span class="mono">${ans}</span></div></div>`;
}

function showFeedback(cur) {
  const w = W[cur.id], g = cur.g;
  const inp = $("#inp"); inp.value = cur.typed; inp.readOnly = true;
  $("#check").hidden = true; $(".tools").hidden = true; $(".playview > .accents").hidden = true;
  const full = cur.mode === "blank" ? filled(cur.sentence) : "";
  const heads = {
    exact: `<p class="verdict exact">✓ Exato${cur.hints || cur.lookedUp ? ' <small>(with hints)</small>' : ""}</p>`,
    close: `<p class="verdict close">≈ Quase — ${g.kind === "accent" ? "check the accent" : "check the spelling"}</p>`,
    wrong: `<p class="verdict wrong">${g.kind === "blank" ? "Here it is" : "✗ Not quite"}</p>`,
  };
  const confused = g.kind === "other-word" ? `<p class="note">You typed <b>${esc(g.confusedWith)}</b>, which is a different word. ${W[IDS.find((i) => norm(W[i].portuguese) === g.confusedWith)]?.english ? `It means “${esc(W[IDS.find((i) => norm(W[i].portuguese) === g.confusedWith)].english)}”.` : ""}</p>` : "";
  const needRetype = g.result !== "exact";
  $("#fb").innerHTML = `<div class="feedback ${g.result}">
    ${heads[g.result]}
    <p class="word"><button class="play" id="replay" aria-label="Play">▶︎</button> ${esc(w.portuguese)} <span class="muted">· ${esc(w.english)}</span></p>
    ${full ? `<p class="sentence small">${full}</p><p class="muted small">${esc(cur.sentence.sentence_en)}</p>` : ""}
    ${g.result !== "exact" && g.kind !== "blank" ? diffHTML(g) : ""}
    ${confused}
    ${g.result === "wrong" && cur.mode !== "type" ? `<p class="scene">${esc(w.scene)}</p>` : ""}${g.result === "wrong" ? `<p class="root"><b>Root</b> ${esc(w.root)}</p>` : ""}
    ${needRetype ? `<form id="rf" class="answer retype"><input id="rinp" ${INPUT_ATTRS} placeholder="type it once, exactly" aria-label="Retype the answer"><button class="primary">OK</button></form>${accentBar()}` : ""}
    <div class="row"><a href="#/word/${cur.id}">Word page →</a><button class="${needRetype ? "ghost" : "primary"}" id="next">${needRetype ? "Skip" : "Continue"}</button></div>
  </div>`;
  $("#replay").onclick = () => play(cur.id);
  const next = () => { cur.finished = true; nextItem(); };
  $("#next").onclick = next;
  if (needRetype) {
    const r = $("#rinp"); wireAccents(r);
    const target = cur.mode === "blank" ? cur.sentence.answer : w.portuguese;
    $("#rf").onsubmit = (e) => {
      e.preventDefault();
      if (norm(r.value) === norm(target)) { cur.retyped = true; next(); }
      else { r.classList.remove("shake"); void r.offsetWidth; r.classList.add("shake"); }
    };
    setTimeout(() => r.focus(), 50);
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
  const chosen = [];
  const excl = new Set();
  let guard = 0;
  while (chosen.length < n && guard++ < 200) {
    const id = srs.pick(state, IDS, {}, excl);
    excl.add(id);
    if (chosen.some((c) => similar(W[c].scene, W[id].scene) || deaccent(norm(W[c].portuguese)) === deaccent(norm(W[id].portuguese)))) continue;
    chosen.push(id);
  }
  return chosen;
}
function renderMatch(cur) {
  if (!cur.left) { cur.left = shuffle(cur.ids); cur.right = shuffle(cur.ids); }
  app.innerHTML = `${sessionBar()}
  <section class="playview match">
    <div class="mhead"><p class="kicker">Match the picture to the word</p><span class="mclock" id="mclock">0:00</span></div>
    <div class="mgrid">
      <div class="col">${cur.left.map((id) => `<button class="tile scene-tile" data-side="L" data-id="${id}">${W[id].photo ? `<img src="media/img/${esc(W[id].photo)}" alt="">` : ""}<span>${esc(W[id].scene)}</span></button>`).join("")}</div>
      <div class="col">${cur.right.map((id) => `<button class="tile word-tile" data-side="R" data-id="${id}">${esc(pretty(W[id].portuguese))}</button>`).join("")}</div>
    </div>
    <div id="mfb"></div>
  </section>`;
  startClock();
  $("#endnow").onclick = renderSummary;
  for (const id of cur.found) $$(`.tile[data-id="${id}"]`).forEach((t) => t.classList.add("done"));
  let sel = null;
  const mclock = setInterval(() => { const c = $("#mclock"); if (!c || cur.finishedAt) return clearInterval(mclock); c.textContent = fmt(Date.now() - cur.t0); }, 250);
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
    cur.finishedAt = Date.now();
    const time = cur.finishedAt - cur.t0;
    for (const id of cur.ids) {
      const res = cur.mistakes[id] ? "wrong" : "exact";
      srs.record(state, id, res, { mode: "match" });
      session.results.push({ id, mode: "match", result: res, kind: res });
    }
    const best = state.bestMatch || Infinity;
    cur.best = time < best;
    if (cur.best) state.bestMatch = time;
    srs.save(state);
  }
  const time = cur.finishedAt - cur.t0;
  const miss = Object.values(cur.mistakes).reduce((a, b) => a + b, 0);
  $("#mfb").innerHTML = `<div class="feedback ${miss ? "close" : "exact"}"><p class="verdict ${miss ? "close" : "exact"}">${fmt(time)} · ${miss ? miss + " miss" + (miss > 1 ? "es" : "") : "clean"}${cur.best ? " · personal best" : ""}</p>
    <div class="row"><span></span><button class="primary" id="next">Continue</button></div></div>`;
  $("#next").onclick = () => { cur.finished = true; nextItem(); };
  $("#next").focus();
}

// ---------- summary ----------
function renderSummary() {
  clearInterval(clockTimer);
  if (!session) return renderHome();
  session.done = true;
  const typed = session.results.filter((r) => r.mode !== "match");
  const c = (k) => typed.filter((r) => r.result === k).length;
  const spell = [...new Set(typed.filter((r) => r.result === "close").map((r) => r.id))];
  const missed = [...new Set(typed.filter((r) => r.result === "wrong").map((r) => r.id))];
  const matched = session.results.filter((r) => r.mode === "match");
  app.innerHTML = `<section class="card summary">
    <h2>Session done</h2>
    <p class="muted">${fmt(Date.now() - session.start)} · ${typed.length} typed · ${matched.length} matched</p>
    <div class="stats"><div><b class="g">${c("exact")}</b><span>exact</span></div><div><b class="a">${c("close")}</b><span>close</span></div><div><b class="r">${c("wrong")}</b><span>wrong</span></div></div>
    ${spell.length ? `<h3>Spelling to lock in</h3><div class="chips">${spell.map((id) => `<a class="chip close" href="#/word/${id}">${esc(W[id].portuguese)}</a>`).join("")}</div>` : ""}
    ${missed.length ? `<h3>Coming back soon</h3><div class="chips">${missed.map((id) => `<a class="chip wrong" href="#/word/${id}">${esc(W[id].portuguese)}</a>`).join("")}</div>` : ""}
    <div class="row"><a class="ghost" href="#/">Home</a><button class="primary" id="again">Another 5 minutes</button></div>
  </section>`;
  $("#again").onclick = () => { session = newSession(); location.hash = "#/play"; renderPlay(); };
}

// ---------- word index ----------
function renderIndex() {
  const lessons = [...new Set(IDS.map((id) => W[id].lesson))].sort((a, b) => a - b);
  app.innerHTML = `<section class="index">
    <input id="q" class="search" type="search" placeholder="Search Portuguese or English" ${INPUT_ATTRS.replace('enterkeyhint="go"', "")}>
    <div id="list"></div></section>`;
  const draw = (q) => {
    const nq = deaccent(norm(q));
    const match = (id) => !nq || deaccent(norm(W[id].portuguese)).includes(nq) || norm(W[id].english).includes(nq);
    $("#list").innerHTML = lessons.map((L) => {
      const ids = IDS.filter((id) => W[id].lesson === L && match(id));
      if (!ids.length) return "";
      return `<h3 class="lesson">Lesson ${L}</h3><ul class="words">${ids.map((id) => `<li><a href="#/word/${id}"><span class="pt">${esc(W[id].portuguese)}</span><span class="en">${esc(W[id].english)}</span>${meters(id)}</a></li>`).join("")}</ul>`;
    }).join("") || `<p class="muted center">No match.</p>`;
  };
  $("#q").oninput = (e) => draw(e.target.value);
  draw("");
}

// ---------- word page ----------
function linkify(item) {
  // Link family/synonym items whose Portuguese head is one of the known words.
  const head = item.split(" (")[0].trim();
  const id = IDS.find((i) => norm(W[i].portuguese) === norm(head) || norm(pretty(W[i].portuguese)) === norm(head));
  const rest = item.slice(head.length);
  return id ? `<a href="#/word/${id}">${esc(head)}</a>${esc(rest)}` : `<b class="pt-inline">${esc(head)}</b>${esc(rest)}`;
}
function cognate(item) {
  const lang = LANGS.find((l) => item.startsWith(l + " "));
  return lang ? `<b>${esc(lang)}</b> ${esc(item.slice(lang.length + 1))}` : esc(item);
}
const sec = (title, body, cls = "") => (body ? `<section class="sec ${cls}"><h3>${title}</h3>${body}</section>` : "");
const ul = (items, f = esc) => (items.length ? `<ul>${items.map((x) => `<li>${f(x)}</li>`).join("")}</ul>` : "");

function renderWord(id) {
  const w = W[id];
  const i = IDS.indexOf(id), prev = IDS[i - 1], next = IDS[i + 1];
  const fromPlay = session && session.current && !session.current.finished && !session.done;
  const sents = (SENT[id] || []).map((s) => `<li>${filled(s)}<br><span class="muted">${esc(s.sentence_en)}</span></li>`).join("");
  app.innerHTML = `<article class="wordpage">
    ${fromPlay ? `<a class="back" href="#/play">← Back to practice</a>` : `<a class="back" href="#/words">← All words</a>`}
    <header class="whead">
      <h1>${esc(w.portuguese)}</h1>
      <button class="play" id="say" aria-label="Play audio">▶︎</button>
    </header>
    <p class="meta">${esc(w.part_of_speech)} · Lesson ${w.lesson}</p>
    ${meters(id, true)}
    <section class="sec scene-sec">
      ${w.photo ? `<figure><img class="photo" src="media/img/${esc(w.photo)}" alt="${esc(w.english)}"><figcaption>${esc(w.photo_credit.split(" / Wikimedia")[0])}</figcaption></figure>` : ""}
      <p class="scene big">${esc(w.scene)}</p>
    </section>
    ${sec("Root", `<p class="rootline">${esc(w.root)} <span class="chip src">${esc(w.source_language)}</span></p>${w.root_image ? `<p>${esc(w.root_image)}</p>` : ""}`)}
    ${sec("Definition", `<p><span class="lang">PT</span> ${esc(w.definition_pt)}</p><p><span class="lang">EN</span> ${esc(w.english)}</p>${w.literal ? `<p class="muted">Literally: ${esc(w.literal)}</p>` : ""}`)}
    ${sec("Etymology", `<dl>${w.parts ? `<dt>Parts</dt><dd>${esc(w.parts)}</dd>` : ""}${w.parts_meaning ? `<dt>What the parts mean</dt><dd>${esc(w.parts_meaning)}</dd>` : ""}${w.origin ? `<dt>History</dt><dd>${esc(w.origin)}</dd>` : ""}</dl>${ul(w.history)}`)}
    ${sec("In other languages", ul(w.cognates, cognate))}
    ${sec("Portuguese family", ul(w.pt_family, linkify))}
    ${sec("Synonyms", ul(w.synonyms, linkify))}
    ${sec("Antonyms", ul(w.antonyms, linkify))}
    ${sec("In use", sents ? `<ul class="sents">${sents}</ul>` : "")}
    ${sec("Culture", ul(w.culture))}
    ${sec("Notes", ul(w.notes))}
    <nav class="pager">${prev ? `<a href="#/word/${prev}">← ${esc(W[prev].portuguese)}</a>` : "<span></span>"}${next ? `<a href="#/word/${next}">${esc(W[next].portuguese)} →</a>` : "<span></span>"}</nav>
  </article>`;
  $("#say").onclick = () => play(id);
}

// ---------- about ----------
function renderAbout() {
  const photos = IDS.filter((id) => W[id].photo);
  app.innerHTML = `<section class="card about">
    <h2>About</h2>
    <p>${IDS.length} words from Pimsleur Brazilian Portuguese, lessons ${Math.min(...IDS.map((i) => W[i].lesson))}–${Math.max(...IDS.map((i) => W[i].lesson))}. Audio: Microsoft Edge neural voice pt-BR-AntonioNeural. Works offline once loaded.</p>
    <p id="offline" class="muted">Checking offline status…</p>
    <h3>Your progress</h3>
    <p class="muted">Saved on this device only. Export it to move it to another phone or browser.</p>
    <div class="row wrap"><button class="ghost" id="exp">Export progress</button><label class="ghost file">Import<input type="file" id="imp" accept="application/json" hidden></label><button class="ghost danger" id="reset">Reset</button></div>
    <h3>Photo credits</h3>
    <ul class="small">${photos.map((id) => `<li><b>${esc(W[id].portuguese)}</b>: ${esc(W[id].photo_credit)}</li>`).join("")}</ul>
    <p class="muted small">Data version ${esc(DATA.data_hash)}</p>
  </section>`;
  navigator.serviceWorker?.getRegistration().then((r) => { $("#offline") && ($("#offline").textContent = r?.active ? "✓ Ready for offline use." : "Not cached for offline yet: open once with a connection."); });
  $("#exp").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `raiz-progress-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  $("#imp").onchange = async (e) => {
    try { const s = JSON.parse(await e.target.files[0].text()); if (!s.words) throw 0; state = s; srs.save(state); toast("Progress imported"); }
    catch { toast("That file isn't a progress export"); }
  };
  $("#reset").onclick = () => { if (confirm("Erase all progress on this device?")) { state = { words: {}, log: [] }; srs.save(state); toast("Progress reset"); } };
}

// ---------- boot ----------
async function init() {
  DATA = await (await fetch("data/words.json")).json();
  for (const w of DATA.words) { W[w.id] = w; IDS.push(w.id); }
  for (const s of DATA.sentences) (SENT[s.word_id] ||= []).push(s);
  VOCAB = DATA.words.flatMap((w) => [w.portuguese, ...w.accept_also]);
  window.addEventListener("hashchange", route);
  route();
  // warm the audio blobs in the background
  (async () => { for (const w of DATA.words) { try { await warm(w.audio); } catch {} } })();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("sw", e));
    let had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (had) toast("Updated: new words load next time you open the app.", 4000); had = true; });
  }
}
window.__raiz = { grade, srs, get state() { return state; }, get session() { return session; }, W };
init();
