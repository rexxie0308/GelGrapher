# Ladder sources

Every band list in `js/ladders.js` was checked against its manufacturer's datasheet, manual or product page on
2026-10-29. `ref` holds the bands the datasheet names as coloured, brighter or reference bands. In the app, those
bands keep their size labels first when labels would collide, and they carry a ★ in the band list. Prestained sizes
are apparent sizes that shift with the gel and buffer system, and the lists here are the Tris-glycine values where a
maker gives several. The vendor's sheet for the lot in use is the final reference.

NEB's websites (neb.com and its regional sites) answer automated readers with a bot challenge, so every NEB entry
comes from the datasheet images the owner supplied on 2026-10-29. Their names follow NEB's product names, without the
® and ™ signs. Thermo Fisher's and Bio-Rad's product pages also block automated readers. Their entries were checked
against the makers' PDFs on their document servers, or against Bio-Rad's catalogue text where the PDF was blocked.

## NEB (the owner's datasheet images, 2026-10-29)

| id | Ladder | Bands as the datasheet shows them | Reference bands |
|---|---|---|---|
| neb1kb | 1 kb DNA Ladder (N3232S, N3232L) | 10.0, 8.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.5, 1.0, 0.5 kb | 3.0 kb (125 ng; the others 33–50 ng) |
| nebql1kb, nebqlp1kb, nebtd1kb | Quick-Load 1 kb (N0468S, N0468L), Quick-Load Purple 1 kb (N0552S, N0552L), TriDye 1 kb (N3272S) | as N3232 | 3.0 kb |
| neb1kbplus | 1 kb Plus DNA Ladder (N3200S, N3200L) | 10.0, 8.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.5, 1.2, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1 kb | 3.0, 1.0, 0.5 kb (120–124 ng) |
| nebql1kbplus, nebqlp1kbplus, nebtd1kbplus, neb1kbplussafe | Quick-Load 1 kb Plus (N0469S), Quick-Load Purple 1 kb Plus (N0550S, N0550L), TriDye 1 kb Plus (N3270S), 1 kb Plus for Safe Stains (N0559S; half the mass per band) | as N3200 | 3.0, 1.0, 0.5 kb |
| neb100 | 100 bp DNA Ladder (N3231S, N3231L) | 1,517, 1,200, 1,000, 900, 800, 700, 600, 500/517, 400, 300, 200, 100 bp | 1,000 and 500/517 bp |
| nebql100, nebqlp100, nebtd100 | Quick-Load 100 bp (N0467S, N0467L), Quick-Load Purple 100 bp (N0551S, N0551L), TriDye 100 bp (N3271S) | as N3231 | 1,000 and 500/517 bp |
| neb50 | 50 bp DNA Ladder (N3236S, N3236L) | 1,350, 916, 766, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100, 50 bp | 500 and 200 bp |
| nebqlp50 | Quick-Load Purple 50 bp (N0556S) | as N3236 | 500 and 200 bp |
| neblmw | Low Molecular Weight DNA Ladder (N3233S, N3233L) | 766, 500, 350, 300, 250, 200, 150, 100, 75, 50, 25 bp | 200 bp (110 ng); the entry named 500 bp until 2026-10-29 |
| nebqlplmw | Quick-Load Purple Low Molecular Weight (N0557S) | as N3233 | 200 bp |
| nebextend | Quick-Load 1 kb Extend DNA Ladder (N3239S) | 48.5, 20, 15, 10, 8, 6, 5, 4, 3, 2, 1.5, 1, 0.5 kb | 3 kb (100 ng) |
| nebfast | Fast DNA Ladder (N3238S) | 10.0, 5.0, 3.0, 2.0, 1.5, 1.0, 0.766, 0.500, 0.300, 0.150, 0.050 kb | 1.0 kb (108 ng) |
| nebpcr | PCR Marker (N3234S, N3234L) | 766, 500, 300, 150, 50 bp | none |
| nebulow | TriDye Ultra Low Range DNA Ladder (N0558S) | 700, 650, 400, 300, 200, 150, 100, 75, 50, 35, 25, 15, 10 bp | none named |
| nebscextend | Supercoiled Extend DNA Ladder (N0494S) | 15.0, 12.0, 10.0, 8.0, 6.0, 5.0, 4.0, 3.0, 2.0 kb (supercoiled plasmids) | 6.0 kb (136 ng) |
| nebpbr322bstni | pBR322 DNA-BstNI Digest (N3031L) | 1,857, 1,058, 929, 383, 121 bp | none |
| nebpbr322mspi | pBR322 DNA-MspI Digest (N3032S) | 622, 527, 404, 307, 238 + 242, 217, 201, 190, 180, 160 + 160, 147 + 147, 123, 110, 90, 76, 67 bp | the three doublets (twice the DNA) |
| lambdahind | Lambda DNA-HindIII Digest (N3012S, N3012L) | 23,130, 9,416, 6,557, 4,361, 2,322, 2,027 bp shown | none |
| nebp7719s | Color Prestained Protein Standard, Broad Range (10-250 kDa) (P7719S, P7719L) | 250, 180, 130, 95, 72, 55, 43, 34, 26, 17, 10 kDa | 72 kDa orange, 26 kDa green |
| nebp7718b | Blue Prestained Protein Standard, Broad Range (11-250 kDa) (P7718S, P7718L) | 250, 180, 130, 95, 72, 55, 43, 34, 26, 17, 11 kDa, all blue | none |
| nebp7717u | Unstained Protein Standard, Broad Range (10-200 kDa) (P7717S, P7717L) | 200, 150, 100, 85, 70, 60, 50, 40, 30, 25, 20, 15, 10 kDa | 50 and 25 kDa (the heavy bands in the image; the datasheet marks none) |

