# Data schema v2 (Raiz)

Flat, UTF-8 CSV tables are the **source of truth**. They import cleanly into Google Sheets
(File → Import → Upload, separator: comma, one tab per file) and are easy for other tools/LLMs to read.
The app never reads the CSVs directly: `tools/build_data.py` turns them into `data/words.json`.

```
data/words.csv          ─┐  lemmas: one dictionary page per word (um covers um + uma)
data/forms.csv          ─┤  forms of each lemma (gender, number, conjugated person)
data/phrases.csv        ─┤  phrases, with links to their words
data/sentences.csv      ─┼─ tools/build_data.py ──> data/words.json  (the app reads this)
data/id_map.csv         ─┤                      └─> sw-assets.js     (offline precache list + version)
data/contrasts.csv      ─┤  spelling & sounds sets (look-alike spellings, different sounds)
data/contrast_items.csv ─┤  one row per word in a contrast, with the pronunciation breakdown
data/comparisons.csv    ─┤  closely related words that are not synonyms (ficar vs estar)
data/comparison_items.csv ─┘  one example sentence per lemma (or form) in a comparison

data/words.json ── tools/export_data.py ──> data/export/*.csv  (reverse)
tools/export_data.py --roundtrip            verifies CSV -> JSON -> CSV is byte-identical for all tables
```

Spelling breakdowns are split across two files so each Sheets tab stays one-row-per-record
(`contrasts.csv` for the set, `contrast_items.csv` for each word’s syllables, respelling, IPA, and highlights;
`comparisons.csv` for the related-words set, `comparison_items.csv` for each lemma’s example sentences).

## The model

- A **word** (lemma) is one dictionary page, headed by its root/base form: `um` (um, uma), `ser` (eu sou, é, você é),
  `ter` (eu tenho, você tem), `seu` (seu, sua), `real` (o real, reais). Etymology, scene, cognates, family live here once.
- A **form** is one subsection of a word page: a gender, number, or conjugated person, with its own audio.
  Every form is practiced (you type `uma` and `duas`; `eu sei` as well as `você sabe`). The first hint on a
  multi-form word shows the form table, with the target blanked, plus a link to the word page.
- A **phrase** (`muito obrigado`, `na sua carteira`) has its own page. Its `components` link each word to a
  word page (and form), and each word page lists the phrases that use it. Etymology is not copied between them.
- **Practice items** = all forms + phrases. Progress, sentences, and audio are keyed by the item id.
- A **contrast** is a Spelling & sounds page that puts look-alike spellings side by side (tem / tenho / entende)
  with a syllable breakdown, a simple respelling, IPA for Rio / São Paulo, audio, and links to the word pages.
- A **comparison** is a “Related, not the same” block on every involved word page (ficar vs estar, ser vs estar).
  These are close, easily mixed-up words, not synonyms or antonyms. Each side has example sentences in Portuguese
  and English, and links to the other word pages.
- **Numbers** (três–vinte, cem / cento, mil) use a stylized numeral as the practice prompt. `um` stays an article
  but still shows the numeral 1. 11–15 are irregular (-ze); 16–19 are dez + e + the unit; cem stands alone,
  cento is used in 101+ (cento e um).
- In practice, each word of the answer has its own blank. There is no WORD/PHRASE badge; a form-clue chip still
  names the exact form when a lemma has more than one. Photos of concrete nouns and place maps (with a blank
  per word) appear as prompts; word pages show the named map and may also show a photo hero.

## Conventions
- Header names are stable `snake_case`; column order is fixed (see `tools/schema.py`).
- Ids are stable, never reused, lowercase ASCII snake_case of the Portuguese (`você é` → `voce_e`).
  Form and phrase ids also name the audio file (`voce_e.mp3`). Progress is keyed by form/phrase id, so don't rename
  them; if you must, add a row to `id_map.csv` so saved progress follows.
- Form ids and phrase ids are unique across both tables. A lemma id may equal one of its own form ids (`um`).
- **Multi-value cells** are separated by ` | ` (space, pipe, space). Items never contain `|`.
- Plain text only: no HTML, no Markdown. (`*` appears only to mark reconstructed forms such as `*figicāre`.)
- `yes` / `no` for booleans. Empty cell = no value. Media cells hold a bare filename; files live in `media/audio/` and `media/img/`.

## words.csv (one row per lemma)

