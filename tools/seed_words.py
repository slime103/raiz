#!/usr/bin/env python3
"""ONE-TIME seeding: merge the Anki cards.csv, the Etymology Google Doc export
(tools/etymology_doc.md) and hand-authored enrichment (tools/enrich.py) into the
canonical flat tables data/words.csv and data/sentences.csv.

SUPERSEDED: this wrote the v1 one-row-per-item words.csv. The data is now schema v2
(words.csv = lemmas, forms.csv, phrases.csv; see data/SCHEMA.md). Kept for history only.

After seeding, the CSVs are the source of truth. Do not re-run this unless you
want to overwrite hand edits (it refuses to overwrite without --force).
"""
import csv, re, sys, shutil
sys.exit("seed_words.py is the retired v1 seeder; edit data/*.csv directly (see data/SCHEMA.md).")
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from enrich import E, S
from schema import WORD_FIELDS, SENTENCE_FIELDS, SEP

APP = Path(__file__).resolve().parent.parent
ANKI = Path("/workspace/anki")
DATA = APP / "data"

def clean(s: str) -> str:
    s = s.replace("\\*", "\x00")
    s = re.sub(r"\\(.)", r"\1", s)
    s = s.replace("**", "").replace("*", "").replace("\x00", "*")
    s = s.replace("|", "/")
    s = re.sub(r"^[:\s]+", "", s)
    return re.sub(r"\s+", " ", s).strip()

LABELS = {
    "🧵 SAME ROOT IN ENGLISH": "Same root in English",
    "🇫🇷 FRENCH TOOK A THIRD PATH": "French took a third path",
    "🇧🇷 WHY PORTUGUESE KEPT IT": "Why Portuguese kept it",
    '⚠️ "INTEND" IS NOT ENTENDER': '"Intend" is not entender',
}

def parse_doc():
    md = (APP / "tools/etymology_doc.md").read_text()
    out = {}
    for block in re.split(r"^### ", md, flags=re.M)[1:]:
        lines = block.split("\n")
        head = lines[0].split(" — ")[0].strip()
        f = {"history": [], "culture": [], "notes": []}
        last = None
        for raw in lines[1:]:
            l = raw.strip()
            if l.startswith("## "): break
            if not l or l == "---" or l.startswith("*Built from"): continue
            l = re.sub(r"^[-*]\s+", "", l).strip()
            l = l.strip("*").strip() if l.startswith("*") and l.endswith("*") else l
            m = re.match(r"\*?\*?(Parts|Meaning of parts|Origin|Cognates & hooks|Fits together|Note):\*?\*?\s*(.*)", l)
            if m:
                k = m.group(1); v = clean(m.group(2))
                key = {"Parts":"parts","Meaning of parts":"parts_meaning","Origin":"origin",
                       "Cognates & hooks":"cognates","Fits together":"literal","Note":"notes"}[k]
                if key == "notes" and v.startswith("★ Culture:"):
                    f["culture"].append(v[len("★ Culture:"):].strip()); key = "culture"
                elif key == "notes": f["notes"].append(v)
                else: f[key] = v
                last = key; continue
            m = re.match(r"(🎯 ROOT IMAGE|🔀 WHY ENGLISH SPLIT|🔗 ENGLISH LINK|🇧🇷 PORTUGUESE FAMILY|🧠 THE IMAGE|★ Culture)\s*[—:]?\s*(.*)", l)
            if m:
                k, v = m.group(1), clean(m.group(2))
                if k == "🎯 ROOT IMAGE": f["root_image"] = v; last = "root_image"
                elif k == "🔀 WHY ENGLISH SPLIT": f["history"].append("Why English split: " + v); last = "history"
                elif k == "🔗 ENGLISH LINK": f["history"].append("English link: " + v); last = "history"
                elif k == "🇧🇷 PORTUGUESE FAMILY": f["doc_family"] = v; last = "doc_family"
                elif k == "🧠 THE IMAGE": f["scene"] = v; last = "scene"
                else: f["culture"].append(v); last = "culture"
                continue
            # continuation line
            lab = next((L for L in LABELS if l.startswith(L)), None)
            if lab:
                f["history"].append(LABELS[lab] + ": " + clean(l[len(lab):].lstrip(" —"))); last = "history"; continue
            if l.startswith("⚠️ NOTE"):
                f["notes"].append(clean(l[len("⚠️ NOTE"):].lstrip(" —"))); continue
            if re.match(r"^\*?\*?Culture:", l):
                f["culture"].append(clean(re.sub(r"^\*?\*?Culture:\*?\*?", "", l))); last = "culture"; continue
            v = clean(l)
            if v.startswith("★ Culture:"):
                f["culture"].append(v[len("★ Culture:"):].strip()); last = "culture"; continue
            if last in ("culture", "notes", "history"): f[last].append(v)
            elif last == "parts_meaning" or last == "literal" or last == "origin": f["notes"].append(v)
            else: f["culture"].append(v)
        out[head] = f
    return out

