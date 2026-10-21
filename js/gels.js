/* Experiment types. Each one decides which ladders are offered and matched, the size unit, how bands
 * are shown by default and the wording of legend notes. The analysis itself (straightening, lanes,
 * migration fit, densitometry) is the same for every type: SDS-PAGE and nucleic-acid gels both run
 * close to linear in log(size), and the fit allows curvature for gradient gels.
 */
(function (G) {
  'use strict';
  // darkBands: default look of the figure (true = dark bands on a light background)
  // minMarkerBands: sharp bands a lane needs before it is taken for a ladder lane
  const TYPES = [
    { id: 'dna-agarose', kind: 'dna', ladder: 'gr1kbplus', darkBands: null, minMarkerBands: 6,
      name: () => 'DNA agarose gel', hint: () => 'EtBr / SYBR / GelRed: PCR, digests, plasmids',
      noun: 'DNA', stain: 'agarose gel' },
    { id: 'dna-page', kind: 'dna', ladder: 'grlow', darkBands: null, minMarkerBands: 6,
      name: () => 'DNA PAGE (native)', hint: () => 'Small fragments, oligos, EMSA',
      noun: 'DNA', stain: 'polyacrylamide gel' },
    { id: 'southern', kind: 'dna', ladder: 'gr1kb', darkBands: true, minMarkerBands: 5, unit: 'kb',
      name: () => 'Southern blot', hint: () => 'Probe hybridisation, autoradiography or chemiluminescence',
      noun: 'DNA', stain: 'Southern blot' },
    { id: 'rna', kind: 'rna', ladder: 'ribohigh', darkBands: null, minMarkerBands: 5,
      name: () => 'RNA gel / Northern blot', hint: () => 'Denaturing agarose, urea-PAGE, Northern',
      noun: 'RNA', stain: 'denaturing gel' },
    { id: 'sds-page', kind: 'protein', ladder: 'pr26619', darkBands: true, minMarkerBands: 6,
      name: () => 'Protein SDS-PAGE', hint: () => 'Coomassie, silver, stain-free',
      noun: 'protein', stain: 'SDS-PAGE gel' },
    { id: 'native-page', kind: 'native', ladder: 'nativemark', darkBands: true, minMarkerBands: 4,
      name: () => 'Native / Blue native PAGE', hint: () => 'Protein complexes, oligomeric state',
      noun: 'protein', stain: 'native gel' },
    { id: 'western', kind: 'protein', ladder: 'pr26619', darkBands: true, minMarkerBands: 6, western: true,
      name: () => 'Western blot', hint: () => 'Chemiluminescence / fluorescence; optional white-light marker image',
      noun: 'protein', stain: 'Western blot' }
  ];
  const get = id => TYPES.find(t => t.id === id) || TYPES[0];
  // what the size column of a figure is called
  const unitOf = id => { const t = get(id); return t.unit || G.Ladders.KIND_UNIT[t.kind]; };
  const sizeNoun = kind => (kind === 'dna' ? 'Fragment size' : kind === 'rna' ? 'Transcript size' : 'Molecular weight');
  G.Gels = { TYPES, get, unitOf, sizeNoun };
})(window);
