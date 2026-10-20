"""Render Zeer's original explanatory diagrams. Optional tooling: Pillow + fonttools[woff]."""
from pathlib import Path
from tempfile import TemporaryDirectory
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "apps/docs/static/demos"
W, H = 1040, 600
BG, PANEL, LINE = "#0c0f12", "#111713", "#29322b"
TEXT, MUTED, LIME, CREAM = "#f4f6f2", "#a9b2ac", "#c1f75b", "#f2d49b"


def render(product, t, fonts):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)

    def text(x, y, label, size=24, color=TEXT, mono=False, bold=False):
        d.text((x, y), label, fill=color, font=fonts[(size, mono, bold)])

    def box(rect, active=False):
        d.rounded_rectangle(rect, radius=12, fill=PANEL, outline=LIME if active else LINE, width=2)
        x, y, r, _ = rect
        d.line((x + 16, y + 2, r - 16, y + 2), fill=LINE)

    def arrow(x1, y, x2, active=False, progress=0):
        d.line((x1, y, x2, y), fill=LINE, width=2)
        d.line((x2 - 8, y - 6, x2, y, x2 - 8, y + 6), fill=MUTED, width=2)
        if active:
            x = x1 + (x2 - x1) * min(1, max(0, progress))
            d.line((x1, y, x, y), fill=LIME, width=3)
            d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=LIME)

    # Persistent labels remain readable while the highlight follows the data.
    text(48, 32, "zeer", 24, LIME, bold=True)
    text(48, 72, f"Zeer {product.title()}", 56, bold=True)
    text(48, 148, "Public Zcash data, selected for your app." if product == "prep"
         else "Your handlers. Your entities. Your API.", 24, MUTED)
    d.line((48, 204, 992, 204), fill=LINE, width=1)

    if product == "prep":
        stages = ["Read blocks", "Select data", "Return JSON"]
        phase = min(2, int(t * 3))
        for i, label in enumerate(stages):
            x = 48 + i * 328
            text(x, 228, label, 24, LIME if i <= phase else MUTED, bold=True)
        # Three concrete source records preserve the relationship to block history.
        for i in range(3):
            y = 280 + i * 64
            box((48, y, 300, y + 52), t > i * .10)
            text(64, y + 12, f"Block {i}", 20, TEXT, mono=True)
            text(212, y + 12, "{ tx }", 20, MUTED, mono=True)
        box((376, 280, 628, 460), t >= .30)
        text(396, 304, "Range", 20, MUTED)
        text(396, 336, "Fields", 20, TEXT)
        text(396, 368, "Filters", 20, TEXT)
        text(396, 416, "Your query", 20, LIME, mono=True)
        box((704, 280, 992, 460), t >= .62)
        for i, line in enumerate(['{ "blocks": [', '  { "height": 0 },', '  { "height": 1 }', '] }']):
            text(724, 300 + i * 36, line, 20, CREAM if t >= .62 else MUTED, mono=True)
        arrow(308, 368, 364, t > .25, (t - .25) / .15)
        arrow(636, 368, 692, t > .55, (t - .55) / .15)
        text(48, 512, "Blocks + transactions", 24)
        text(704, 512, "Only the fields you need", 20, LIME)
    else:
        names = ["Prep", "TypeScript", "PostgreSQL", "GraphQL"]
        details = ["Chain data", "Your handlers", "Your entities", "Your API"]
        for i, (name, detail) in enumerate(zip(names, details)):
            x = 48 + i * 244
            box((x, 276, x + 212, 396), t >= i * .20)
            text(x + 16, 300, name, 24, LIME if t >= i * .20 else TEXT, bold=True)
            text(x + 16, 348, detail, 20, MUTED)
            if i < 3:
                arrow(x + 216, 336, x + 240, t > (i + 1) * .20 - .08,
                      (t - ((i + 1) * .20 - .08)) / .12)
        d.line((48, 436, 992, 436), fill=LINE)
        text(48, 468, "BlockSummary", 24, CREAM, mono=True)
        text(48, 512, "id  height  hash  transactionCount", 20, MUTED, mono=True)
        text(704, 468, "Committed data", 24)
        text(704, 512, "Ready to query", 24, LIME if t >= .70 else MUTED)
    return im


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="zeer-diagram-fonts-") as temp:
        regular = Path(temp) / "manrope.ttf"
        bold = Path(temp) / "manrope-bold.ttf"
        mono = Path(temp) / "mono.ttf"
        source = ROOT / "node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2"
        for weight, dest in [(400, regular), (700, bold)]:
            font = instantiateVariableFont(TTFont(source), {"wght": weight})
            font.flavor = None
            font.save(dest)
        font = TTFont(ROOT / "node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2")
        font.flavor = None
        font.save(mono)
        fonts = {(size, is_mono, is_bold): ImageFont.truetype(str(mono if is_mono else bold if is_bold else regular), size)
                 for size in [20, 24, 56] for is_mono in [False, True] for is_bold in [False, True]}
        for product in ["prep", "chef"]:
            frames = [render(product, min(1, n / 32), fonts) for n in range(48)]
            frames[-1].save(OUT / f"{product}-flow.png", optimize=True)
            palette = frames[-1].quantize(colors=64).getpalette()
            palette_im = Image.new("P", (1, 1)); palette_im.putpalette(palette)
            frames = [f.quantize(palette=palette_im, dither=Image.Dither.NONE) for f in frames]
            dest = OUT / f"{product}-flow.gif"
            frames[0].save(dest, save_all=True, append_images=frames[1:], duration=100, optimize=True)
            with Image.open(dest) as check:
                assert "loop" not in check.info
                duration = 0
                for n in range(check.n_frames):
                    check.seek(n); duration += check.info["duration"]
                assert duration == 4800
            print(f"{dest.name}: {dest.stat().st_size} bytes; 4.8 seconds, one playback")


if __name__ == "__main__":
    main()
