# Raiz

Offline practice for Pimsleur Brazilian Portuguese. Not translating — relating.

Open the app: **https://slime103.github.io/raiz/**

On an iPhone: open that link once in Safari (with a connection), then Share → Add to Home Screen. After that it works on the subway, with no signal.

## Practice

Begin a session when you like, and end it when you're done. A session mixes *type the word*, *fill in the blank*, *listen and type*, and *matching*. Each prompt says whether the answer is a word (and which form, when a word has more than one) or a phrase. No card flipping.

Answers are graded exact, close (right word, typo or missing accent — memory counts, the letters are highlighted, spelling is marked weak), or wrong. Each word has two scores, memory and spelling, saved on this device.

The dictionary has **words** and **phrases**. Each word has one page headed by its root form (um covers um and uma; ter covers eu tenho and você tem), with each gender, number, or conjugation as its own subsection with audio. Each phrase has its own page that links to the words in it, and every word page lists the phrases that use it. The index is alphabetical, with filters for Words, Phrases, and word type (person, thing, verb, adjective, …). Search any form (uma, tenho, reais) to land on its word page with that form highlighted. Every form of a word is practiced (eu sei as well as você sabe; na and no as well as em). A session reviews what you already know and introduces only a few new forms at a time, preferring new forms of words you have already met. The first hint on a multi-form word shows the form table, with the answer blanked, plus a link to the word page. Place names (Brasil, Nova York, Estados Unidos) appear on a stylized offline map with a blank for each word. Numbers appear as a stylized numeral plus a blank. Each word of an answer has its own blank (no WORD/PHRASE badge); a form-clue chip names the exact form when a lemma has more than one. Word pages have a **Related, not the same** section for close but distinct words (ficar vs estar). **Spelling & sounds** pages put look-alike spellings side by side (tem, tenho, entende) with syllables, a simple respelling, IPA, and audio. In a game you can open a hint or jump to the word or phrase page.

## Data

The source of truth is UTF-8 CSVs, documented in [`data/SCHEMA.md`](data/SCHEMA.md):

- `data/words.csv` — one row per word (lemma), with its `word_type`
- `data/forms.csv` — one row per form of a word (gender / number / conjugated person)
- `data/phrases.csv` — one row per phrase, with links to its words
- `data/sentences.csv` — fill-in-the-blank sentences, keyed by form or phrase id
- `data/id_map.csv` — old progress ids → new ids, so saved progress carries over
- `data/contrasts.csv` and `data/contrast_items.csv` — Spelling & sounds comparisons
- `data/comparisons.csv` and `data/comparison_items.csv` — closely related words that are not synonyms

`python3 tools/build_data.py` validates them and writes `data/words.json` (what the app reads) plus the offline file list. Add `--make-audio` to generate any missing mp3s with `edge-tts` (voice `pt-BR-AntonioNeural`).

`python3 tools/export_data.py --roundtrip` checks that CSV → JSON → CSV comes back byte-identical for all tables.

To add a lesson: add rows to the CSVs (see SCHEMA.md, "Adding a lesson") (Google Sheets is fine: export UTF-8 CSV), add any photos to `media/img/`, then rebuild.

## Run it locally

This is plain HTML/CSS/JS. From this folder:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765/

Progress is stored in the browser (`localStorage`). Export or import it from the app's About page if you switch devices.

## License notes

Audio is generated with Microsoft Edge's `pt-BR-AntonioNeural` voice. Object photos are from Wikimedia Commons (and, where replaced, Unsplash or Pexels); credits and licenses are on each word page and in `data/words.csv` (`photo_credit`). Place maps are stylized from Natural Earth 110m data (public domain).
