#!/usr/bin/env bash
# After a main deploy: bring every open PR up to date with main and rebuild
# its preview, so previews always show the PR on top of the latest live site.
#
# Usage: refresh_previews.sh <gh-pages dir>
# Run from a full-history checkout of main. Needs GH_TOKEN and GITHUB_REPOSITORY.
set -euo pipefail

pages=$(realpath "$1")
live="https://freekingdean.github.io/"
repo="$GITHUB_REPOSITORY"
tmp=$(mktemp -d)
summary=${GITHUB_STEP_SUMMARY:-/dev/stdout}

# Use main's version of the banner script, whatever each PR has.
cp .github/scripts/preview_banner.py "$tmp/preview_banner.py"
main_sha=$(git rev-parse HEAD)

echo "### PR previews refreshed against main" >> "$summary"
echo "| PR | Branch update | Preview built from |" >> "$summary"
echo "|---|---|---|" >> "$summary"

gh pr list --repo "$repo" --state open --limit 100 \
  --json number,isCrossRepository \
  -q '.[] | select(.isCrossRepository | not) | .number' |
while read -r n; do
  # 1. Merge main into the PR branch on GitHub (no rebase, no force-push).
  if out=$(gh api -X PUT "repos/$repo/pulls/$n/update-branch" 2>&1); then
    update="merged main in"
  elif grep -qi "no new commits" <<<"$out"; then
    update="already up to date"
  else
    update="skipped: $(grep -o '"message":"[^"]*"' <<<"$out" | head -1 | cut -d'"' -f4)"
    update=${update:-skipped}
  fi

  # 2. Build the preview from the PR merged with the latest main.
  git fetch -q origin "pull/$n/head"
  git checkout -q --detach "$main_sha"
  if git merge -q --no-edit FETCH_HEAD >/dev/null 2>&1; then
    built="PR + latest main"
  else
    git merge --abort || true
    git checkout -q --detach FETCH_HEAD
    built="PR branch only (conflicts with main)"
  fi

  rm -rf "$pages/pr-preview/pr-$n"
  mkdir -p "$pages/pr-preview"
  python3 "$tmp/preview_banner.py" . "$pages/pr-preview/pr-$n" "$n" "$live"

  echo "PR #$n: $update; preview from $built"
  echo "| #$n | $update | $built |" >> "$summary"
done

git checkout -q --detach "$main_sha"
