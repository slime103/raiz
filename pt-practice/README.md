# Raiz: Brazilian Portuguese practice (offline PWA)

Plain HTML/CSS/JS, no build step. Open `index.html` through any static web server.

- Practice: `#/play`, a ~5-minute session mixing *type the word* (scene + photo + Portuguese definition),
  *listen and type*, *fill in the blank*, and *timed matching*.
- Grading: exact / close (accent or small typo: memory counts, letters highlighted, spelling weakens) / wrong.
  Typing a *different* known word (obrigada for obrigado) is wrong, not close.
- Two scores per word (memory, spelling) in `localStorage` with spaced repetition toward weak items.
- Word pages: `#/word/<id>`. Index: `#/words`.
- Offline: `sw.js` precaches everything listed in `sw-assets.js`.

Data: see `data/SCHEMA.md`. Rebuild after editing CSVs: `python3 tools/build_data.py`.
Local test: `python3 -m http.server 8765` in this folder, open http://localhost:8765/.
`tools/seed_words.py` + `tools/enrich.py` + `tools/etymology_doc.md` are the one-time seeding sources (kept for provenance).
