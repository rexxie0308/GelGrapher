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
- **Edit on the figure**: click a lane name and type, Enter jumps to the next lane; drag across lane names for a group line; click cells to cycle `+` / `−`. A group label wider than its line wraps onto even lines (or shrinks, or stays on one line: Layout → Long group labels); Shift+Enter starts a new line by hand.
- **Lanes numbered by well**: cropping only chooses which wells are shown, so names and annotations survive any crop. Shift+click selects several lane lines on the raw image to move them together; two selected lines can have the lanes between them spread evenly.
- **Target-band arrows with sizes** estimated from the ladder(s); values outside the ladder are marked `≈`. Typing a size in the arrow window moves the arrow to where the markers place that size.
- **Several exposures at once**: the best one (least saturation, best signal-to-noise) is chosen.
- **Lane removal with splice marks**, empty-lane suggestions, rotation that carries every annotation.
- **Pre-flight check before export**: camera saturation, contrast clipping, effective resolution below 300 dpi, small fonts, extrapolated sizes.
- **Reproducible**: a library in the browser that keeps every gel you opened with its latest edits (reopen it as you left it), project files with the original image and every setting, style templates.

Added in GelGrapher:

- **Seven experiment types** with 85 built-in ladders (45 DNA, 5 RNA, 33 protein, 2 native protein), each checked against the manufacturer's datasheet (sources in [docs/ladder-sources.md](docs/ladder-sources.md)).
- **Densitometry**: signal and background regions fixed on the original pixels, signed sums with local background, flags for bands cut off or backgrounds holding band, optional normalization (reference band or total lane signal), fold change against a lane you choose, saturation and noise thresholds, lane profiles, CSV and a publication chart.
- **Band-size table**: every band in every lane sized against the ladder, as a table and CSV.
- **Strips**: show only chosen regions of a blot (e.g. the target and the loading control), stacked with a gap, each labelled on the right.
- **Western marker image**: load the white-light picture of the membrane to find a ladder that is invisible on the chemiluminescence image.
- **Vector PDF** export besides PNG, TIFF and SVG, and **Copy figure** for pasting into slides or a notebook.
- **Flip** a gel imaged with the wells at the bottom or mirrored; annotations follow and the change is recorded.
- **Several rows of wells** on one gel (two combs): each row gets its own crop, lanes and ladder; switch rows under *Lanes in figure*, with every row's names and annotations kept.
- **Claude artifact**: install it in Claude, export through Claude's save prompt, and draft the figure legend and methods text with Claude.
- **Worked examples** (synthetic DNA gel, Coomassie SDS-PAGE, Western blot), dark theme, a phone layout with one workspace at a time (Steps, Image, Figure, Analysis), touch and pen input with pinch zoom.

## Quick start

**On the web:** open **https://rexxie0308.github.io/GelGrapher/** in any browser. No account and no installation; the page is redeployed from this repository on every change. Images stay in your browser.