- **Doublets.** A band holding two fragments is labelled with the smaller one: 500 for the 100 bp ladder's 500/517,
  and 238, 160 and 147 for the MspI digest.
- **Loading formats.** The plain, Quick-Load, Quick-Load Purple, TriDye and Safe Stains versions of one ladder have
  identical bands, so a gel cannot tell them apart. The ladder search counts them once (`E.uniqueLadders`) and names
  the plain one, or the one starred as a favourite. Star the format you use.
- **P7718 and P7719** differ only in the bottom band (11 against 10 kDa) and the colours, so they fit a gel alike.
  The Color standard is listed first and wins a tie. Star the Blue one if that is the one you use.
- **Lambda HindIII.** The 564 bp fragment is below NEB's image but in every maker's list (Thermo SM0101 user guide
  MAN0012986: "23130, 9416, 6557, 4361, 2322, 2027, 564, 125"), and it is kept. The 125 bp fragment, about 0.3 % of
  the DNA, is usually invisible and is left out. Heat the marker to 65 °C for 5 minutes before loading. Otherwise the
  cohesive ends of the 23,130 and 4,361 bp fragments anneal into an extra band at 27,491 bp.

Not checked against NEB's own sheets yet, because no image has been supplied: nebp7712 (Color Prestained, Broad Range
11-245 kDa, P7712, superseded by P7719; NEB says 12 proteins), nebp7703 (Protein Ladder 10-250 kDa, P7703; its
certificate of analysis gives 12 proteins with 25 and 80 kDa at triple intensity), and the RNA markers nebssrna,
neblrssrna and nebmirna. Earlier ids still open saved projects: `nebp7719` opens nebp7712, `nebp7718` opens nebp7719s,
and `nebp7717` opens nebp7703, the list that id carried.

## Thermo Fisher and Invitrogen (manuals on assets.thermofisher.com, 2026-10-29)

Each manual is at `https://assets.thermofisher.com/TFS-Assets/LSG/manuals/<file>`.

