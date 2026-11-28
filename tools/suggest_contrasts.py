#!/usr/bin/env python3
"""Propose look-alike spelling contrasts from the dictionary.

Only curated, confidently accurate sets are written to contrasts.csv.
This script prints candidates (included vs skipped) so a human can review them.

  python3 tools/suggest_contrasts.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from build_data import read_all

# Curated sets already in the data, with the reason we trust the IPA.
INCLUDED = [
    ("tem_tenho_entende", "tem [tẽj̃] vs tenho [ˈtẽɲu] vs entende [ẽˈtẽdʒi] — -em diphthong vs nh vs nasal en + palatal de"),
    ("e_vs_e", "é [ɛ] vs e [i] — accent is the whole difference"),
    ("sei_sabe", "sei [sej] vs sabe [ˈsabi] — ei diphthong vs unstressed final e as [i]"),
    ("muito_nasal_ui", "muito [ˈmũjtu] — nasal ui with no tilde (standard BP quirk)"),
    ("nao_vs_no", "não [nɐ̃w̃] vs no [nu] — ão nasal diphthong vs contraction em+o"),
    ("o_vs_o", "o [u] vs ó in dólar [ˈdɔlaʁ] — unstressed article vs open ó"),
]

def forms(d):
    return {f["id"]: f for f in d["forms"]}

def has_form(d, *texts):
    want = set(texts)
    found = {f["form"]: f for f in d["forms"] if f["form"] in want}
    return found

def main():
    d = read_all()
    F = forms(d)
    by_text = {}
    for f in d["forms"]:
        by_text.setdefault(f["form"], []).append(f)

    print("INCLUDED (already in contrasts.csv)")
    for cid, why in INCLUDED:
        print(f"  + {cid}: {why}")

    print("\nSCAN")
    # mas vs mais — only if both exist
    mais = [f for f in d["forms"] if f["form"] == "mais"]
    mas = [f for f in d["forms"] if f["form"] == "mas"]
    if mas and mais:
        print("  ? mas vs mais — both present; review IPA (mas [mas], mais [majs]) before adding")
    elif mas and not mais:
        print("  - mas vs mais — skipped, mais is not in the dictionary")
    elif mais and not mas:
        print("  - mas vs mais — skipped, mas is not in the dictionary")

    # other -em words
    em_final = [f for f in d["forms"] if f["form"].endswith("em") and f["form"] != "tem"]
    if em_final:
        print("  ? other -em forms (same nasal diphthong as tem): " + ", ".join(sorted({f["form"] for f in em_final})))
    nh = [f for f in d["forms"] if "nh" in f["form"] and f["form"] != "tenho"]
    if nh:
        print("  ? other nh forms: " + ", ".join(sorted({f["form"] for f in nh})))

    ao = [f for f in d["forms"] if "ão" in f["form"] and f["form"] != "não"]
    if ao:
        print("  ? other ão forms (same nasal as não): " + ", ".join(sorted({f["form"] for f in ao})))

    o_acc = [f for f in d["forms"] if "ó" in f["form"] or "ô" in f["form"]]
    if o_acc:
        print("  ? accented o forms: " + ", ".join(sorted({f["form"] for f in o_acc})))

    # lookalikes sharing a 3-letter stretch, different remainder — informational only
    texts = sorted({f["form"] for f in d["forms"] if " " not in f["form"] and len(f["form"]) >= 3})
    pairs = []
    for i, a in enumerate(texts):
        for b in texts[i+1:]:
            if a.lower() == b.lower(): continue
            # share a 3-char window
            sa = {a[j:j+3].lower() for j in range(len(a)-2)}
            sb = {b[j:j+3].lower() for j in range(len(b)-2)}
            if sa & sb and a[0].lower() == b[0].lower():
                pairs.append((a, b, *sorted(sa & sb)))
    if pairs:
        print("  ? same-initial lookalikes sharing 3 letters (review before adding):")
        for a, b, *shared in pairs[:24]:
            print(f"      {a} / {b}  ({', '.join(shared[:3])})")

    print("\nDone. Add a contrast to the CSVs only when the IPA is confidently accurate for Rio / São Paulo.")

if __name__ == "__main__":
    main()
