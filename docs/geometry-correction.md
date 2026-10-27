# Geometric correction of photographed gels: design and rules

Status: **planned, not implemented.** This document is the design the app will follow, written before the code so the rules are fixed first. The lane detector it builds on (comb pitch, slab edges, margin rules) is in `js/engine.js` since 2026-10 and is scored by `node tools/lane-bench.mjs`.

## The problem

A gel photographed with a phone or a camera, or a slab that shrank, tore or "smiled" while it ran, is not the rectangle the figure needs:

- **Keystone** (perspective): the camera was not square to the gel, so the slab is a trapezoid and the lanes converge. Lane lines in the app are vertical, so a lane that tilts by 15 px over its length is only partly inside its line, the band boxes catch the neighbour, and the figure shows a tilted gel.
- **Smile / frown**: the bands of one row curve (the gel ran hotter in the middle); the ladder bands in the outer lanes sit higher or lower than in the inner lanes, so a marker tick is at the wrong height for the inner lanes.
- **Contraction and tearing**: part of the slab stretched or shrank (the user's sanity-check gel: three ladders, a broken corner, the right ladder 38 px from its neighbour where the pitch is 48 px).

A scanner or an imager with the gel flat on the glass has none of this; the correction must stay out of the way on those images.

## The three questions

### 1. Gel from non-gel

The slab is found, not assumed:

- Along x: the column median of the band rows (the signal over the crop's height) steps up where the background ends and the gel begins, and down where it ends. The detector walks outward from the outermost loaded lane and takes the first step down to a lower level that has no lane beyond it and is not the edge of a lane itself (this is `detectLaneLattice` today).
- Along y: the same on the row median, bounded by the well row (`autoCrop.meta.wellY`) and the dye front. Not implemented yet.
- The four corners are the intersections of the four fitted edge lines. Each edge is fitted to the step positions found row by row (or column by column) with a robust line fit (least squares after discarding the quarter of the points farthest from a first fit), so a torn corner or a folded edge does not bend the line.
- The corners are **shown as four handles** on the raw image and can be dragged. The correction is only computed from what the user sees and can fix; nothing is inferred from texture that cannot be checked by eye.

Non-gel that must not count: the frame of the scanner, dust, bubbles, the slanted cut edge of the slab, reflections. The lane detector already drops line-like and spot-like features with a small horizontal opening before the top-hat; the corner finder uses the same signal.

### 2. Lane from non-lane

Lanes are the comb's teeth (`combPitch`), kept from the first to the last tooth that carries a lane: a wide feature of the presence profile that is a bump of the band-contrast profile (rows above the lane's own median, which a torn edge or a fold does not have). Teeth in the slab's margin (within 0.75 pitch of the edge) are never wells. Once the geometry is corrected the same detector runs on the corrected image, where lanes are vertical and the column profile is sharper: a lane that is a slope between its neighbours today (the user's right ladder) separates when it stops drifting across 15 columns.

Per lane the correction needs its **direction**, not only its centre: the centroid of the lane's signal is measured in horizontal bands of the crop (every 1/8 of its height), a line x(y) is fitted to them, and lanes whose fit is poor (empty wells, smears) are left out of the geometry estimate. This is the "lane topology" the correction is based on: a set of nearly parallel lines that, in a keystoned photograph, meet at one vanishing point.

### 3. Re-distort by the lane topology without adding artefacts

Three levels, applied in this order, each one only when the previous cannot explain the image:

**A. Projective (keystone), 8 parameters.** The four slab corners map to a rectangle; alternatively the vanishing point of the lane lines and the vanishing point of the band rows (from a ladder with ≥ 4 bands in two lanes) give the same homography. A projective transform has no freedom to move one lane relative to another: every straight line stays straight and every lane keeps its neighbours, so it cannot create a band, split one or move one into another lane. It is the correction a camera needs and the one the literature accepts (a global transform, applied to the whole image).

**B. Rotation is folded into A.** The app already rotates the image for the deskew. The rotation and the homography are composed into one 3 × 3 matrix so the pixels are resampled **once**. Two resamplings blur twice.

**C. Smooth non-rigid warp, only when asked for.** Smiles and contraction are not projective. Model: a thin-plate spline (or a coarse grid, one node per lane and per ladder band) whose control points are the fitted lane lines (x correction) and the ladder band rows across the marker lanes (y correction), regularised so the surface is smooth and the mesh never folds. The user sees the mesh on the raw image before it is applied. This is an area-specific change, which journal rules treat differently from a global transform (see below), so the app labels it separately.

Artefact rules, applied to every level:

1. **Densitometry never uses corrected pixels.** Band boxes and lane profiles are measured on the raw image; the box corners are mapped back through the inverse transform. A warp changes the area of a pixel differently across the image, so the integral of a band would depend on where it sits. (Segre 2022 shows standard warps do not conserve intensity sums.)
2. **One resampling, bilinear.** No bicubic or Lanczos (ringing at band edges), no sharpening, no upsampling beyond the native pixel size; the corrected image has the same pixel pitch as the raw one along the longer edge.
3. **Global or smooth only.** No per-lane shifts, no local cloning; the mesh is continuous and its Jacobian is bounded (a node may move at most 0.4 pitch from its lattice position).
4. **Default off; opt-in with a preview.** The raw image stays what the editor shows; "Geometry" in step 1 has *Keystone: off / auto / corners* and *Straighten smile: off / on* with a before-after preview. A figure without correction is always one click away.
5. **Disclosed.** The processing log records the transform (the four corners, the matrix, the mesh nodes); the legend notes say "Perspective-corrected (projective transform from the slab outline)" and, for C, "Lanes straightened (thin-plate spline on lane and ladder positions)"; the methods paragraph names it. The original pixels are kept in the Library and exported with "Original data".
6. **Lane names, markers and boxes are stored in the raw frame.** Nothing typed moves when the correction is toggled; the figure is rendered through the transform.

