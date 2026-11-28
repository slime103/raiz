// Offline stylized place maps (Natural Earth 110m, public domain).
import { PLACE_MAPS } from "./maps-data.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const hasPlaceMap = (lemmaId) => !!PLACE_MAPS[lemmaId];

/** Named=false draws one ___ per word (Nova York → two blanks). */
export function placeMapHTML(lemmaId, { named = false } = {}) {
  const m = PLACE_MAPS[lemmaId];
  if (!m) return "";
  const words = m.name.split(/\s+/);
  const label = named
    ? `<span class="map-name">${esc(m.name)}</span>`
    : words.map(() => `<span class="map-blank">___</span>`).join("");
  const left = ((m.lx / m.vw) * 100).toFixed(2);
  const top = ((m.ly / m.vh) * 100).toFixed(2);
  return `<div class="place-map" data-place="${esc(lemmaId)}">${m.svg}<div class="map-label" style="left:${left}%;top:${top}%">${label}</div></div>`;
}

export { PLACE_MAPS };
