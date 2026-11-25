#!/usr/bin/env python3
"""Sync the gh-pages checkout with the open PRs.

Usage: sync_pages.py <gh-pages dir> <open-prs.json>

open-prs.json is the output of:
  gh pr list --state open --json number,title,url,author,updatedAt,isDraft

  - Deletes pr-preview/pr-<N>/ for every PR that is no longer open.
  - Rewrites the list between the pr-list markers in the root index.html.
"""
import html
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

START = "<!-- pr-list:start"
END = "<!-- pr-list:end -->"


def prune(root, open_numbers):
    removed = []
    previews = root / "pr-preview"
    if not previews.is_dir():
        return removed
    for d in sorted(previews.iterdir()):
        m = re.fullmatch(r"pr-(\d+)", d.name)
        if d.is_dir() and m and int(m.group(1)) not in open_numbers:
            shutil.rmtree(d)
            removed.append(d.name)
    return removed


def fmt_date(iso):
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return d.strftime("%b %-d")
    except (ValueError, AttributeError):
        return ""


def render(root, prs, indent="        "):
    e = html.escape
    if not prs:
        return [indent + '<li class="pr-status">Nothing open right now. Everything\'s shipped!</li>']
    lines = []
    for pr in sorted(prs, key=lambda p: p.get("updatedAt", ""), reverse=True):
        n = pr["number"]
        has_preview = (root / "pr-preview" / f"pr-{n}" / "index.html").is_file()
        preview = f"pr-preview/pr-{n}/"
        author = (pr.get("author") or {}).get("login") or "someone"
        meta = [f"#{n}", author]
        if pr.get("updatedAt"):
            meta.append("updated " + fmt_date(pr["updatedAt"]))
        if pr.get("isDraft"):
            meta.append("draft")
        if not has_preview:
            meta.append("preview building")
        main_href = preview if has_preview else pr["url"]
        lines += [
            indent + '<li class="pr">',
            indent + f'  <a class="pr-main" href="{e(main_href)}">',
            indent + f'    <span class="pr-title">{e(pr["title"])}</span>',
            indent + f'    <span class="pr-meta">{e(" · ".join(meta))}</span>',
            indent + "  </a>",
            indent + '  <span class="pr-links">',
        ]
        if has_preview:
            lines.append(indent + f'    <a class="pr-btn pr-btn--primary" href="{e(preview)}">Preview</a>')
        lines += [
            indent + f'    <a class="pr-btn" href="{e(pr["url"])}">GitHub</a>',
            indent + "  </span>",
            indent + "</li>",
        ]
    return lines


def write_list(root, prs):
    index = root / "index.html"
    text = index.read_text()
    m = re.search(r"^([ \t]*)" + re.escape(START) + r".*?$\n(.*?)^[ \t]*" + re.escape(END),
                  text, re.S | re.M)
    if not m:
        print("index.html has no pr-list markers; skipping list")
        return False
    indent = m.group(1)
    body = "\n".join(render(root, prs, indent)) + "\n"
    new = text[: m.start(2)] + body + text[m.end(2) :]
    if new != text:
        index.write_text(new)
        return True
    return False


def main():
    root = Path(sys.argv[1])
    prs = json.loads(Path(sys.argv[2]).read_text())
    removed = prune(root, {p["number"] for p in prs})
    for name in removed:
        print(f"removed pr-preview/{name}")
    if write_list(root, prs):
        print(f"wrote {len(prs)} open PR(s) into index.html")


if __name__ == "__main__":
    main()