**In Claude:** open the [GelGrapher artifact](https://claude.ai/artifact/TaJkMEbS7d2Yf81LcVr2oj) (it is pinned in your claude.ai sidebar). The artifact is private to its owner until you share it from its *Share* menu; it adds "Draft legend and methods with Claude".

**As an app:** on the web version, *File ▾ → Install as an app* (Chrome, Edge) or the browser's own *Add to Dock* / *Add to Home Screen* (Safari). The installed app has its own window and icon, opens without an internet connection, and whenever it starts online it fetches the newest version in the background and offers "Reload". This is the easiest way for a lab to stay on one, current version.

**First time?** Nothing starts by itself. The start screen offers **Use my image**, **Practice with an example** (Prepare a figure or Measure bands, on an example of the experiment you chose) and a two-minute **Quick overview**. Lessons are short (two to seven cards), each card asks for one action and waits for it, and **Why?** gives the reason. *Measure bands* is five decisions: acquisition quality, the target band, the background in a strong and a weak lane, the output and any normalization, the flags before export; *Broad bands and background* shows why a broad band can read lower than narrow ones and how the background regions and the region height fix it. Lessons in the top bar lists them all, ticks the ones done and continues one left part-way; they run on an example (never saved) or, if you choose, on your own gel, with the lesson's changes undone at the end on request.

**Coming back to a gel:** every gel you open is kept in the browser's *Library* (top bar) with your latest edits, so the next visit shows your gels and one click reopens one exactly as you left it. The open gel is saved after every change. To move a gel to another computer or to archive it with a paper, save a project file (*Open / Save ▾ → Project…*).

**Offline, fixed version:** download the latest release, unzip it and open `index.html`. No installation and no internet connection needed; it never changes, which is what you want for the exact build cited in a paper.

Then:

1. Choose the **experiment type** and drop the image. Everything is detected automatically.
2. **Click the grey lane numbers** on the figure and type the names (Enter = next lane), or type them in the lane list of step 2 or paste a row from Excel there. A lane missing? *+ Add lane*, then click its place on the raw image.
3. **Check the ladder** in step 3; a poor fit is flagged.
4. Optional: group lines, arrows, +/− rows and strips (step 4), densitometry and band sizes (step 6).
5. **Export** (top right). The pre-flight check runs first.

On first visit the Western blot example is open, so you can see what a finished figure looks like. Drop your own image at any time to start.

## Western blots

- **Strips** (step 4, *Strip*): drag down across a region of the raw image, for example the p53 band with the 70 and 55 kDa marker ticks, then the GAPDH band. The figure shows only the strips, stacked with a white gap, each with its name on the right and its own kDa ticks on the left. The legend notes say that the panels are regions of the same image and that the uncropped image shows the rest; the uncropped export marks every strip.
- **Marker image** (step 3): if the prestained ladder does not show on the chemiluminescence image, load the white-light / colorimetric image the imager took in the same position. Ladder bands are read from it; the figure still shows the blot. It is stored in projects and drafts, and exported with the original data.
- **No marker image?** Mark the ladder lane as a marker and drag its yellow lines onto the bands you see on the membrane; the others re-fit around them.

## Densitometry

Densitometry is step 6 of the panel; its results open in the **analysis window** under the figure (Profile, Table, Plot, Band sizes). "Figure" and "Analysis" in the top bar show or hide the two windows of the right column.

1. Click **+ Add band**, then click the band on the image (the region fits itself to the band) or drag from just above it to just below. The band is measured in every lane of the analysis area, at the same height. Each lane gets a **signal region** and **background regions** above and below it (dashed on the image), fixed on the original pixels of the file.
2. Check the background in the **Profile**: the shaded rows are counted, the dashed rows are the background. A lane marked **? Needs review** has a reason under its profile: the band reaches the region's edge, the background regions hold part of the band or another band, two peaks, the value moves when the region is made taller. Make the region taller (the band's **Height**, or drag its edges on the image) or move the background further away (**Background → Edit…**). Never widen a region into the neighbouring lanes. As an expert alternative, as in chromatography software, **Edit baseline…** lets you draw a straight baseline on the profile (drag from the start of the peak to its end, or type the rows and levels) and **Apply** it: the lane is then integrated relative to that user-defined baseline, which assumes both ends lie on background. Its noise estimate excludes the uncertainty in where the line was drawn; a sensitivity check and the coverage checks still flag ends that hold band signal or a band that continues beyond the limits. **Use automatic background** removes the line and keeps the limits. **Copy integration limits…** copies one lane's start and end to other lanes (each keeps its own background); **Use endpoint baseline…** draws such lines in chosen lanes; both show the lanes and a preview of every value before applying, and one Undo takes them back. Lanes integrated this way are marked ✎ and named in the methods text and the log.
3. Choose what to report: **Output** is the background-corrected signal, a normalized signal, or a fold change against a reference lane you choose. **Normalize** is None, a **Reference band** (a loading control such as GAPDH: valid only if it is unchanged by the treatment and within its linear range) or the **Total lane signal** (total-protein normalization only on a total-protein stain or stain-free image; tick that it is one). Nothing is chosen for you.

