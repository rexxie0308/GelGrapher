# Contributing to GelGrapher

Issues and pull requests in English or Chinese are welcome. 中文或英文提交均可。

## Reporting a problem

Please use the [issue templates](https://github.com/rexxie0308/GelGrapher/issues/new/choose). The most useful reports include:

- the experiment type, browser and operating system, and where you used GelGrapher (Claude artifact, GitHub Pages, local `index.html`);
- the imager and file type (e.g. "ChemiDoc, 16-bit TIFF");
- what you expected and what happened; a screenshot helps a lot;
- the **processing log** (*Export ▾ → Processing log (JSON)*). It contains settings and statistics but no pixel data. Remove lane names first if they are confidential.

**Gel and blot images.** An image on which detection fails is the best possible bug report, but only attach one if you are allowed to share it publicly. Unpublished data, patient-derived material or anything under a confidentiality agreement should not be posted. A cropped or downscaled copy is often enough.

## Adding a ladder

Built-in ladders live in [`js/ladders.js`](js/ladders.js), one helper per kind (`D` DNA in bp, `R` RNA in nt, `P` protein in kDa, `N` native protein in kDa):

```js
P('biodual', 'Bio-Rad Precision Plus Dual Color (1610374)', [250, 150, 100, 75, 50, 37, 25, 20, 15, 10], [75, 25]),
```

- `id`: short and unique.
- `name`: `Vendor Product name (catalogue number)`; add the gel / buffer system when the apparent sizes depend on it.
- `sizes`: every **visible** band, largest to smallest, in the kind's unit.
- `ref`: the brighter or coloured reference bands, if the datasheet marks any.

In the pull request, link the manufacturer's datasheet the sizes come from. A wrong size produces a wrong figure, so ladders without a source cannot be merged.

## Development

There is no build step for the app. Edit the files and reload `index.html`.

- **Keep it dependency-free** and loadable from `file://`: plain `<script>` tags, no ES modules, no CDN, no network requests (the Content Security Policy in `index.html` blocks them anyway).
- **Every interface string is bilingual.** In JavaScript, write `L('中文', 'English')`; in HTML, put the English text in `data-en` (or `data-en-html`, `data-en-title`, `data-en-placeholder`). Text that goes into figures, legends, logs and exported files stays in English.
- **No `alert`, `confirm`, `prompt` or `window.print`**: they do nothing inside a Claude artifact. Use `G.UI.alert` / `G.UI.confirm` (in-page dialogs) and `G.Export.download` (goes through the host's save prompt when there is one).
- **Image-processing changes must stay honest:** only linear whole-image adjustments by default, densitometry on raw pixel values, nothing removed silently, and anything that changes how the data looks is recorded in the processing log and the legend notes.
- Match the existing style: small functions, comments that explain *why*.

### Tests

```bash
npm install
npm run check                   # scripts parse, index.html is consistent, artifact builds
npm test -- --browser=chromium  # engine + interaction self-tests
npx playwright install firefox webkit && npm test   # all three engines, as CI does
```

`test/test.html` checks the TIFF decoder, deskew, crop, lane and ladder detection and rendering on synthetic gels. `index.html?demo=1&uitest=1` drives the interface: editing, rotation, lane removal, templates, exports, projects, exposures, drafts, experiment types, strips, densitometry, PDF, ZIP, the Western marker image and the worked examples. Please add a check to `js/uitest.js` (and an assertion to `tests/run.mjs`) for new behaviour.

## Pull requests

1. Create a branch.
2. Make the change, with tests where it makes sense.
3. Run `npm run check` and `npm test -- --browser=chromium`.
4. Describe what changed and why; add a line to [CHANGELOG.md](CHANGELOG.md) under *Unreleased*.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
