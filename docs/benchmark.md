# Benchmarking the automatic analysis on your own gels

The synthetic benches (`node tools/lane-bench.mjs`, `node tools/marker-bench.mjs`, `node tools/quant-bench.mjs`) run on generated gels and cannot show how the analysis does on real photographs and scans: uneven lighting, torn corners, smiles, overloaded lanes, three ladders. `tools/real-bench.mjs` loads your own images in the app exactly as a user would and compares what it found with what you labelled.

The images never leave your machine: `bench/real/` is ignored by git.

## Setting it up

1. Put the images in `bench/real/` (PNG, JPEG, TIFF, WebP: anything the app opens).
2. Write `bench/real/labels.json`, one entry per image. Every label is optional; an entry with only `file` reports what was found without judging it.

```json
{
  "gels": [
    {
      "file": "sds_three_ladders.jpg",
      "type": "sds-page",
      "lanes": 13,
      "laneX": [629, 677, 726, 773, 822, 873, 918, 968, 1019, 1067, 1111, 1167, 1203],
      "laneY": 800,
      "ladders": [1, 7, 13],
      "keystonePct": 16.8,
      "keystoneRows": 815,
      "keystoneTol": 4,
      "note": "phone photograph, torn lower-right corner"
    },
    { "file": "northern_scan.tif", "type": "northern", "lanes": 8, "ladders": [1] }
  ]
}
```

| label | meaning |
| --- | --- |
| `type` | the experiment type as the type menu names it (`dna-agarose`, `sds-page`, `western`, …); the app's default when left out |
| `lanes` | how many wells the gel has (the lattice must find exactly this many) |
| `laneX`, `laneY` | the lane centres in pixels of the original image, measured along the row `laneY` (the middle of the image when left out); every centre must be found within 0.3 lane pitch |
| `ladders` | the wells that hold a ladder, counted from 1 on the left (the automatic markers must be exactly these) |
| `ladderId` | the id of the ladder product (`js/ladders.js`) every marker lane must be matched with, e.g. `nebp7719s` |
| `dilution` | `{ "wells": [2, 3, 4, 5], "amounts": [1, 2, 4, 8], "y": 640, "tol": 0.15 }`: a dilution series loaded in those wells with those relative amounts, its band at row `y` of the original image. The bench draws a band box there and fits the measured values against the amounts on log-log axes over the wells at or above their limit of quantification: a slope of 1 is linear. It reports the whole-box and the thresholded measure, and fails when the whole-box slope is more than `tol` (0.15) from 1. Run one on your imager before trusting relative values near the bottom of its range. |
| `keystonePct`, `keystoneRows`, `keystoneTol` | the perspective you measured (the Manual box's figure, or the lane spacing at the top over the bottom, minus 1, in %), with a tolerance in points (4 when left out). The figure is stated over the rows of a box, so give the height in pixels of the box you measured it over (`keystoneRows`); the bench scales it to the rows the app framed |

3. Run it:

```bash
node tools/real-bench.mjs                # bench/real/labels.json
node tools/real-bench.mjs other/labels.json
```

One line per gel: lanes found (and how many labelled centres were hit), the ladder wells, the keystone and bend applied, and the time the load took. The exit code is 1 when any gel differs from its labels, so the bench can guard a change the same way the synthetic ones do.

## Reading a miss

- **lanes**: open the image in the app and look at the blue lines. Too few: a faint lane next to a strong one, or a lane cut by the red box. Too many: a torn edge or a glare line taken for a lane. `node tools/lane-bench.mjs --raw gel.raw WxH` runs the engine alone on an 8-bit grey copy and prints the lattice's evidence per tooth.
- **ladders**: the markers panel shows the fit score per lane; a ladder scoring under 0.7 against every known ladder usually means the wrong ladder library (the experiment type) or a ladder the app does not know yet (CONTRIBUTING.md).
- **keystone**: the Manual box gives the figure the lanes imply; the automatic one is measured over different rows, so a few points of difference is normal.

## Building a labelled set

A labelled set of real gels is what the lane and ladder detection can be tuned against with confidence, and what a learned detector would need. Label what you can see without the app's help: the number of wells, the ladder wells, and the lane centres along one row (an image editor's cursor readout is enough). Twenty varied images (phone photographs and scanner images, bright and dark bands, a few with a torn corner or a smile) are more useful than a hundred alike.

## Densitometry on synthetic gels

`node tools/quant-bench.mjs` measures a two-fold dilution series of one band (eight lanes, peak 0.0025 to 0.32 of full scale) at three noise levels, with and without an uneven haze, for both measures and the three background methods. It reports the log-log slope over the lanes at or above their limit of quantification (1 = linear), the ratio of the two faintest lanes (2 = linear), how many lanes reach their LOQ, and how much the value moves when a box that contains the band is made wider (70 to 100 % of the lane spacing) or taller (up to 1.5 times). Results on 2026-11-01:

| measure, background | slope | faintest pair | wider box | taller box |
| --- | --- | --- | --- | --- |
| whole box, edge line | 0.98 | 1.8–2.0 | 1–5 % | 5–13 % |
| whole box, border median | 0.93–0.98 | 2.1–4.1 | 1–5 % | 0–15 % |
| whole box, rolling ball | 0.92–0.97 | 1.6–2.2 | 1–3 % | 1–9 % |
| thresholded, any background | 1.08–1.31 | lane 1 reads 0 | 1–10 % | 0–26 % |

The thresholded measure is not linear: it drops the faint part of every band, so a faint band reads disproportionately low and the faintest lanes read zero. That is why the whole box is the default. Taller boxes move the value most at high noise, where the edge rows that set the background are themselves noisy: draw boxes that hold the band with a little background above and below, and keep the same box height across a comparison (one box spans every lane, so lanes of one image are always measured alike).
