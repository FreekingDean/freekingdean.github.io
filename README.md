# freekingdean.github.io

A suite of small web pages, built for fun. Live at https://freekingdean.github.io

## Layout

- `index.html` + `style.css`: the landing page that links to every mini-site.
- `<name>/index.html`: one folder per mini-site, served at `/<name>/`.
- `games/`: a category page (`games/index.html`) with one folder per game, e.g. `games/tanglecube/`, `games/nibblecrate/`.

Plain static HTML/CSS/JS, no build step. Keep links relative (`hello/`, `../style.css`) so PR previews work.

## Adding a mini-site

1. Create a folder, e.g. `snake/`, with an `index.html`.
2. Add a card for it in `index.html` (or, for a game, put the folder in `games/` and add the card to `games/index.html`).
3. Open a PR. A preview link gets posted on the PR automatically.

## Deploys

`.github/workflows/deploy.yml` publishes to the `gh-pages` branch:

- Merging to `main` deploys the live site.
- Each PR gets a preview at `https://freekingdean.github.io/pr-preview/pr-<N>/`, removed when the PR closes.

One-time setting: **Settings → Pages → Build and deployment → Source: Deploy from a branch → `gh-pages` / `(root)`**.
