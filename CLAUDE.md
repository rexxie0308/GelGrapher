# GelGrapher: notes for Claude Code

Browser app that turns raw gel / blot images (DNA, RNA, SDS-PAGE, native PAGE, Western, Southern, Northern) into publication figures, with densitometry. Based on GelFigure 0.5.0 by poplarity (MIT); keep that attribution in LICENSE, README, the help dialog and the processing log.

## Commands

```bash
npm install                     # Playwright only (the SessionStart hook does this in cloud sessions)
npm run check                   # fast: every js/*.js parses, index.html loads each script once, artifact builds
npm test -- --browser=chromium  # engine self-test (test/test.html) + interface self-test (js/uitest.js), ~60 s
npm run build                   # dist/gelgrapher-artifact.html (single file for the Claude artifact)
```

Run `npm run check` and the Chromium tests before every push. CI (`.github/workflows/ci.yml`) also runs Firefox and WebKit. In cloud sessions do not run `playwright install`; Chromium is preinstalled under `$PLAYWRIGHT_BROWSERS_PATH`.

## Architecture

Plain scripts on `window` (no modules, no bundler, no dependencies), loaded in this order by `index.html`:
`tiff → ladders → gels → engine → render → quant → zip → pdf → host → export → demo → app → editor → ui → figedit → quantui → claude`.

- `app.js` owns the state `App.S` (JSON-serialisable; undo history is snapshots of it). Coordinates of lanes, bands, arrows, strips and band boxes are in rotated-image pixels, so cropping never moves annotations. `App.src0` is the image as decoded and `App.src` is it flipped as `S.flip` says (`App.applyFlip`, called from `ensureRot`, so undo / redo / project loads re-derive it); `App.flip(axis)` mirrors every annotation in the rotated frame and negates the rotation. New state fields need a default in `startFrom` and in `normalize()` (old projects / GelFigure files lack them), must be carried in `setRotation` and mirrored in `App.flip`, and lane indices must be remapped in `replaceLanes` / `removeLane` / `reorderLanes` / `fixIndices`.
- A gel with several rows of wells keeps `S.gelRows` (y ranges), `S.gelRow` (the row shown) and `S.rowStash` (the other rows' `ROW_KEYS` state); `App.setGelRow` swaps them. `setRotation` and `App.flip` carry the stash too; `E.autoCrop(img, bright, band)` restricts the crop to one row.
- `gels.js` defines experiment types (`kind` = dna | rna | protein | native picks the ladder library and unit). `App.kind()`, `App.baseUnit()`, `App.fmtSize()` / `App.fmtExact()` format sizes; never hard-code "bp".
- `engine.js` is pure image analysis (deskew, autoCrop, lane lattice, ladder fit in log(size)). Changes there affect every gel type: check the synthetic gels (`G.Demo.makeGel({preset: 'dna' | 'sds' | 'western'})`) and run the full tests.
- `render.js` builds the figure SVG in points (`composeGel` handles removed lanes and stacked strips; `mapY` maps crop rows to figure rows or null outside strips).
- `quant.js` is densitometry on raw pixels (never the display levels) and the band-size table; `quantui.js` is its panel.
- `host.js` is the only place that touches `window.claude` (Claude artifact runtime). Everything must work without it.

## Conventions

- The interface, figures, legends, logs and exported files are English only; there is no translation layer.
- No `alert` / `confirm` / `prompt` / `window.print` (inert in the artifact; `tools/build-artifact.mjs` fails the build on them). Use `G.UI.alert`, `G.UI.confirm` (async, in-page) and `G.Export.download` (resolves 'saved' | 'declined' | 'failed').
- Image integrity: linear whole-image adjustments only by default; anything that changes how data looks or what is shown (inversion, gamma, removed lanes, strips, marker image, densitometry method) is reported in `G.Export.legendHints` and the processing log.
- Colours in CSS are tokens on `:root` with dark values under `prefers-color-scheme` and `[data-theme]`; the figure itself is always black on white.
- Ladder additions need a manufacturer datasheet (see CONTRIBUTING.md).
- New behaviour gets a check in `js/uitest.js` (sections 20+) and an assertion in `tests/run.mjs`.

## Claude artifact

The app is published as a Claude artifact at https://claude.ai/artifact/TaJkMEbS7d2Yf81LcVr2oj (pinned in the owner's sidebar) with capabilities `{"downloads": true, "sample": {}}`.

To update it after changing the app: `npm run build`, then publish `dist/gelgrapher-artifact.html` to that URL with the Artifact tool (pass the URL as `url` from a new conversation; omit `capabilities` to keep them, omit `icon`). Things that differ inside the artifact viewer:

- downloads go through `claude.use('downloads').save()`, which only accepts png, jpg, gif, webp, svg, pdf, csv, json, txt, md, html, xlsx, docx, pptx, zip; `G.Export.download` wraps anything else (TIFF, `.gelfig`, original data) in a ZIP, and the app opens such ZIPs;
- `sample` powers "Draft legend and methods with Claude" (`js/claude.js`); it sends only a text summary, never the image;
- no query string reaches the page, so the `?demo=1` / `?uitest=1` test hooks only work on a normal server.
