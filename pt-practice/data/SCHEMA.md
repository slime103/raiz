# Data schema (Raiz / pt-practice)

Two flat, UTF-8 CSV tables are the **source of truth**. They import cleanly into Google Sheets
(File → Import → Upload, separator: comma) and are easy for other tools/LLMs to read.
The app never reads the CSVs directly: `tools/build_data.py` turns them into `data/words.json`.

```
data/words.csv ─┐                         ┌─> data/words.json   (the app reads this)
                ├─ tools/build_data.py ───┤
data/sentences.csv ┘                      └─> sw-assets.js      (offline precache list)

data/words.json ── tools/export_data.py ──> data/export/words.csv, sentences.csv  (reverse)
tools/export_data.py --roundtrip           verifies CSV -> JSON -> CSV is byte-identical
```

## Conventions
- One row per word or phrase. Header names are stable `snake_case`; column order is fixed (see `tools/schema.py`).
- `id` is stable and never reused: lowercase ASCII snake_case of the Portuguese (`você é` → `voce_e`).
  It also names the audio file (`voce_e.mp3`). Progress in the app is keyed by `id`, so don't rename ids.
- **Multi-value cells** are separated by ` | ` (space, pipe, space). Items never contain `|`.
- Plain text only: no HTML, no Markdown. (`*` appears only to mark reconstructed forms such as `*figicāre`.)
- `yes` / `no` for booleans. Empty cell = no value. Media cells hold a bare filename; files live in `media/audio/` and `media/img/`.

## words.csv

| column | type | meaning |
|---|---|---|
| id | text | stable key, snake_case |
| lesson | integer | Pimsleur lesson number (1, 2, …) |
| portuguese | text | the word/phrase as taught, with accents (`você`, `como vai?`) |
| english | text | short English gloss |
| part_of_speech | text | e.g. `verb (entender)`, `noun (fem.)`, `phrase` |
| is_object | yes/no | physical object → shows a photo |
| audio | filename | mp3 in `media/audio/` (pt-BR-AntonioNeural) |
| photo | filename | jpg in `media/img/` (objects only; else empty) |
| photo_credit | text | author / license / source URL |
| scene | text | language-free picture of the idea ("🧠 THE IMAGE") |
| root | text | key root + source-language link |
| source_language | text | e.g. `Latin`, `French ← Latin`, `German` |
| root_image | text | the root's original concrete picture ("🎯 ROOT IMAGE") |
| definition_pt | text | simple definition in Portuguese, using known words where possible |
| literal | text | what the parts add up to literally |
| parts | text | prefix / root / suffix breakdown |
| parts_meaning | text | meaning of each part |
| origin | text | sound/meaning history |
| history | list | why English split / English link / other notes on the path |
| cognates | list | related words in other languages, each item starts with the language (`Spanish entender`) |
| pt_family | list | related Portuguese words, `word (gloss)` |
| synonyms | list | real synonyms only; empty if none |
| antonyms | list | real antonyms only; empty if none |
| culture | list | cultural usage notes |
| notes | list | grammar/usage notes |
| accept_also | list | other spellings accepted as exact in "type the word" |
| tags | list | e.g. `pimsleur | lesson03` |

## sentences.csv (fill-in-the-blank)

| column | type | meaning |
|---|---|---|
| id | text | `<word_id>__<n>`, stable |
| word_id | text | foreign key → words.id |
| sentence_pt | text | Brazilian Portuguese sentence with exactly one `___` |
| answer | text | what goes in the blank |
| sentence_en | text | English meaning (shown only as the last hint) |
| accept_also | list | other answers that are also correct in this sentence |

## words.json
`{ "schema_version": 1, "data_hash": "…", "words": [ {…same columns…} ], "sentences": [ {…} ] }`
Lists become JSON arrays, `is_object` a boolean, `lesson` a number. Key names equal the CSV headers.

## Adding a lesson
1. Append rows to `data/words.csv` (Google Sheets is fine: export as CSV, UTF-8) and sentences to `data/sentences.csv`.
2. Put any object photos in `media/img/` and credit them in `photo_credit`.
3. `python3 tools/build_data.py --make-audio` (creates missing mp3s with edge-tts, validates, rebuilds JSON + offline list).
4. Re-upload the folder to the host; the app updates itself the next time it's opened online.
