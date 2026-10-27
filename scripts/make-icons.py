"""Draws the JYSV HERA mark (gold diadem over an H, on ink) and writes
resources/icon.png, icon.ico and icon.icns. Run: python scripts/make-icons.py"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources')
os.makedirs(ROOT, exist_ok=True)
S = 2048  # supersampled canvas
k = S / 1024


def gradient(size, top, bottom):
    img = Image.new('RGB', (1, 256))
    for y in range(256):
        t = y / 255
        img.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img.resize(size)


def mark():
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # ink tile
    tile_mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(tile_mask).rounded_rectangle([int(64 * k), int(64 * k), int(960 * k), int(960 * k)], radius=int(210 * k), fill=255)
    tile = gradient((S, S), (30, 31, 36), (10, 11, 13))
    canvas.paste(tile, (0, 0), tile_mask)

    # hairline rim
    rim = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle([int(66 * k), int(66 * k), int(958 * k), int(958 * k)], radius=int(208 * k), outline=(212, 167, 44, 70), width=int(5 * k))
    canvas.alpha_composite(rim)

    # gold glyph: diadem + H
    glyph = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(glyph)
    p = lambda pts: [(int(x * k), int(y * k)) for x, y in pts]
    # H bars + crossbar
    d.rounded_rectangle(p([(300, 400), (398, 790)]), radius=int(18 * k), fill=255)
    d.rounded_rectangle(p([(626, 400), (724, 790)]), radius=int(18 * k), fill=255)
    d.rectangle(p([(398, 560), (626, 640)]), fill=255)
    # diadem band sitting on the bars
    d.polygon(p([(300, 372), (300, 330), (372, 214), (442, 300), (512, 168), (582, 300), (652, 214), (724, 330), (724, 372)]), fill=255)
    # jewels at the peaks
    for cx, cy, r in [(372, 196, 26), (512, 146, 32), (652, 196, 26)]:
        d.ellipse(p([(cx - r, cy - r), (cx + r, cy + r)]), fill=255)
    # notch separating diadem from bars
    d.rectangle(p([(398, 372), (626, 392)]), fill=0)
    d.rectangle(p([(290, 372), (734, 384)]), fill=0)

    gold = gradient((S, S), (246, 214, 120), (176, 124, 18))
    glow = glyph.filter(ImageFilter.GaussianBlur(int(22 * k)))
    halo = Image.new('RGBA', (S, S), (212, 167, 44, 0))
    halo.putalpha(glow.point(lambda v: int(v * 0.35)))
    canvas.alpha_composite(halo)
    gold_layer = Image.new('RGBA', (S, S))
    gold_layer.paste(gold, (0, 0))
    gold_layer.putalpha(glyph)
    canvas.alpha_composite(gold_layer)
    return canvas


big = mark().resize((1024, 1024), Image.LANCZOS)
big.save(os.path.join(ROOT, 'icon-1024.png'))
big.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, 'icon.png'))
big.save(os.path.join(ROOT, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
try:
    big.save(os.path.join(ROOT, 'icon.icns'))
except Exception as error:  # pragma: no cover
    print('icns skipped:', error)
# tray template (small, monochrome-friendly)
big.resize((32, 32), Image.LANCZOS).save(os.path.join(ROOT, 'tray-16@2x.png'))
big.resize((16, 16), Image.LANCZOS).save(os.path.join(ROOT, 'tray-16.png'))
print('ok', sorted(os.listdir(ROOT)))
