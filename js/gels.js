/* Experiment types. Each one decides which ladders are offered and matched, the size unit, how bands
 * are shown by default and the wording of legend notes. The analysis itself (straightening, lanes,
 * migration fit, densitometry) is the same for every type: SDS-PAGE and nucleic-acid gels both run
 * close to linear in log(size), and the fit allows curvature for gradient gels.
 */
(function (G) {
  'use strict';
  const L = (...a) => G.L(...a);
  // darkBands: default look of the figure (true = dark bands on a light background)
  // minMarkerBands: sharp bands a lane needs before it is taken for a ladder lane
  const TYPES = [
    { id: 'dna-agarose', kind: 'dna', ladder: 'gr1kbplus', darkBands: null, minMarkerBands: 6,
      name: () => L('DNA 琼脂糖凝胶', 'DNA agarose gel'), hint: () => L('EtBr / SYBR / GelRed 染色，PCR、酶切、质粒', 'EtBr / SYBR / GelRed: PCR, digests, plasmids'),
      noun: 'DNA', stain: 'agarose gel' },
    { id: 'dna-page', kind: 'dna', ladder: 'grlow', darkBands: null, minMarkerBands: 6,
      name: () => L('DNA 聚丙烯酰胺凝胶 (PAGE)', 'DNA PAGE (native)'), hint: () => L('小片段、寡核苷酸、EMSA', 'Small fragments, oligos, EMSA'),
      noun: 'DNA', stain: 'polyacrylamide gel' },
    { id: 'southern', kind: 'dna', ladder: 'gr1kb', darkBands: true, minMarkerBands: 5, unit: 'kb',
      name: () => L('Southern 印迹', 'Southern blot'), hint: () => L('探针杂交，放射自显影或化学发光', 'Probe hybridisation, autoradiography or chemiluminescence'),
      noun: 'DNA', stain: 'Southern blot' },
    { id: 'rna', kind: 'rna', ladder: 'ribohigh', darkBands: null, minMarkerBands: 5,
      name: () => L('RNA 凝胶 / Northern 印迹', 'RNA gel / Northern blot'), hint: () => L('变性琼脂糖、尿素 PAGE、Northern', 'Denaturing agarose, urea-PAGE, Northern'),
      noun: 'RNA', stain: 'denaturing gel' },
    { id: 'sds-page', kind: 'protein', ladder: 'pr26619', darkBands: true, minMarkerBands: 6,
      name: () => L('蛋白 SDS-PAGE', 'Protein SDS-PAGE'), hint: () => L('考马斯亮蓝、银染、免染 (stain-free)', 'Coomassie, silver, stain-free'),
      noun: 'protein', stain: 'SDS-PAGE gel' },
    { id: 'native-page', kind: 'native', ladder: 'nativemark', darkBands: true, minMarkerBands: 4,
      name: () => L('非变性 / 蓝绿温和 PAGE', 'Native / Blue native PAGE'), hint: () => L('蛋白复合物、寡聚状态', 'Protein complexes, oligomeric state'),
      noun: 'protein', stain: 'native gel' },
    { id: 'western', kind: 'protein', ladder: 'pr26619', darkBands: true, minMarkerBands: 6, western: true,
      name: () => L('Western 印迹', 'Western blot'), hint: () => L('化学发光 / 荧光；可另载 Marker 白光图', 'Chemiluminescence / fluorescence; optional white-light marker image'),
      noun: 'protein', stain: 'Western blot' }
  ];
  const get = id => TYPES.find(t => t.id === id) || TYPES[0];
  // what the size column of a figure is called
  const unitOf = id => { const t = get(id); return t.unit || G.Ladders.KIND_UNIT[t.kind]; };
  const sizeNoun = kind => (kind === 'dna' ? L('片段大小', 'Fragment size') : kind === 'rna' ? L('转录本大小', 'Transcript size') : L('分子量', 'Molecular weight'));
  G.Gels = { TYPES, get, unitOf, sizeNoun };
})(window);