| id | Product | Manual | Notes |
|---|---|---|---|
| gr1kb | GeneRuler 1 kb (SM0311) | MAN0013004_GeneRuler_1kb_DNALadder_250ug_UG.pdf | reference bands 6000, 3000, 1000 |
| gr1kbplus | GeneRuler 1 kb Plus (SM1331) | MAN0013047_GeneRuler_1kb_Plus_DNALadder_250ug_UG.pdf | 5000, 1500, 500 |
| gr100plus | GeneRuler 100 bp Plus (SM0321) | MAN0013008_GeneRuler_100bp_Plus_DNALadder_50ug_UG.pdf | 1000, 500 |
| gr100 | GeneRuler 100 bp (SM0241) | MAN0012995_GeneRuler_100bp_DNALadder_50ug_UG.pdf | 500 |
| gr50 | GeneRuler 50 bp (SM0371) | MAN0013016_GeneRuler_50bp_DNALadder_50ug_UG.pdf | 500, 250 |
| grmix | GeneRuler DNA Ladder Mix (SM0331) | MAN0013012_GeneRuler_DNALadder_250ug_UG.pdf | 3000, 1000, 500 |
| grlow | GeneRuler Low Range (SM1191) | MAN0013035_GeneRuler_LowRange_DNALadder_50ug_UG.pdf | 300, 100 |
| grulow | GeneRuler Ultra Low Range (SM1211) | MAN0013039_GeneRuler_Ultra_LowRange_DNALadder_50ug_UG.pdf | 50 |
| grexpress | GeneRuler Express (SM1553) | MAN0013075_GeneRuler_Express_DNALadder_RTU_UG.pdf | 1500, 500 |
| inv1kbplus | 1 Kb Plus DNA Ladder (10787018) | 1Kb_Plus_DNA_ladder_man.pdf | 1500; sizes read from the manual's figure |
| ribohigh | RiboRuler High Range (SM1821) | MAN0013096_RiboRuler_HighRange_RNA_Ladder_UG.pdf | none named |
| ribolow | RiboRuler Low Range (SM1831) | MAN0013098_RiboRuler_LowRange_RNA_Ladder_UG.pdf | none named |
| pr26619 | PageRuler Plus Prestained (26619) | MAN0011773_PgRuler_Plus_Prestain_Protein_Lad_UG.pdf | orange 70 and 25, green 10 (10 added 2026-10-29) |
| pr26616 | PageRuler Prestained (26616) | MAN0011772_PgRuler_Prestain_Protein_Lad_UG.pdf | orange 70, green 10 (10 added) |
| pr26614 | PageRuler Unstained (26614) | MAN0011771_PgRuler_Unstain_Protein_Lad_UG.pdf | 50 brighter |
| pr26630 | PageRuler Unstained Broad Range (26630) | MAN0011777_PgRuler_BrdRnge_Unstain_Protein_Lad_UG.pdf | 100, 50, 20 brighter (added) |
| spectra26634 | Spectra Multicolor Broad Range (26634) | MAN0011774_Spectra_Multiclr_BrdRnge_Protein_Lad_UG.pdf | green 10 and 50, orange 40, 70 and 260, pink 140 (added) |
| pr26632 | PageRuler Unstained Low Range (26632) | MAN0011778_PgRuler_LwRnge_Unstain_Protein_Lad_UG.pdf | 25 brighter |
| spectra26625 | Spectra Multicolor High Range (26625) | MAN0011775_Spectra_Multiclr_HiRnge_Protein_Lad_UG.pdf | orange 300 and 70, green 50 (added) |
| spectra26628 | Spectra Multicolor Low Range (26628) | MAN0011776_Spectra_Multiclr_LwRnge_Protein_Lad_UG.pdf; Thermo protein-ladder flier (assets/brochures/1602395-Protein-Ladder-Flier.pdf) | green 10, orange 40 (added) |
| novexsharp | Novex Sharp Pre-stained (LC5800) | MAN0005693_LC5800pps_Novex_Sharp_Std_UG.pdf | the 3.5 kDa band shows only in NuPAGE MES gels |
| seeblueMES | SeeBlue Plus2, Bis-Tris MES (LC5925) | SeeBluePlus2PreStainedStnd_man.pdf | top band **198** kDa (was 188, the original SeeBlue's) |
| seeblueTG, seeblueMOPS | SeeBlue Plus2, Tris-glycine and MOPS (LC5925) | not verified: the per-buffer table is on a protocol page that blocks automated readers | |
| magicmark | MagicMark XP (LC5602) | MAN0001518_LC5600pps_MagicMarkXP_Std_UG.pdf | |
| benchmark | BenchMark Protein Ladder (10747012) | BenchMarkUnstainedProteinLadder_man.pdf | 50 and 20 more prominent (added) |
| nativemark | NativeMark Unstained (LC0725) | MAN0001514_LC0725pps_NativeMark_Unstained_Std_UG.pdf | |

## Bio-Rad, Cytiva, Bioline

| id | Source | Notes |
|---|---|---|
| biodual, bioallblue, biounstained, biowesternc | Bio-Rad catalogue text (SelectScience listings) and bulletins 4110025 / 4110023 as indexed by search (bio-rad.com blocks automated readers) | All four have three reference bands, 25, 50 and 75 kD, at three times the intensity of the others. Dual Color's 25 and 75 are pink and its 50 is blue; 50 was added to Dual Color on 2026-10-29. WesternC is named "WesternC Blotting Standards". |
| biokaleido | Kaleidoscope manual 4110182 Rev G (on manualsdir.com) | no reference bands |
| hmwnative | Cytiva catalogue sheet (cytivalifesciences.co.jp/catalog/pdf/06-076-02.pdf) | 669, 440, 232, 140, 66 kDa. The catalogue number was 28403842, which is the Gel Filtration Calibration Kit; the HMW Native Marker Kit is **17044501**. |
| hyper1kb | Bioline product page (copy at fenix.ciencias.ulisboa.pt; bioline.com blocks automated readers) | "14 regularly spaced bands, ranging from 200 bp to 10,037 bp, with higher intensity reference bands at 1000 bp and 10,037 bp and a doublet band at 1500/1517 bp". The top band became **10,037** (was 10,000), and the reference bands 10,037 and 1,000 were added. The bands between 8,000 and 400 bp were not checked one by one; the count fits. |

## Takara, TransGen, Tiangen

| id | Source | Notes |
|---|---|---|
| dl2000 | Takara datasheet 3427A (takarabio.com/documents/User Manual/3427A/3427A_DS.v1901Da.pdf) | 750 bp about 3 times as bright |
| dl5000 | Takara datasheet 3428A (…/3428A/3428A_DS.v1901Da.pdf) | 1,000 bp brighter |
| dl15000 | Takara's Chinese datasheet 3582A v201702Da (on ulab360.com; Takara China's page blocks automated readers) | about 50 ng per band, none brighter |
| trans2k, trans2kplus, trans2kplus2 | transgenbiotech.com product pages and manuals BM101, BM111, BM121 | 750 bp double intensity |
| trans5k | transgenbiotech.com/dna_marker/trans5k_dna_marker.html; manual BM141 | catalogue number **BM141** added (the entry had none) |
| trans15k | transgenbiotech.com product page; manual BM161 | 5,000 bp double intensity |
| tiangen2000 | tiangen.com product page "D2000分子量标准 (MD114)" | 750 bp brightest; renamed "Tiangen D2000 DNA Marker (MD114)" |

