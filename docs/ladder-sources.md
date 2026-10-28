# Ladder sources

Band lists in `js/ladders.js` come from the manufacturers' datasheets or product pages. Entries added after the
GelFigure 0.5.0 import list their source here (read 2026-10). Prestained sizes are apparent sizes that shift with
the gel and buffer system; the vendor page is the reference for the lot in use.

| id | Ladder | Source |
|---|---|---|
| nebp7719s | NEB Color Prestained Protein Standard, Broad Range 10–250 kDa (P7719S / P7719L) | Band list supplied by the owner from the tube's datasheet (250, 180, 130, 95, 72, 55, 43, 34, 26, 17, 10 kDa; 72 and 26 kDa coloured reference bands). NEB's catalogue (https://www.neb.com/en-us/products/p7719-color-prestained-protein-standard-broad-range-10-250-kda, read through search excerpts on 2026-10-28; neb.com itself is not reachable from the cloud session) files this product as P7719: 11 bands, 10–250 kDa, orange 72 kDa and green 26 kDa reference bands, the direct replacement of P7712 with slightly different apparent weights. Until 2026-10-28 the entry was labelled P7718 under the id `nebp7718`; the id stays as an alias so saved projects open. The owner confirmed the product (P7719S) and its band list from the tube on 2026-10-28; the owner's gel photograph (three ladder lanes) fits it on every band. |
| nebp7712 | NEB Color Prestained Protein Standard, Broad Range 11–245 kDa (P7712S / P7712L) | NEB product sheet (245, 190, 135, 100, 80, 58, 46, 32, 25, 22, 17, 11 kDa; NEB: 12 proteins, 11–245 kDa, superseded by P7719). Until 2026-10 this list was filed under the id `nebp7719` and labelled P7719; the id stays as an alias so saved projects open. |
| nebp7703 | NEB Protein Ladder 10–250 kDa (P7703S) | NEB certificate of analysis and the Spring 2008 *Expressions* figure: 12 recombinant proteins, 250, 150, 100, 80, 60, 50, 40, 30, 25, 20, 15, 10 kDa; the 25 and 80 kDa bands at triple intensity as reference bands. Until 2026-10-28 this list was filed as "P7717 Unstained Protein Standard, Broad Range 10–200 kDa" under the id `nebp7717`, which it is not (P7717 has 13 bands from 10 to 200 kDa); the id stays as an alias. |
| pr26632 | Thermo PageRuler Unstained Low Range (26632) | https://www.thermofisher.com/order/catalog/product/26632 ("100, 30, 25, 20, 15, 10, 5, 3.4 kDa"; 25 kDa band stronger; Tricine gels) |
| spectra26625 | Thermo Spectra Multicolor High Range (26625) | https://www.thermofisher.com/order/catalog/product/26625 ("300, 250, 180, 130, 100, 70, 50, 40 kDa"; blue, orange and green bands, not assigned on the page) |
| spectra26628 | Thermo Spectra Multicolor Low Range (26628) | https://www.thermofisher.com/order/catalog/product/26628 ("40, 25, 15, 10, 4.6, 1.7 kDa"; Tricine gels) |
| epiwj101 | Epizyme WJ101 | https://www.epizyme.cn/Products/Details/1070 (15, 20, 25, 35, 40, 50, 70, 100, 150 kDa; 25 and 70 kDa coloured) |
| epiwj102 | Epizyme WJ102 | https://www.epizyme.cn/Products/Details/1071 (10, 15, 20, 25, 35, 40, 50, 70, 100, 150, 250 kDa; 25 and 70 kDa coloured) |
| epiwj103 | Epizyme WJ103 | https://www.epizyme.cn/Products/Details/1073 (same list as WJ102) |
| epiwj106 | Epizyme WJ106 | https://www.epizyme.cn/Products/Details/1072 (same list as WJ102; near-infrared) |
| epiwj107 | Epizyme WJ107 | https://www.epizyme.cn/Products/Details/25016 (10, 15, 25, 35, 40, 55, 70, 100, 130, 180 kDa; 10 and 70 kDa coloured) |
| epiwj402 | Epizyme WJ402 | https://www.epizyme.cn/Products/Details/26632 (1.2, 4.2, 7.5, 15, 20, 30, 40 kDa; 20 kDa green; Tricine gels) |
| yeasen26616 | Yeasen GoldBand Plus 3-color Regular Range (26616ES) | https://www.yeasen.com/products/detail/13366 (10, 15, 25, 35, 40, 55, 70, 100, 130, 180 kDa; 70 kDa orange-red, 10 kDa green) |
| yeasen20350 | Yeasen GoldBand Plus 3-color Regular Range (20350ES) | https://www.yeasen.com/products/detail/1750 (8, 17, 25, 33, 43, 55, 72, 100, 130, 180 kDa; 72 kDa orange-red, 8 kDa green) |
| yeasen20352 | Yeasen GoldBand 3-color High Range (20352ES) | https://www.yeasen.com/products/detail/592 (10, 15, 20, 35, 45, 60, 100, 140, 180, 245 kDa blue; 72 kDa orange; 25 kDa green) |

Not added yet, because their band lists could not be read from a datasheet (neb.com is outside the cloud session's
network allowance): NEB **P7717** Unstained Protein Standard, Broad Range 10–200 kDa (13 bands; a distributor's sheet
lists 200, 150, 100, 85, 70, 60, 50, 40, 30, 25, 20, 15, 10 kDa, unconfirmed) and NEB **P7718** Blue Prestained Protein
Standard, Broad Range 11–250 kDa (11 bands, all blue, the replacement of P7706). To add them, read the band list from
the product page or the tube's datasheet and file it here.

Not added, because the vendor page shows the band list only as an image or could not be read: Beyotime P0068 / P0071 /
P0075 / P0776 / P0773 / P0779 / P0771 / P0060 / P0063, GenScript M00624, Abcam ab116028, Bio-Rad 1610377, TransGen
DM111 / DM141 / DM151 / DR201, Solarbio PR1910 / PR1920, Sangon C610110 / C610210.