The value of a region is the **signed sum of signal minus background** over every original pixel whose centre lies inside it (signal = pixel value for bright bands, 1 − pixel value for dark bands; the display contrast and inversion change nothing). A blank reads about zero, sometimes below; nothing is cut at zero. Rotating, flipping, correcting the perspective, changing the figure box, hiding or reordering lanes never moves a region; only an explicit edit does. Values below the estimated 10σ noise threshold are marked †, clipped pixels ⚠ (never used as a divisor or reference), and a value that cannot be given says why instead of showing zero. Values are signal units of this image, not optical density or amounts: compare lanes of one image only.

**Copy table** (with units, flags and the reference) goes into Excel or Prism; the CSV adds every lane's uncorrected sum, background, pixel counts, noise state, thresholds and the corners of its regions in original pixels, and gives each quantity (corrected, normalized, fold change) its own reason when it is not available, whichever output is shown. The results package also holds a densitometry specification (JSON) that, with the original image, recomputes every value. The chart exports as PNG, TIFF, SVG, PDF or PowerPoint in the figure's style, with its marks explained under it. The processing log and the methods paragraph describe the same calculation (Method details in step 6).

Projects measured with an earlier version keep their numbers and say so; **Update to the current method…** recalculates them on request (Undo brings the old values back).

One gel gives one value per lane. Biological replication depends on independently obtained samples; duplicate lanes or repeated imaging do not create independent biological replicates. Before relying on the numbers, image blank lanes and a dilution series on your own system (docs/benchmark.md).

*Band sizes* (a tab of the analysis window) lists every band in every lane with its estimated size (≈ = extrapolated beyond the ladder).

## Exports

| Export | Content |
|---|---|
| PNG | Rendered at 300 / 600 / 1200 dpi, with `pHYs`, `sRGB` and an embedded processing summary. |
| TIFF | 8-bit grayscale, LZW, with resolution tags and the processing summary. |
| PDF | Vector text and lines in the standard PDF fonts (Greek letters such as β via the Symbol font); the gel embedded pixel for pixel. |
| PPTX | One editable slide: labels as text boxes, lines and arrows as shapes, the gel as pictures that can be recropped on the slide. |
| Copy figure | The figure as a PNG on the clipboard, at the chosen dpi. |
| Print (printer button, Ctrl+P) | The figure with a caption (file, experiment, date) for a lab notebook; a PDF inside the Claude artifact. |
| Include legend notes | Export-menu option, off by default: the legend notes are written under the figure in exports and prints. |
| SVG | Vector text and lines; edit in Illustrator or Inkscape. |
| Uncropped image | Same rotation and contrast as the figure, with the crop box, strips, well numbers and removed lanes marked. |
| Original data | The untouched source file (and marker image), byte-identical, with its SHA-256 in the file name. |
| Processing log (JSON) | Source SHA-256, rotation, linear levels, clipping, effective resolution, removed lanes, strips, ladder fits, arrow sizes, densitometry. |
| Densitometry | CSV of all values; bar chart as PNG / SVG / PDF. |
| Band sizes | CSV. |

Inside Claude, each export asks you to confirm the save. Claude accepts PNG, PDF, SVG, CSV and JSON directly; TIFF files, projects and original data are delivered inside a `.zip`. GelGrapher opens these `.zip` files directly.

## Image integrity

A photographed gel is **geometry-corrected** automatically when it opens (step 1 → *Gel shape*, Auto / Manual / Off): a camera angle (converging lanes) by one projective transform found from the lane lines and the ladder bands, and bent lanes by a smooth displacement field that straightens the traced lanes and levels the ladder band rows, never using sample bands as anchors; lanes and markers are detected again on the corrected image until they settle. *Manual* is a box with four free corners dragged onto the gel's corners; *Off* shows the raw image. Rotation and geometry are composed into one resampling, the correction is carried through undo and project files, and it is stated in the legend notes, the processing log (with the displacement grid) and the methods paragraph. `docs/geometry-correction.md` has the design, the artefact rules and the literature.