| column | type | meaning |
|---|---|---|
| id | text | stable key, snake_case of the headword (`dolar`, `querer`) |
| headword | text | root / base form shown as the page title, with accents (`dólar`, `querer`) |
| word_type | enum | the dictionary filter; one of the values below |
| english | text | short English gloss for the whole word (`to have (to hold)`) |
| part_of_speech | text | free-text grammar label (`verb (irregular)`, `article / number (masc.)`) |
| lesson | integer | first Pimsleur lesson the word appears in |
| is_object | yes/no | physical object → shows a photo |
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
| pt_family | list | related Portuguese words, `word (gloss)` (not its own forms: those are subsections) |
| synonyms | list | real synonyms only; empty if none |
| antonyms | list | real antonyms only; empty if none |
| culture | list | cultural usage notes |
| notes | list | grammar/usage notes for the whole word |
| tags | list | e.g. `pimsleur | lesson05` |

### word_type values

| value | shown as | examples |
|---|---|---|
| animate_noun | Person | senhor |
| inanimate_noun | Thing | mala, carteira, hotel, real, dólar, português |
| proper_noun | Place / name | Brasil, Estados Unidos |
| pronoun | Pronoun | eu, você |
| verb | Verb | ser, estar, ter, querer, saber, entender, ir |
| adjective | Adjective | americano, brasileiro, gentil |
| adverb | Adverb | muito, bem, aqui |
| article | Article | um |
| number | Number | dois |
| preposition | Preposition | de |
| conjunction | Conjunction | mas |
| interjection | Interjection | obrigado |
| possessive | Possessive | meu, seu |
| question_word | Question word | como, quanto |

## forms.csv (one row per form of a lemma)

Empty content cells **inherit from the lemma** (scene, definition_pt, photo, photo_credit, root, root_image).
Fill them only where the form differs (uma's own definition, reais's own photo).

