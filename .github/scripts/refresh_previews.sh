#!/usr/bin/env bash
# After a main deploy: rebase every open PR branch onto main, push it back to
# the branch, and rebuild its preview, so previews always show the PR on top
# of the latest live site.
#
# Usage: refresh_previews.sh <gh-pages dir>
# Run from a full-history checkout of main whose credentials can push to PR
# branches. Needs GH_TOKEN and GITHUB_REPOSITORY.
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
echo "| PR | Branch | Preview built from |" >> "$summary"
echo "|---|---|---|" >> "$summary"

gh pr list --repo "$repo" --state open --limit 100 \
  --json number,headRefName,isCrossRepository \
  -q '.[] | select(.isCrossRepository | not) | "\(.number) \(.headRefName)"' |
while read -r n ref; do
  git fetch -q origin "refs/heads/$ref"
  old=$(git rev-parse FETCH_HEAD)
  git checkout -q --detach "$old"

  if git merge-base --is-ancestor "$main_sha" HEAD; then
    update="already on latest main"
    built="PR (already on main)"
  elif git rebase -q "$main_sha" >/dev/null 2>&1; then
    built="PR rebased onto main"
    # Only overwrite the branch if nobody pushed to it since we fetched.
    if out=$(git push -q --force-with-lease="refs/heads/$ref:$old" origin "HEAD:refs/heads/$ref" 2>&1); then
      update="rebased onto main and pushed"
    else
      reason=$(grep -m1 -oE 'refusing to allow[^)]*|stale info|rejected[^(]*' <<<"$out" || true)
      update="rebased, but push refused: ${reason:-see log}"
      echo "$out"
    fi
  else
    git rebase --abort || true
    git checkout -q --detach "$old"
    update="not rebased: conflicts with main"
    built="PR branch as is"
  fi

  rm -rf "$pages/pr-preview/pr-$n"
  mkdir -p "$pages/pr-preview"
  python3 "$tmp/preview_banner.py" . "$pages/pr-preview/pr-$n" "$n" "$live"

  echo "PR #$n: $update; preview from $built"
  echo "| #$n | $update | $built |" >> "$summary"
done

git checkout -q --detach "$main_sha"
