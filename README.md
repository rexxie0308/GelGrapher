<div align="center">

# GelGrapher

**Publication-ready figures and densitometry for gels and blots: DNA and RNA gels, SDS-PAGE, native PAGE, and Western, Southern and Northern blots. Runs in the browser; images are never uploaded.**

[**Open in Claude**](https://claude.ai/artifact/TaJkMEbS7d2Yf81LcVr2oj) · [Web version](https://rexxie0308.github.io/GelGrapher/) · [Download for offline use](https://github.com/rexxie0308/GelGrapher/releases/latest)

[![CI](https://github.com/rexxie0308/GelGrapher/actions/workflows/ci.yml/badge.svg)](https://github.com/rexxie0308/GelGrapher/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

Drop the TIFF from your imager. GelGrapher straightens the gel, crops it, finds the lanes, identifies the ladder and labels its sizes in bp, nt or kDa. You type the lane names on the figure, add group lines, arrows or +/− rows, quantify bands if you need numbers, and export PNG, TIFF, PDF or SVG at journal resolution.

GelGrapher is built on [GelFigure](https://github.com/poplarity/GelFigure) by poplarity (MIT), which does the DNA agarose gel part. GelGrapher adds protein and RNA gels, blots, densitometry, vector PDF and a Claude artifact build.

## Contents

- [Experiment types](#experiment-types)
- [Features](#features)
- [Quick start](#quick-start)
- [Western blots](#western-blots)
- [Densitometry](#densitometry)
- [Exports](#exports)
- [Image integrity](#image-integrity)
- [Built-in ladders](#built-in-ladders)
- [Privacy](#privacy)
- [Supported input](#supported-input)
- [Known limitations](#known-limitations)
- [Development](#development)
- [Credits, citing and license](#credits-citing-and-license)

## Experiment types

Pick the type before or after loading the image (section 1, *Experiment*). The type decides which ladders are matched, the size unit, the default band look and the wording of the legend notes. The analysis itself is shared: nucleic-acid gels and SDS-PAGE both migrate close to linearly in log(size), and the fit allows curvature for gradient gels.

| Type | Unit | Default ladder | Default look |
|---|---|---|---|
| DNA agarose gel | bp (bp / kb / auto) | GeneRuler 1 kb Plus | as imaged |
| DNA PAGE (native) | bp | GeneRuler Low Range | as imaged |
| Southern blot | kb | GeneRuler 1 kb | dark bands on light |
| RNA gel / Northern blot | nt (nt / kb) | RiboRuler High Range | as imaged |
| Protein SDS-PAGE (Coomassie, silver, stain-free) | kDa | PageRuler Plus Prestained | dark bands on light |
| Native / Blue native PAGE | kDa | NativeMark | dark bands on light |
| Western blot (chemiluminescence, fluorescence) | kDa | PageRuler Plus Prestained | dark bands on light |

The ladder, unit and band look you choose are remembered per experiment type.

## Features

From GelFigure:

- **Automatic first draft**: straightening (±15°), crop, lane detection, ladder identification and size labels, linear contrast.
- **Edit on the figure**: click a lane name and type, Enter jumps to the next lane; drag across lane names for a group line; click cells to cycle `+` / `−`.
- **Lanes numbered by well**: cropping only chooses which wells are shown, so names and annotations survive any crop.
- **Target-band arrows with sizes** estimated from the ladder(s); values outside the ladder are marked `≈`.
- **Several exposures at once**: the best one (least saturation, best signal-to-noise) is chosen.
- **Lane removal with splice marks**, empty-lane suggestions, rotation that carries every annotation.
- **Pre-flight check before export**: camera saturation, contrast clipping, effective resolution below 300 dpi, small fonts, extrapolated sizes.
- **Reproducible**: a library in the browser that keeps every gel you opened with its latest edits (reopen it as you left it), project files with the original image and every setting, style templates.

Added in GelGrapher:

- **Seven experiment types** with 50 built-in ladders (25 DNA, 5 RNA, 18 protein, 2 native protein).
- **Densitometry**: band boxes, three background methods, normalization to a loading control, relative values, saturation flags, lane profiles, CSV and a publication bar chart.
- **Band-size table**: every band in every lane sized against the ladder, as a table and CSV.
- **Strips**: show only chosen regions of a blot (e.g. the target and the loading control), stacked with a gap, each labelled on the right.
- **Western marker image**: load the white-light picture of the membrane to find a ladder that is invisible on the chemiluminescence image.
- **Vector PDF** export besides PNG, TIFF and SVG, and **Copy figure** for pasting into slides or a notebook.
- **Flip** a gel imaged with the wells at the bottom or mirrored; annotations follow and the change is recorded.
- **Several rows of wells** on one gel (two combs): each row gets its own crop, lanes and ladder; switch rows under *Lanes in figure*, with every row's names and annotations kept.
- **Claude artifact**: install it in Claude, export through Claude's save prompt, and draft the figure legend and methods text with Claude.
- **Worked examples** (synthetic DNA gel, Coomassie SDS-PAGE, Western blot), dark theme, phone layout, touch and pen input with pinch zoom.

## Quick start

**On the web:** open **https://rexxie0308.github.io/GelGrapher/** in any browser. No account and no installation; the page is redeployed from this repository on every change. Images stay in your browser.

**In Claude:** open the [GelGrapher artifact](https://claude.ai/artifact/TaJkMEbS7d2Yf81LcVr2oj) (it is pinned in your claude.ai sidebar). The artifact is private to its owner until you share it from its *Share* menu; it adds "Draft legend and methods with Claude".

**As an app:** on the web version, *File ▾ → Install as an app* (Chrome, Edge) or the browser's own *Add to Dock* / *Add to Home Screen* (Safari). The installed app has its own window and icon, opens without an internet connection, and whenever it starts online it fetches the newest version in the background and offers "Reload". This is the easiest way for a lab to stay on one, current version.

**Coming back to a gel:** every gel you open is kept in the browser's *Library* (top bar) with your latest edits, so the next visit shows your gels and one click reopens one exactly as you left it. The open gel is saved after every change. To move a gel to another computer or to archive it with a paper, save a project file (*Open / Save ▾ → Project…*).

**Offline, fixed version:** download the latest release, unzip it and open `index.html`. No installation and no internet connection needed; it never changes, which is what you want for the exact build cited in a paper.

Then:

1. Choose the **experiment type** and drop the image. Everything is detected automatically.
2. **Click the grey lane numbers** on the figure and type the names (Enter = next lane), or paste a row from Excel on the left.
3. **Check the ladder** in section 4; a poor fit is flagged.
4. Optional: group lines, arrows, +/− rows and strips (section 5), densitometry and band sizes (section 7).
5. **Export** (top right). The pre-flight check runs first.

On first visit the Western blot example is open, so you can see what a finished figure looks like. Drop your own image at any time to start.

## Western blots

- **Strips** (section 5, *Strip*): drag down across a region of the raw image, for example the p53 band with the 70 and 55 kDa marker ticks, then the GAPDH band. The figure shows only the strips, stacked with a white gap, each with its name on the right and its own kDa ticks on the left. The legend notes say that the panels are regions of the same image and that the uncropped image shows the rest; the uncropped export marks every strip.
- **Marker image** (section 4): if the prestained ladder does not show on the chemiluminescence image, load the white-light / colorimetric image the imager took in the same position. Ladder bands are read from it; the figure still shows the blot. It is stored in projects and drafts, and exported with the original data.
- **No marker image?** Mark the ladder lane as a marker and drag its yellow lines onto the bands you see on the membrane; the others re-fit around them.

## Densitometry

Section 7 of the panel holds the controls; the results (chart, table, lane profile, band sizes) open in the **Densitometry** view beside "Figure" in the figure area as soon as the first box is added.

1. Click **+ Band box**, then click a band on the raw image (the box fits itself to the band) or drag across it. Add one box per protein or product. Tick **Loading control** on the box of the housekeeping protein (GAPDH, actin, tubulin): the other bands in each lane are divided by it, which corrects for unequal loading.
2. Choose the **background**: a straight line between the box edges (the usual "close the peak" method of ImageJ's gel analyser), a rolling-ball baseline of the lane profile, or none.
3. Set the **box width** (fraction of the lane spacing) and the **reference lane**, whose value is defined as 1.00; every other lane is given relative to it.

For every lane in the figure (ladder lanes excluded) GelGrapher integrates the signal in the box on the **raw pixel values** (after rotation only; the display contrast has no effect) and subtracts the background. Dark-band images (Coomassie, silver, film) are inverted first so more protein always means more signal. The table shows integrated density (arbitrary units), target / loading control, and the value relative to the reference lane. Boxes containing saturated pixels are flagged, because their values are underestimated.

Export the table as CSV or copy it into Excel or Prism; export the bar chart as PNG, SVG or PDF in the same style as the figure. The processing log records the method, boxes and every value, and the legend notes include a sentence describing the quantification.

Densitometry values are only comparable within one image. For statistics, quantify replicate blots and combine the CSVs.

*Band sizes* (a tab of the Densitometry view) lists every band in every lane with its estimated size (≈ = extrapolated beyond the ladder).

## Exports

| Export | Content |
|---|---|
| PNG | Rendered at 300 / 600 / 1200 dpi, with `pHYs`, `sRGB` and an embedded processing summary. |
| TIFF | 8-bit grayscale, LZW, with resolution tags and the processing summary. |
| PDF | Vector text and lines in the standard PDF fonts (Greek letters such as β via the Symbol font); the gel embedded pixel for pixel. |
| Copy figure | The figure as a PNG on the clipboard, at the chosen dpi. |
| SVG | Vector text and lines; edit in Illustrator or Inkscape. |
| Uncropped image | Same rotation and contrast as the figure, with the crop box, strips, well numbers and removed lanes marked. |
| Original data | The untouched source file (and marker image), byte-identical, with its SHA-256 in the file name. |
| Processing log (JSON) | Source SHA-256, rotation, linear levels, clipping, effective resolution, removed lanes, strips, ladder fits, arrow sizes, densitometry. |
| Densitometry | CSV of all values; bar chart as PNG / SVG / PDF. |
| Band sizes | CSV. |

Inside Claude, each export asks you to confirm the save. Claude accepts PNG, PDF, SVG, CSV and JSON directly; TIFF files, projects and original data are delivered inside a `.zip`. GelGrapher opens these `.zip` files directly.

## Image integrity

GelGrapher follows common journal image policies (e.g. Nature, PLOS, JBC; Rossner & Yamada, *J Cell Biol* 2004):

- Only **linear, whole-image** adjustments. Gamma is locked at 1 unless unlocked, and is then reported.
- **Camera saturation** (re-image needed) is reported separately from **contrast clipping** (a display setting you can fix).
- Removed lanes get a visible **splice gap or line**, strips are separated by a gap, and suggested legend text is generated. Never splice lanes from different gels into one panel.
- Densitometry uses raw pixel values and flags saturated boxes.
- Every export carries a processing summary; the uncropped image and the original file can be exported for the supplement.

GelGrapher helps you comply, but **you remain responsible** for following your journal's policy.

## Built-in ladders

- **DNA**: Thermo GeneRuler 1 kb, 1 kb Plus, 100 bp, 100 bp Plus, 50 bp, DNA Ladder Mix, Low Range, Ultra Low Range, Express · NEB 1 kb, 100 bp, 1 kb Plus, Low Molecular Weight · Invitrogen 1 Kb Plus · Bioline HyperLadder 1kb · Lambda DNA/HindIII · Takara DL2000, DL5000, DL15000 · TransGen Trans2K, Trans2K Plus, Trans2K Plus II, Trans5K, Trans15K · Tiangen Marker D2000.
- **RNA**: Thermo RiboRuler High Range, Low Range · NEB ssRNA Ladder, Low Range ssRNA Ladder, microRNA Marker.
- **Protein**: Thermo PageRuler Plus Prestained, PageRuler Prestained, PageRuler Unstained, PageRuler Unstained Broad Range, Spectra Multicolor Broad Range · Bio-Rad Precision Plus Dual Color, All Blue, Kaleidoscope, Unstained, WesternC · NEB Color Prestained Broad Range, Unstained Broad Range · Invitrogen Novex Sharp Pre-stained, SeeBlue Plus2 (Tris-glycine, Bis-Tris MES, Bis-Tris MOPS), MagicMark XP, BenchMark.
- **Native protein**: Invitrogen NativeMark · Cytiva HMW Native Marker Kit.

Apparent sizes of prestained protein ladders depend on the gel and buffer system; check them against your lot's datasheet. Any other ladder can be added under **Marker → Custom ladder** (in the unit of the current experiment type); custom ladders travel inside style and project files. To add a ladder for everyone, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy

GelGrapher is a static page with no backend. Images are decoded and processed by JavaScript in your browser.

- The web and offline versions carry a Content Security Policy that **forbids the page from connecting to any server**; the test suite checks this.
- In the Claude artifact, files are saved only through Claude's own save prompt. **Draft legend and methods with Claude** sends a text summary (experiment type, lane names, ladder, sizes, settings, densitometry numbers) to Claude on your own account, only when you click it and after you allow it. The image is never sent.
- Preferences and custom ladders stay in your browser's local storage; the library (the gels you opened, with their edits) is in the browser's IndexedDB. Neither leaves the computer; remove a gel from the library with the × on its card.

## Supported input

| Format | Notes |
|---|---|
| TIFF (8 / 16 / 32-bit grayscale) | Recommended. Uncompressed, LZW, Deflate and PackBits; little- and big-endian. |
| PNG / JPG / BMP | Read as 8-bit by the browser; a warning suggests the raw 16-bit TIFF. |
| `.gelfig` | GelGrapher / GelFigure project file. |
| `.zip` | A ZIP containing images or a project (as saved from the Claude artifact). |

Both bright-on-dark and dark-on-light images are handled; polarity is detected automatically.

## Known limitations

- Automatic detection was validated on DNA agarose gels (iBright imagers) and on synthetic gels of every type. If detection fails on your images, use *Re-detect in box* or *Space evenly*, and please [open an issue](https://github.com/rexxie0308/GelGrapher/issues/new/choose).
- Strips come from one image. Panels from different exposures or re-probed membranes are separate figures; stack them in your layout program.
- 2D gels, dot blots and capillary systems are not supported.
- Bio-Rad `.scn` / `.1sc` and other proprietary formats must be exported to TIFF first. BigTIFF and palette TIFFs are not supported. 16-bit PNGs are read as 8-bit by browsers.

## Development

No build step and no dependencies for the app: plain HTML, CSS and JavaScript loaded with ordinary `<script>` tags, so it also runs from `file://`.

```
index.html          the page
css/style.css       styles (colour tokens, dark theme, phone layout)
js/tiff.js          TIFF decoder                 js/engine.js     image analysis (deskew, crop, lanes, ladder fit)
js/ladders.js       ladder library               js/gels.js       experiment types
js/render.js        figure layout (SVG, strips)  js/quant.js      densitometry, band sizes, bar chart
js/zip.js           ZIP writer / reader          js/pdf.js        vector PDF writer
js/host.js          Claude artifact bridge       js/export.js     PNG / TIFF / SVG / PDF / logs
js/demo.js          synthetic example gels       js/app.js        state, pipeline, undo, projects
js/editor.js        raw-image canvas             js/ui.js         side panel and top bar
js/figedit.js       editing on the figure        js/quantui.js    Quantify section
js/claude.js        legend drafting with Claude  js/uitest.js     interaction self-test
test/test.html      engine self-test             tests/run.mjs    runs both self-tests in Playwright
tools/check.mjs     fast checks                  tools/build-artifact.mjs  single-file Claude artifact
```

```bash
npm install                     # installs Playwright (the only dev dependency)
npm run check                   # every script parses, index.html is consistent, the artifact builds
npm test -- --browser=chromium  # engine + interface self-tests (CI also runs firefox and webkit)
npm run build                   # dist/gelgrapher-artifact.html
```

**Claude artifact.** `npm run build` writes `dist/gelgrapher-artifact.html`: the page with the stylesheet and all scripts inlined and the offline CSP left out (the artifact host sets its own). It is published at https://claude.ai/artifact/TaJkMEbS7d2Yf81LcVr2oj with the `downloads` and `sample` capabilities. To update it, ask Claude Code to rebuild and republish that URL; see [CLAUDE.md](CLAUDE.md).

**GitHub Pages.** `.github/workflows/pages.yml` deploys the app to https://rexxie0308.github.io/GelGrapher/ on every push to `main` (Pages is set to *Source: GitHub Actions*; a fork needs that switch once under *Settings → Pages*).

**Releases.** Push a tag such as `v1.1.0`, or run the *Release* workflow from the Actions tab with the version number (it creates the tag); `.github/workflows/release.yml` attaches an offline ZIP and the single-file build.

**Claude Code.** `CLAUDE.md` describes the code base and conventions, and `.claude/hooks/session-start.sh` installs the test runner in Claude Code cloud sessions.

## Credits, citing and license

GelGrapher is based on [GelFigure](https://github.com/poplarity/GelFigure) © poplarity and GelFigure contributors, used under the MIT License. If GelGrapher helped with a publication, please cite it ([CITATION.cff](CITATION.cff)) and GelFigure.

[MIT](LICENSE)
