// Stylized numerals for number lemmas (and um / uma, which are also "one").
const GLYPH = {
  um: "1", uma: "1",
  dois: "2", duas: "2",
  tres: "3", quatro: "4", cinco: "5", seis: "6", sete: "7",
  oito: "8", nove: "9", dez: "10",
  onze: "11", doze: "12", treze: "13", catorze: "14", quinze: "15",
  dezesseis: "16", dezessete: "17", dezoito: "18", dezenove: "19",
  vinte: "20",
  cem: "100", cento: "101+",
  mil: "1.000",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function numeralFor(it) {
  if (!it) return null;
  if (GLYPH[it.id]) return { id: it.id, glyph: GLYPH[it.id] };
  if (it.lemma_id && GLYPH[it.lemma_id]) return { id: it.lemma_id, glyph: GLYPH[it.lemma_id] };
  return null;
}

export function hasNumeral(it) { return !!numeralFor(it); }

/** named=true writes the Portuguese word under the digit (word page). Otherwise a blank. */
export function numeralHTML(it, { named = false, word = "" } = {}) {
  const n = typeof it === "object" && it && it.glyph ? it : numeralFor(it);
  if (!n) return "";
  const under = named && word
    ? `<span class="num-word">${esc(word)}</span>`
    : named ? "" : `<span class="num-blank">___</span>`;
  return `<div class="numeral${named ? " named" : ""}" data-num="${esc(n.id)}"><span class="num-glyph">${esc(n.glyph)}</span>${under}</div>`;
}

export { GLYPH as NUMERAL_GLYPH };
