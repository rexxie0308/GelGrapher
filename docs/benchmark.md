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

`node tools/quant-bench.mjs` measures a two-fold dilution series of one band (eight lanes, peak 0.0025 to 0.32 of full scale) at three noise levels, with and without an uneven haze, for the whole-region measure with local, end-row (edge) and rolling backgrounds and for the thresholded measure. It reports the log-log slope over the lanes at or above their 10σ noise threshold (1 = linear), the ratio of the two faintest lanes (2 = linear), how many lanes reach 10σ, how much the value moves when a region that holds the band is made wider (70 to 100 % of the lane spacing) or taller (up to 1.5 times), the mid-series value's own 3σ, the blank lane's mean, and the broad-band blot of the background lesson. The default (whole region, local background above and below) has pass / fail limits and the bench exits with 1 when one fails. Results on 2026-10-29 (calculation version 2):

| measure, background | slope | faintest pair | wider region | taller region |
| --- | --- | --- | --- | --- |
| whole region, local regions (default) | 0.95–1.00 | 2.1–2.7 | 0.5–1.6 % | 1.0–3.4 % (its 3σ: 2–11 %) |
| whole region, line between region ends | 0.99–1.00 | 2.0–2.3 | 1–4 % | 5–13 % |
| whole region, rolling baseline | 0.94–0.99 | 1.6–2.2 | 1–4 % | 1–9 % |
| thresholded (exploratory), local | 1.10–1.27 | lane 1 reads 0 | 0–4 % | 1–6 % |

Blank lanes, whole region and local background: mean −0.09, sd 0.26 over the six images (signed: about half below zero, as a blank should be).

**The broad band.** The broad-band example (`G.Demo.makeGel({ preset: 'broad' })`) has, in lane 4, a band three times as tall as the others that holds 2.89 × lane 2's protein at the same peak height. Lane 4 / lane 2:

| region and background | lane 4 / lane 2 | flagged |
| --- | --- | --- |
| region fitted to a narrow band, background from its end rows (the default before version 2) | 0.74 × (the lowest lane) | yes (version 2); no flag before |
| the same region, local background regions | 1.67 × | yes: the band reaches the region's edges, the background regions rise towards it |
| local background regions, a region as tall as the band (57 px) | 2.68 × (the highest lane) | no |

The few per cent still missing are the band's faint tails beyond the region and in the background regions; a taller region reaches the band above (61 px away) and is flagged for it.

**Before and after (2026-10-29, the same synthetic images, the previous release against version 2).**

- Five lanes, regions fitted to a narrow band: a broad band holding 5.4 × the narrow band's protein read 1.2 × with the earlier end-row background (lower than a band with 37 % of its protein), unflagged. Version 2: 3.2 × with the same short region, flagged (the region holds 76 % of the band); 5.4 × (all five lanes equal to their true sums to 0.01 %) once the regions hold the bands.
- Blank lanes: +0.60 on average, none below zero (rows cut at zero), before; −0.08, 16 of 30 below zero, after.
- A 3° rotation of the Western example: one lane's value went from 172 to 10 before (the box moved with the working frame); identical to the last digit after, through rotation, flips and back.

What these show: the arithmetic, the background model and the bookkeeping do what they say on images whose truth is known. They are not an experimental validation. On your own imager, measure blank lanes (their values should scatter around zero), a two-fold dilution series of your target and your loading control (the slope over the lanes above 10σ should be near 1, and the range where it is tells you the linear range of your detection), and the same blot at two exposures (unclipped bands should keep their ratios). `tools/real-bench.mjs` takes a `dilution` label for the series.