| column | type | meaning |
|---|---|---|
| id | text | stable item id = audio name (`uma`, `eu_tenho`) |
| lemma_id | text | → words.id |
| form | text | the form as taught, with accents (`uma`, `eu tenho`, `o real`) |
| label | text | short subsection label (`feminine`, `eu · I have`, `plural`) |
| gender | text | `masc`, `fem`, or empty |
| number | text | `sing`, `plur`, or empty |
| person | text | for verbs: `1st (eu)`, `3rd (você, ele, ela)` |
| tense | text | for verbs: `present` |
| taught | yes/no | yes = drilled in practice; no = reference only |
| lesson | integer or empty | lesson it was taught in (required when taught) |
| english | text | English for this form (`I have`) |
| part_of_speech | text | grammar label for this form |
| audio | filename | mp3 in `media/audio/` (pt-BR-AntonioNeural) |
| photo, photo_credit, scene, definition_pt | text | form-specific overrides (empty = lemma's) |
| root, root_image, literal, parts, parts_meaning, origin | text | form-specific etymology notes (empty = lemma's covers it) |
| notes | list | notes about this form only |
| accept_also | list | other spellings accepted as exact in "type the word" |

## phrases.csv (one row per phrase)

| column | type | meaning |
|---|---|---|
| id | text | stable item id = audio name (`na_sua_carteira`) |
| phrase | text | the phrase with accents (`na sua carteira`) |
| english, part_of_speech, lesson | | as above |
| components | list | the words in order, ` | ` separated. Each is `surface=lemma_id#form_id` (`sua=seu#sua`), `surface=lemma_id`, or `surface=lemma_id`. **Every component must link to a word page**: `build_data.py` fails otherwise (add the word to words.csv/forms.csv first, as a reference form with `taught = no` if it isn't drilled on its own) |
| audio, photo, photo_credit, scene | | as above |
| root … notes | | phrase-level etymology and notes (how the phrase is built); word-level etymology lives on the word pages |
| accept_also | list | other accepted spellings (`tá bem`) |
| tags | list | |

## sentences.csv (fill-in-the-blank)

| column | type | meaning |
|---|---|---|
| id | text | `<item_id>__<n>`, stable |
| item_id | text | → a taught forms.id or phrases.id |
| sentence_pt | text | Brazilian Portuguese sentence with exactly one `___` |
| answer | text | what goes in the blank |
| sentence_en | text | English meaning (shown only as the last hint) |
| accept_also | list | other answers that are also correct in this sentence |

## id_map.csv

| column | type | meaning |
|---|---|---|
| old_id | text | an id saved progress may still use |
| new_id | text | the form or phrase id it now belongs to |
| note | text | why (`form of um`, `phrase`) |

On first load after the v2 update the app copies `localStorage["pt-practice-progress-v1"]` into
`localStorage["raiz-progress-v2"]`, mapping every id through this table (ids that are already valid items stay as they are).
Anything it can't map goes to `orphans` in the saved state, never discarded; the v1 key is left as a backup.
Imported progress files from older versions are migrated the same way.

## contrasts.csv

One row per Spelling & sounds set.

| column | type | meaning |
|---|---|---|
| id | text | stable id (`tem_tenho_entende`) |
| title | text | heading, usually the forms being compared |
| explanation | text | why the look-alike spellings sound different (Rio / São Paulo Brazilian Portuguese) |
| item_ids | list | ids of rows in `contrast_items.csv`, in display order |
| tags | list | optional labels (`nasal`, `nh`, `accent`) |

## contrast_items.csv

One row per word in a contrast. Keep this as a second table so each breakdown stays a single Sheets row.

| column | type | meaning |
|---|---|---|
| id | text | stable id (`tem`, `entende_cx`) |
| contrast_id | text | parent row in `contrasts.csv` |
| item_id | text | the form, phrase, or lemma id to link to (`voce_tem`, `e_and`) |
| form | text | the written word shown and spoken (`tem`, not `você tem`) |
| syllables | text | hyphenated syllable breakdown (`te-nho`, `en-ten-de`) |
| respelling | text | a simple English-friendly respelling (`teyn`, `TEH-nyoo`) |
| ipa | text | IPA in square brackets, Brazilian (Rio / São Paulo, neutral) |
| spelling_highlight | list | graphemes to mark in the spelling (`em`, or `en \| de`) |
| sound_highlight | list | the matching sounds, same length as `spelling_highlight` |
| note | text | a short comment under the breakdown |
| audio | text | mp3 filename in `media/audio/` (often an isolated recording of just this form) |
| sort | int | display order within the contrast (1, 2, 3, …) |

`tools/suggest_contrasts.py` can propose further look-alike sets from the dictionary; only confidently accurate ones are added to these tables.

## comparisons.csv

One row per “Related, not the same” set. Keep this as a second pair of tables so each Sheets tab stays one-row-per-record. Only include words that are genuinely confusable in Brazilian Portuguese, not synonyms or antonyms.

| column | type | meaning |
|---|---|---|
| id | text | stable id (`ficar_estar`) |
| title | text | short heading (`ficar and estar`) |
| explanation | text | the distinction, in English, with Brazilian usage |
| lemma_ids | list | the lemmas involved, in a stable order (`ficar \| estar`) |
| tags | list | optional labels (`location`, `formality`) |

## comparison_items.csv

One row per example sentence (usually one or two per lemma).

| column | type | meaning |
|---|---|---|
| id | text | stable id (`fe_ficar_lugar`) |
| comparison_id | text | parent row in `comparisons.csv` |
| lemma_id | text | the lemma this example belongs to |
| form_id | text | optional form to link to (`esta`, `isto`); empty if the form isn’t a practiced item |
| example_pt | text | Portuguese example sentence(s) |
| example_en | text | English gloss, with a brief usage note when it helps |
| sort | int | display order within the comparison (1, 2, 3, …) |

The same comparison appears on every involved word page, with links to the others and the current lemma’s examples highlighted.

## words.json
`{ "schema_version": 2, "data_hash": "…", "word_types": {value: label}, "words": [...], "forms": [...], "phrases": [...], "sentences": [...], "id_map": [...], "contrasts": [...], "contrast_items": [...], "comparisons": [...], "comparison_items": [...] }`
Lists become JSON arrays, yes/no booleans, integers numbers (`lesson` empty → null). Key names equal the CSV headers.

## Adding a lesson
1. New word → a row in `words.csv` (pick a `word_type`) plus its form rows in `forms.csv` (`taught = yes`).
   New form of a known word (e.g. a later conjugation) → just a `forms.csv` row.
   New phrase → a row in `phrases.csv` with `components` linking to the word pages.
   Sentences → `sentences.csv` keyed by the form or phrase id.
   A new sound contrast → a row in `contrasts.csv` plus a row per word in `contrast_items.csv`.
   A new related-words comparison → a row in `comparisons.csv` plus a row per example in `comparison_items.csv`.
2. Put any object photos in `media/img/` and credit them.
3. `python3 tools/build_data.py --make-audio` (creates missing mp3s with edge-tts, validates, rebuilds JSON + offline list).
4. `python3 tools/export_data.py --roundtrip` must say LOSSLESS.