def photo_credits():
    txt = (ANKI / "IMAGE_SOURCES.txt").read_text()
    cred = {}
    for blk in re.split(r"\n\s*\n", txt):
        lines = [x.strip() for x in blk.strip().splitlines() if x.strip() and not x.startswith("#")]
        if not lines or not lines[0].endswith(".jpg"): continue
        d = dict(re.match(r"(\w+):\s*(.*)", x).groups() for x in lines[1:] if re.match(r"\w+:", x))
        cred[lines[0]] = f"{d.get('Author','')} / {d.get('License','')} / Wikimedia Commons: {d.get('URL','')}"
    return cred

def main():
    if (DATA / "words.csv").exists() and "--force" not in sys.argv:
        sys.exit("data/words.csv exists; it is canonical now. Use --force to overwrite.")
    doc = parse_doc(); cred = photo_credits()
    rows = []
    for c in csv.DictReader(open(ANKI / "cards.csv", encoding="utf-8")):
        wid = c["audio"][:-4]
        d = doc[c["portuguese"]]; e = E[wid]
        is_obj = bool(c["photo"])
        notes = ([clean(c["notes"])] if c["notes"] else []) + d["notes"] + ([e["note"]] if e.get("note") else [])
        if is_obj and c["image"] and c["image"].lower().startswith("from "):
            notes.append("Word history: " + clean(c["image"]))
        cog = [clean(x) for x in d["cognates"].split(";") if clean(x)]
        rows.append({
            "id": wid, "lesson": int(c["lesson"]), "portuguese": c["portuguese"], "english": c["english"],
            "part_of_speech": e["pos"], "is_object": "yes" if is_obj else "no",
            "audio": c["audio"], "photo": c["photo"], "photo_credit": cred.get(c["photo"], ""),
            "scene": d["scene"], "root": c["root"].strip(), "source_language": e["src"],
            "root_image": d.get("root_image", ""),
            "definition_pt": e["dpt"], "literal": d.get("literal", ""),
            "parts": d.get("parts", ""), "parts_meaning": d.get("parts_meaning", ""), "origin": d.get("origin", ""),
            "history": d["history"], "cognates": cog, "pt_family": e.get("fam", []),
            "synonyms": e.get("syn", []), "antonyms": e.get("ant", []),
            "culture": d["culture"], "notes": notes, "accept_also": e.get("acc", []),
            "tags": ["pimsleur", f"lesson{int(c['lesson']):02d}"],
        })
    for r in rows:
        for k, v in r.items():
            if isinstance(v, list): r[k] = [x for x in v if x.strip()]
    from build_data import write_words_csv, write_sentences_csv
    write_words_csv(rows, DATA / "words.csv")
    sents = []
    count = {}
    for wid, s, a, en, acc in S:
        count[wid] = count.get(wid, 0) + 1
        sents.append({"id": f"{wid}__{count[wid]}", "word_id": wid, "sentence_pt": s, "answer": a,
                      "sentence_en": en, "accept_also": acc})
    write_sentences_csv(sents, DATA / "sentences.csv")
    for r in rows:
        shutil.copy(ANKI / "audio" / r["audio"], APP / "media/audio" / r["audio"])
        if r["photo"]: shutil.copy(ANKI / "images" / r["photo"], APP / "media/img" / r["photo"])
    print(f"seeded {len(rows)} words, {len(sents)} sentences")

if __name__ == "__main__":
    main()