## Epizyme, Yeasen (product pages and Epizyme's PDF manuals, 2026-10-29)

| id | Ladder | Source |
|---|---|---|
| epiwj101 | Epizyme WJ101 | https://www.epizyme.cn/Products/Details/1070 (15, 20, 25, 35, 40, 50, 70, 100, 150 kDa; 25 and 70 kDa coloured) |
| epiwj102 | Epizyme WJ102 | https://www.epizyme.cn/Products/Details/1071 (10, 15, 20, 25, 35, 40, 50, 70, 100, 150, 250 kDa; 25 and 70 kDa coloured) |
| epiwj103 | Epizyme WJ103 | https://www.epizyme.cn/Products/Details/1073 (same list as WJ102; three colours) |
| epiwj106 | Epizyme WJ106 | https://www.epizyme.cn/Products/Details/1072 (same list as WJ102; a two-colour marker for near-infrared imaging, renamed so) |
| epiwj107 | Epizyme WJ107 | https://www.epizyme.cn/Products/Details/25016 (10, 15, 25, 35, 40, 55, 70, 100, 130, 180 kDa; 10 and 70 kDa coloured) |
| epiwj402 | Epizyme WJ402 | https://www.epizyme.cn/Products/Details/26632 (1.2, 4.2, 7.5, 15, 20, 30, 40 kDa; 20 kDa green; Tricine gels) |
| yeasen26616 | Yeasen GoldBand Plus 3-color Regular Range (26616ES) | https://www.yeasen.com/products/detail/13366 (10, 15, 25, 35, 40, 55, 70, 100, 130, 180 kDa; 70 kDa orange-red, 10 kDa green) |
| yeasen20350 | Yeasen GoldBand Plus 3-color Regular Range (20350ES) | https://www.yeasen.com/products/detail/1750 (8, 17, 25, 33, 43, 55, 72, 100, 130, 180 kDa; 72 kDa orange-red, 8 kDa green) |
| yeasen20352 | Yeasen GoldBand 3-color High Range (20352ES) | https://www.yeasen.com/products/detail/592 (10, 15, 20, 35, 45, 60, 100, 140, 180, 245 kDa blue; 72 kDa orange; 25 kDa green) |

## Not in the library

These are left out because the vendor page shows the band list only as an image or could not be read: Beyotime P0068 /
P0071 / P0075 / P0776 / P0773 / P0779 / P0771 / P0060 / P0063, GenScript M00624, Abcam ab116028, Bio-Rad 1610377,
TransGen DM111 / DM141 / DM151 / DR201, Solarbio PR1910 / PR1920, Sangon C610110 / C610210.
