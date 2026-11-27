#!/usr/bin/env python3
"""Build the app's data file from the canonical CSVs.

  data/words.csv      one row per lemma (dictionary headword: um covers um + uma)
  data/forms.csv      one row per form of a lemma (gender / number / conjugated person)
  data/phrases.csv    one row per phrase; components link to lemma/form pages
  data/sentences.csv  fill-in-the-blank sentences, keyed by item_id (a form id or phrase id)
  data/id_map.csv     old progress id -> new item id (for migrating saved progress)
      --> data/words.json  (what the app reads)
      --> sw-assets.js     (offline precache list + version)

Usage:
  python3 tools/build_data.py               # validate + build
  python3 tools/build_data.py --make-audio  # also create missing mp3s with edge-tts (pt-BR-AntonioNeural)

Stdlib only (edge-tts needed only for --make-audio).
"""
import csv, hashlib, json, re, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from schema import WORD_FIELDS, FORM_FIELDS, PHRASE_FIELDS, SENTENCE_FIELDS, ID_MAP_FIELDS, WORD_TYPES, SEP

APP = Path(__file__).resolve().parent.parent
DATA = APP / "data"
EDGE_TTS = "/workspace/anki/venv/bin/edge-tts"
VOICE = "pt-BR-AntonioNeural"
SCHEMA_VERSION = 2
TABLES = {  # file -> (json key, fields)
    "words.csv": ("words", WORD_FIELDS),
    "forms.csv": ("forms", FORM_FIELDS),
    "phrases.csv": ("phrases", PHRASE_FIELDS),
    "sentences.csv": ("sentences", SENTENCE_FIELDS),
    "id_map.csv": ("id_map", ID_MAP_FIELDS),
}

# ---------- CSV <-> python ----------
def to_cell(v, t):
    if t == "list":
        for x in v:
            if "|" in x: raise ValueError(f"list item contains '|': {x!r}")
        return SEP.join(v)
    if t == "bool": return "yes" if v else "no"
    if t == "optint": return "" if v is None or v == "" else str(int(v))
    return str(v)

def from_cell(s, t):
    s = s or ""
    if t == "list": return [x.strip() for x in s.split("|") if x.strip()]
    if t == "bool": return s.strip().lower() in ("yes", "true", "1", "y")
    if t == "int": return int(s)
    if t == "optint": return int(s) if s.strip() else None
    return s

def _norm_row(r, fields):
    out = {}
    for name, t in fields:
        v = r.get(name, [] if t == "list" else None if t == "optint" else "")
        if t == "bool" and isinstance(v, str): v = v.lower() in ("yes", "true", "1")
        if t == "int": v = int(v)
        out[name] = v
    return out

def write_table(rows, path, fields):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow([n for n, _ in fields])
        for r in rows:
            r = _norm_row(r, fields)
            w.writerow([to_cell(r[n], t) for n, t in fields])

def read_table(path, fields):
    with open(path, encoding="utf-8-sig", newline="") as f:
        rd = csv.DictReader(f)
        missing = [n for n, _ in fields if n not in rd.fieldnames]
        if missing: raise SystemExit(f"{path.name}: missing columns {missing}")
        return [{n: from_cell(r[n], t) for n, t in fields} for r in rd if any((r.get(n) or "").strip() for n, _ in fields)]

def read_all():
    return {key: read_table(DATA / name, fields) for name, (key, fields) in TABLES.items()}

def write_all(d, dest):
    for name, (key, fields) in TABLES.items():
        write_table(d[key], dest / name, fields)

def parse_component(c):
    """'sua=seu#sua' -> ('sua', 'seu', 'sua'); 'não' -> ('não', '', '')."""
    surface, _, target = c.partition("=")
    lemma, _, form = target.partition("#")
    return surface.strip(), lemma.strip(), form.strip()

# ---------- validation ----------
BAD = re.compile(r"(<[a-zA-Z/][^>]*>|\*\*|\[[^\]]+\]\(|^#)")
def _cells(rowid, r, fields, errs):
    for n, t in fields:
        if isinstance(r[n], str) and r[n] != r[n].strip(): errs.append(f"{rowid}.{n}: leading/trailing whitespace")
        vals = r[n] if t == "list" else [str(r[n] if r[n] is not None else "")]
        for v in vals:
            if BAD.search(v): errs.append(f"{rowid}.{n}: HTML/markdown in cell: {v[:60]!r}")

