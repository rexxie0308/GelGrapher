/* Size-marker presets for every supported gel type. Sizes are listed largest -> smallest, as visible
 * bands, in the kind's base unit: DNA bp, RNA nt, protein / native protein kDa.
 * ref = reference (brighter or coloured) bands.
 * DNA ladders: verified against manufacturer datasheets (GelFigure, 2026-10).
 * Protein, native and RNA ladders: from the manufacturers' product sheets; apparent sizes of
 * prestained ladders depend on the gel / buffer system, so check them against your lot's datasheet
 * and add a custom ladder if they differ.
 */
(function (G) {
  'use strict';
  const D = (id, name, sizes, ref) => ({ id, name, sizes, ref: ref || [], kind: 'dna' });
  const R = (id, name, sizes, ref) => ({ id, name, sizes, ref: ref || [], kind: 'rna' });
  const P = (id, name, sizes, ref) => ({ id, name, sizes, ref: ref || [], kind: 'protein' });
  const N = (id, name, sizes, ref) => ({ id, name, sizes, ref: ref || [], kind: 'native' });
  const BIORAD = [250, 150, 100, 75, 50, 37, 25, 20, 15, 10];
  const L = [
    // ---- DNA ----
    D('gr1kb', 'Thermo GeneRuler 1 kb (SM0311)', [10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1000, 750, 500, 250], [6000, 3000, 1000]),
    D('gr1kbplus', 'Thermo GeneRuler 1 kb Plus (SM1331)', [20000, 10000, 7000, 5000, 4000, 3000, 2000, 1500, 1000, 700, 500, 400, 300, 200, 75], [5000, 1500, 500]),
    D('gr100plus', 'Thermo GeneRuler 100 bp Plus (SM0321)', [3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], [1000, 500]),
    D('gr100', 'Thermo GeneRuler 100 bp (SM0241)', [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], [500]),
    D('gr50', 'Thermo GeneRuler 50 bp (SM0371)', [1000, 900, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50], [500, 250]),
    D('grmix', 'Thermo GeneRuler DNA Ladder Mix (SM0331)', [10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], [3000, 1000, 500]),
    D('grlow', 'Thermo GeneRuler Low Range (SM1191)', [700, 500, 400, 300, 200, 150, 100, 75, 50, 25], [300, 100]),
    D('grulow', 'Thermo GeneRuler Ultra Low Range (SM1211)', [300, 200, 150, 100, 75, 50, 35, 25, 20, 15, 10], [50]),
    D('grexpress', 'Thermo GeneRuler Express (SM1553)', [5000, 3000, 2000, 1500, 1000, 750, 500, 300, 100], [1500, 500]),
    D('neb1kb', 'NEB 1 kb DNA Ladder (N3232S / N3232L)', [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500], [3000]),
    D('neb100', 'NEB 100 bp DNA Ladder (N3231S / N3231L)', [1517, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], [1000, 500]),
    D('neb1kbplus', 'NEB 1 kb Plus DNA Ladder (N3200S / N3200L)', [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], [3000, 1000, 500]),
    D('neblmw', 'NEB Low Molecular Weight DNA Ladder (N3233S / N3233L)', [766, 500, 350, 300, 250, 200, 150, 100, 75, 50, 25], [500]),
    D('inv1kbplus', 'Invitrogen 1 Kb Plus DNA Ladder (10787018)', [15000, 10000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 850, 650, 500, 400, 300, 200, 100], [1500]),
    D('hyper1kb', 'Bioline HyperLadder 1kb (BIO-33053)', [10000, 8000, 6000, 5000, 4000, 3000, 2500, 2000, 1500, 1000, 800, 600, 400, 200]),
    D('lambdahind', 'Lambda DNA/HindIII', [23130, 9416, 6557, 4361, 2322, 2027, 564]),
    D('dl2000', 'Takara DL2000 (3427A)', [2000, 1000, 750, 500, 250, 100], [750]),
    D('dl5000', 'Takara DL5000 (3428A)', [5000, 3000, 2000, 1500, 1000, 750, 500, 250, 100], [1000]),
    D('dl15000', 'Takara DL15000 (3582A)', [15000, 10000, 7500, 5000, 2500, 1000, 250]),
    D('trans2k', 'TransGen Trans2K (BM101)', [2000, 1000, 750, 500, 250, 100], [750]),
    D('trans2kplus', 'TransGen Trans2K Plus (BM111)', [5000, 3000, 2000, 1000, 750, 500, 250, 100], [750]),
    D('trans2kplus2', 'TransGen Trans2K Plus II (BM121)', [8000, 5000, 3000, 2000, 1000, 750, 500, 250, 100], [750]),
    D('trans5k', 'TransGen Trans5K', [5000, 3000, 2000, 1500, 1000, 800, 500, 300], [1500]),
    D('trans15k', 'TransGen Trans15K (BM161)', [15000, 10000, 7500, 5000, 3000, 1500, 1000, 500], [5000]),
    D('tiangen2000', 'Tiangen Marker D2000 (MD114)', [2000, 1000, 750, 500, 250, 100], [750]),
    // ---- RNA ----
    R('ribohigh', 'Thermo RiboRuler High Range RNA (SM1821)', [6000, 4000, 3000, 2000, 1500, 1000, 500, 200]),
    R('ribolow', 'Thermo RiboRuler Low Range RNA (SM1831)', [1000, 800, 600, 400, 300, 200, 100]),
    R('nebssrna', 'NEB ssRNA Ladder (N0362S)', [9000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500]),
    R('neblrssrna', 'NEB Low Range ssRNA Ladder (N0364S)', [1000, 500, 300, 150, 80, 50]),
    R('nebmirna', 'NEB microRNA Marker (N2102S)', [25, 21, 17]),
    // ---- protein (SDS-PAGE, Western) ----
    P('pr26619', 'Thermo PageRuler Plus Prestained (26619)', [250, 130, 100, 70, 55, 35, 25, 15, 10], [70, 25]),
    P('pr26616', 'Thermo PageRuler Prestained (26616)', [180, 130, 100, 70, 55, 40, 35, 25, 15, 10], [70]),
    P('pr26614', 'Thermo PageRuler Unstained (26614)', [200, 150, 120, 100, 85, 70, 60, 50, 40, 30, 25, 20, 15, 10], [50]),
    P('pr26630', 'Thermo PageRuler Unstained Broad Range (26630)', [250, 150, 100, 70, 50, 40, 30, 20, 15, 10, 5]),
    P('spectra26634', 'Thermo Spectra Multicolor Broad Range (26634)', [260, 140, 100, 70, 50, 40, 35, 25, 15, 10]),
    P('biodual', 'Bio-Rad Precision Plus Dual Color (1610374)', BIORAD, [75, 25]),
    P('bioallblue', 'Bio-Rad Precision Plus All Blue (1610373)', BIORAD, [75, 50, 25]),
    P('biokaleido', 'Bio-Rad Precision Plus Kaleidoscope (1610375)', BIORAD),
    P('biounstained', 'Bio-Rad Precision Plus Unstained (1610363)', BIORAD, [75, 50, 25]),
    P('biowesternc', 'Bio-Rad Precision Plus WesternC (1610376)', BIORAD, [75, 50, 25]),
    P('nebp7712', 'NEB Color Prestained Protein Standard, Broad Range 11–245 kDa (P7712S / P7712L)', [245, 190, 135, 100, 80, 58, 46, 32, 25, 22, 17, 11]),
    P('nebp7719s', 'NEB Color Prestained Protein Standard, Broad Range 10–250 kDa (P7719S / P7719L)', [250, 180, 130, 95, 72, 55, 43, 34, 26, 17, 10], [72, 26]),
    P('nebp7703', 'NEB Protein Ladder 10–250 kDa (P7703S)', [250, 150, 100, 80, 60, 50, 40, 30, 25, 20, 15, 10], [80, 25]),
    P('novexsharp', 'Invitrogen Novex Sharp Pre-stained (LC5800)', [260, 160, 110, 80, 60, 50, 40, 30, 20, 15, 10, 3.5]),
    P('seeblueTG', 'Invitrogen SeeBlue Plus2, Tris-glycine (LC5925)', [250, 148, 98, 64, 50, 36, 22, 16, 6, 4]),
    P('seeblueMES', 'Invitrogen SeeBlue Plus2, Bis-Tris MES (LC5925)', [188, 98, 62, 49, 38, 28, 17, 14, 6, 3]),
    P('seeblueMOPS', 'Invitrogen SeeBlue Plus2, Bis-Tris MOPS (LC5925)', [191, 97, 64, 51, 39, 28, 19, 14]),
    P('magicmark', 'Invitrogen MagicMark XP Western (LC5602)', [220, 120, 100, 80, 60, 50, 40, 30, 20]),
    P('benchmark', 'Invitrogen BenchMark Protein Ladder (10747012)', [220, 160, 120, 100, 90, 80, 70, 60, 50, 40, 30, 25, 20, 15, 10]),
    // ---- native protein ----
    /* Added 2026-10, sizes read from the vendors' product pages (sources in docs/ladder-sources.md):
     * Thermo 26632 / 26625 / 26628, Epizyme WJ101 / WJ102 / WJ103 / WJ106 / WJ107 / WJ402, Yeasen 26616ES /
     * 20350ES / 20352ES. The Spectra pages name the colours but not which band carries which: no ref. */
    P('pr26632', 'Thermo PageRuler Unstained Low Range (26632, Tricine gels)', [100, 30, 25, 20, 15, 10, 5, 3.4], [25]),
    P('spectra26625', 'Thermo Spectra Multicolor High Range (26625)', [300, 250, 180, 130, 100, 70, 50, 40]),
    P('spectra26628', 'Thermo Spectra Multicolor Low Range (26628, Tricine gels)', [40, 25, 15, 10, 4.6, 1.7]),
    P('epiwj101', 'Epizyme Two-color Prestained 15–150 kDa (WJ101)', [150, 100, 70, 50, 40, 35, 25, 20, 15], [70, 25]),
    P('epiwj102', 'Epizyme Two-color Prestained 10–250 kDa (WJ102)', [250, 150, 100, 70, 50, 40, 35, 25, 20, 15, 10], [70, 25]),
    P('epiwj103', 'Epizyme Three-color Prestained 10–250 kDa (WJ103)', [250, 150, 100, 70, 50, 40, 35, 25, 20, 15, 10], [70, 25]),
    P('epiwj106', 'Epizyme NIR Prestained 10–250 kDa (WJ106)', [250, 150, 100, 70, 50, 40, 35, 25, 20, 15, 10], [70, 25]),
    P('epiwj107', 'Epizyme Three-color Prestained 10–180 kDa (WJ107)', [180, 130, 100, 70, 55, 40, 35, 25, 15, 10], [70, 10]),
    P('epiwj402', 'Epizyme Two-color Prestained Low Range 1.2–40 kDa (WJ402, Tricine gels)', [40, 30, 20, 15, 7.5, 4.2, 1.2], [20]),
    P('yeasen26616', 'Yeasen GoldBand Plus 3-color Regular Range 10–180 kDa (26616ES)', [180, 130, 100, 70, 55, 40, 35, 25, 15, 10], [70, 10]),
    P('yeasen20350', 'Yeasen GoldBand Plus 3-color Regular Range 8–180 kDa (20350ES)', [180, 130, 100, 72, 55, 43, 33, 25, 17, 8], [72, 8]),
    P('yeasen20352', 'Yeasen GoldBand 3-color High Range 10–245 kDa (20352ES)', [245, 180, 140, 100, 72, 60, 45, 35, 25, 20, 15, 10], [72, 25]),
    N('nativemark', 'Invitrogen NativeMark Unstained (LC0725)', [1236, 1048, 720, 480, 242, 146, 66, 20]),
    N('hmwnative', 'Cytiva HMW Native Marker Kit (28403842)', [669, 440, 232, 140, 66])
  ];

  const KIND_UNIT = { dna: 'bp', rna: 'nt', protein: 'kDa', native: 'kDa' };
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked: keep working without it */ } }
  };
  const CUSTOM_KEY = 'gelfig.customLadders', FAV_KEY = 'gelfig.favLadders';
  // in-memory copy, so custom ladders still work for this session when storage is blocked
  let customMem = null;
  function loadCustom() {
    if (!customMem) customMem = store.get(CUSTOM_KEY, []).map(l => Object.assign({ kind: 'dna' }, l));
    return customMem;
  }
  function writeCustom(list) { customMem = list; store.set(CUSTOM_KEY, list); }
  function saveCustom(name, sizes, kind) {
    const list = loadCustom().filter(l => l.name !== name);
    const lad = { id: 'custom_' + Date.now(), name, sizes: sizes.slice().sort((a, b) => b - a), ref: [], custom: true, kind: kind || 'dna' };
    list.push(lad);
    writeCustom(list);
    return lad;
  }
  // register a ladder definition carried by a template / project (keeps its id); true if it was new
  function importDef(def) {
    if (!def || !def.id || !Array.isArray(def.sizes) || get(def.id)) return false;
    const list = loadCustom();
    list.push({ id: def.id, name: def.name || def.id, sizes: def.sizes.slice().sort((a, b) => b - a), ref: def.ref || [], custom: true, kind: def.kind || 'dna' });
    writeCustom(list);
    return true;
  }
  function removeCustom(id) {
    writeCustom(loadCustom().filter(l => l.id !== id));
    setFavorites(favorites().filter(f => f !== id));
  }
  // kind: optional filter ('dna' | 'rna' | 'protein' | 'native')
  function all(kind) { const a = L.concat(loadCustom()); return kind ? a.filter(l => l.kind === kind) : a; }
  // ids of earlier versions (docs/ladder-sources.md): 'nebp7719' carried the 11–245 kDa list, which is
  // P7712's; 'nebp7718' the 10–250 kDa colour list, which is P7719's; 'nebp7717' the 12-band 10–250 kDa
  // list, which is the Protein Ladder P7703's (P7717 has 13 bands, 10–200 kDa, and is not in the library yet)
  const ALIAS = { nebp7719: 'nebp7712', nebp7718: 'nebp7719s', nebp7717: 'nebp7703' };
  function get(id) { id = ALIAS[id] || id; return all().find(l => l.id === id); }
  // portable definitions of the custom ladders among `ids` (built-ins never need to travel)
  function defsFor(ids) { return [...new Set(ids)].map(get).filter(l => l && l.custom).map(l => ({ id: l.id, name: l.name, sizes: l.sizes, ref: l.ref || [], kind: l.kind })); }

  // "my ladders": ordered favourites, built-in and custom alike
  let favMem = null;
  function favorites(kind) {
    if (!favMem) favMem = store.get(FAV_KEY, []);
    return favMem.filter(id => { const l = get(id); return l && (!kind || l.kind === kind); });
  }
  function setFavorites(ids) { favMem = [...new Set(ids)]; store.set(FAV_KEY, favMem); }
  function isFavorite(id) { return favorites().includes(id); }
  function toggleFavorite(id) {
    const f = favorites();
    setFavorites(f.includes(id) ? f.filter(x => x !== id) : f.concat([id]));
    return isFavorite(id);
  }
  // favourites first (in their order), then the rest
  function ordered(kind) { const f = favorites(kind); return f.map(get).concat(all(kind).filter(l => !f.includes(l.id))); }

  // a size as printed next to a marker band: v is in the ladder's base unit
  function fmt(v, unit) {
    if (unit === 'kb') return (Math.round(v / 10) / 100).toString();
    if (unit === 'auto') return v >= 1000 ? (Math.round(v / 10) / 100) + ' kb' : v + ' bp';
    if (unit === 'kDa') return v < 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v));
    return String(v);
  }
  // column header above a marker's size labels ('' = none)
  function unitHeader(unit) { return unit === 'auto' ? '' : `(${unit})`; }
  // label units a marker of this kind can use
  function unitsFor(kind) { return kind === 'protein' || kind === 'native' ? ['kDa'] : kind === 'rna' ? ['nt', 'kb'] : ['bp', 'kb', 'auto']; }
  function kindOf(id) { const l = get(id); return l ? l.kind : 'dna'; }

  G.Ladders = { all, get, saveCustom, importDef, removeCustom, defsFor, favorites, setFavorites, isFavorite, toggleFavorite, ordered, fmt, unitHeader, unitsFor, kindOf, KIND_UNIT, store };
})(window);
