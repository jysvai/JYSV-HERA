"""Builds the app icons from resources/icon-art.png (the full-bleed 1024 px artwork:
a gold terminal prompt (>_) under a small crown) and writes resources/icon-1024.png,
icon.png, icon.ico, icon.icns and the tray images. Run: python scripts/make-icons.py"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources')
ART = Image.open(os.path.join(ROOT, 'icon-art.png')).convert('RGB')
S = 2048  # supersampled canvas
k = S / 1024
# macOS icon grid: an 824 px tile centred on a 1024 canvas.
TILE = (100, 100, 924, 924)
RADIUS = 185


def zoomed(art, factor):
    """Crop the centre so the mark fills more of the tile."""
    w, h = art.size
    cw, ch = int(w / factor), int(h / factor)
    left, top = (w - cw) // 2, (h - ch) // 2
    return art.crop((left, top, left + cw, top + ch))


def tile_icon():
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    x0, y0, x1, y1 = (int(v * k) for v in TILE)

    # soft drop shadow under the tile
    shadow = Image.new('L', (S, S), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([x0, y0 + int(14 * k), x1, y1 + int(14 * k)], radius=int(RADIUS * k), fill=120)
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(18 * k)))
    canvas.alpha_composite(Image.merge('RGBA', (Image.new('L', (S, S), 0),) * 3 + (shadow,)))

    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([x0, y0, x1, y1], radius=int(RADIUS * k), fill=255)
    art = zoomed(ART, 1.02).resize((x1 - x0, y1 - y0), Image.LANCZOS)
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    layer.paste(art, (x0, y0))
    canvas.paste(layer, (0, 0), mask)

    # hairline gold rim
    rim = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle([x0 + 2, y0 + 2, x1 - 2, y1 - 2], radius=int(RADIUS * k), outline=(232, 186, 70, 90), width=int(4 * k))
    canvas.alpha_composite(rim)
    return canvas.resize((1024, 1024), Image.LANCZOS)


def small_icon(size):
    """Small sizes: less margin and a tighter crop so the crown stays readable."""
    canvas = Image.new('RGBA', (size * 8, size * 8), (0, 0, 0, 0))
    mask = Image.new('L', canvas.size, 0)
    pad = size // 2
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, size * 8 - pad, size * 8 - pad], radius=size * 2, fill=255)
    art = zoomed(ART, 1.3).resize(canvas.size, Image.LANCZOS)
    canvas.paste(art, (0, 0), mask)
    return canvas.resize((size, size), Image.LANCZOS)


big = tile_icon()
big.save(os.path.join(ROOT, 'icon-1024.png'))
big.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, 'icon.png'))

# .ico: every size drawn separately so 16-32 px get the tighter small version.
frames = {s: (small_icon(s) if s <= 48 else big.resize((s, s), Image.LANCZOS)) for s in (16, 24, 32, 48, 64, 128, 256)}
frames[256].save(os.path.join(ROOT, 'icon.ico'), sizes=[(s, s) for s in frames], append_images=[frames[s] for s in frames if s != 256])
try:
    big.save(os.path.join(ROOT, 'icon.icns'))
except Exception as error:  # pragma: no cover
    print('icns skipped:', error)
small_icon(32).save(os.path.join(ROOT, 'tray-16@2x.png'))
small_icon(16).save(os.path.join(ROOT, 'tray-16.png'))
print('ok', sorted(os.listdir(ROOT)))
