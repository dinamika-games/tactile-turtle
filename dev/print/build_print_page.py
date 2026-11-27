"""
Write the page that lists the printable PDFs, for the GitHub Pages site.

The page goes next to the PDFs: one row per language (the full kit and the
smaller kits for some worlds that are present) and the plates.

Usage::

    python dev/print/build_print_page.py site/print
"""

import argparse
import html
import json
import pathlib
import re
import sys
from typing import List, Optional, Sequence

REPO = pathlib.Path(__file__).resolve().parents[2]


def link(name: str, text: str) -> str:
    return f'<a href="{html.escape(name)}">{html.escape(text)}</a>'


def build(directory: pathlib.Path) -> str:
    names = sorted(path.name for path in directory.glob("*.pdf"))

    worlds: List[str] = sorted(
        {m.group(1) for n in names if (m := re.search(r"-world-([0-9-]+)\.pdf$", n))},
        key=lambda w: [int(part) for part in w.split("-")],
    )

    rows = []
    for path in sorted((REPO / "i18n").glob("*.json")):
        language = json.loads(path.read_text(encoding="utf-8"))["language"]
        code = language["code"]
        full = f"tactile-turtle-tiles-{code}.pdf"
        if full not in names:
            continue
        cells = [link(full, "full kit")]
        for world in worlds:
            name = f"tactile-turtle-tiles-{code}-world-{world}.pdf"
            cells.append(link(name, f"world{'s' if '-' in world else ''} {world}") if name in names else "")
        rows.append(
            f'<tr><th lang="{html.escape(code)}">{html.escape(language["name"])}</th>'
            + "".join(f"<td>{cell}</td>" for cell in cells)
            + "</tr>"
        )

    plates = [
        link(n, n.removeprefix("tactile-turtle-plate-").removesuffix(".pdf").upper())
        for n in names
        if n.startswith("tactile-turtle-plate-")
    ]

    header = "<tr><th>Language</th><th>All tiles</th>" + "".join(
        f"<th>World{'s' if '-' in w else ''} {html.escape(w)}</th>" for w in worlds
    ) + "</tr>"

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tactile Turtle: tiles to print</title>
<style>
  body {{ font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }}
  table {{ border-collapse: collapse; }}
  th, td {{ padding: 0.3rem 0.8rem; text-align: left; border-bottom: 1px solid #ccc; }}
</style>
</head>
<body>
<h1>Tactile Turtle: tiles to print</h1>
<p><a href="../">Play the game</a></p>
<p>Print at 100&nbsp;% (each sheet has a 50&nbsp;mm test bar), on printable magnetic paper
or sticky paper on a magnetic sheet, matte against glare. The tiles of different
languages can be mixed on one plate. The smaller kits hold the tiles the levels
of those worlds need, with spares.</p>
<h2>Tiles</h2>
<table>
{header}
{chr(10).join(rows)}
</table>
<h2>Plates</h2>
<p>{" · ".join(plates)}</p>
</body>
</html>
"""


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("directory", type=pathlib.Path, help="The directory with the PDFs")
    args = parser.parse_args(argv)
    (args.directory / "index.html").write_text(build(args.directory), encoding="utf-8")
    print(f"Wrote {args.directory / 'index.html'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
