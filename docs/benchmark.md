# Benchmarking the automatic analysis on your own gels

The synthetic benches (`node tools/lane-bench.mjs`, `node tools/marker-bench.mjs`) run on generated gels and cannot show how the analysis does on real photographs and scans: uneven lighting, torn corners, smiles, overloaded lanes, three ladders. `tools/real-bench.mjs` loads your own images in the app exactly as a user would and compares what it found with what you labelled.

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
