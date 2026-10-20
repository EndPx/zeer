# Zeer documentation site

Docusaurus documentation at `https://zeer.endpx.cloud/docs/`. Prep and Chef have
separate sidebars; Shielded & Memos is inside Chef. The existing public playground
keeps its Overview / Prep / Chef navigation.

## Run from the repository root

```sh
npm ci
npm run dev:docs
```

Open `http://127.0.0.1:3001/docs/`. Run `npm run prepare:content -w @zeer/docs`
after editing a canonical source outside the generated docs directory; restart
the dev server if navigation/configuration changes.

For a production preview:

```sh
npm run build:docs
npm run serve -w @zeer/docs
```

In another terminal, with real Chrome installed:

```sh
npm run check -w @zeer/docs
# Check the deployed site instead:
npm run check -w @zeer/docs -- https://zeer.endpx.cloud
```

The browser check visits all manifest pages, verifies local anchors, checks three
viewport sizes and axe WCAG rules, then exercises search, clipboard, mobile menu
and reduced-motion reflow. Evidence stays under ignored `.deploy-local/`.

## Content ownership

`pages.mjs` explicitly lists published sources. New teaching pages live in
`content/`; existing protocol, installation and scanner contracts remain in
`docs/` and `examples/`. `scripts/prepare.mjs` generates Docusaurus inputs into
`.generated/docs`, rewrites published source links to docs routes, and points
other repository links at their GitHub sources. It clears only the validated
generated directory so retired pages cannot remain published.

Edit original sources, not `.generated` files. Use the site's Edit this page
link to find the corresponding source. Keep examples aligned with real commands;
testnet, public-data, historical-fixture and local-private boundaries must remain
explicit. Only allowlisted pages enter search and generated LLM references.

The site includes local full-text page search, self-hosted fonts, real code-copy
controls, section navigation, metadata and a sitemap. Search queries stay in the
browser. There are no external search credentials or runtime data-source secrets.
The font copyright and OFL notices accompany the self-hosted font assets.
The generated references are `/docs/generated/llms.txt` and `llms-full.txt`.

## Static hosting

Publish only `apps/docs/build`, not the workspace, dependencies, environment,
scanner state or local evidence. The build uses two SSG worker threads. The
root build-tool overrides pin patched Tinypool and serialize-javascript versions;
use the lockfile and check audits rather than downgrading Docusaurus automatically.

The current npm audit still reports build-tool advisories through `braces`,
`postcss-selector-parser` and `uuid` (43 total, zero critical at verification).
The public deployment serves static output only; it does not expose the Node
development/preview server. This is not a zero-advisory dependency claim. Keep
build inputs trusted and revisit the upstream dependency chain when fixes land.

For a server whose `root` contains a `docs/` directory holding the build output:

```nginx
location = /docs { return 308 /docs/; }
location ^~ /docs/ {
    root /absolute/path/to/current;
    index index.html;
    try_files $uri $uri/ =404;
    error_page 404 /docs/404.html;
}
```

Use an immutable release directory, validate its HTML/assets, validate `nginx -t`,
then switch the docs release symlink and reload Nginx. Retain the previous release
and vhost configuration for rollback. The public website already links to `/docs`;
Prep, Chef and their databases do not need restarting for this static publication.
