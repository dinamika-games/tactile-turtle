"""Add the names of the 100 levels to i18n/<code>.json (keys level.1 ... level.100).

Usage: venv/bin/python dev/i18n/add_level_names.py <code> <file with 100 names, "|"-separated or one per line>
"""
import json
import sys

code, source = sys.argv[1], sys.argv[2]
text = open(source, encoding="utf-8").read().strip()
names = [name.strip() for name in (text.split("|") if "|" in text else text.splitlines())]
if len(names) != 100:
    raise SystemExit(f"{code}: {len(names)} names, expected 100")
path = f"i18n/{code}.json"
data = json.load(open(path, encoding="utf-8"))
for i, name in enumerate(names, 1):
    data["texts"][f"level.{i}"] = name
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"{code}: 100 level names")
