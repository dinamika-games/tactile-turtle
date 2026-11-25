"""Find the separate sprites on a transparent sprite sheet (blobs of opaque pixels)."""

from __future__ import annotations

from typing import List, Tuple

from PIL import Image

Box = Tuple[int, int, int, int]  # left, top, right, bottom (exclusive)


def components(image: Image.Image, step: int = 4, alpha_threshold: int = 40, min_area: int = 400) -> List[Box]:
    """The bounding boxes of the opaque blobs, in reading order (rows, then left to right)."""
    alpha = image.getchannel("A")
    small = alpha.resize((image.width // step, image.height // step), Image.Resampling.BOX)
    w, h = small.size
    data = small.load()
    seen = [[False] * w for _ in range(h)]
    boxes: List[Box] = []
    for y in range(h):
        for x in range(w):
            if seen[y][x] or data[x, y] < alpha_threshold:
                continue
            stack = [(x, y)]
            seen[y][x] = True
            x0, y0, x1, y1, count = x, y, x, y, 0
            while stack:
                cx, cy = stack.pop()
                count += 1
                x0, y0, x1, y1 = min(x0, cx), min(y0, cy), max(x1, cx), max(y1, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and data[nx, ny] >= alpha_threshold:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            if count * step * step >= min_area:
                boxes.append((x0 * step, y0 * step, (x1 + 1) * step, (y1 + 1) * step))

    # Reading order: group into rows by the vertical centre, then sort by x.
    boxes.sort(key=lambda b: (b[1] + b[3]) / 2)
    rows: List[List[Box]] = []
    for box in boxes:
        centre = (box[1] + box[3]) / 2
        if rows and abs(centre - sum((b[1] + b[3]) / 2 for b in rows[-1]) / len(rows[-1])) < (box[3] - box[1]) * 0.5:
            rows[-1].append(box)
        else:
            rows.append([box])
    return [box for row in rows for box in sorted(row, key=lambda b: b[0])]
