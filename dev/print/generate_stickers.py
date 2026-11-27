#!/usr/bin/env python3
"""
Generate the printable PDFs of Tactile Turtle: the tile stickers per language
and the stickers of the plates.

The tiles (25 x 25 mm) are laid out at their real size on A4, with dashed
lines to cut them out. Each tile carries its marker (the only thing the game
reads), its word in the language of the kit, an optional icon, and the colour
band of its group. See section 10 of DESIGN.md.

The marker codes come from ``data/markers.json``, which is exported from the
game's detector (js-aruco2, ``npm run markers``), so the printed tiles and the
detector cannot disagree. ``npm run verify:print`` reads the PDFs back with
the detector.

Usage (from the repository root):

    venv/bin/python dev/print/generate_stickers.py
    venv/bin/python dev/print/generate_stickers.py --languages de sq

The output goes to ``print/`` by default:

* ``tactile-turtle-tiles-<lang>.pdf`` for every language in ``i18n/``,
* ``tactile-turtle-plate-<a4|a3>.pdf``, the same for every language.
"""

from __future__ import annotations

import argparse
import dataclasses
import html
import json
import pathlib
import re
import subprocess
import sys
from typing import Any, Dict, List, Optional, Sequence, Tuple

import weasyprint
from fontTools.ttLib import TTCollection, TTFont
from PIL import ImageFont

REPO = pathlib.Path(__file__).resolve().parents[2]

GROUP_ORDER = [
    "action",
    "control",
    "operator",
    "number",
    "variable",
    "sensor",
    "value",
]

# The page of the tiles: A4 portrait in millimetres.
PAGE_WIDTH = 210.0
PAGE_HEIGHT = 297.0
COLUMNS = 8
ROWS = 11
GRID_TOP = 12.0

# Overhang of the cut lines beyond the grid, as crop marks.
CUT_OVERHANG = 3.0


@dataclasses.dataclass(frozen=True)
class FontChoice:
    """A font as used in CSS and as a file, for measuring and checking."""

    family: str
    weight: int
    path: pathlib.Path


@dataclasses.dataclass(frozen=True)
class Tile:
    id: int
    key: str
    group: str
    kit: int
    symbol: Optional[str]
    icon: Optional[str]
    fill: Optional[str]


@dataclasses.dataclass(frozen=True)
class Language:
    code: str
    name: str
    texts: Dict[str, str]


def load_json(path: pathlib.Path) -> Any:
    with path.open("rt", encoding="utf-8") as fid:
        return json.load(fid)


def load_tiles(catalogue: Dict[str, Any]) -> List[Tile]:
    return [
        Tile(
            id=entry["id"],
            key=entry["key"],
            group=entry["group"],
            kit=entry["kit"],
            symbol=entry.get("symbol"),
            icon=entry.get("icon"),
            fill=entry.get("fill"),
        )
        for entry in catalogue["tiles"]
    ]


def load_languages(codes: Optional[Sequence[str]]) -> List[Language]:
    result = []
    for path in sorted((REPO / "i18n").glob("*.json")):
        data = load_json(path)
        code = data["language"]["code"]
        if codes is not None and code not in codes:
            continue
        result.append(
            Language(code=code, name=data["language"]["name"], texts=data["texts"])
        )

    if codes is not None:
        missing = set(codes) - {language.code for language in result}
        if missing:
            raise SystemExit(f"No i18n/<lang>.json for: {', '.join(sorted(missing))}")
    return result


# region Fonts


