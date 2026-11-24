# freekingdean.github.io

A suite of small web pages, built for fun. Live at https://freekingdean.github.io

## Layout

- `index.html` + `style.css`: the landing page that links to every mini-site.
- `<name>/index.html`: one folder per mini-site, served at `/<name>/`.

Plain static HTML/CSS/JS, no build step. Keep links relative (`hello/`, `../style.css`) so PR previews work.

## Adding a mini-site

1. Create a folder, e.g. `snake/`, with an `index.html`.
2. Add a card for it in `index.html`.
3. Open a PR. A preview link gets posted on the PR automatically.

## Deploys

`.github/workflows/deploy.yml` publishes to the `gh-pages` branch:

- Merging to `main` deploys the live site.
- Each PR gets a preview at `https://freekingdean.github.io/pr-preview/pr-<N>/`, with a banner linking back to the live site.
- After every merge to `main`, each open PR branch is rebased onto `main` and force-pushed back (only if nobody pushed to it in the meantime), and every preview is rebuilt. A branch that conflicts with `main` is left alone and its preview is built from the branch as is. Pushing a rebase that picks up workflow changes from `main` needs a token with the `workflow` scope saved as the `PR_UPDATE_TOKEN` secret; without it that push is refused, but the preview is still rebuilt from the rebased code.
- After every deploy, `.github/scripts/sync_pages.py` rewrites the "In the works" list on the live homepage from the open PRs, and deletes the preview folder of any PR that is no longer open.

One-time setting: **Settings → Pages → Build and deployment → Source: Deploy from a branch → `gh-pages` / `(root)`**.
