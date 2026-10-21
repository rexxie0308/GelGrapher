# Changelog

## Unreleased

### Added
- The Densitometry view switch no longer carries a count of band boxes.
- Hands-on tutorial: on the first visit the app opens on the empty workspace and a tutorial makes a figure with you, one real action at a time, in sixteen steps: open a practice gel, the three areas, band look (bright or dark), straightening, contrast, the figure area, checking and removing lanes, naming, the ladder, group line, target band, condition row, strips, densitometry with a loading control, export. Each step first says what an area is for, then spotlights the exact control (a button, the white-point slider, a lane number, the box handle on the raw image); button names appear as key caps in the text; the rest of the screen is dimmed while the control and the area where the result shows (the raw image, the figure) stay lit; the card says "Done" when the app shows the action was done, no text box, window or dialog is open, and a label that was asked for has been typed, and then waits for Next (nothing moves on by itself); any step can be skipped; the spotlight follows the panel when it scrolls; notices wait for the contrast step and are checked again before the export, and the practice gel is made so that the figure passes the pre-flight check. Replay it on any gel, your own included, with "Guide me" in the top bar or ? → "Hands-on tutorial".
- While a target band is being placed, a dashed line on the figure follows the mouse, snapped to the band under it, with the estimated size, so you see where the arrow will go before clicking.
- The text box for a strip label opens to the right of the gel and the one for a condition name to the left of it, and the target-band window opens beside the figure, so none of them covers the gel image.
- On the raw image, a named lane shows its name in a light pill above the well-number chip instead of "2 · name" in one chip.
- "Group lines break at splice gaps" (step 6, Layout). Off by default: a group line now runs on across a splice gap, since the gap itself shows that a lane was removed; tick it to break the line there as before.
- "All" / "none" links above the ladder's band list and "show all" / "hide the empty wells" above the lane list, so several boxes need not be ticked one by one.
- Overview tour: a two-minute spotlight tour of the screen, offered at the end of the tutorial and under ? → "Overview tour".

### Fixed
- A condition row no longer has a cell under the ladder lane.

### Changed
- The app no longer opens a worked example by itself: it starts on the empty workspace, or on your library when it has gels. The examples stay one click away on the start screen.

### Changed
- Densitometry results (chart, table, lane profile, band sizes) moved out of the settings panel into a **Densitometry** view beside "Figure" in the figure column; adding a band box opens it, "Show results" in step 7 and the view switch bring it back. Step 7 keeps only the controls, and the checkbox is now "Loading control" with an explanation of the normalization; the reference lane is labelled "= 1.00".

### Added
- Library: every gel you open is kept in the browser (IndexedDB) with its latest edits, a thumbnail and a name you can change; the next visit shows your gels and one click reopens one as you left it. The open gel is saved after every change; the gel can be removed from its card. Replaces the single autosaved draft (an existing draft is moved into the library).

### Changed
- The top-bar menu is "Open / Save" with grouped entries (Open: image, project file; Save to a file: project, style; This app: install, reset) instead of "File"; a "Library" button sits beside it.

## 1.1.0 (2026-10-21)

### Changed
- Dependencies: Playwright 1.64.1; GitHub Actions checkout v7, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5. The test runner falls back to a preinstalled Chromium when the bundled one is missing.
- One palette with Paper Radar: cool mist ground, slate ink, teal for anything you can act on, amber only for warnings, green only for "fine"; a light top bar; the same tokens in dark mode. The figure stays black on white and the overlay colours on the raw image are unchanged.
- The panel's first screen holds the daily steps (experiment, band look, lanes, names, marker): rotation, flips, contrast and gamma sit under "Straighten and contrast", which states what was set automatically, and the lane-fixing tools under "Lanes detected wrongly?". Hints are shorter.
- English-only interface: the Chinese translation layer (`js/i18n.js`, `L()` calls, `data-en` attributes) and the language button are removed.

