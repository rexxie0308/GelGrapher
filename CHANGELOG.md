# Changelog

## Unreleased

### Fixed
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
