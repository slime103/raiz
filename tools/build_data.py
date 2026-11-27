#!/usr/bin/env python3
"""Build the app's data file from the canonical CSVs.

  data/words.csv + data/sentences.csv  -->  data/words.json  (what the app reads)
                                         -->  sw-assets.js    (offline precache list + version)

Usage:
  python3 tools/build_data.py               # validate + build
  python3 tools/build_data.py --make-audio  # also create missing mp3s with edge-tts (pt-BR-AntonioNeural)

Adding a lesson: append rows to data/words.csv (and sentences to data/sentences.csv),
drop any photos into media/img/, run with --make-audio, then reload the app.
Stdlib only (edge-tts needed only for --make-audio).
"""
import csv, hashlib, json, re, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from schema import WORD_FIELDS, SENTENCE_FIELDS, SEP

APP = Path(__file__).resolve().parent.parent
DATA = APP / "data"
EDGE_TTS = "/workspace/anki/venv/bin/edge-tts"
VOICE = "pt-BR-AntonioNeural"

# ---------- CSV <-> python ----------
def to_cell(v, t):
    if t == "list":
        for x in v:
            if "|" in x: raise ValueError(f"list item contains '|': {x!r}")
        return SEP.join(v)
    if t == "bool": return "yes" if v else "no"
    return str(v)

def from_cell(s, t):
    s = s or ""
    if t == "list": return [x.strip() for x in s.split("|") if x.strip()]
    if t == "bool": return s.strip().lower() in ("yes", "true", "1", "y")
    if t == "int": return int(s)
    return s

def _norm_row(r, fields):
    out = {}
    for name, t in fields:
        v = r.get(name, [] if t == "list" else "")
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

def write_words_csv(rows, path): write_table(rows, path, WORD_FIELDS)
def write_sentences_csv(rows, path): write_table(rows, path, SENTENCE_FIELDS)

# ---------- validation ----------
BAD = re.compile(r"(<[a-zA-Z/][^>]*>|\*\*|\[[^\]]+\]\(|^#)")
def validate(words, sents):
    errs = []
    ids = [w["id"] for w in words]
    for i in set(ids):
        if ids.count(i) > 1: errs.append(f"duplicate word id {i}")
    for w in words:
        if not re.fullmatch(r"[a-z0-9_]+", w["id"]): errs.append(f"bad id {w['id']!r} (use snake_case)")
        for k in ("portuguese", "english", "scene", "root", "audio"):
            if not w[k]: errs.append(f"{w['id']}: empty {k}")
        if not (APP / "media/audio" / w["audio"]).exists(): errs.append(f"{w['id']}: missing media/audio/{w['audio']}")
        if w["photo"] and not (APP / "media/img" / w["photo"]).exists(): errs.append(f"{w['id']}: missing media/img/{w['photo']}")
        for n, t in WORD_FIELDS:
            if isinstance(w[n], str) and w[n] != w[n].strip(): errs.append(f"{w['id']}.{n}: leading/trailing whitespace")
            vals = w[n] if t == "list" else [str(w[n])]
            for v in vals:
                if BAD.search(v): errs.append(f"{w['id']}.{n}: HTML/markdown in cell: {v[:60]!r}")
    sids = set()
    for s in sents:
        if s["id"] in sids: errs.append(f"duplicate sentence id {s['id']}")
        sids.add(s["id"])
        if s["word_id"] not in ids: errs.append(f"sentence {s['id']}: unknown word_id {s['word_id']}")
        if s["sentence_pt"].count("___") != 1: errs.append(f"sentence {s['id']}: needs exactly one ___")
    return errs

def make_audio(words):
    for w in words:
        p = APP / "media/audio" / w["audio"]
        if not p.exists():
            print("tts:", w["portuguese"], "->", p.name)
            subprocess.run([EDGE_TTS, "--voice", VOICE, "--text", w["portuguese"], "--write-media", str(p)], check=True)

def build():
    words = read_table(DATA / "words.csv", WORD_FIELDS)
    sents = read_table(DATA / "sentences.csv", SENTENCE_FIELDS)
    if "--make-audio" in sys.argv: make_audio(words)
    errs = validate(words, sents)
    if errs:
        print("\n".join(errs)); raise SystemExit(f"{len(errs)} validation error(s)")
    body = {"schema_version": 1, "words": words, "sentences": sents}
    blob = json.dumps(body, ensure_ascii=False, sort_keys=True).encode()
    body = {"schema_version": 1, "data_hash": hashlib.sha1(blob).hexdigest()[:10], "words": words, "sentences": sents}
    (DATA / "words.json").write_text(json.dumps(body, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    write_sw_assets(words)
    print(f"words.json: {len(words)} words, {len(sents)} sentences, hash {body['data_hash']}")

STATIC = ["./", "index.html", "manifest.webmanifest", "css/app.css", "js/app.js", "js/grade.js",
          "js/srs.js", "data/words.json", "icons/icon-192.png", "icons/icon-512.png",
          "icons/apple-touch-icon.png", "icons/icon.svg"]
def write_sw_assets(words):
    files = list(STATIC)
    files += [f"media/audio/{w['audio']}" for w in words]
    files += [f"media/img/{w['photo']}" for w in words if w["photo"]]
    h = hashlib.sha1()
    for f in files:
        p = APP / (f if f != "./" else "index.html")
        if p.exists(): h.update(p.read_bytes())
    ver = h.hexdigest()[:10]
    (APP / "sw-assets.js").write_text(
        "// Generated by tools/build_data.py. Do not edit.\n"
        f"self.APP_VERSION = {json.dumps(ver)};\nself.PRECACHE = {json.dumps(files, indent=0, ensure_ascii=False)};\n",
        encoding="utf-8")

if __name__ == "__main__":
    build()