### Added
- Resizable layout: drag the divider between the settings panel and the stage, or the one between the raw image and the figure (left/right, or top/bottom when they are stacked). Sizes are remembered; double-click a divider to reset it; arrow keys move a focused divider.
- Installable app: the web version registers a service worker (`sw.js`) that stores the app in the browser, so it opens offline; each deployment is stamped with its commit and the next online start offers "Reload" to switch to it. "Install as an app" in the File menu where the browser supports it; web app manifest and icons. Not part of the Claude artifact or of a locally opened file.
- Gels with several rows of wells (two combs): the rows are found, one row is shown at a time with its own crop, lanes and ladder, and a row switcher under "Lanes in figure" keeps the names and annotations of every row.
- Lane chips on the raw image thin out when many lanes are shown at a small zoom instead of piling up.
- Flip vertical / horizontal (Image section): for gels imaged with the wells at the bottom or mirrored. Every annotation follows, the processing log and legend notes record the orientation change.
- "Copy figure to clipboard" in the export menu: a PNG at the chosen dpi for slides and notebooks.
- Arrow labels on the same side of the gel no longer overlap: close ones are spread apart with a short leader line.

### Fixed
- The favourite-ladder list and the custom-ladder unit followed the experiment chosen at start-up, not the loaded gel's (DNA ladders listed on a Western).
- The marker's band list closed after every tick; it now stays open, at the same scroll position, so several bands can be shown or hidden in a row.
- Checkboxes placed directly in a field (saturated pixels, lane numbers, frame, auto width, gamma unlock) lost their layout.
- Lane chips on the raw image read "2 0 h" for a lane named "0 h"; now "2 · 0 h".
- The zoom percentage was empty until the first wheel zoom; the "Raw image" column title wrapped; the panel-letter box stretched across the panel.
- The synthetic examples are no longer autosaved as drafts, so a later visit opens the app instead of offering an "unfinished" example.
- Unreadable files say which file failed and which formats are supported.
- Discarding the autosaved draft could be undone by an autosave that was already due; the discard now cancels it.

## 1.0.0 (2026-10-19)

First GelGrapher release, built on GelFigure 0.5.0 (MIT).

### Added
- Experiment types: DNA agarose gel, DNA PAGE, Southern blot, RNA gel / Northern blot, protein SDS-PAGE, native / Blue native PAGE and Western blot. Each type has its own ladder library, size unit (bp, nt, kDa) and default band look.
- Ladder library: 18 protein ladders (Thermo PageRuler / Spectra, Bio-Rad Precision Plus, NEB, Invitrogen Novex Sharp, SeeBlue Plus2, MagicMark XP, BenchMark), 2 native markers, 5 RNA ladders and 4 more DNA ladders (50 in total) (NEB Low Molecular Weight, Invitrogen 1 Kb Plus, HyperLadder 1kb, Lambda/HindIII).
- Densitometry: band boxes, three background methods, normalization to a loading control and a reference lane, saturation flags, lane profile plot, CSV and publication bar chart (PNG / SVG / PDF).
- Band-size table for every lane, with CSV export.
- Strips: show only chosen regions of a blot, stacked with a gap and labelled (target + loading control), disclosed in the legend notes.
- Western marker image: a white-light / colorimetric image of the same membrane can be loaded to find the ladder bands; it travels with projects and drafts.
- Vector PDF export (standard fonts, Greek letters via the Symbol font, gel embedded losslessly).
- Claude artifact build (`npm run build`): exports go through the viewer's save prompt (TIFF and projects inside a .zip), and "Draft legend and methods with Claude" writes a legend and a methods paragraph from a text summary of the figure.
- Worked examples (synthetic DNA gel, Coomassie SDS-PAGE, Western blot); the Western example opens on first visit.
- Dark theme, phone layout, touch and pen input with pinch zoom, in-page dialogs.

### Changed
- Automatic crop no longer stops at a run of faint lanes, so protein gels with wash / flow-through lanes keep their marker and lysate lanes.
- Marker lanes are chosen by how well they fit a ladder, not only by how many bands they have, so lysate lanes are not mistaken for ladders.
