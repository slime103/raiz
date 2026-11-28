#!/usr/bin/env python3
"""Reverse export: data/words.json --> words.csv, forms.csv, phrases.csv, sentences.csv, id_map.csv, contrasts.csv, contrast_items.csv.

  python3 tools/export_data.py              # writes data/export/*.csv
  python3 tools/export_data.py --in-place   # overwrite data/*.csv
  python3 tools/export_data.py --roundtrip  # verify CSV -> JSON -> CSV is byte-identical
"""
import json, sys, filecmp, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from build_data import write_all, DATA, TABLES, build

def export(dest_dir):
    d = json.loads((DATA / "words.json").read_text(encoding="utf-8"))
    dest_dir.mkdir(parents=True, exist_ok=True)
    write_all(d, dest_dir)
    return dest_dir

if __name__ == "__main__":
    if "--roundtrip" in sys.argv:
        build()
        tmp = export(Path(tempfile.mkdtemp()))
        res = {n: filecmp.cmp(DATA / n, tmp / n, shallow=False) for n in TABLES}
        for n, ok in res.items(): print(f"  {n}: {'identical' if ok else 'DIFFERENT'}")
        ok = all(res.values())
        print("round-trip CSV -> JSON -> CSV:", "LOSSLESS (byte-identical)" if ok else "MISMATCH")
        sys.exit(0 if ok else 1)
    out = export(DATA if "--in-place" in sys.argv else DATA / "export")
    print("exported to", out)
