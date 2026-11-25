#!/usr/bin/env python3
"""Reverse export: data/words.json --> words.csv + sentences.csv.

  python3 tools/export_data.py              # writes data/export/words.csv, data/export/sentences.csv
  python3 tools/export_data.py --in-place   # overwrite data/words.csv + data/sentences.csv
  python3 tools/export_data.py --roundtrip  # verify CSV -> JSON -> CSV is byte-identical
"""
import json, sys, filecmp, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from build_data import write_words_csv, write_sentences_csv, DATA, build

def export(dest_dir):
    d = json.loads((DATA / "words.json").read_text(encoding="utf-8"))
    dest_dir.mkdir(parents=True, exist_ok=True)
    write_words_csv(d["words"], dest_dir / "words.csv")
    write_sentences_csv(d["sentences"], dest_dir / "sentences.csv")
    return dest_dir

if __name__ == "__main__":
    if "--roundtrip" in sys.argv:
        build()
        tmp = export(Path(tempfile.mkdtemp()))
        ok = all(filecmp.cmp(DATA / n, tmp / n, shallow=False) for n in ("words.csv", "sentences.csv"))
        print("round-trip CSV -> JSON -> CSV:", "LOSSLESS (byte-identical)" if ok else "MISMATCH")
        sys.exit(0 if ok else 1)
    out = export(DATA if "--in-place" in sys.argv else DATA / "export")
    print("exported to", out)