## What the literature and the journals accept

Journal and integrity guidelines do not mention perspective or warping by name; they distinguish **whole-image, uniform adjustments** (acceptable, disclosed when non-linear) from **feature-specific changes** (enhancing, obscuring, moving, removing or introducing a feature: not acceptable):

- Rossner & Yamada 2004, *J Cell Biol* 166:11–15 (doi:10.1083/jcb.200406019): "no specific feature within an image may be enhanced, obscured, moved, removed, or introduced"; linear whole-image adjustments are fine, non-linear ones must be stated in the legend; downsampling is averaging, upsampling "creates data not present in the original".
- Cromey 2010, *Sci Eng Ethics* 16:639–667 (doi:10.1007/s11948-010-9201-y), also the ORI image-processing guidelines: simple adjustments to the entire image and cropping are acceptable (G3, G4); area-specific manipulations are questionable and must be stated (G6); intensity measurements on unprocessed data, every other processing applied uniformly and described in Methods (G9); resizing interpolates new values and can alias, so resample once (G12).
- Nature Portfolio image-integrity policy, JCB editorial policies, PLOS figure guidelines, Cell Press figure guidelines: processing applied equally across the whole image and to controls; non-linear adjustments disclosed; unprocessed gels supplied with the paper.

So a global homography (A + B) is a whole-image transform of the same class as rotation and cropping and is disclosed like a non-linear adjustment; a non-rigid warp (C) is area-specific and must be stated explicitly, which is why it is a separate switch with its own legend note.

Geometric correction is standard practice in gel analysis itself:

- 2D gels: warping is a routine step of every analysis package. Gustafsson, Blomberg & Rudemo 2002, *Electrophoresis* 23:1731–1744 (model-based warping of the spot pattern); Veeser, Dunn & Yang 2001, *Proteomics* 1:856–870 (multiresolution image registration); Dowsey, Dunn & Yang 2003, *Proteomics* 3:1567–1596 (review); Berth et al. 2007, *Appl Microbiol Biotechnol* 76:1223–1243 (review, image warping as standard).
- 1D gels: lane tracking that follows curved lanes in sequencing gels (Cooper et al. 1996, *Genome Res* 6:1110–1117); "smile" elimination in an automatic pipeline (Trifunović et al. 2005, *Electrophoresis* 26:4277–4286); LaneRuler, which straightens agarose lanes (Wong et al. 2010, *IEEE Trans Autom Sci Eng* 7:706–708); GelClust, automatic smile detection and correction (Khakabimamaghani et al. 2013, *Comput Methods Programs Biomed* 111:512–518); GELect, per-column smile correction as an ImageJ plugin (Intarapanich et al. 2015, *BMC Genomics* 16(S12):S15). Commercial tools: Bio-Rad Image Lab bends single lanes with anchor points, Syngene GeneTools corrects track distortion and smiling bands.
- Photographed gels: no gel paper applying a homography was found; the method is the standard one for photographed documents (e.g. Liu et al. 2015, *IJDAR* 18:111–124, thin-plate-spline dewarping). GelGenie (Aquilina et al. 2025, *Nat Commun* 16:4087) avoids lane geometry altogether by segmenting bands directly.
- On measurement after resampling: Segre 2022, *SIAM J Imaging Sci* 15:1623–1645 (warps do not conserve pixel sums; intensity-preserving resampling needed for optical densities); Gassmann et al. 2009, *Electrophoresis* 30:1845–1855 (undocumented densitometry choices move a p-value from 0.00001 to 0.76: document every step).

The common recommendation across these sources is the rule set above: measure on the raw pixels, correct geometry for display with a global or smooth transform, resample once, keep the original, and write down the parameters.

## Interface (planned)

Step 1, Image → **Geometry** fold:

- *Keystone*: **Off** (default) · Auto (corners from the slab outline, shown as handles) · Corners (drag the four handles). A line under it: "Projective correction from the slab outline, 3.2° keystone; the figure uses it, measurements use the original pixels."
- *Straighten lanes and bands* (smile / contraction): Off (default) · On. Shows the mesh on the raw image; "Smooth warp on 13 lane lines and 2 ladders; stated in the legend."
- Preview toggle above the figure: raw ↔ corrected.
- Both switches write to the processing log, the legend notes and the methods text; both are carried in the project file and the Library.

## Order of work

1. Slab corners (x edges exist; add y edges, corner handles, robust line fit). Test: synthetic gels with a known homography applied (`Demo.makeGel` + `Engine.warp`), corners recovered within 2 px.
2. Homography composed with the rotation; `App.ensureRot` becomes `App.ensureGeom`; annotations stay in the raw frame; the renderer samples through the transform. Test: the lane lattice on the corrected user gel finds 13 wells with the right ladder as a marker.
3. Legend / log / methods wording, project-file field, Library.
4. Lane-line fit and vanishing-point estimate as the "Auto" source when the slab edges are unusable (torn, out of frame).
5. Thin-plate smile correction, with the mesh overlay.
