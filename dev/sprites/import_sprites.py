#!/usr/bin/env python3
"""
Cut the generated sprite sheets into single sprites for the game.

The sheets were generated from the prompts of dev/sprites/export_prompts.ts.
This script finds the sprites on each sheet (blobs of opaque pixels, or a
fixed grid), centres them, and writes them as square PNGs to
``assets/sprites/``, together with ``assets/sprites/manifest.json``.

Frames of one animation share one square (centred on the same point and of
the same size), so that they line up when played one after the other.

Usage:
    venv/bin/python dev/sprites/import_sprites.py ~/Downloads
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Dict, List, Sequence, Tuple

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from components import Box, components  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[2]
OUT = REPO / "assets" / "sprites"

SPRITE_SIZE = 160  # pixels; a cell of the board is 64, so this is sharp at 2x
TILE_SIZE = 128  # the ground tiles


def union(boxes: Sequence[Box]) -> Box:
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def square_crops(
    image: Image.Image,
    boxes: Sequence[Box],
    margin: float = 0.06,
    clips: Sequence[Box] | None = None,
    side: float | None = None,
) -> List[Image.Image]:
    """
    Crop the boxes to squares of one common size, each centred on its box.
    With ``clips``, nothing outside the clip box of a sprite is taken (so that
    a neighbour on the sheet does not show at the edge of the square).
    """
    if side is None:
        side = max(max(b[2] - b[0], b[3] - b[1]) for b in boxes) * (1 + 2 * margin)
    side = int(side)
    crops = []
    for i, box in enumerate(boxes):
        cx = (box[0] + box[2]) / 2
        cy = (box[1] + box[3]) / 2
        left = int(round(cx - side / 2))
        top = int(round(cy - side / 2))
        source = image
        if clips is not None:
            source = Image.new("RGBA", image.size, (0, 0, 0, 0))
            source.paste(image.crop(clips[i]), clips[i][:2])
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(source.crop((left, top, left + side, top + side)), (0, 0))
        crops.append(canvas.resize((SPRITE_SIZE, SPRITE_SIZE), Image.Resampling.LANCZOS))
    return crops


def grid_boxes(image: Image.Image, columns: int, rows: int, inset: int = 0) -> List[Box]:
    w = image.width / columns
    h = image.height / rows
    return [
        (int(c * w) + inset, int(r * h) + inset, int((c + 1) * w) - inset, int((r + 1) * h) - inset)
        for r in range(rows)
        for c in range(columns)
    ]


def opaque_box(image: Image.Image, box: Box) -> Box:
    """The bounding box of the opaque pixels within a box."""
    inner = image.crop(box).getchannel("A").point(lambda a: 255 if a > 40 else 0).getbbox()
    if inner is None:
        return box
    return (box[0] + inner[0], box[1] + inner[1], box[0] + inner[2], box[1] + inner[3])


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source", type=pathlib.Path, help="The directory with the sprite sheets")
    args = parser.parse_args(argv)
    src: pathlib.Path = args.source.expanduser()

    def sheet(name: str) -> Image.Image:
        path = src / name
        if not path.exists():
            raise SystemExit(f"Missing sheet: {path}")
        return Image.open(path).convert("RGBA")

    OUT.mkdir(parents=True, exist_ok=True)
    sprites: Dict[str, Image.Image] = {}

    def by_blobs(name: str, names: List[str]) -> None:
        image = sheet(name)
        boxes = components(image)
        if len(boxes) != len(names):
            raise SystemExit(f"{name}: found {len(boxes)} sprites, expected {len(names)}")
        for sprite_name, crop in zip(names, square_crops(image, boxes)):
            sprites[sprite_name] = crop

    def by_cells(name: str, columns: int, rows: int, names: List[str], cells: List[int] | None = None) -> None:
        image = sheet(name)
        all_cells = grid_boxes(image, columns, rows)
        chosen = [all_cells[i] for i in (cells or range(len(names)))]
        boxes = [opaque_box(image, cell) for cell in chosen]
        for sprite_name, crop in zip(names, square_crops(image, boxes, clips=chosen)):
            sprites[sprite_name] = crop

    # The turtle: standing, walking (6 frames), turning left and right (6 frames
    # each). The sheets were drawn at different scales, and a turtle turned by
    # 45° needs a larger square: all turtle frames get one scale, measured by
    # the height of the turtle facing up (the first frame of every sheet).
    turtle_sheets = [
        ("Seven Cute Green Turtle Sprite Frames.png", ["turtle"] + [f"turtle-walk-{i}" for i in range(1, 7)]),
        ("Six-Frame Green Turtle Robot Sprite Sheet.png", [f"turtle-turn-left-{i}" for i in range(1, 7)]),
        ("Rotating Green Turtle Sprite Sheet.png", [f"turtle-turn-right-{i}" for i in range(1, 7)]),
    ]
    found = []
    for name, names in turtle_sheets:
        image = sheet(name)
        boxes = components(image)
        if len(boxes) != len(names):
            raise SystemExit(f"{name}: found {len(boxes)} sprites, expected {len(names)}")
        found.append((image, boxes, names, boxes[0][3] - boxes[0][1]))
    # The square, in units of "the height of the turtle facing up".
    unit_side = 1.1 * max(max(b[2] - b[0], b[3] - b[1]) / height for _, boxes, _, height in found for b in boxes)
    for image, boxes, names, height in found:
        for sprite_name, crop in zip(names, square_crops(image, boxes, side=unit_side * height)):
            sprites[sprite_name] = crop
    turtle_extent = 1 / unit_side  # the share of the square taken by the turtle's length

    # The things.
    by_blobs("Colorful Symbolic Wooden Crate Set.png", ["box-red", "box-green", "box-blue", "box-yellow"])
    by_blobs("Cute Green Turtle Hatchling Sprite Sheet.png", [f"hatchling-{i}" for i in range(1, 9)])
    by_blobs("Six Stylized Beach Rock Variants.png", [f"rock-{i}" for i in range(1, 7)])
    # The lamp lights up in 5 frames (the glows of the last frames touch: cut by columns).
    by_cells("Luminous Lamp Animation Sequence.png", 5, 1, [f"lamp-{i}" for i in range(5)])
    # The gate opens in 6 frames (each but the first is two halves: cut by cells).
    gate = sheet("Wooden Harbor Gate Opening Sprites.png")
    gate_frames = [
        union([b for b in components(gate) if row_top <= b[1] < row_top + 400 and x0 <= b[0] < x1])
        for row_top, x0, x1 in [(0, 0, 500), (0, 500, 1000), (0, 1000, 1536), (500, 0, 500), (500, 500, 1000), (500, 1000, 1536)]
    ]
    for i, crop in enumerate(square_crops(gate, gate_frames)):
        sprites[f"gate-{i}"] = crop

    # The ground: a 4 x 4 atlas: sand, sea, the coloured cells, more sea.
    atlas = Image.open(src / "Tropical Turtle Terrain Tile Atlas.png").convert("RGBA")
    names = (
        [f"sand-{i}" for i in range(1, 5)]
        + [f"sea-{i}" for i in range(1, 5)]
        + ["cell-red", "cell-green", "cell-blue", "cell-yellow"]
        + [f"sea-{i}" for i in range(5, 9)]
    )
    for name, box in zip(names, grid_boxes(atlas, 4, 4, inset=3)):
        sprites[name] = atlas.crop(box).resize((TILE_SIZE, TILE_SIZE), Image.Resampling.LANCZOS)

    # The spanner of the scanning screen: the light pixels in the middle of the picture.
    picture = Image.open(src / "Wrench Progress Indicator.png").convert("RGB")
    w, h = picture.size
    centre = picture.crop((w // 2 - h // 4, h // 4, w // 2 + h // 4, 3 * h // 4))
    # The spanner is light grey; the ring around it is yellow (saturated) or dark.
    rgba = centre.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, _ = pixels[x, y]
            grey = max(r, g, b) - min(r, g, b) < 40
            bright = (r + g + b) / 3
            alpha = 0 if not grey else max(0, min(255, int((bright - 40) * 2.5)))
            pixels[x, y] = (r, g, b, alpha)
    box = rgba.getchannel("A").point(lambda a: 255 if a > 128 else 0).getbbox()
    spanner = rgba.crop(box)
    side = max(spanner.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(spanner, ((side - spanner.width) // 2, (side - spanner.height) // 2))
    sprites["spanner"] = canvas.resize((SPRITE_SIZE * 2, SPRITE_SIZE * 2), Image.Resampling.LANCZOS)

    small = OUT / "small"
    small.mkdir(exist_ok=True)
    for old in [*OUT.glob("*.png"), *small.glob("*.webp")]:
        old.unlink()
    for name, image in sorted(sprites.items()):
        image.save(OUT / f"{name}.png", optimize=True)
        # Small copies, to embed in SVG pictures (e.g. the animations of the README).
        size = 96 if image.width == SPRITE_SIZE else 64 if image.width == TILE_SIZE else 128
        image.resize((size, size), Image.Resampling.LANCZOS).save(small / f"{name}.webp", quality=82)
    manifest = {
        "note": "Cut by dev/sprites/import_sprites.py from the generated sprite sheets.",
        "sprite_size": SPRITE_SIZE,
        "tile_size": TILE_SIZE,
        "turtle_extent": round(turtle_extent, 4),
        "sprites": sorted(sprites),
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {len(sprites)} sprites to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