def resolve_font(family: str, weight: int) -> FontChoice:
    """Find the file of a font with fontconfig, and refuse a substitute."""
    style = "bold" if weight >= 700 else "regular"
    try:
        output = subprocess.run(
            ["fc-match", "-f", "%{family}\n%{file}", f"{family}:{style}"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    except FileNotFoundError:
        raise SystemExit("fc-match (fontconfig) is needed to find the fonts.")

    families_line, file_line = output.split("\n", 1)
    families = [name.strip() for name in families_line.split(",")]
    if family not in families:
        raise SystemExit(
            f"The font {family!r} is not installed (fontconfig offers "
            f"{families_line!r} instead). On Debian or Ubuntu: "
            "sudo apt-get install fonts-noto-core fonts-noto-cjk fonts-dejavu-core fonts-tibetan-machine"
        )
    return FontChoice(family=family, weight=weight, path=pathlib.Path(file_line))


# Fonts for scripts beyond Latin, Cyrillic and Greek (Noto Sans covers those).
# Chinese, Japanese and Korean: fonts-noto-cjk; Hindi and Arabic: fonts-noto-core.
CJK_FONTS = {
    "zh": "Noto Sans CJK SC",
    "ja": "Noto Sans CJK JP",
    "ko": "Noto Sans CJK KR",
    "hi": "Noto Sans Devanagari",
    "ar": "Noto Sans Arabic",
}


def font_for(language: Language, tile: Tile) -> FontChoice:
    if tile.symbol is not None:
        return resolve_font("DejaVu Sans", 700)
    if language.code in CJK_FONTS:
        return resolve_font(CJK_FONTS[language.code], 700)
    if language.code == "bo":
        # Its stacks are more compact than those of Noto Serif Tibetan: the
        # same strip holds the words about half again as large.
        return resolve_font("Tibetan Machine Uni", 700)
    return resolve_font("Noto Sans", 700)


_CMAPS: Dict[pathlib.Path, set] = {}


def assert_covers(font: FontChoice, text: str, where: str) -> None:
    """Fail if the font lacks a glyph, so that no PDF ships with tofu."""
    if font.path not in _CMAPS:
        if font.path.suffix.lower() == ".ttc":
            ttfont = TTCollection(str(font.path)).fonts[0]
        else:
            ttfont = TTFont(str(font.path), lazy=True)
        _CMAPS[font.path] = set(ttfont.getBestCmap().keys())

    missing = [
        char
        for char in text
        if not char.isspace() and ord(char) not in _CMAPS[font.path]
    ]
    if missing:
        raise SystemExit(
            f"{where}: the font {font.family} ({font.path}) has no glyph for "
            + ", ".join(f"U+{ord(char):04X} {char!r}" for char in missing)
        )


_PIL_FONTS: Dict[pathlib.Path, ImageFont.FreeTypeFont] = {}


@dataclasses.dataclass(frozen=True)
class Ink:
    """The measured shape of a shaped text, in em (1 em = the font size)."""

    width: float  # the wider of the advance and the inked width
    above: float  # how far the ink reaches above the baseline
    below: float  # how far the ink reaches below the baseline
    ascent: float  # the font's ascent (where the baseline sits in a line box)
    descent: float


def measure(font: FontChoice, text: str) -> Ink:
    """Measure the real ink of the shaped text, accents and stacked letters included."""
    if font.path not in _PIL_FONTS:
        _PIL_FONTS[font.path] = ImageFont.truetype(
            str(font.path), size=1000, layout_engine=ImageFont.Layout.RAQM
        )
    pil = _PIL_FONTS[font.path]
    left, top, right, bottom = pil.getbbox(text, anchor="ls")
    ascent, descent = pil.getmetrics()
    return Ink(
        width=max(pil.getlength(text), right - left) / 1000.0,
        above=-top / 1000.0,
        below=bottom / 1000.0,
        ascent=ascent / 1000.0,
        descent=descent / 1000.0,
    )


# endregion

# region Markers

_MARKERS = load_json(REPO / "data" / "markers.json")


def marker_svg(marker_id: int, x: float, y: float, size: float) -> str:
    """
    Draw a marker as SVG in millimetres: a black square with the white cells
    of its code ("1" = white), inside a black border of one cell.
    """
    side = _MARKERS["side"]
    code = _MARKERS["codes"][marker_id]
    cells = side + 2
    white = []
    for row in range(side):
        for column in range(side):
            if code[row * side + column] == "1":
                white.append(f"M{column + 1} {row + 1}h1v1h-1z")
    return (
        f'<svg class="marker" style="left:{x}mm;top:{y}mm;width:{size}mm;'
        f'height:{size}mm" viewBox="0 0 {cells} {cells}" '
        f'shape-rendering="crispEdges">'
        f'<rect width="{cells}" height="{cells}" fill="#000"/>'
        f'<path d="{"".join(white)}" fill="#fff"/></svg>'
    )


# endregion

# Languages whose script stacks letters above and below the line.
STACKING_LANGUAGES = {"bo"}

_LANGUAGE_INK: Dict[Tuple[str, pathlib.Path], Tuple[float, float]] = {}


def language_ink(language: Language, font: FontChoice) -> Tuple[float, float]:
    """How far the words of a language reach above and below the baseline, at most (em)."""
    key = (language.code, font.path)
    if key not in _LANGUAGE_INK:
        words = [text for name, text in language.texts.items() if name.startswith("tile.")]
        inks = [measure(font, word) for word in words]
        _LANGUAGE_INK[key] = (max(i.above for i in inks), max(i.below for i in inks))
    return _LANGUAGE_INK[key]


# region Icons

# The icons are SVGs in assets/icons/ (100 x 100), in the colour of their
# group; on a coloured tile, they take the ink colour of the tile instead.
ICON_DIR = REPO / "assets" / "icons"
_ICONS: Dict[str, str] = {}


def icon_content(icon: str) -> str:
    if icon not in _ICONS:
        path = ICON_DIR / f"{icon}.svg"
        if not path.exists():
            raise SystemExit(f"Missing icon: {path}")
        text = path.read_text(encoding="utf-8")
        _ICONS[icon] = text[text.index(">", text.index("<svg")) + 1 : text.rindex("</svg>")]
    return _ICONS[icon]


def icon_svg(icon: str, x: float, y: float, size: float, colour: Optional[str]) -> str:
    content = icon_content(icon)
    if colour is not None:
        content = re.sub(r'fill="#[0-9a-fA-F]{6}"', f'fill="{colour}"', content)
    return (
        f'<svg class="icon" style="left:{x}mm;top:{y}mm;width:{size}mm;'
        f'height:{size}mm" viewBox="0 0 100 100">{content}</svg>'
    )


# endregion

# region Tiles


def is_dark(colour: str) -> bool:
    red, green, blue = (int(colour[i : i + 2], 16) for i in (1, 3, 5))
    return 0.299 * red + 0.587 * green + 0.114 * blue < 150


def label_of(language: Language, tile: Tile) -> str:
    if tile.symbol is not None:
        return tile.symbol

    key = f"tile.{tile.key}"
    if key not in language.texts:
        raise SystemExit(f"i18n/{language.code}.json lacks the text {key!r}.")
    return language.texts[key]


def tile_html(
    tile: Tile,
    language: Language,
    x: float,
    y: float,
    geometry: Dict[str, float],
    groups: Dict[str, Any],
) -> Tuple[str, List[str]]:
    """
    Render one tile at (x, y) on the page; return the HTML and warnings.

    The layout (DESIGN.md, section 5): the marker at the top, with a white
    margin of at least one cell all around it; the label strip below it; the
    colour band of the group along the bottom edge.
    """
    warnings: List[str] = []
    width = geometry["tile_width"]
    height = geometry["tile_height"]
    label_top = geometry["label_top"]
    label_bottom = geometry["label_bottom"]
    band = geometry["band_height"]

    parts = []

    if tile.fill is not None:
        # A colour tile: the coloured strip reaches down to the edge (instead of
        # the band of the group), so that it is tall enough for every script.
        # It cannot reach up: the white margin around the marker must stay white.
        parts.append(
            f'<div class="fill" style="left:0;top:{label_top}mm;'
            f"width:{width}mm;height:{height - label_top}mm;"
            f'background:{tile.fill}"></div>'
        )
    else:
        parts.append(
            f'<div class="band" style="left:0;top:{height - band}mm;width:{width}mm;'
            f'height:{band}mm;background:{groups[tile.group]["colour"]}"></div>'
        )

    parts.append(
        marker_svg(
            tile.id, geometry["marker_x"], geometry["marker_y"], geometry["marker_size"]
        )
    )

    ink_colour = "#fff" if tile.fill is not None and is_dark(tile.fill) else "#111"

    area_left = 1.0
    area_right = width - 1.0
    label_height = label_bottom - label_top

    if tile.icon is not None:
        icon_size = min(3.4, label_height - 0.8)
        icon_colour = ink_colour if tile.fill is not None else None
        parts.append(
            icon_svg(
                tile.icon,
                area_left,
                label_top + (label_height - icon_size) / 2,
                icon_size,
                icon_colour,
            )
        )
        area_left += icon_size + 0.5

    area_width = area_right - area_left

    label = label_of(language, tile)
    font = font_for(language, tile)
    assert_covers(font, label, f"Tile {tile.key} in {language.code}")

    # The text box: inside the label strip, with room above (the white margin
    # of the marker) and below (the cut). The text is sized by its real ink
    # (accents, Cyrillic, Tibetan stacks) and centred on it, so nothing is
    # clipped and nothing comes near the edges.
    box_top = label_top + 0.5
    box_height = geometry["label_bottom"] - box_top
    ink = measure(font, label)
    stacking = language.code in STACKING_LANGUAGES
    if tile.symbol is None and not stacking:
        # Words share one baseline and one height per language (measured over
        # all its words), so that a kit looks even: only the width is per word.
        above, below = language_ink(language, font)
        ink = dataclasses.replace(ink, above=above, below=below)
    # Scripts that stack letters (Tibetan) differ too much in height from word
    # to word: there, each word is as large as its own stacks allow.
    ink_height = ink.above + ink.below
    size = min(
        area_width * 0.97 / ink.width if ink.width > 0 else box_height,
        box_height * (1.0 if stacking else 0.95) / ink_height if ink_height > 0 else box_height,
        box_height * (1.15 if stacking else 1.0 if tile.symbol is not None else 0.85),
    )
    if size < 2.0:
        warnings.append(
            f"{language.code}: {label!r} needs a small font ({size:.1f} mm); "
            "consider a shorter word."
        )
    # The baseline that centres the ink in the box; the line box of the div is
    # ascent + descent high, with the baseline at the ascent.
    baseline = box_top + (box_height - ink_height * size) / 2 + ink.above * size
    line_height = (ink.ascent + ink.descent) * size
    parts.append(
        f'<div class="label" style="left:{area_left}mm;top:{baseline - ink.ascent * size:.3f}mm;'
        f"width:{area_width}mm;height:{line_height:.3f}mm;line-height:{line_height:.3f}mm;"
        f"font-family:'{font.family}';"
        f'font-weight:{font.weight};font-size:{size:.3f}mm;color:{ink_colour}">'
        f"{html.escape(label)}</div>"
    )

    # The id, tiny, in the top right corner: helps to sort and to debug.
    parts.append(
        f'<div class="id" style="left:{width - 4.2}mm;top:0.6mm;width:3.6mm">{tile.id}</div>'
    )

    return (
        f'<div class="tile" style="left:{x}mm;top:{y}mm;width:{width}mm;'
        f'height:{height}mm">{"".join(parts)}</div>',
        warnings,
    )


def cut_lines_svg(
    count: int, left: float, top: float, width: float, height: float
) -> str:
    """Draw the dashed cut lines around ``count`` tiles filled row by row."""
    rows = (count + COLUMNS - 1) // COLUMNS

    def in_row(row: int) -> int:
        if row < 0 or row >= rows:
            return 0
        return min(COLUMNS, count - row * COLUMNS)

    lines = []
    # Horizontal lines: one at the top of each row and one below the last.
    for row in range(rows + 1):
        span = max(in_row(row - 1), in_row(row))
        y = top + row * height
        lines.append((left - CUT_OVERHANG, y, left + span * width + CUT_OVERHANG, y))

    # Vertical lines: column boundary c spans the rows which have a tile on
    # either side of it.
    for column in range(COLUMNS + 1):
        spanned = [row for row in range(rows) if in_row(row) >= max(column, 1)]
        if not spanned:
            continue
        x = left + column * width
        y0 = top + spanned[0] * height
        y1 = top + (spanned[-1] + 1) * height
        lines.append((x, y0 - CUT_OVERHANG, x, y1 + CUT_OVERHANG))

    segments = "".join(
        f'<line x1="{x0}" y1="{y0}" x2="{x1}" y2="{y1}"/>' for x0, y0, x1, y1 in lines
    )
    return (
        f'<svg class="overlay" viewBox="0 0 {PAGE_WIDTH} {PAGE_HEIGHT}">'
        f'<g stroke="#777" stroke-width="0.2" stroke-dasharray="1.5 1" fill="none">'
        f"{segments}</g></svg>"
    )


def test_bar_html(x: float, y: float) -> str:
    return (
        f'<div class="bar" style="left:{x}mm;top:{y}mm"></div>'
        f'<div class="note" style="left:{x + 52}mm;top:{y - 1.2}mm">'
        f"← 50 mm: if not, print at 100 % (no “fit to page”)</div>"
    )


COMMON_CSS = """
* { margin: 0; padding: 0; box-sizing: border-box; }
.page { position: relative; overflow: hidden; page-break-after: always; }
.page:last-child { page-break-after: auto; }
.tile, .marker, .icon, .fill, .band, .label, .id, .overlay, .bar, .note, .header,
.plate-text {
  position: absolute;
}
.tile { background: #fff; }
.label {
  text-align: center; white-space: nowrap;
}
.id {
  font-family: 'DejaVu Sans'; font-size: 1.3mm; text-align: right;
  color: #999;
}
.overlay { left: 0; top: 0; width: 100%; height: 100%; }
.bar { width: 50mm; height: 1.2mm; background: #111; }
.note, .header, .plate-text { font-family: 'Noto Sans'; font-size: 2.8mm; color: #444; }
.header { font-size: 3.4mm; }
"""


# The text form of the solutions (src/lang/tokens.ts): symbols for some keys.
_SYMBOL_KEYS = {
    "←": "ASSIGN", "<-": "ASSIGN", "★": "STAR", "●": "DOT", "+": "PLUS", "−": "MINUS", "-": "MINUS",
    "×": "TIMES", "*": "TIMES", "=": "EQUAL", "==": "EQUAL", "≠": "NOT_EQUAL", "!=": "NOT_EQUAL",
    "<": "LESS", ">": "GREATER",
}

# Spare tiles in a kit for some worlds: the children try more than one idea.
_SPARES = {"FORWARD": 2, "LEFT": 2, "RIGHT": 2}


def kit_for_worlds(tiles: List[Tile], worlds: Sequence[int]) -> Dict[str, int]:
    """
    The tiles the levels of these worlds need (per kind, the most any of their
    reference solutions uses), with a few spares.
    """
    levels = load_json(REPO / "data" / "levels.json")["levels"]
    need: Dict[str, int] = {}
    for level in levels:
        if level["world"] not in worlds:
            continue
        counts: Dict[str, int] = {}
        for word in " ".join(level["solution"]).split():
            keys = list(word) if word.isdigit() else [_SYMBOL_KEYS.get(word, word)]
            for key in keys:
                counts[key] = counts.get(key, 0) + 1
        for key, count in counts.items():
            need[key] = max(need.get(key, 0), count)
    known = {tile.key for tile in tiles}
    unknown = set(need) - known
    if unknown:
        raise SystemExit(f"Unknown words in the solutions: {sorted(unknown)}")
    return {key: count + _SPARES.get(key, 1) for key, count in need.items()}


def render_tiles_pdf(
    language: Language,
    tiles: List[Tile],
    catalogue: Dict[str, Any],
    output: pathlib.Path,
    counts: Optional[Dict[str, int]] = None,
) -> List[str]:
    """Render a kit: the standard kit, or ``counts`` (tile key: how many)."""
    geometry = catalogue["geometry_mm"]
    groups = catalogue["groups"]

    kit = [
        tile
        for group in GROUP_ORDER
        for tile in tiles
        if tile.group == group
        for _ in range(tile.kit if counts is None else counts.get(tile.key, 0))
    ]

    per_page = COLUMNS * ROWS
    pages = [kit[i : i + per_page] for i in range(0, len(kit), per_page)]

    width = geometry["tile_width"]
    height = geometry["tile_height"]
    left = (PAGE_WIDTH - COLUMNS * width) / 2

    warnings: List[str] = []
    page_htmls = []
    for page_index, page_tiles in enumerate(pages):
        parts = [
            f'<div class="header" style="left:{left}mm;top:4.5mm">'
            f"Tactile Turtle · {html.escape(language.name)} "
            f"({html.escape(language.code)}) · {page_index + 1}/{len(pages)}</div>"
        ]
        for index, tile in enumerate(page_tiles):
            x = left + (index % COLUMNS) * width
            y = GRID_TOP + (index // COLUMNS) * height
            tile_markup, tile_warnings = tile_html(
                tile, language, x, y, geometry, groups
            )
            parts.append(tile_markup)
            warnings.extend(tile_warnings)

        parts.append(cut_lines_svg(len(page_tiles), left, GRID_TOP, width, height))
        parts.append(test_bar_html(left, PAGE_HEIGHT - 6.0))

        page_htmls.append(
            f'<div class="page" style="width:{PAGE_WIDTH}mm;height:{PAGE_HEIGHT}mm">'
            f'{"".join(parts)}</div>'
        )

    document = (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        f"<title>Tactile Turtle tiles ({html.escape(language.code)})</title>"
        f"<style>@page {{ size: A4 portrait; margin: 0; }}{COMMON_CSS}</style>"
        f'</head><body>{"".join(page_htmls)}</body></html>'
    )
    weasyprint.HTML(string=document).write_pdf(str(output))

    # The same words appear many times; report each warning once.
    return sorted(set(warnings))


# endregion

# region Plate


def render_plate_pdf(
    plate: Dict[str, Any], tile_geometry: Dict[str, float], output: pathlib.Path
) -> None:
    """
    The sticker of a plate (DESIGN.md, section 5): an anchor marker at both
    ends of every row, the row lines, and marks for the slots of the tiles.
    """
    width = plate["width"]
    height = plate["height"]
    size = plate["anchor_size"]
    margin = plate["anchor_margin"]
    pitch = plate["row_pitch"]
    rows_top = plate["rows_top"]
    rows_left = plate["rows_left"]
    tile_width = tile_geometry["tile_width"]
    rows_right = rows_left + plate["columns"] * tile_width

    parts = []
    lines = []
    for row in range(plate["rows"]):
        y = rows_top + row * pitch + (pitch - size) / 2
        left_id = plate["first_anchor"] + 2 * row
        parts.append(marker_svg(left_id, margin, y, size))
        parts.append(marker_svg(left_id + 1, width - margin - size, y, size))

    for row in range(plate["rows"] + 1):
        y = rows_top + row * pitch
        lines.append(
            f'<line x1="{rows_left}" y1="{y}" x2="{rows_right}" y2="{y}" '
            f'stroke="#bbb" stroke-width="0.3"/>'
        )

    # Slot marks: short ticks at the slot boundaries on every row line.
    for row in range(plate["rows"] + 1):
        y = rows_top + row * pitch
        for column in range(plate["columns"] + 1):
            x = rows_left + column * tile_width
            lines.append(
                f'<line x1="{x}" y1="{y - 1.2}" x2="{x}" y2="{y + 1.2}" '
                f'stroke="#999" stroke-width="0.3"/>'
            )

    parts.append(
        f'<svg class="overlay" viewBox="0 0 {width} {height}">{"".join(lines)}</svg>'
    )
    parts.append(
        f'<div class="plate-text" style="left:{rows_left}mm;top:{max(0.8, rows_top - 4.5)}mm">'
        f"Tactile Turtle · {html.escape(plate['description'])} · ↑ this way up</div>"
    )

    document = (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        f"<title>Tactile Turtle plate ({plate['name']})</title>"
        f"<style>@page {{ size: {width}mm {height}mm; margin: 0; }}{COMMON_CSS}</style>"
        f'</head><body><div class="page" style="width:{width}mm;height:{height}mm">'
        f'{"".join(parts)}</div></body></html>'
    )
    weasyprint.HTML(string=document).write_pdf(str(output))


# endregion


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--languages",
        nargs="+",
        help="Language codes (default: every file in i18n/)",
    )
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        default=REPO / "print",
        help="Output directory (default: print/)",
    )
    parser.add_argument(
        "--worlds",
        help=(
            "Make a smaller kit for these worlds only, e.g. 1 or 1-3 (the tiles "
            "their levels need, with spares); written as ...-world-1.pdf"
        ),
    )
    args = parser.parse_args(argv)

    catalogue = load_json(REPO / "data" / "tiles.json")
    plates = load_json(REPO / "data" / "plate.json")
    tiles = load_tiles(catalogue)
    languages = load_languages(args.languages)

    if len(_MARKERS["codes"]) <= max(tile.id for tile in tiles):
        raise SystemExit("data/markers.json has fewer codes than there are tiles.")

    args.output.mkdir(parents=True, exist_ok=True)

    counts: Optional[Dict[str, int]] = None
    suffix = ""
    if args.worlds:
        first, _, last = args.worlds.partition("-")
        worlds = list(range(int(first), int(last or first) + 1))
        counts = kit_for_worlds(tiles, worlds)
        suffix = f"-world-{args.worlds}"
        print(f"The kit for world {args.worlds}: {sum(counts.values())} tiles: {counts}")

    for language in languages:
        pdf = args.output / f"tactile-turtle-tiles-{language.code}{suffix}.pdf"
        for warning in render_tiles_pdf(language, tiles, catalogue, pdf, counts):
            print(f"Warning: {warning}", file=sys.stderr)
        print(f"Wrote {pdf}")

    if args.worlds:
        return 0

    for plate in plates["plates"]:
        pdf = args.output / f"tactile-turtle-plate-{plate['name']}.pdf"
        render_plate_pdf(plate, catalogue["geometry_mm"], pdf)
        print(f"Wrote {pdf}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