def validate(d):
    errs = []
    words, forms, phrases, sents = d["words"], d["forms"], d["phrases"], d["sentences"]
    def dup(ids, what):
        seen = set()
        for i in ids:
            if i in seen: errs.append(f"duplicate {what} id {i}")
            seen.add(i)
        return seen
    L = {w["id"]: w for w in words}; dup(L, "lemma") if False else dup([w["id"] for w in words], "lemma")
    fids = dup([f["id"] for f in forms], "form")
    pids = dup([p["id"] for p in phrases], "phrase")
    for i in fids & pids: errs.append(f"id {i} is both a form and a phrase (item ids must be unique)")
    for i in pids & set(L): errs.append(f"id {i} is both a lemma and a phrase")
    FM = {f["id"]: f for f in forms}
    for i in set(L) & fids:
        if FM[i]["lemma_id"] != i: errs.append(f"lemma id {i} is also a form of another lemma ({FM[i]['lemma_id']})")
    for w in words:
        if not re.fullmatch(r"[a-z0-9_]+", w["id"]): errs.append(f"bad lemma id {w['id']!r}")
        for k in ("headword", "english", "scene", "root", "word_type"):
            if not w[k]: errs.append(f"lemma {w['id']}: empty {k}")
        if w["word_type"] and w["word_type"] not in WORD_TYPES: errs.append(f"lemma {w['id']}: unknown word_type {w['word_type']!r} (one of {', '.join(WORD_TYPES)})")
        if w["photo"] and not (APP / "media/img" / w["photo"]).exists(): errs.append(f"{w['id']}: missing media/img/{w['photo']}")
        if not any(f["lemma_id"] == w["id"] for f in forms): errs.append(f"lemma {w['id']}: has no forms")
        _cells(w["id"], w, WORD_FIELDS, errs)
    for f in forms:
        if not re.fullmatch(r"[a-z0-9_]+", f["id"]): errs.append(f"bad form id {f['id']!r}")
        if f["lemma_id"] not in L: errs.append(f"form {f['id']}: unknown lemma_id {f['lemma_id']}")
        for k in ("form", "english", "audio"):
            if not f[k]: errs.append(f"form {f['id']}: empty {k}")
        if f["taught"] and f["lesson"] is None: errs.append(f"form {f['id']}: taught forms need a lesson")
        if f["audio"] and not (APP / "media/audio" / f["audio"]).exists(): errs.append(f"form {f['id']}: missing media/audio/{f['audio']}")
        if f["photo"] and not (APP / "media/img" / f["photo"]).exists(): errs.append(f"form {f['id']}: missing media/img/{f['photo']}")
        _cells(f["id"], f, FORM_FIELDS, errs)
    for p in phrases:
        if not re.fullmatch(r"[a-z0-9_]+", p["id"]): errs.append(f"bad phrase id {p['id']!r}")
        for k in ("phrase", "english", "scene", "audio", "components"):
            if not p[k]: errs.append(f"phrase {p['id']}: empty {k}")
        if not (APP / "media/audio" / p["audio"]).exists(): errs.append(f"phrase {p['id']}: missing media/audio/{p['audio']}")
        for c in p["components"]:
            s, lem, form = parse_component(c)
            if lem and lem not in L: errs.append(f"phrase {p['id']}: component {c!r} -> unknown lemma {lem}")
            if form and (form not in FM or FM[form]["lemma_id"] != lem): errs.append(f"phrase {p['id']}: component {c!r} -> form {form} is not a form of {lem}")
        _cells(p["id"], p, PHRASE_FIELDS, errs)
    items = {f["id"] for f in forms if f["taught"]} | pids
    sids = set()
    for s in sents:
        if s["id"] in sids: errs.append(f"duplicate sentence id {s['id']}")
        sids.add(s["id"])
        if s["item_id"] not in items: errs.append(f"sentence {s['id']}: unknown or untaught item_id {s['item_id']}")
        if s["sentence_pt"].count("___") != 1: errs.append(f"sentence {s['id']}: needs exactly one ___")
    for m in d["id_map"]:
        if m["new_id"] not in fids | pids: errs.append(f"id_map {m['old_id']}: new_id {m['new_id']} is not a form or phrase")
    return errs

def audio_jobs(d):
    for f in d["forms"]: yield f["form"], f["audio"]
    for p in d["phrases"]: yield p["phrase"], p["audio"]

def make_audio(d):
    for text, fn in audio_jobs(d):
        p = APP / "media/audio" / fn
        if fn and not p.exists():
            print("tts:", text, "->", p.name)
            subprocess.run([EDGE_TTS, "--voice", VOICE, "--text", text, "--write-media", str(p)], check=True)

def build():
    d = read_all()
    if "--make-audio" in sys.argv: make_audio(d)
    errs = validate(d)
    if errs:
        print("\n".join(errs)); raise SystemExit(f"{len(errs)} validation error(s)")
    body = {"schema_version": SCHEMA_VERSION, **d}
    blob = json.dumps(body, ensure_ascii=False, sort_keys=True).encode()
    out = {"schema_version": SCHEMA_VERSION, "data_hash": hashlib.sha1(blob).hexdigest()[:10], "word_types": WORD_TYPES, **d}
    (DATA / "words.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    write_sw_assets(d)
    taught = sum(f["taught"] for f in d["forms"])
    print(f"words.json: {len(d['words'])} lemmas, {len(d['forms'])} forms ({taught} taught), {len(d['phrases'])} phrases, "
          f"{len(d['sentences'])} sentences, hash {out['data_hash']}")

STATIC = ["./", "index.html", "manifest.webmanifest", "css/app.css", "js/app.js", "js/grade.js",
          "js/srs.js", "js/dict.js", "data/words.json", "icons/icon-192.png", "icons/icon-512.png",
          "icons/apple-touch-icon.png", "icons/icon.svg"]
def write_sw_assets(d):
    files = list(STATIC)
    seen = set()
    for _, fn in audio_jobs(d):
        if fn and fn not in seen: seen.add(fn); files.append(f"media/audio/{fn}")
    for row in d["words"] + d["forms"] + d["phrases"]:
        if row.get("photo") and f"media/img/{row['photo']}" not in files: files.append(f"media/img/{row['photo']}")
    h = hashlib.sha1()
    for f in files:
        p = APP / (f if f != "./" else "index.html")
        if p.exists(): h.update(p.read_bytes())
    for p in ("sw.js",):
        h.update((APP / p).read_bytes())
    ver = h.hexdigest()[:10]
    (APP / "sw-assets.js").write_text(
        "// Generated by tools/build_data.py. Do not edit.\n"
        f"self.APP_VERSION = {json.dumps(ver)};\nself.PRECACHE = {json.dumps(files, indent=0, ensure_ascii=False)};\n",
        encoding="utf-8")

if __name__ == "__main__":
    build()
