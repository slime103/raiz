"""Render app icons (PNG) with Pillow: a cream 'ã' on deep green."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import glob
ICONS = Path(__file__).resolve().parent.parent / "icons"
cands = [p for p in glob.glob("/usr/share/fonts/**/*.ttf", recursive=True) if any(k in p for k in ("DejaVuSerif-Bold", "LiberationSerif-Bold", "NotoSerif-Bold"))]
def make(size, name, rounded=False):
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0) if rounded else (47, 107, 94, 255))
    d = ImageDraw.Draw(img)
    if rounded: d.rounded_rectangle([0, 0, s, s], radius=int(s * 0.22), fill=(47, 107, 94, 255))
    f = ImageFont.truetype(cands[0], int(s * 0.62)) if cands else ImageFont.load_default()
    bb = d.textbbox((0, 0), "ã", font=f)
    d.text(((s - (bb[2] - bb[0])) / 2 - bb[0], (s - (bb[3] - bb[1])) / 2 - bb[1]), "ã", font=f, fill=(246, 243, 236, 255))
    img.resize((size, size), Image.LANCZOS).save(ICONS / name)
make(180, "apple-touch-icon.png")   # iOS rounds corners itself: keep full-bleed
make(192, "icon-192.png")
make(512, "icon-512.png")
print("fonts:", cands[:1])