GelGrapher follows common journal image policies (e.g. Nature, PLOS, JBC; Rossner & Yamada, *J Cell Biol* 2004):

- Only **linear, whole-image** adjustments. Gamma is locked at 1 unless unlocked, and is then reported.
- **Camera saturation** (re-image needed) is reported separately from **contrast clipping** (a display setting you can fix).
- Removed lanes get a visible **splice gap or line**, strips are separated by a gap, and suggested legend text is generated. Never splice lanes from different gels into one panel.
- Densitometry uses raw pixel values and flags saturated boxes.
- Every export carries a processing summary; the uncropped image and the original file can be exported for the supplement.

GelGrapher helps you comply, but **you remain responsible** for following your journal's policy.

## Built-in ladders

- **DNA**: Thermo GeneRuler 1 kb, 1 kb Plus, 100 bp, 100 bp Plus, 50 bp, DNA Ladder Mix, Low Range, Ultra Low Range, Express · NEB 1 kb, 1 kb Plus, 100 bp, 50 bp and Low Molecular Weight (each also as Quick-Load, Quick-Load Purple, TriDye or for Safe Stains where NEB sells it), Quick-Load 1 kb Extend, Fast, PCR Marker, TriDye Ultra Low Range, Supercoiled Extend, Lambda DNA-HindIII, pBR322-BstNI and pBR322-MspI digests · Invitrogen 1 Kb Plus · Bioline HyperLadder 1kb · Takara DL2000, DL5000, DL15000 · TransGen Trans2K, Trans2K Plus, Trans2K Plus II, Trans5K, Trans15K · Tiangen D2000.
- **RNA**: Thermo RiboRuler High Range, Low Range · NEB ssRNA Ladder, Low Range ssRNA Ladder, microRNA Marker.
- **Protein**: Thermo PageRuler Plus Prestained, PageRuler Prestained, PageRuler Unstained, PageRuler Unstained Broad Range, PageRuler Unstained Low Range, Spectra Multicolor Broad, High and Low Range · Bio-Rad Precision Plus Dual Color, All Blue, Kaleidoscope, Unstained, WesternC · NEB Color Prestained Broad Range (10-250 and 11-245 kDa), Blue Prestained Broad Range, Unstained Broad Range, Protein Ladder 10-250 kDa · Invitrogen Novex Sharp Pre-stained, SeeBlue Plus2 (Tris-glycine, Bis-Tris MES, Bis-Tris MOPS), MagicMark XP, BenchMark · Epizyme WJ101, WJ102, WJ103, WJ106, WJ107, WJ402 · Yeasen GoldBand 26616ES, 20350ES, 20352ES.
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

- Automatic detection was validated on DNA agarose gels (iBright imagers), on a photographed Coomassie SDS-PAGE (three ladders, torn corner, keystone) and on synthetic gels of every type. If detection fails on your images, use *+ Add lane*, *Re-detect in box* or *Space evenly*, and please [open an issue](https://github.com/rexxie0308/GelGrapher/issues/new/choose).
- Strips come from one image. Panels from different exposures or re-probed membranes are separate figures; stack them in your layout program.
- 2D gels, dot blots and capillary systems are not supported.
- Safari, and every browser on iPhone and iPad, cannot draw a PNG above about 16.7 million pixels (a double-column figure at 1200 dpi). The Layout step shows the export's pixel size and the pre-flight check offers the largest resolution that fits; TIFF, SVG and PDF are not affected.
- Bio-Rad `.scn` / `.1sc` and other proprietary formats must be exported to TIFF first. BigTIFF is not supported. Palette (indexed) TIFFs load: a grey colour map gives the grey values, a false-colour map that runs one way is read back as the saved intensity, any other map is converted by luminance. 1-, 2- and 4-bit TIFFs have 2 to 16 grey levels only. 16-bit PNGs are read as 8-bit by browsers.

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
