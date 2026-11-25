#!/usr/bin/env python3
"""Copy the site into <out> and add a "back to the live site" banner to every page.

Usage: preview_banner.py <src dir> <out dir> <pr number> <live site url>
"""
import html
import re
import shutil
import sys
from pathlib import Path

src, out, pr, live = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4]

shutil.copytree(src, out, ignore=shutil.ignore_patterns(".git", ".github", out.name))

banner = (
    '<div id="pr-preview-banner" style="position:sticky;top:0;z-index:2147483647;'
    "display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;justify-content:center;"
    "padding:8px 16px;background:#1f1d1a;color:#fdf8f0;"
    'font:600 14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center">'
    f"<span>You're looking at a preview of PR #{html.escape(pr)}</span>"
    f'<a href="{html.escape(live)}" style="color:#ff7a50">← Back to the live site</a>'
    "</div>"
)

count = 0
for page in out.rglob("*.html"):
    text = page.read_text()
    new, n = re.subn(r"(<body\b[^>]*>)", lambda m: m.group(1) + "\n" + banner, text, count=1, flags=re.I)
    if n:
        page.write_text(new)
        count += 1
print(f"added preview banner to {count} page(s)")
