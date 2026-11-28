/* =====================================================================
 * OptiSim FTTx Lab — labs.js
 * Auteur : Hassami COMPAORE
 * Contenu pédagogique embarqué : documentation / cours FTTx,
 * bibliothèque de 9 TP prêts à l'emploi et topologies d'exemple.
 * ===================================================================== */
(function (global) {
  'use strict';
  /** Version élève : consignes sans les outils réservés à l'enseignant (voir edition.js). */
  const ELEVE = !!(global.OptiEdition && global.OptiEdition.role === 'eleve');
  const { CATALOG, CABLES, mduLevels, deviceSize } = global.OptiPhysics;

  /* ------------------------------------------------------------------ */
  /*  Petit constructeur de topologies                                    */
  /* ------------------------------------------------------------------ */
  class Topo {
    constructor() { this.devices = []; this.links = []; this.n = 0; }
    dev(type, x, y, props = {}, extra = {}) {
      const id = type + '-' + (++this.n);
      const d = Object.assign({ id, type, x, y, props: Object.assign(JSON.parse(JSON.stringify(CATALOG[type].defaults)), props) }, extra);
      if (type === 'ont' && !d.props.sn) d.props.sn = global.OptiPhysics.autoSerial(id);
      this.devices.push(d);
      return id;
    }
    get(id) { return this.devices.find(d => d.id === id); }
    /** Place un équipement centré verticalement dans un étage d'immeuble. */
    inFloor(bld, floor, type, x, props = {}) {
      const b = this.get(bld);
      const lv = mduLevels(b).find(l => l.floor === floor);
      const tmp = { type, props: Object.assign({}, CATALOG[type].defaults, props) };
      const h = deviceSize(tmp).h;
      return this.dev(type, b.x + x, Math.round(lv.y0 + (lv.y1 - lv.y0 - h) / 2 - 6), props);
    }
    /**
     * Ajoute un local (logement, bureau, pièce…) dans un bâtiment.
     * x, w : position et largeur relatives au bâtiment ; opts.floor pour un étage
     * d'immeuble (toute la hauteur de l'étage), sinon opts.y / opts.h relatifs au bâtiment.
     */
    room(bld, name, kind, x, w, opts = {}) {
      const b = this.get(bld);
      let y, h;
      if (b.type === 'bld_mdu') { const lv = mduLevels(b).find(l => l.floor === opts.floor); y = lv.y0 + 3; h = lv.y1 - lv.y0 - 6; }
      else { y = b.y + (opts.y !== undefined ? opts.y : 36); h = opts.h !== undefined ? opts.h : b.h - 36 - 6; }
      return this.dev('local', b.x + x, y, { name, kind }, { w, h });
    }
    link(type, a, ap, b, bp, opts = {}) {
      const id = 'L' + (++this.n);
      this.links.push(Object.assign({ id, type, a: { dev: a, port: ap }, b: { dev: b, port: bp } }, JSON.parse(JSON.stringify(CABLES[type].defaults)), opts));
      return id;
    }
    json() { return { version: 1, devices: this.devices, links: this.links }; }
  }

  /* ------------------------------------------------------------------ */
  /*  TOPOLOGIES DES TP                                                   */
  /* ------------------------------------------------------------------ */

  function tp1(full) {
    const t = new Topo();
    const sw = t.dev('switch', 60, 250, { name: 'Switch cœur NRO', role: 'coeur', txPower: -3, wavelength: 1310, sfpPorts: 2, ethPorts: 4 });
    const odf = t.dev('odf', 300, 220, { name: 'ODF de tête NRO', ports: 12 });
    const bat = t.dev('bld_simple', 640, 150, { name: 'Bâtiment administratif (Mairie)', kind: 'Bâtiment administratif', gaineLength: 0 }, { w: 640, h: 320 });
    const odfB = t.dev('odf_int', 680, 230, { name: 'ODF d\'entrée', ports: 12 });
    const swC = t.dev('switch', 920, 255, { name: 'Switch client', role: 'acces', txPower: -3, sensitivity: -20, overload: -3, wavelength: 1310, sfpPorts: 1, ethPorts: 4 });
    const pc = t.dev('pc', 1130, 230, { name: 'PC secrétariat' });
    const ph = t.dev('phone', 1130, 340, { name: 'Tél. IP accueil' });
    t.link('patch', sw, 0, odf, 0, { length: 2 });
    t.link('smf', odf, 0, odfB, 0, { length: 4000, fibers: 12 });
    if (full) {
      t.link('patch', odfB, 0, swC, 0, { length: 3 });
      t.link('cat6', swC, 1, pc, 0, { length: 12 });
      t.link('cat6', swC, 2, ph, 0, { length: 8 });
    }
    t.room(bat, 'Local technique', 'Local technique', 20, 410);
    t.room(bat, 'Secrétariat', 'Bureau', 450, 175);
    return t.json();
  }

  function tp2(full) {
    const t = new Topo();
    const olt = t.dev('olt', 40, 300, { name: 'OLT NRO', txPower: 4, wavelength: 1490 });
    const odf = t.dev('odf', 220, 260, { name: 'ODF NRO' });
    const sro = t.dev('sro', 470, 250, { name: 'SRO Quartier Nord', splitter: '1:32', outPorts: 32 });
    const pbo = t.dev('pbo_ext', 730, 290, { name: 'PBO poteau P12', capacity: 8, mount: 'Aérien (poteau)' });
    const villa = t.dev('bld_simple', 960, 170, { name: 'Villa Les Tilleuls', kind: 'Villa / Pavillon', gaineLength: 15 }, { w: 660, h: 320 });
    const pto = t.dev('pto', 1000, 300, { name: 'PTO salon' });
    const ont = t.dev('ont', 1170, 290, { name: 'ONT Villa' });
    const rtr = t.dev('router', 1340, 230, { name: 'Routeur Wi-Fi' });
    const pc = t.dev('pc', 1490, 236, { name: 'PC bureau' });
    const tv = t.dev('tv', 1490, 380, { name: 'Décodeur TV' });
    t.link('patch', olt, 0, odf, 0, { length: 2 });
    t.link('smf', odf, 0, sro, 0, { length: 3000, fibers: 48 });
    t.link('smf', sro, 0, pbo, 0, { length: 800, fibers: 12 });
    if (full) {
      t.link('drop', pbo, 0, pto, 0, { length: 45 });
      t.link('patch', pto, 0, ont, 0, { length: 2 });
    }
    t.link('cat6', ont, 0, rtr, 0, { length: 2 });
    t.link('cat6', rtr, 0, pc, 0, { length: 6 });
    t.link('cat6', rtr, 1, tv, 0, { length: 3 });
    t.room(villa, 'Séjour', 'Pièce', 20, 490);
    t.room(villa, 'Bureau', 'Pièce', 515, 140, { y: 36, h: 140 });
    t.room(villa, 'Salon', 'Pièce', 515, 140, { y: 180, h: 134 });
    return t.json();
  }

  function mduTopo(full, opts) {
    const t = new Topo();
    const olt = t.dev('olt', 30, 760, { name: 'OLT NRO', txPower: 4, wavelength: 1490 });
    const odf = t.dev('odf', 210, 730, { name: 'ODF NRO' });
    const b = t.dev('bld_mdu', 520, 40, { name: opts.name, usage: 'Résidentiel', floors: 3, basement: true, floorHeight: 3 }, { w: 760, floorPx: 170 });
    const pmi = t.inFloor(b, -1, 'pmi', 110, { name: 'PMI sous-sol', splitter: opts.splitter, outPorts: 12 });
    const pbo = {}, pto = {}, ont = {};
    for (const f of [1, 2, 3]) {
      pbo[f] = t.inFloor(b, f, 'pbo_int', 110, { name: `PBO étage ${f}`, capacity: 6 });
      pto[f] = t.inFloor(b, f, 'pto', 380, { name: `PTO Appt ${f}01` });
      ont[f] = t.inFloor(b, f, 'ont', 560, { name: `ONT Appt ${f}01` });
    }
    t.link('patch', olt, 0, odf, 0, { length: 2 });
    t.link('smf', odf, 0, pmi, 0, { length: 2500, fibers: 24 });
    const r1 = t.link('riser', pmi, 0, pbo[1], 0, { jointA: 'fusion', jointB: 'none', fibers: 24 });
    const r2 = t.link('riser', pbo[1], 0, pbo[2], 0, { jointA: 'none', jointB: 'none', fibers: 24 });
    const links = { r1, r2 };
    for (const f of [1, 2]) {
      links['h' + f] = t.link('lszh', pbo[f], 1, pto[f], 0, { length: 15 });
      t.link('patch', pto[f], 0, ont[f], 0, { length: 2 });
    }
    if (full) {
      links.r3 = t.link('riser', pbo[2], 0, pbo[3], 0, { jointA: 'none', jointB: 'none', fibers: 24 });
      links.h3 = t.link('lszh', pbo[3], 1, pto[3], 0, { length: 15 });
      t.link('patch', pto[3], 0, ont[3], 0, { length: 2 });
    }
    for (const f of [1, 2, 3]) {
      t.room(b, 'Palier', 'Parties communes', 100, 240, { floor: f });
      t.room(b, `Appt ${f}01`, 'Logement', 360, 390, { floor: f });
    }
    t.room(b, 'Hall d\'entrée', 'Parties communes', 100, 650, { floor: 0 });
    t.room(b, 'Local technique', 'Local technique', 100, 250, { floor: -1 });
    t.room(b, 'Caves', 'Parties communes', 360, 390, { floor: -1 });
    return { t, links, pto, ont, pbo };
  }

  function tp3(full) { return mduTopo(full, { name: 'Résidence Les Érables (R+3)', splitter: '1:32' }).t.json(); }

  function tp4(full) {
    const t = new Topo();
    const sw = t.dev('switch', 40, 330, { name: 'Switch cœur opérateur', role: 'coeur', txPower: -3, wavelength: 1310, sfpPorts: 2, ethPorts: 0 });
    const odf = t.dev('odf', 230, 290, { name: 'ODF NRO' });
    const b = t.dev('bld_mdu', 520, 50, { name: 'Siège Société TechnoSud (R+2)', usage: 'Bureaux', floors: 2, basement: false, floorHeight: 3 }, { w: 800, floorPx: 170 });
    const odfR = t.inFloor(b, 0, 'odf_int', 90, { name: 'ODF local technique' });
    const odf1 = t.inFloor(b, 1, 'odf_int', 90, { name: 'ODF d\'étage 1', ports: 12 });
    const odf2 = t.inFloor(b, 2, 'odf_int', 90, { name: 'ODF d\'étage 2', ports: 12 });
    const acc = { role: 'acces', txPower: -3, sensitivity: -20, overload: -3, wavelength: 1310, sfpPorts: 1, ethPorts: 4 };
    const sw1 = t.inFloor(b, 1, 'switch', 320, Object.assign({ name: 'Switch étage 1' }, acc));
    const sw2 = t.inFloor(b, 2, 'switch', 320, Object.assign({ name: 'Switch étage 2' }, acc));
    const pc1 = t.inFloor(b, 1, 'pc', 520, { name: 'PC compta' });
    const tel1 = t.inFloor(b, 1, 'phone', 660, { name: 'Tél. IP compta' });
    const pc2 = t.inFloor(b, 2, 'pc', 520, { name: 'PC direction' });
    const tel2 = t.inFloor(b, 2, 'phone', 660, { name: 'Tél. IP direction' });
    t.link('patch', sw, 0, odf, 0, { length: 2 });
    t.link('patch', sw, 1, odf, 1, { length: 2 });
    t.link('smf', odf, 0, odfR, 0, { length: 6000, fibers: 12 });
    t.link('smf', odf, 1, odfR, 1, { length: 6000, fibers: 12 });
    t.link('riser', odfR, 0, odf2, 0, { jointA: 'fusion', jointB: 'fusion', fibers: 12 });
    t.link('riser', odfR, 1, odf1, 0, { jointA: 'fusion', jointB: 'fusion', fibers: 12 });
    t.link('patch', odf1, 0, sw1, 0, { length: 2 });
    t.link('cat6', sw1, 1, pc1, 0, { length: 15 });
    t.link('cat6', sw1, 2, tel1, 0, { length: 20 });
    if (full) {
      t.link('patch', odf2, 0, sw2, 0, { length: 2 });
      t.link('cat6', sw2, 1, pc2, 0, { length: 18 });
      t.link('cat6', sw2, 2, tel2, 0, { length: 22 });
    }
    t.room(b, 'Local technique', 'Local technique', 80, 250, { floor: 0 });
    t.room(b, 'Accueil', 'Bureau', 350, 440, { floor: 0 });
    t.room(b, 'Local télécom', 'Local technique', 80, 380, { floor: 1 });
    t.room(b, 'Comptabilité', 'Bureau', 480, 310, { floor: 1 });
    t.room(b, 'Local télécom', 'Local technique', 80, 380, { floor: 2 });
    t.room(b, 'Direction', 'Bureau', 480, 310, { floor: 2 });
    return t.json();
  }

  function tp5() {
    const m = mduTopo(true, { name: 'Résidence Le Belvédère (R+3)', splitter: '1:64' });
    const L = id => m.t.links.find(l => l.id === id);
    L(m.links.r3).fault = { type: 'cut', pos: 1.5, hidden: true };
    L(m.links.h1).fault = { type: 'bend', pos: 8, hidden: true };
    m.t.get(m.pto[2]).fault = { type: 'dirty', hidden: true };
    return m.t.json();
  }

  /** Exemple Recette : immeuble en mode réaliste, un logement avec un défaut caché. */
  function exRecette() {
    const m = mduTopo(true, { name: 'Résidence Les Platanes (R+3)', splitter: '1:32' });
    m.t.get(m.pto[2]).fault = { type: 'dirty', hidden: true };
    const j = m.t.json();
    j.recette = { actif: true, graine: 2026, seuils: { acceptable: 0.5, controle: 1, marge: 3, suspect: 2 }, mesures: {} };
    return j;
  }

  function exFTTB() {
    const t = new Topo();
    const olt = t.dev('olt', 30, 760, { name: 'OLT NRO' });
    const odf = t.dev('odf', 210, 730, { name: 'ODF NRO' });
    const sro = t.dev('sro', 400, 740, { name: 'SRO', splitter: '1:16', outPorts: 16 });
    const b = t.dev('bld_mdu', 640, 40, { name: 'Immeuble FTTB (R+3)', usage: 'Bureaux', floors: 3, basement: true }, { w: 640, floorPx: 170 });
    const odfI = t.inFloor(b, -1, 'odf_int', 90, { name: 'ODF pied d\'immeuble' });
    const onu = t.inFloor(b, -1, 'ont', 300, { name: 'ONU d\'immeuble' });
    const pcs = [1, 2, 3].map(f => t.inFloor(b, f, 'pc', 460, { name: `PC étage ${f}` }));
    t.link('patch', olt, 0, odf, 0, { length: 2 });
    t.link('smf', odf, 0, sro, 0, { length: 1800 });
    t.link('smf', sro, 0, odfI, 0, { length: 350 });
    t.link('patch', odfI, 0, onu, 0, { length: 2 });
    [25, 32, 40].forEach((len, i) => t.link('cat6', onu, i, pcs[i], 0, { length: len }));
    t.room(b, 'Local technique', 'Local technique', 80, 360, { floor: -1 });
    t.room(b, 'Hall', 'Parties communes', 80, 550, { floor: 0 });
    [1, 2, 3].forEach(f => t.room(b, `Plateau étage ${f}`, 'Bureau', 440, 190, { floor: f }));
    return t.json();
  }

  function exCampus() {
    const t = new Topo();
    const b = t.dev('bld_simple', 40, 120, { name: 'Lycée — Bâtiment A', kind: 'Bureau RDC', gaineLength: 0 }, { w: 420, h: 300 });
    const b2 = t.dev('bld_simple', 820, 120, { name: 'Lycée — Bâtiment B', kind: 'Bureau RDC', gaineLength: 0 }, { w: 420, h: 300 });
    const sw = t.dev('switch', 80, 220, { name: 'Switch cœur A', role: 'coeur', wavelength: 850, fiberMode: 'Multimode (MM)', txPower: -5, sfpPorts: 1, ethPorts: 2 });
    const odfA = t.dev('odf_int', 270, 200, { name: 'ODF A', connector: 'LC/UPC' });
    const odfB = t.dev('odf_int', 860, 200, { name: 'ODF B', connector: 'LC/UPC' });
    const swB = t.dev('switch', 1060, 220, { name: 'Switch B', role: 'acces', wavelength: 850, fiberMode: 'Multimode (MM)', txPower: -5, sensitivity: -17, overload: -1, sfpPorts: 1, ethPorts: 2 });
    const pc = t.dev('pc', 1060, 330, { name: 'Salle info B' });
    t.link('patch', sw, 0, odfA, 0, { length: 2, connector: 'LC/UPC' });
    t.link('om3', odfA, 0, odfB, 0, { length: 250, jointA: 'fusion', jointB: 'fusion' });
    t.link('patch', odfB, 0, swB, 0, { length: 2, connector: 'LC/UPC' });
    t.link('cat6', swB, 1, pc, 0, { length: 30 });
    t.room(b, 'Salle serveurs', 'Local technique', 20, 380);
    t.room(b2, 'Local technique', 'Local technique', 20, 170);
    t.room(b2, 'Salle informatique', 'Pièce', 220, 180);
    return t.json();
  }

  /* ------------------------------------------------------------------ */
  /*  Autres usages de la fibre : nœuds actifs, datacenter, industrie      */
  /* ------------------------------------------------------------------ */

  /** TP 13 — Fibre vers les nœuds actifs : site mobile (backhaul + fronthaul FTTA) et armoire de rue. */
  function tp13(full) {
    const t = new Topo();
    const agg = t.dev('switch', 40, 250, { name: 'Switch d\'agrégation (central)', role: 'coeur', txPower: -3, wavelength: 1310, fiberMode: 'Monomode (SM)', sfpPorts: 2, ethPorts: 0 });
    const odfC = t.dev('odf', 260, 225, { name: 'ODF du central', ports: 12, connector: 'LC/UPC' });
    const sh = t.dev('bld_simple', 600, 90, { name: 'Site radio P27 — shelter', kind: 'Shelter de site radio', gaineLength: 5 }, { w: 600, h: 430 });
    const odfS = t.dev('odf_int', 630, 170, { name: 'ODF du shelter', ports: 12, connector: 'LC/UPC' });
    const csr = t.dev('switch', 860, 170, { name: 'Routeur de site (CSR)', role: 'acces', txPower: -3, sensitivity: -14.4, overload: 0.5, wavelength: 1310, fiberMode: 'Monomode (SM)', sfpPorts: 1, ethPorts: 2 });
    const bbu = t.dev('bbu', 640, 340, { name: 'BBU du site', txPower: -1, wavelength: 1310, sfpPorts: 3 });
    const pt = [], rrh = [];
    for (let k = 0; k < 3; k++) {
      pt.push(t.dev('coupler', 970, 265 + k * 78, { name: `Traversée pied de pylône S${k + 1}`, connector: 'LC/UPC', connLoss: 0.5 }));
      rrh.push(t.dev('rrh', 1360, 120 + k * 150, { name: `RRH secteur ${k + 1}`, secteur: ['Azimut 0°', 'Azimut 120°', 'Azimut 240°'][k] }));
    }
    const pa = t.dev('coupler', 640, 610, { name: 'Traversée armoire de rue', connector: 'LC/UPC', connLoss: 0.5 });
    const msan = t.dev('msan', 880, 595, { name: 'Armoire MSAN rue Pasteur', sensitivity: -20, overload: -3 });
    t.link('patch', agg, 0, odfC, 0, { length: 2, connector: 'LC/UPC' });
    t.link('patch', agg, 1, odfC, 1, { length: 2, connector: 'LC/UPC' });
    t.link('smf', odfC, 0, odfS, 0, { length: 6000, fibers: 12 });
    t.link('patch', odfS, 0, csr, 0, { length: 2, connector: 'LC/UPC' });
    for (let k = 0; k < 3; k++) {
      t.link('patch', bbu, k, pt[k], 0, { length: 3, connector: 'LC/UPC' });
      if (full) t.link('ftta', pt[k], 0, rrh[k], 0, { length: 45 });
    }
    t.link('smf', odfC, 1, pa, 0, { length: 3000, fibers: 12, jointA: 'fusion', jointB: 'fusion' });
    if (full) t.link('patch', pa, 0, msan, 0, { length: 1, connector: 'LC/UPC' });
    t.room(sh, 'Baie télécom', 'Local technique', 20, 520);
    return t.json();
  }

  /** TP 14 — Datacenter : liaisons leaf-spine et serveurs en OM4 par cassettes MPO. */
  function tp14(full) {
    const t = new Topo();
    const dc = t.dev('bld_simple', 30, 100, { name: 'Datacenter — salle informatique', kind: 'Salle informatique / datacenter', gaineLength: 0 }, { w: 1540, h: 420 });
    const spine = t.dev('switch', 70, 200, { name: 'Switch spine A1', role: 'coeur', txPower: -2.5, wavelength: 850, fiberMode: 'Multimode (MM)', sfpPorts: 2, ethPorts: 0 });
    const casA = t.dev('mpo_cassette', 280, 190, { name: 'Cassette A1', side: 'lc-mpo', grade: 'faible' });
    const casB = t.dev('mpo_cassette', 570, 190, { name: 'Cassette B4 (spine)', side: 'mpo-lc', grade: 'faible' });
    const leaf = t.dev('switch', 780, 200, { name: 'Switch leaf B4', role: 'acces', txPower: -2.5, sensitivity: -9.9, overload: -1, wavelength: 850, fiberMode: 'Multimode (MM)', sfpPorts: 2, ethPorts: 0 });
    const casC = t.dev('mpo_cassette', 990, 190, { name: 'Cassette B4 (serveurs)', side: 'lc-mpo', grade: 'standard' });
    const casD = t.dev('mpo_cassette', 1210, 190, { name: 'Cassette C2', side: 'mpo-lc', grade: 'standard' });
    const s1 = t.dev('server', 1410, 190, { name: 'Serveur C2-01' });
    const s2 = t.dev('server', 1410, 330, { name: 'Serveur C2-02' });
    t.link('patch', spine, 0, casA, 0, { length: 2, connector: 'LC/UPC' });
    if (full) t.link('mpo', casA, 0, casB, 0, { length: 60 });
    t.link('patch', casB, 0, leaf, 0, { length: 2, connector: 'LC/UPC' });
    t.link('patch', leaf, 0, casC, 0, { length: 2, connector: 'LC/UPC' });
    t.link('mpo', casC, 0, casD, 0, { length: 40 });
    t.link('patch', casD, 0, s1, 0, { length: 3, connector: 'LC/UPC' });
    if (full) t.link('patch', casD, 1, s2, 0, { length: 3, connector: 'LC/UPC' });
    t.room(dc, 'Baie A1 — spine', 'Baie informatique', 20, 460);
    t.room(dc, 'Baie B4 — leaf', 'Baie informatique', 500, 660);
    t.room(dc, 'Baie C2 — serveurs', 'Baie informatique', 1180, 340);
    return t.json();
  }

  /** Exemple Usine : dorsale fibre du local technique vers les ateliers (multimode et monomode). */
  function exUsine() {
    const t = new Topo();
    const u = t.dev('bld_simple', 30, 90, { name: 'Usine — bâtiment principal', kind: 'Usine / atelier', gaineLength: 0 }, { w: 900, h: 560 });
    const ab = t.dev('bld_simple', 1080, 90, { name: 'Atelier B — assemblage', kind: 'Usine / atelier', gaineLength: 10 }, { w: 520, h: 560 });
    const swS = t.dev('switch', 60, 170, { name: 'Switch de cœur (SM)', role: 'coeur', txPower: -3, wavelength: 1310, fiberMode: 'Monomode (SM)', sfpPorts: 1, ethPorts: 0 });
    const swM = t.dev('switch', 60, 330, { name: 'Switch de cœur (MM)', role: 'coeur', txPower: -5, wavelength: 850, fiberMode: 'Multimode (MM)', sfpPorts: 1, ethPorts: 0 });
    const odfL = t.dev('odf_int', 250, 200, { name: 'ODF local technique', ports: 12, connector: 'LC/UPC' });
    const odfA = t.dev('odf_int', 560, 360, { name: 'ODF atelier A', ports: 12, connector: 'LC/UPC' });
    const swA = t.dev('switch_ind', 740, 360, { name: 'Switch atelier A', fiberMode: 'Multimode (MM)', sensitivity: -17, overload: -1, ethPorts: 4, indice: 'IP40' });
    const a1 = t.dev('automate', 740, 470, { name: 'Automate presse 1' });
    const a2 = t.dev('automate', 740, 570, { name: 'Automate presse 2' });
    const odfB = t.dev('odf_int', 1110, 200, { name: 'ODF atelier B', ports: 12, connector: 'LC/UPC' });
    const swB = t.dev('switch_ind', 1310, 200, { name: 'Switch atelier B', fiberMode: 'Monomode (SM)', sensitivity: -20, overload: -3, ethPorts: 4, indice: 'IP67' });
    const b1 = t.dev('automate', 1310, 330, { name: 'Robot d\'assemblage' });
    const b2 = t.dev('automate', 1450, 430, { name: 'Poste de supervision' });
    t.link('patch', swS, 0, odfL, 0, { length: 2, connector: 'LC/UPC' });
    t.link('patch', swM, 0, odfL, 1, { length: 2, connector: 'LC/UPC' });
    t.link('om3', odfL, 1, odfA, 1, { length: 120, jointA: 'fusion', jointB: 'fusion' });
    t.link('patch', odfA, 1, swA, 0, { length: 2, connector: 'LC/UPC' });
    t.link('cat6', swA, 0, a1, 0, { length: 25 });
    t.link('cat6', swA, 1, a2, 0, { length: 40 });
    t.link('smf', odfL, 0, odfB, 0, { length: 800, fibers: 12 });
    t.link('patch', odfB, 0, swB, 0, { length: 2, connector: 'LC/UPC' });
    t.link('cat6', swB, 0, b1, 0, { length: 30 });
    t.link('cat6', swB, 1, b2, 0, { length: 60 });
    t.room(u, 'Local technique', 'Local technique', 20, 450);
    t.room(u, 'Atelier A — usinage', 'Atelier', 500, 380);
    t.room(ab, 'Atelier B — assemblage', 'Atelier', 20, 480);
    return t.json();
  }

  /* ------------------------------------------------------------------ */
  /*  Couche service : mise en service FTTH (GPON) et Active Ethernet     */
  /* ------------------------------------------------------------------ */
  const SN_TP10 = 'ALCL1A2B3C4D';

  /** TP 10 — Mise en service FTTH : collecte PPPoE, OLT, ONT, Box, 3 services. */
  function tp10(full) {
    const t = new Topo();
    const col = t.dev('collecte', 30, 250, { name: 'Routeur de collecte', accessMode: 'pppoe',
      accounts: [{ login: 'dupont@optisim', password: 'Fibre-2026' }, { login: 'martin@optisim', password: 'Opti-75' }] });
    const olt = t.dev('olt', 230, 250, { name: 'OLT NRO', onts: full ? [{ sn: SN_TP10, profile: 'trio' }] : [] });
    const odf = t.dev('odf', 430, 200, { name: 'ODF NRO' });
    const sro = t.dev('sro', 640, 230, { name: 'SRO Quartier Est', splitter: '1:32', outPorts: 32 });
    const pbo = t.dev('pbo_ext', 850, 250, { name: 'PBO poteau P7', capacity: 8 });
    const maison = t.dev('bld_simple', 1050, 130, { name: 'Maison Dupont', kind: 'Villa / Pavillon', gaineLength: 15 }, { w: 740, h: 380 });
    const pto = t.dev('pto', 1080, 260, { name: 'PTO séjour' });
    const ont = t.dev('ont', 1250, 250, { name: 'ONT Dupont', sn: SN_TP10 });
    const box = t.dev('router', 1430, 250, Object.assign({ name: 'Box Dupont' }, full
      ? { wanMode: 'pppoe', pppLogin: 'dupont@optisim', pppPassword: 'Fibre-2026' }
      : { wanMode: 'dhcp', pppLogin: '', pppPassword: '', vlanTv: 210 }));
    const pc = t.dev('pc', 1630, 192, { name: 'PC salon' });
    const tv = t.dev('tv', 1630, 306, { name: 'Décodeur TV' });
    const ph = t.dev('phone', 1630, 420, { name: 'Téléphone' });
    t.link('uplink', col, 0, olt, 0, { length: 15 });
    t.link('patch', olt, 0, odf, 0, { length: 2 });
    t.link('smf', odf, 0, sro, 0, { length: 3000, fibers: 48 });
    t.link('smf', sro, 0, pbo, 0, { length: 800, fibers: 12 });
    t.link('drop', pbo, 0, pto, 0, { length: 45 });
    t.link('patch', pto, 0, ont, 0, { length: 2 });
    t.link('cat6', ont, 0, box, 0, { length: 2 });
    t.link('cat6', box, 0, pc, 0, { length: 6 });
    t.link('cat6', box, 1, tv, 0, { length: 4 });
    t.link('cat6', box, 2, ph, 0, { length: 8 });
    t.room(maison, 'Séjour', 'Pièce', 15, 500);
    t.room(maison, 'Salon', 'Pièce', 560, 165, { y: 36, h: 224 });
    t.room(maison, 'Entrée', 'Pièce', 560, 165, { y: 264, h: 110 });
    return t.json();
  }

  /** TP 11 — Active Ethernet (AON) : raccordement d'une entreprise en point à point. */
  function tp11(full) {
    const t = new Topo();
    const col = t.dev('collecte', 30, 250, { name: 'Routeur de collecte', accessMode: 'dhcp' });
    const sw = t.dev('switch_aon', 230, 210, { name: 'Switch AON NRO',
      ports: full ? [{ enabled: true, profile: 'internet-1g' }, { enabled: true, profile: 'duo' }, { enabled: true, profile: 'trio' }] : [{ enabled: true, profile: 'internet-1g' }, { enabled: true, profile: 'duo' }] });
    const odf = t.dev('odf', 440, 210, { name: 'ODF NRO' });
    const ent = t.dev('bld_simple', 720, 120, { name: 'Entreprise Lumitech', kind: 'Bureau RDC', gaineLength: 10 }, { w: 760, h: 400 });
    const pto = t.dev('pto', 750, 260, { name: 'PTO local technique' });
    const ont = t.dev('ont', 920, 250, { name: 'CPE fibre (ONT)', sensitivity: -22, overload: -3 });
    const box = t.dev('router', 1100, 250, { name: 'Routeur Lumitech', lanIp: '192.168.10.1', lanPrefix: 24, dhcp: false, dhcpStart: '192.168.10.100', dhcpEnd: '192.168.10.150', ssid: 'Lumitech' });
    const pc = t.dev('pc', 1300, 190, { name: 'PC accueil', ipMode: 'static', ip: '192.168.10.20', prefix: 24, gateway: full ? '192.168.10.1' : '192.168.10.254' });
    const ph = t.dev('phone', 1300, 340, { name: 'Téléphone accueil', ipMode: 'static', ip: '192.168.10.21', prefix: 24, gateway: '192.168.10.1' });
    if (full) t.link('uplink', col, 0, sw, 0, { length: 10 });
    t.link('patch', sw, 2, odf, 2, { length: 2 });
    t.link('smf', odf, 2, pto, 0, { length: 1500, fibers: 12 });
    t.link('patch', pto, 0, ont, 0, { length: 2 });
    t.link('cat6', ont, 0, box, 0, { length: 3 });
    t.link('cat6', box, 0, pc, 0, { length: 15 });
    t.link('cat6', box, 1, ph, 0, { length: 12 });
    t.room(ent, 'Local technique', 'Local technique', 15, 500);
    t.room(ent, 'Accueil', 'Bureau', 560, 185);
    return t.json();
  }

  /* ------------------------------------------------------------------ */
  /*  BIBLIOTHÈQUE DE TP                                                  */
  /* ------------------------------------------------------------------ */
  const LABS = [
    {
      id: 'tp1', num: 1, title: 'Liaison point-à-point (P2P) avec brassage ODF', archi: 'P2P / FTTO', duration: '1 h', level: 'Découverte', public: 'Bac Pro · Licence',
      objectives: ['Identifier les éléments d\'une liaison optique point-à-point', 'Réaliser un brassage sur un ODF par jarretière', 'Calculer l\'atténuation totale et la puissance reçue', 'Vérifier la mesure au photomètre'],
      context: 'La mairie de la commune doit être raccordée en fibre dédiée (P2P) au NRO situé à 4 km. Le switch cœur du NRO est déjà relié à l\'ODF de tête et le câble de 4 km est tiré et épissuré jusqu\'à l\'ODF d\'entrée du bâtiment administratif. Il reste à brasser le switch client.',
      steps: [
        'Cliquez sur « Charger la topologie du TP ». Observez le NRO (à gauche) et le bâtiment administratif (à droite).',
        'Sélectionnez le câble de 4 km : relevez dans l\'inspecteur son type, sa longueur et ses modes de raccordement (épissures fusion).',
        'Dans la boîte à outils, choisissez « Jarretière optique », cliquez sur l\'ODF d\'entrée puis sur le Switch client. Validez une longueur de 3 m, connecteurs SC/APC.',
        'Reliez le switch client au PC et au téléphone IP avec des câbles « Ethernet RJ45 Cat6 ». Les badges doivent passer au vert.',
        'Passez en mode « Mesure / Test », choisissez le Photomètre et cliquez sur le Switch client. Relevez la puissance reçue.',
        'Ouvrez l\'onglet « Bilan » de l\'inspecteur et comparez avec votre calcul.',
        'Expérience : sélectionnez la jarretière côté client et changez son port amont (Aval 2 au lieu de Aval 1). Que se passe-t-il ? Remettez le port 1.'
      ],
      questions: [
        { q: 'Quel est le rôle d\'un ODF ? Que signifient les côtés « amont » et « aval » ?', a: '' },
        { q: 'Calculez l\'atténuation de la fibre de 4 km à 1310 nm.', a: '' },
        { q: 'Calculez l\'atténuation totale de la liaison (2 traversées d\'ODF à 0,5 dB, 2 épissures fusion à 0,05 dB, jarretières négligeables).', a: '' },
        { q: 'Le SFP émet à −3 dBm. Quelle puissance reçoit le switch client ?', a: '' },
        { q: 'La sensibilité du récepteur est de −20 dBm. Quelle est la marge ? La liaison est-elle correcte ?', a: '' },
        { q: 'Que se passe-t-il si la jarretière est branchée sur le port Aval 2 de l\'ODF ? Comment appelle-t-on ce défaut ?', a: '' }
      ],
      topology: tp1
    },
    {
      id: 'tp2', num: 2, title: 'FTTH pavillonnaire : raccordement d\'une villa via PBO extérieur', archi: 'FTTH', duration: '1 h 30', level: 'Intermédiaire', public: 'Bac Pro · Licence',
      objectives: ['Comprendre la chaîne NRO → SRO → PBO → PTO → ONT', 'Poser un câble drop et raccorder la PTO', 'Intégrer la perte d\'un coupleur dans le bilan', 'Interpréter les voyants de l\'ONT'],
      context: 'Un client de la Villa « Les Tilleuls » souscrit un abonnement fibre. Le réseau de distribution est en place jusqu\'au PBO aérien (poteau P12). Le technicien doit tirer le câble de branchement (drop) jusqu\'à la PTO du salon puis installer l\'ONT.',
      steps: [
        'Chargez la topologie. Repérez l\'OLT, l\'ODF du NRO, le SRO (coupleur 1:32) et le PBO aérien.',
        'Sélectionnez la villa : notez la longueur de gaine intérieure (adduction → PTO).',
        'Outil « Câble Drop extérieur » : cliquez sur le PBO puis sur la PTO. Saisissez 45 m, épissure fusion aux deux extrémités.',
        'Outil « Jarretière optique » : reliez la PTO à l\'ONT (2 m, SC/APC).',
        'Observez les voyants de l\'ONT (PON vert, LOS éteint) et la connexion du routeur, du PC et du décodeur.',
        'Mesurez au photomètre la puissance en sortie du SRO, au PBO, à la PTO et sur l\'ONT.',
        'Expérience : passez le coupleur du SRO en 1:64 et observez la puissance reçue par l\'ONT. Revenez à 1:32.'
      ],
      questions: [
        { q: 'Que signifient NRO, SRO, PBO et PTO ?', a: '' },
        { q: 'Longueur totale du branchement fibre entre le PBO et la PTO ?', a: '' },
        { q: 'Calculez les pertes linéiques à 1490 nm (0,25 dB/km) : transport 3 km, distribution 0,8 km, branchement 60 m.', a: '' },
        { q: 'Faites le bilan complet : ODF 0,5 dB ; SRO (brassage 0,5 dB + coupleur 1:32 17,2 dB) ; 6 épissures fusion ; PTO 0,5 dB.', a: '' },
        { q: 'L\'OLT émet à +4 dBm. Quelle puissance reçoit l\'ONT ? Est-elle dans la plage [−27 ; −8] dBm ?', a: '' },
        { q: 'Avec un coupleur 1:64 (21 dB), que devient la puissance reçue ?', a: '' }
      ],
      topology: tp2
    },
    {
      id: 'tp3', num: 3, title: 'FTTH en immeuble : PMI, colonne montante et PBO d\'étage', archi: 'FTTH (immeuble)', duration: '2 h', level: 'Intermédiaire', public: 'Bac Pro · Licence',
      objectives: ['Identifier PMI, colonne montante et PBO intérieurs', 'Calculer la longueur d\'une colonne montante', 'Réaliser le piquage d\'un PBO d\'étage et le branchement palier', 'Établir un bilan tronçon par tronçon'],
      context: 'La Résidence « Les Érables » (R+3 avec sous-sol) est fibrée. Le PMI est installé au sous-sol avec un coupleur 1:32. La colonne montante dessert les étages 1 et 2. Vous devez prolonger la colonne jusqu\'au 3e étage et raccorder l\'appartement 301.',
      steps: [
        'Chargez la topologie. Repérez la gaine technique (bande en pointillés) et les PBO d\'étage.',
        'Sélectionnez la colonne PMI → PBO étage 1 : vérifiez que la longueur est calculée automatiquement (écart d\'étages × 3 m).',
        'Outil « Câble de colonne montante » : reliez le PBO étage 2 au PBO étage 3 (sortie libre du PBO). Laissez « Longueur auto » coché et choisissez « Aucun » aux deux extrémités (fibre en passage, non coupée).',
        'Outil « Câble intérieur LSZH » : reliez le PBO étage 3 à la PTO Appt 301 (15 m, épissure fusion aux deux extrémités).',
        'Outil « Jarretière » : reliez la PTO 301 à l\'ONT 301.',
        'Sélectionnez l\'ONT 301 et consultez l\'onglet « Bilan » : identifiez chaque catégorie (NRO, extérieur, PMI, colonne, PBO, branchement).',
        'Tirez un OTDR (mode Mesure) sur l\'ONT 301 à 1310 nm et identifiez les événements.'
      ],
      questions: [
        { q: 'Quelle est la différence entre un PMI et un PBO intérieur ?', a: '' },
        { q: 'Le PMI est au sous-sol, le PBO au 3e étage, hauteur d\'étage 3 m. Longueur de colonne ?', a: '' },
        { q: 'Pourquoi utilise-t-on de la fibre G.657A2 dans la colonne et en palier ?', a: '' },
        { q: 'Calculez le bilan jusqu\'à l\'ONT 301 à 1490 nm.', a: '' },
        { q: 'Puissance reçue par l\'ONT 301 ? Conclusion ?', a: '' },
        { q: 'Sur l\'OTDR, quels événements sont réflectifs ? Lesquels sont non réflectifs ?', a: '' }
      ],
      topology: tp3
    },
    {
      id: 'tp4', num: 4, title: 'FTTO : fibre dédiée entreprise avec ODF d\'étage et switchs optiques', archi: 'FTTO', duration: '1 h 30', level: 'Intermédiaire', public: 'Bac Pro · Licence',
      objectives: ['Différencier FTTH, FTTB et FTTO', 'Câbler une distribution FTTO par ODF d\'étage', 'Vérifier le budget optique d\'une liaison SFP', 'Contrôler la connectivité des postes de travail'],
      context: 'La société TechnoSud (immeuble de bureaux R+2) dispose de 2 fibres dédiées depuis le NRO (6 km). Chaque étage possède un ODF d\'étage alimenté par la colonne montante depuis le local technique du RDC. L\'étage 1 est opérationnel ; l\'étage 2 doit être mis en service.',
      steps: [
        'Chargez la topologie. Vérifiez qu\'à l\'étage 1 le PC et le téléphone sont connectés (badges verts).',
        'Étage 2 : avec l\'outil « Jarretière », reliez l\'ODF d\'étage 2 au Switch étage 2.',
        'Reliez le switch d\'étage 2 au PC direction et au téléphone IP direction en Cat6.',
        'Mesurez au photomètre la puissance reçue par chaque switch d\'étage.',
        'Comparez le bilan des deux étages : quelle différence ? pourquoi est-elle faible ?',
        'Expérience : remplacez une jarretière SC/APC par une jarretière SC/UPC (inspecteur du câble). Que signale le simulateur ?'
      ],
      questions: [
        { q: 'Qu\'est-ce qui distingue le FTTO du FTTH ?', a: '' },
        { q: 'Calculez l\'atténuation jusqu\'au switch d\'étage 2 à 1310 nm.', a: '' },
        { q: 'Puissance reçue et marge (Tx −3 dBm, sensibilité −20 dBm) ?', a: '' },
        { q: 'Pourquoi ne faut-il jamais connecter un connecteur APC (vert) avec un UPC (bleu) ?', a: '' },
        { q: 'Dans quel cas utiliserait-on de la fibre multimode OM3/OM4 ?', a: '' }
      ],
      topology: tp4
    },
    {
      id: 'tp5', num: 5, title: 'Diagnostic et dépannage d\'un immeuble FTTH', archi: 'FTTH (dépannage)', duration: '2 h', level: 'Avancé', public: 'Bac Pro · Licence',
      objectives: ['Mettre en œuvre une méthode de dépannage', 'Utiliser photomètre, OTDR et VFL pour localiser un défaut', 'Distinguer coupure, courbure et connecteur sale', 'Rédiger un compte rendu d\'intervention'],
      context: 'Trois abonnés de la Résidence « Le Belvédère » (PMI avec coupleur 1:64) se plaignent : l\'appartement 301 n\'a plus de service, le 101 subit des coupures, le 201 trouve sa connexion moins stable. Les pannes sont cachées : à vous de les localiser !',
      steps: [
        'Chargez la topologie. Calculez d\'abord la puissance théorique attendue sur chaque ONT (bilan sans défaut).',
        'Mode « Mesure / Test » → Photomètre : relevez la puissance sur les 3 ONT, puis remontez PTO → PBO → colonne pour encadrer chaque défaut.',
        'Appt 301 (LOS) : utilisez le VFL depuis le PBO étage 2 (sens aval) : où la lumière rouge s\'échappe-t-elle ?',
        'Tirez un OTDR à 1550 nm sur l\'ONT 301 : relevez la distance de la fin anormale.',
        'Appt 101 : tirez un OTDR à 1310 nm puis à 1550 nm. Comparez la perte de l\'événement sur le câble palier.',
        'Appt 201 : comparez la puissance avant et après la PTO.',
        ELEVE ? 'Mode « Dépannage » : sélectionnez chaque élément défectueux, cliquez sur le bouton d\'intervention (« Reprendre le câble » ou « Nettoyer / remplacer »), puis contrôlez au photomètre.' : 'Mode « Simulation de pannes » : cliquez sur « Révéler » pour vérifier, puis « Réparer » chaque défaut et contrôlez au photomètre.'
      ],
      questions: [
        { q: 'Quelle puissance théorique attend-on sur chaque ONT (coupleur 1:64) ?', a: '' },
        { q: 'Appt 301 : quel défaut ? Où ?', a: '' },
        { q: 'Appt 101 : quelle puissance mesurée ? Quel défaut ?', a: '' },
        { q: 'Appt 201 : quel défaut ? Quelle action corrective ?', a: '' },
        { q: 'Pourquoi la courbure est-elle mieux révélée à 1550 nm ?', a: '' },
        { q: 'Rédigez la méthode générale de dépannage.', a: '' }
      ],
      topology: tp5
    },
    {
      id: 'tp10', num: 10, title: 'Mise en service FTTH : OLT, routeur de collecte et Box', archi: 'FTTH (services)', duration: '1 h 30', level: 'Intermédiaire', public: 'Bac Pro · Licence · Master',
      objectives: ['Comprendre la chaîne logique routeur de collecte → OLT → ONT → Box → appareils', 'Autoriser une ONT sur l\'OLT par son numéro de série et lui attribuer un profil', 'Configurer la session WAN PPPoE et les VLAN de la Box', 'Lire un diagnostic de service pas à pas'],
      context: 'La fibre de la Maison Dupont est raccordée et la lumière arrive à l\'ONT (−15,97 dBm). Pourtant, ni Internet, ni la TV, ni le téléphone ne fonctionnent. Le technicien de mise en service doit déclarer l\'abonné sur l\'OLT et terminer la configuration de la Box. Contrat de l\'abonné : offre Triple play, identifiant PPPoE dupont@optisim, mot de passe Fibre-2026.',
      steps: [
        'Chargez la topologie. Sélectionnez le PC salon et ouvrez l\'onglet « Configuration » : quelle étape du diagnostic est en défaut ?',
        'Sélectionnez l\'ONT Dupont : relevez son numéro de série dans l\'onglet « Configuration ».',
        'Sélectionnez l\'OLT NRO → « Configuration » → « Autorisation des ONT » : cliquez sur « Autoriser » en face de l\'ONT détectée (ou déclarez son numéro de série), profil Triple play.',
        'Revenez sur le PC : quelle est maintenant l\'étape en défaut ? Sélectionnez le routeur de collecte et relevez son mode d\'accès.',
        'Sélectionnez la Box Dupont → « Configuration » → WAN : passez en PPPoE et saisissez l\'identifiant et le mot de passe de l\'abonné.',
        'Le décodeur TV est encore en défaut : comparez le VLAN TV de la Box à celui de l\'OLT et de la collecte, puis corrigez.',
        'Vérifiez que les trois services sont « En service » (onglet « Configuration » sans sélection : tableau des services) et relevez les adresses obtenues.'
      ],
      questions: [
        { q: 'Pourquoi l\'ONT reçoit-elle de la lumière mais les services ne fonctionnent-ils pas ?', a: '' },
        { q: 'Quel est le rôle du profil de service attribué à l\'ONT ?', a: '' },
        { q: 'Quelle adresse WAN la Box obtient-elle ? Qui la fournit ?', a: '' },
        { q: 'Quelles adresses IP reçoivent le PC, le décodeur et le téléphone ? Quelle est leur passerelle ?', a: '' },
        { q: 'Pourquoi la TV ne fonctionnait-elle pas alors qu\'Internet était rétabli ?', a: '' },
        { q: 'Quel débit maximal le PC peut-il atteindre ? Que se passerait-il avec 4 abonnés actifs sur le même port PON ?', a: '' }
      ],
      topology: tp10
    },
    {
      id: 'tp11', num: 11, title: 'Active Ethernet (AON) : raccordement d\'une entreprise', archi: 'AON / P2P', duration: '1 h', level: 'Intermédiaire', public: 'Bac Pro · Licence · Master',
      objectives: ['Distinguer l\'architecture Active Ethernet (point à point) du GPON', 'Raccorder un switch AON au routeur de collecte', 'Activer un port abonné et choisir son profil', 'Configurer un adressage IP statique'],
      context: 'L\'entreprise Lumitech est raccordée en fibre dédiée sur le port SFP 3 du switch AON du NRO. Le lien de collecte du switch n\'a pas encore été posé, et le port de l\'entreprise n\'est pas activé. Lumitech utilise un adressage fixe (réseau 192.168.10.0/24, routeur en 192.168.10.1) et a souscrit l\'offre Triple play pour son téléphone.',
      steps: [
        'Chargez la topologie. Repérez la fibre dédiée : patch du port SFP 3 du switch → ODF → câble de 1,5 km → PTO. Mesurez la puissance reçue par la CPE fibre.',
        'Outil « Lien de collecte 10 GbE » : reliez un port 10G du routeur de collecte à l\'uplink du switch AON.',
        'Sélectionnez le PC accueil → « Configuration » : quelle étape est en défaut ?',
        'Switch AON → « Configuration » → « Ports abonnés » : activez le port SFP 3 avec le profil Triple play.',
        'Le PC est encore en défaut : lisez le diagnostic, puis corrigez sa configuration IP.',
        'Vérifiez que le PC (Internet) et le téléphone (Téléphonie) sont en service.'
      ],
      questions: [
        { q: 'Quelle différence principale entre Active Ethernet et GPON ?', a: '' },
        { q: 'Comment l\'abonné est-il identifié en AON ? et en GPON ?', a: '' },
        { q: 'Quelle puissance reçoit la CPE ? Pourquoi a-t-elle un seuil de saturation de −3 dBm ?', a: '' },
        { q: 'Quelle erreur de configuration avait le PC ?', a: '' },
        { q: 'Quel débit maximal le PC peut-il atteindre ?', a: '' }
      ],
      topology: tp11
    },
    {
      id: 'tp13', num: 13, title: 'Fibre vers les nœuds actifs : site mobile (FTTA) et armoire de rue', archi: 'Nœuds actifs (FTTA, FTTC)', duration: '1 h 30', level: 'Intermédiaire', public: 'Bac Pro → cycle d\'ingénieur',
      objectives: ['Identifier les nœuds actifs raccordés en fibre : site radio, armoire de rue', 'Distinguer le backhaul (collecte du site) et le fronthaul (BBU → têtes radio)', 'Câbler un pylône en FTTA : une fibre par secteur', 'Calculer le bilan et la marge d\'une liaison SFP point à point', 'Repérer un risque de saturation sur une liaison courte'],
      context: 'L\'opérateur raccorde le site radio P27 (pylône à 3 secteurs, 4G / 5G) et une armoire de montée en débit rue Pasteur. Au central, un switch d\'agrégation alimente en fibre le routeur de site (CSR) du shelter, à 6 km (backhaul), et l\'armoire MSAN, à 3 km. Dans le shelter, la BBU émet le fronthaul vers les trois têtes radio (RRH) du haut du pylône. Les câbles FTTA du pylône et la jarretière de l\'armoire ne sont pas encore posés.',
      steps: [
        'Chargez la topologie. Repérez les deux liaisons du central : backhaul du routeur de site (6 km) et collecte de l\'armoire MSAN (3 km). Mesurez au photomètre la puissance reçue par le routeur de site.',
        'Outil « Câble FTTA de pylône » : reliez chaque traversée de pied de pylône (S1, S2, S3) à la tête radio du même secteur, longueur 45 m.',
        'Mesurez la puissance reçue par chaque tête radio. Comparez-la à la sensibilité et au seuil de saturation de son SFP (inspecteur, onglet Propriétés).',
        'Outil « Jarretière » (LC/UPC) : reliez la traversée de l\'armoire de rue à l\'armoire MSAN, puis mesurez sa puissance reçue.',
        'Onglet « Bilan optique » : relevez le détail des pertes du routeur de site et de l\'armoire MSAN.',
        'Expérience : passez la puissance d\'émission de la BBU à +4 dBm (module longue portée). Que devient l\'état des têtes radio ? Remettez −1 dBm.'
      ],
      questions: [
        { q: 'Quelle différence entre le backhaul et le fronthaul d\'un site mobile ?', a: '' },
        { q: 'Calculez l\'atténuation et la puissance reçue par le routeur de site (Tx −3 dBm, 1310 nm). Quelle est la marge ?', a: '' },
        { q: 'Quelle puissance reçoit une tête radio ? Pourquoi cette liaison est-elle facile ?', a: '' },
        { q: 'Avec une BBU à +4 dBm, que se passe-t-il ? Comment y remédier ?', a: '' },
        { q: 'Armoire MSAN : pertes, puissance reçue, et rôle de l\'armoire ?', a: '' },
        { q: 'Pourquoi n\'utilise-t-on pas de coupleur (PON) pour alimenter les têtes radio ?', a: '' },
        { q: 'Pour aller plus loin (Licence, Master, ingénieur) — Avec le même switch d\'agrégation et le même routeur de site, quelle est la portée maximale du backhaul en gardant 3 dB de marge ?', a: '' },
        { q: 'Pour aller plus loin — La lumière parcourt la fibre en 5 µs par km environ (indice de groupe ≈ 1,47). Si la BBU est regroupée au central (C-RAN), quel est le retard du fronthaul ? Quelle distance le limite ?', a: '' },
        { q: 'Pour aller plus loin — En C-RAN, un site à 3 secteurs demande 3 liaisons fronthaul depuis le central. Comment économiser les fibres du câble de transport ?', a: '' }
      ],
      topology: tp13
    },
    {
      id: 'tp14', num: 14, title: 'Datacenter : liaisons leaf-spine et serveurs en OM4 par cassettes MPO', archi: 'Datacenter (MPO, OM4)', duration: '1 h 30', level: 'Intermédiaire', public: 'Bac Pro → cycle d\'ingénieur',
      objectives: ['Décrire le câblage d\'un datacenter : baies, cassettes MPO, trunks, jarretières', 'Justifier le choix de la fibre multimode OM4 et des SFP 850 nm', 'Calculer un bilan optique à 850 nm', 'Comparer des connexions faible perte et standard', 'Vérifier la perte d\'un canal par rapport à la norme 10GBASE-SR'],
      context: 'Dans la salle informatique, le switch spine (baie A1) est relié au switch leaf (baie B4) par un trunk MPO OM4 de 60 m, entre deux cassettes « faible perte ». Le leaf dessert les serveurs de la baie C2 par un second trunk de 40 m, entre deux cassettes standard. Le trunk spine → leaf n\'est pas posé et le serveur C2-02 n\'est pas brassé.',
      steps: [
        'Chargez la topologie. Dans chaque baie, repérez la cassette MPO : ports LC en façade, trunk MPO à l\'arrière.',
        'Outil « Trunk MPO/MTP OM4 » : reliez la sortie MPO de la cassette A1 à l\'entrée de la cassette B4 (spine), longueur 60 m.',
        'Mesurez au photomètre la puissance reçue par le switch leaf B4.',
        'Outil « Jarretière » (LC/UPC) : brassez le port LC 2 de la cassette C2 vers le serveur C2-02, puis mesurez les deux serveurs.',
        'Onglet « Bilan optique » : comparez la perte d\'une cassette faible perte et celle d\'une cassette standard.',
        'Expérience : passez la cassette C2 en « Faible perte ». Que gagne-t-on sur la liaison des serveurs ? Remettez « Standard ».'
      ],
      questions: [
        { q: 'Pourquoi utilise-t-on de la fibre multimode OM4 dans un datacenter ?', a: '' },
        { q: 'Calculez l\'atténuation et la puissance reçue par le switch leaf (Tx −2,5 dBm, 850 nm).', a: '' },
        { q: 'Même calcul pour un serveur de la baie C2.', a: '' },
        { q: 'La norme IEEE 802.3ae (10GBASE-SR) fixe la perte maximale du canal à 2,6 dB pour 300 m d\'OM3 ; pour 400 m d\'OM4, la valeur d\'usage (TIA, constructeurs) est 2,9 dB. Les deux liaisons OM4 sont-elles conformes ?', a: '' },
        { q: 'Que gagne-t-on avec une cassette C2 « faible perte » ?', a: '' },
        { q: 'À quoi sert une cassette MPO ?', a: '' },
        { q: 'Pour aller plus loin (Licence, Master, ingénieur) — Le budget du SFP (Tx − sensibilité) atteint 7,4 dB. Pourquoi la perte du canal est-elle pourtant limitée à 2,6 dB (IEEE 802.3ae, OM3) ou 2,9 dB (valeur d\'usage, OM4) ?', a: '' },
        { q: 'Pour aller plus loin — À 850 nm, la bande passante modale vaut 2 000 MHz·km en OM3 et 4 700 MHz·km en OM4. Pourquoi la portée 10GBASE-SR passe-t-elle de 300 m à 400 m ?', a: '' },
        { q: 'Pour aller plus loin — Pourquoi un câblage MPO prépare-t-il la migration vers 40 et 100 Gbit/s ? Qu\'est-ce que la polarité d\'un lien MPO ?', a: '' }
      ],
      topology: tp14
    }
  ];

  const EXAMPLES = [
    { id: 'ex-fttb', title: 'Exemple FTTB : ONU en pied d\'immeuble + Ethernet', desc: 'La fibre s\'arrête au sous-sol (ONU d\'immeuble) ; la distribution des étages se fait en cuivre Cat6 (≤ 100 m). Modifiez une longueur Cat6 à 120 m pour observer la limite.', topology: exFTTB },
    { id: 'ex-campus', title: 'Exemple Campus : liaison multimode OM3 entre deux bâtiments', desc: 'Switchs SFP 850 nm multimode, ODF LC/UPC et dorsale OM3 de 250 m.', topology: exCampus },
    { id: 'ex-recette', title: 'Exemple Recette : réception d\'un immeuble (mesures réalistes)', desc: 'Résidence R+3 en mode recette réaliste : chaque composant a sa propre perte, comme sur le terrain. Mesurez chaque ONT au photomètre, saisissez les valeurs dans la fiche de recette (onglet Bilan optique, sans sélection), comparez au calcul théorique et concluez. Un logement n\'est pas conforme : localisez le défaut à l\'OTDR.', topology: exRecette },
    { id: 'ex-ftth', title: 'Démo complète : villa FTTH en service', desc: 'Topologie du TP 2 entièrement câblée.', topology: () => tp2(true) },
    { id: 'ex-services', title: 'Exemple Services : FTTH triple play configuré', desc: 'Routeur de collecte (PPPoE), OLT avec ONT autorisée, Box et 3 appareils : Internet, TV et Téléphonie en service. Explorez l\'onglet « Configuration », puis introduisez une erreur (VLAN, mot de passe, DHCP…) pour voir le diagnostic.', topology: () => tp10(true) },
    { id: 'ex-usine', title: 'Exemple Industrie : dorsale fibre d\'une usine', desc: 'Local technique, dorsale multimode OM3 vers l\'atelier A (même bâtiment) et monomode vers l\'atelier B (800 m), switchs industriels sur rail DIN et automates.', topology: exUsine },
    { id: 'ex-aon', title: 'Exemple Services : Active Ethernet (AON) entreprise', desc: 'Switch AON relié au routeur de collecte, fibre dédiée sur le port SFP 3, routeur d\'entreprise et adressage IP statique.', topology: () => tp11(true) }
  ];

  /* ------------------------------------------------------------------ */
  /*  DOCUMENTATION / COURS                                               */
  /* ------------------------------------------------------------------ */
  const DOCS = [
    { id: 'start', group: 'Guide de l\'utilisateur', title: 'Prise en main de l\'interface', html: `
<p><b>OptiSim FTTx Lab</b> est un laboratoire virtuel de réseaux fibre optique, conçu par <b>Hassami COMPAORE</b>, du <b>Bac Pro Télécommunications</b> au <b>cycle d'ingénieur</b> (Licence, Master). Chaque TP indique les niveaux visés ; les questions « Pour aller plus loin » s'adressent à la Licence, au Master et au cycle d'ingénieur. L'écran est organisé en 4 zones :</p>
<ol>
<li><b>Barre supérieure</b> : Nouveau / Ouvrir / Sauvegarder (fichier JSON), choix du <b>mode</b>, bibliothèque <b>Exemples &amp; TP</b>, <b>Documentation</b>, annulation et thème clair/sombre.</li>
<li><b>Boîte à outils (gauche)</b> : équipements classés par catégorie, câbles et instruments de mesure.</li>
<li><b>Canevas (centre)</b> : espace de travail quadrillé. Molette = zoom, clic-glisser sur le fond = déplacement.</li>
<li><b>Inspecteur (droite)</b> : propriétés de l'élément sélectionné, <b>bilan optique</b> détaillé et écran de l'<b>OTDR</b>.</li>
</ol>
<h4>Les trois modes</h4>
<table class="doc-table"><tr><th>Mode</th><th>Usage</th></tr>
<tr><td>Conception</td><td>Poser, déplacer, câbler et paramétrer les équipements.</td></tr>
<tr><td>Mesure / Test</td><td>Utiliser le photomètre, l'OTDR et le stylo optique (VFL).</td></tr>
<tr><td>Dépannage</td><td>Intervenir sur un câble ou un équipement défectueux, après l'avoir localisé par la mesure.</td></tr></table>

<h4>Poser et câbler</h4>
<ul>
<li><b>Glissez</b> un équipement de la boîte à outils vers le canevas. Déposé dans un bâtiment, il y est rattaché (et à l'étage correspondant).</li>
<li>Pour câbler : cliquez sur un <b>type de câble</b>, puis sur l'équipement de départ (amont) et sur l'équipement d'arrivée (aval). Une fenêtre demande la longueur et le mode de raccordement de chaque extrémité.</li>
<li>Les ports sont attribués automatiquement (premier port libre compatible). Vous pouvez les changer dans l'inspecteur du câble.</li>
<li>Les ports d'<b>entrée</b> sont à gauche des équipements, les ports de <b>sortie</b> à droite. Le simulateur représente le <b>sens descendant</b> (émetteur → récepteur).</li>
</ul>
<h4>Adapter l'écran</h4>
<ul><li>Tirez le <b>bord intérieur</b> de la boîte à outils ou de l'inspecteur pour les élargir (double-clic : largeur par défaut).</li>
<li>Les fenêtres flottantes (photomètre, VFL, consignes du TP) se <b>déplacent par leur titre</b> et se <b>redimensionnent par leur coin</b> (double-clic sur le titre : position initiale). La disposition est mémorisée sur le poste.</li></ul>
<h4>Raccourcis</h4>
<table class="doc-table"><tr><td><kbd>Suppr</kbd></td><td>Supprimer la sélection</td></tr><tr><td><kbd>Échap</kbd></td><td>Annuler l'outil en cours</td></tr><tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd></td><td>Annuler</td></tr><tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>Sauvegarder (JSON)</td></tr><tr><td><kbd>F</kbd></td><td>Recadrer la vue sur le réseau</td></tr></table>
<h4>Badges de statut</h4>
<p><span class="dot ok"></span> OK &nbsp; <span class="dot weak"></span> Signal faible (marge &lt; 3 dB) &nbsp; <span class="dot los"></span> LOS / saturation &nbsp; <span class="dot nc"></span> non raccordé / pas de source.</p>
<h4>Auteur et contact</h4>
<p><b>Hassami COMPAORE</b> — <a href="mailto:decompaore@gmail.com">decompaore@gmail.com</a> — Tél. / WhatsApp : <b>+226 79 00 03 04</b>. Questions, remarques et propositions de TP sont les bienvenues.</p>` },

    { id: 'buildings', group: 'Guide de l\'utilisateur', title: 'Créer des bâtiments', html: `
<h4>Bâtiment simple</h4>
<p>Villa, pavillon, boutique ou bureau de plain-pied. Paramètre clé : <b>longueur de gaine intérieure</b> (du point d'adduction PA jusqu'à la PTO). Tout câble optique entrant depuis l'extérieur reçoit automatiquement cette longueur supplémentaire dans le bilan.</p>
<h4>Immeuble multi-niveaux (R+N)</h4>
<ul><li>Réglez le nombre d'étages (R+1 à R+12), la présence d'un sous-sol et la <b>hauteur d'étage</b> (3 m par défaut).</li>
<li>Le bâtiment est découpé en bandes horizontales (Sous-sol, RDC, Étage 1…). La bande verticale en pointillés représente la <b>gaine technique</b> (colonne montante).</li>
<li>Déposez les équipements dans l'étage voulu : l'inspecteur affiche l'étage détecté.</li>
<li>Redimensionnez un bâtiment à la souris : sélectionnez-le, puis tirez l'une des poignées carrées (coins et côtés). Pour un immeuble, le bas règle la hauteur des étages. Déplacer un bâtiment déplace tout son contenu.</li></ul>
<h4>Compartimenter : logements, bureaux, pièces</h4>
<p>L'élément <b>« Local »</b> (boîte à outils, rubrique Bâtiments) découpe un bâtiment comme sur un vrai plan.</p>
<ul><li>Glissez un local <b>dans</b> le bâtiment ou dans l'étage voulu, puis ajustez-le avec les poignées de ses coins et de ses côtés.</li>
<li>Dans l'inspecteur, donnez-lui un <b>nom</b> (« Appt 301 », « Comptabilité », « Séjour ») et un <b>type</b>. Chaque type a sa couleur :
<table class="doc-table"><tr><th>Type</th><th>Exemples</th></tr>
<tr><td>Logement</td><td>appartement d'un immeuble</td></tr><tr><td>Bureau</td><td>service d'une entreprise, accueil</td></tr>
<tr><td>Commerce</td><td>boutique en pied d'immeuble</td></tr><tr><td>Pièce</td><td>séjour, chambre ou bureau d'une maison</td></tr>
<tr><td>Parties communes</td><td>palier, hall d'entrée, caves : la colonne montante et les PBO y passent</td></tr>
<tr><td>Local technique</td><td>PMI, baie, ODF d'étage, local télécom</td></tr></table></li>
<li>Les équipements posés dans un local lui sont rattachés. L'inspecteur et le bilan affichent l'emplacement complet, par exemple « Résidence — Étage 3 — Appt 301 ».</li>
<li>Déplacer un local déplace ses équipements. Supprimer un local ne supprime pas son contenu.</li></ul>
<div class="tip">Les locaux illustrent le plan : ils ne changent <b>pas</b> le bilan optique. Ce sont la gaine intérieure (bâtiment simple) et l'écart d'étages (colonne montante) qui comptent dans le calcul. Les TP intégrés sont déjà compartimentés.</div>` },

    { id: 'odf', group: 'Guide de l\'utilisateur', title: 'Brassage sur ODF', html: `
<p>L'ODF possède deux faces :</p>
<ul><li><b>Amont</b> (à gauche) : arrivée des fibres du câble, épissurées sur des pigtails.</li>
<li><b>Aval</b> (à droite) : connecteurs en face avant où l'on brasse des <b>jarretières</b>.</li></ul>
<p>La correspondance est <b>port à port</b> : la fibre arrivant sur <i>Amont 3</i> ressort uniquement sur <i>Aval 3</i>. Brancher une jarretière sur un autre port produit une <b>erreur de brassage</b> (LOS chez l'abonné).</p>
<p>Chaque traversée d'ODF ajoute sa perte d'insertion (raccord, 0,3 à 0,5 dB). Les jarretières n'ajoutent pas de perte de raccordement supplémentaire : les connecteurs sont comptés dans la traversée.</p>
<p class="tip">Astuce : quand vous câblez depuis un ODF, le simulateur choisit le port aval qui correspond à une fibre déjà présente en amont.</p>` },

    { id: 'riser', group: 'Guide de l\'utilisateur', title: 'Colonne montante & épissurage en PBO intérieur', html: `
<ol><li>Placez le <b>PMI</b> (ou l'ODF de local technique) au sous-sol ou au RDC.</li>
<li>Placez un <b>PBO intérieur</b> à chaque étage (ou tous les 2 étages) dans la gaine technique.</li>
<li>Outil <b>Câble de colonne montante</b> : PMI → PBO étage 1, puis PBO étage 1 → PBO étage 2, etc. Avec « Longueur auto », la longueur = écart d'étages × hauteur d'étage.</li>
<li>Raccordement : épissure au départ du PMI ; pour les tronçons suivants, choisissez <b>« Aucun »</b> : la fibre traverse le PBO sans être coupée (seules les fibres piquées sont épissurées).</li>
<li>Outil <b>Câble intérieur LSZH</b> : PBO → PTO de chaque logement (épissure fusion aux deux bouts = piquage dans le PBO + épissure dans la PTO).</li></ol>
<p class="tip">Modélisation : un câble multi-fibres est représenté par un seul trait. Chaque sortie d'un PBO correspond à une fibre de la colonne dédiée à un logement.</p>` },

    
    { id: 'pm', group: 'Instruments de mesure', title: 'Photomètre (wattmètre optique)', html: `
<p>Le photomètre mesure la <b>puissance optique</b> en dBm sur un port. Mode <b>Mesure / Test</b> → outil <b>Photomètre</b> → cliquez sur un équipement (OLT, ODF, PMI, PBO, PTO, ONT…).</p>
<p>L'afficheur indique : la longueur d'onde, la puissance reçue, l'atténuation cumulée depuis la source et le statut :</p>
<table class="doc-table"><tr><th>Statut</th><th>Condition (référence ONT GPON B+)</th></tr>
<tr><td><span class="dot ok"></span> OK</td><td>P ≥ sensibilité + 3 dB et P ≤ saturation</td></tr>
<tr><td><span class="dot weak"></span> Signal faible</td><td>sensibilité ≤ P &lt; sensibilité + 3 dB</td></tr>
<tr><td><span class="dot los"></span> Saturation</td><td>P &gt; −8 dBm sur un récepteur</td></tr>
<tr><td><span class="dot los"></span> LOS</td><td>P &lt; −27 dBm ou absence de lumière</td></tr></table>
<p>Sur un équipement passif (ODF, PMI, PBO, PTO…), le photomètre juge la puissance comme le ferait une ONT : classe B+ (−27 / −8 dBm), ou C+ (−30 / −12 dBm) si l'OLT est réglé en classe C+.</p>
<p>Le tableau de ports permet de mesurer chaque entrée et chaque sortie : très utile pour encadrer un défaut (la puissance chute entre deux points de mesure).</p>` },

    { id: 'otdr', group: 'Instruments de mesure', title: 'Réflectomètre (OTDR)', html: `
<p>L'OTDR envoie des impulsions lumineuses et analyse la lumière <b>rétrodiffusée</b> : il trace la puissance en fonction de la distance. Dans le simulateur, l'OTDR remplace la source (OLT/switch) et tire vers l'équipement cliqué.</p>
<ul><li><b>Pente</b> de la courbe = atténuation linéique de la fibre (dB/km).</li>
<li><b>Événement réflectif</b> (pic puis marche) : connecteur (ODF, PTO, PBO connectorisé), épissure mécanique, fin de fibre ou coupure franche.</li>
<li><b>Événement non réflectif</b> (marche sans pic) : épissure fusion, coupleur, courbure.</li>
<li><b>Fin de fibre</b> : grand pic de Fresnel puis chute dans le bruit.</li></ul>
<p>Réglages : longueur d'onde (1310 / 1550 nm), <b>bobine amorce</b> (fibre de lancement qui permet de voir le premier connecteur hors zone morte). Cliquez sur une ligne du tableau d'événements pour zoomer.</p>
<p class="tip">Une perte plus forte à 1550 nm qu'à 1310 nm signale une <b>courbure</b>.</p>
<h4>Mesure bidirectionnelle (recette)</h4>
<ul><li><b>Aller</b> : l'OTDR est au NRO, à la place de la source. <b>Retour</b> : il est branché côté abonné, sur l'équipement visé, et tire vers le NRO.</li>
<li>Une épissure ou un connecteur ne mesure pas la même perte dans les deux sens, car les fibres raccordées n'ont pas exactement le même diamètre de mode. Un tir seul peut même montrer un « gain ». Seule la <b>moyenne aller-retour</b> donne la vraie perte : c'est elle que l'on compare aux seuils.</li>
<li>Bouton <b>Enregistrer le tir</b> : quand l'aller et le retour d'un même récepteur sont enregistrés à la même longueur d'onde, le tableau bidirectionnel affiche, pour chaque événement, l'aller, le retour, la moyenne et le seuil. Le seuil est calculé d'après les éléments que l'OTDR regroupe en un seul événement (connecteurs, épissures, coupleur).</li>
<li>Les tirs enregistrés alimentent le <b>rapport de recette</b> imprimable (fiche de recette, onglet Bilan optique sans sélection).</li></ul>` },

    { id: 'vfl', group: 'Instruments de mesure', title: 'Stylo optique (VFL)', html: `
<p>Le VFL (Visual Fault Locator) injecte une <b>lumière rouge visible</b> (650 nm) dans la fibre. Mode Mesure → outil <b>VFL</b> → cliquez sur l'équipement d'injection. Choisissez le sens (aval / amont) dans la fenêtre de l'instrument.</p>
<ul><li>La lumière parcourt câbles et jarretières à travers ODF, PMI et PBO (portée ≈ 5 km).</li>
<li>Au niveau d'une <b>cassure</b> ou d'une <b>courbure</b>, la lumière s'échappe : un point rouge clignotant apparaît.</li>
<li>Usage : continuité, identification d'une fibre sur un palier, détection de défaut proche.</li></ul>
<p class="warn">Sécurité : ne jamais regarder directement une fibre ou un connecteur, même avec un VFL.</p>` },

    { id: 'recette', group: 'Fiches d\'ingénierie FTTx', title: 'Recette : calcul, mesure et conformité', html: `
<p>Les valeurs du simulateur sont des <b>valeurs de référence</b> : celles des fiches techniques et du calcul de bilan. Elles servent à <b>dimensionner</b> une liaison, pas à la déclarer conforme.</p>
<table class="doc-table"><tr><th>Élément</th><th>Référence (calcul)</th><th>Sur le terrain</th></tr>
<tr><td>Fibre G.652D</td><td>0,35 / 0,25 / 0,22 dB/km (1310 / 1490 / 1550 nm)</td><td>souvent un peu meilleure</td></tr>
<tr><td>Épissure fusion</td><td>0,05 dB</td><td>0,01 à 0,1 dB</td></tr>
<tr><td>Connecteur</td><td>0,5 dB (valeur pessimiste)</td><td>souvent 0,2 à 0,3 dB s'il est propre</td></tr>
<tr><td>Coupleur 1:32</td><td>17,2 dB</td><td>quelques dixièmes de dB d'écart</td></tr>
<tr><td>ONT GPON B+ / C+</td><td colspan="2">réception entre −27 et −8 dBm (B+) ou −30 et −12 dBm (C+) ; viser au moins 3 dB de marge</td></tr></table>
<h4>Juger une liaison réelle</h4>
<ol><li><b>Calculer</b> le bilan théorique avec les valeurs de référence (onglet Bilan optique).</li>
<li><b>Mesurer</b> la puissance reçue au photomètre.</li>
<li><b>Comparer</b> : écart = perte mesurée − perte calculée = P<sub>calculée</sub> − P<sub>mesurée</sub>.</li></ol>
<table class="doc-table"><tr><th>Écart</th><th>Conclusion (seuils par défaut)</th></tr>
<tr><td>≤ 0 dB</td><td><b>Conforme</b> : cas normal, le réseau réel est meilleur que le calcul</td></tr>
<tr><td>0 à 0,5 dB</td><td><b>Acceptable</b> : nettoyer et contrôler les connecteurs</td></tr>
<tr><td>0,5 à 1 dB</td><td><b>À contrôler</b> à l'OTDR</td></tr>
<tr><td>plus de 1 dB</td><td><b>Non conforme</b> : un défaut est à localiser (courbure, épissure, connecteur sale)</td></tr>
<tr><td>mesure meilleure de plus de 2 dB</td><td><b>Suspecte</b> : vérifier la référence du photomètre</td></tr></table>
<p>La puissance doit aussi rester dans la fenêtre du récepteur, avec au moins 3 dB de marge au-dessus de la sensibilité. Les seuils exacts sont fixés par le <b>cahier des charges de recette</b> de l'opérateur : ceux du simulateur sont des repères pédagogiques.</p>
<h4>Dans le simulateur</h4>
<ul><li>En <b>mode recette réaliste</b>, chaque composant a sa propre perte, tirée au hasard autour de la valeur de référence (souvent un peu meilleure), comme sur le terrain. Les instruments mesurent ce réseau réel ; le bilan affiche toujours le calcul théorique.</li>
<li>La <b>fiche de recette</b> (onglet Bilan optique, sans sélection) liste chaque récepteur : saisissez la mesure du photomètre, l'écart et la conclusion s'affichent. Les mesures sont enregistrées avec le fichier et dans la copie d'examen.</li>
<li>Pour s'entraîner : <b>Exemples &amp; TP → Exemple Recette</b>.</li>
<li><b>Recette OTDR</b> : enregistrez un tir aller et un tir retour pour chaque récepteur (onglet OTDR). La moyenne de chaque événement est comparée au seuil : épissure ≤ 0,15 dB, connecteur ≤ 0,5 dB, coupleur à ± 0,5 dB de sa valeur nominale.</li>
<li><b>Rapport de recette</b> (bouton de la fiche) : document imprimable avec les mesures au photomètre, l'analyse OTDR bidirectionnelle, les seuils appliqués et la conclusion « conforme » ou « non conforme ».</li></ul>
` },

    { id: 'equip', group: 'Fiches d\'ingénierie FTTx', title: 'ODF, PMI, PBO intérieur / extérieur', html: `
<table class="doc-table"><tr><th>Élément</th><th>Où ?</th><th>Rôle</th></tr>
<tr><td><b>ODF</b></td><td>NRO, local technique, sous-répartiteur d'étage</td><td>Terminaison des câbles (épissures pigtails) et brassage par jarretières. Port à port.</td></tr>
<tr><td><b>SRO / PM</b></td><td>Armoire de rue</td><td>Point de mutualisation entre opérateurs, coupleurs, brassage.</td></tr>
<tr><td><b>PMI</b></td><td>Pied d'immeuble (sous-sol / RDC)</td><td>Point de mutualisation d'immeuble : reçoit le câble opérateur, alimente la colonne montante.</td></tr>
<tr><td><b>PBO extérieur</b></td><td>Poteau, façade, chambre</td><td>Distribue les câbles de branchement (drop) vers les villas.</td></tr>
<tr><td><b>PBO intérieur</b></td><td>Gaine technique de palier</td><td>Piquage des fibres de la colonne vers les logements de l'étage.</td></tr>
<tr><td><b>PTO</b></td><td>Logement</td><td>Prise murale : point de raccordement de l'ONT.</td></tr></table>` },

    { id: 'conn', group: 'Fiches d\'ingénierie FTTx', title: 'Connecteurs APC (vert) / UPC (bleu)', html: `
<table class="doc-table"><tr><th></th><th><span class="chip apc">APC</span></th><th><span class="chip upc">UPC</span></th></tr>
<tr><td>Polissage</td><td>Angle 8°</td><td>Plat (bombé)</td></tr>
<tr><td>Couleur</td><td>Vert</td><td>Bleu</td></tr>
<tr><td>Réflectance</td><td>&lt; −60 dB</td><td>&lt; −50 dB</td></tr>
<tr><td>Usage</td><td>FTTH / PON, vidéo</td><td>Data, P2P, LAN</td></tr></table>
<p class="warn">Ne jamais accoupler APC et UPC : forte perte (simulée à +3 dB) et risque de détérioration des férules.</p>
<p>Formats : <b>SC</b> (carré, clipsable, 2,5 mm) et <b>LC</b> (petit format, 1,25 mm, haute densité).</p>
<p>Avant toute connexion : <b>inspecter</b> et <b>nettoyer</b> la férule. Un connecteur sale peut ajouter plusieurs dB.</p>` },

    { id: 'fibers', group: 'Fiches d\'ingénierie FTTx', title: 'Fibres et câbles', html: `
<table class="doc-table"><tr><th>Fibre</th><th>Usage</th><th>Atténuation</th></tr>
<tr><td>Monomode <b>G.652D</b></td><td>Transport / distribution extérieure</td><td>0,35 dB/km à 1310 nm · 0,25 à 1490 · 0,22 à 1550</td></tr>
<tr><td>Monomode <b>G.657A2</b></td><td>Intérieur, drop, colonne : insensible aux courbures (rayon 7,5 mm)</td><td>identique à G.652D</td></tr>
<tr><td>Multimode <b>OM3</b> (aqua)</td><td>Dorsale entreprise ≤ 300 m @ 10G</td><td>3,0 dB/km à 850 nm · 1,0 à 1300 (typique ; maximum CEI 60793-2-10 : 3,5 et 1,5)</td></tr>
<tr><td>Multimode <b>OM4</b> (violet)</td><td>Dorsale ≤ 400 m @ 10G</td><td>identique à l'OM3 : l'OM4 a une plus grande bande passante modale, pas une atténuation plus faible</td></tr></table>
<p><b>LSZH</b> (Low Smoke Zero Halogen) : gaine obligatoire dans les bâtiments (faible fumée, pas de gaz halogéné en cas d'incendie).</p>
<p><b>Drop</b> : câble de branchement extérieur renforcé (aérien ou souterrain).</p>
<p>Code couleur des câbles dans le simulateur : <span class="chip" style="background:#eab308">SMF</span> <span class="chip" style="background:#78716c">Drop</span> <span class="chip" style="background:#e2e8f0;color:#111">LSZH</span> <span class="chip" style="background:#f97316">Colonne</span> <span class="chip" style="background:#22d3ee;color:#111">OM3</span> <span class="chip" style="background:#a855f7">OM4</span> <span class="chip apc">Jarretière APC</span> <span class="chip upc">Jarretière UPC</span> <span class="chip" style="background:#60a5fa">Cat6</span></p>
<h4>Quel câble entre quels équipements ?</h4>
<table class="doc-table"><tr><th>Liaison</th><th>Câble</th></tr>
<tr><td>OLT / switch → ODF, ODF → ODF dans une baie, PTO → ONT</td><td><b>Jarretière</b> (1 à 5 m, brassage) : un équipement actif se branche toujours par une jarretière</td></tr>
<tr><td>NRO (ODF) → SRO → PBO extérieur ; NRO → PMI d'un immeuble</td><td><b>Câble de transport / distribution G.652D</b> (extérieur, multi-fibres)</td></tr>
<tr><td>PBO extérieur → PTO d'une maison</td><td><b>Drop G.657A2</b> (branchement aérien, façade ou souterrain)</td></tr>
<tr><td>PMI → PBO d'étage ; PBO d'étage → PBO de l'étage suivant</td><td><b>Colonne montante</b> (verticale, entre étages)</td></tr>
<tr><td>PBO d'étage → PTO d'un logement (même étage)</td><td><b>Câble intérieur LSZH</b> (horizontal, dans le bâtiment)</td></tr>
<tr><td>Switchs à SFP multimode (850 nm), courte distance</td><td><b>Multimode OM3 / OM4</b> (jamais sur un réseau FTTH)</td></tr>
<tr><td>ONT / Box / switch → PC, téléphone, décodeur</td><td><b>Cat6</b> (≤ 100 m)</td></tr>
<tr><td>Routeur de collecte → OLT ou switch AON</td><td><b>Lien de collecte 10 GbE</b></td></tr></table>
` },

    { id: 'budget', group: 'Fiches d\'ingénierie FTTx', title: 'Calcul du bilan optique', html: `
<p class="formula">P<sub>reçue</sub> (dBm) = P<sub>émise</sub> (dBm) − Σ pertes (dB)</p>
<p class="formula">Σ pertes = α × L + n<sub>épissures</sub> × a<sub>ép</sub> + n<sub>connecteurs</sub> × a<sub>c</sub> + pertes coupleurs</p>
<table class="doc-table"><tr><th>Élément</th><th>Valeur utilisée</th></tr>
<tr><td>Épissure fusion</td><td>0,05 dB</td></tr><tr><td>Épissure mécanique</td><td>0,2 dB</td></tr>
<tr><td>Connecteur / traversée ODF, PMI, SRO, PTO</td><td>0,5 dB (0,3 à 0,5)</td></tr>
<tr><td>Coupleur 1:2 / 1:4 / 1:8</td><td>3,5 / 7,2 / 10,5 dB</td></tr>
<tr><td>Coupleur 1:16 / 1:32 / 1:64</td><td>13,8 / 17,2 / 21,0 dB</td></tr></table>
<h4>Exemple</h4>
<p>OLT +4 dBm, 5 km à 1490 nm, ODF, SRO 1:32, 4 épissures, PTO :</p>
<p>Pertes = 5 × 0,25 + 0,5 + (0,5 + 17,2) + 4 × 0,05 + 0,5 = 20,15 dB → P<sub>reçue</sub> = 4 − 20,15 = <b>−16,15 dBm</b>.</p>
<p>Conditions : P<sub>reçue</sub> ≥ sensibilité (−27 dBm) avec une <b>marge ≥ 3 dB</b>, et P<sub>reçue</sub> ≤ saturation (−8 dBm).</p>
<h4>Budget optique</h4>
<p class="formula">Budget (dB) = P<sub>émise</sub> (dBm) − sensibilité (dBm)<br>Pertes admissibles = budget − marge de sécurité (3 dB)<br>Marge = budget − Σ pertes = P<sub>reçue</sub> − sensibilité</p>
<p>Le budget est la quantité de pertes que la liaison peut « dépenser ». Exemple : OLT +4 dBm, ONT −27 dBm → budget <b>31 dB</b>, pertes admissibles 28 dB. Avec 20,15 dB de pertes, la liaison utilise 65 % du budget et garde 10,85 dB de marge.</p>
<table class="doc-table"><tr><th>Classe GPON (norme ITU-T G.984)</th><th>Affaiblissement du réseau passif</th></tr>
<tr><td>B+</td><td>13 à 28 dB</td></tr><tr><td>C+</td><td>17 à 32 dB</td></tr></table>
<p>La classe est un <b>pire cas garanti</b> (puissance d'émission minimale de l'OLT) : un réseau étudié pour la classe B+ doit rester sous 28 dB de pertes, même si le budget réel des équipements est plus grand. La classe se choisit dans les propriétés de l'OLT.</p>
<p>Dans OptiSim, l'onglet <b>Bilan optique</b> affiche le budget, les pertes admissibles, la marge, une jauge du budget utilisé et la conformité à la classe de l'OLT.</p>` },

    { id: 'usages', group: 'Fiches d\'ingénierie FTTx', title: 'Autres usages : nœuds actifs, datacenter, industrie', html: `
<p>La fibre ne sert pas qu'à raccorder des abonnés. Elle alimente aussi les <b>nœuds actifs</b> du réseau de l'opérateur, et relie les équipements d'un <b>datacenter</b> ou d'une <b>usine</b>. Dans ces trois cas, la liaison est le plus souvent <b>point à point</b> : une fibre (ou une paire) par équipement, sans coupleur.</p>
<h3>1. Fibre vers les nœuds actifs</h3>
<table class="doc-table"><tr><th>Nœud actif</th><th>Rôle</th><th>Liaison fibre</th></tr>
<tr><td>Site radio (pylône 4G / 5G)</td><td>antennes du réseau mobile</td><td><b>backhaul</b> : du central au routeur de site (CSR), plusieurs km ; <b>fronthaul</b> : de la <b>BBU</b> à chaque tête radio (<b>RRH</b>) du pylône, une fibre par secteur (câble <b>FTTA</b>)</td></tr>
<tr><td>Armoire de rue (MSAN, montée en débit)</td><td>nœud de quartier (FTTC / FTTN)</td><td>fibre de collecte jusqu'à l'armoire ; le service continue sur le cuivre (VDSL2) jusqu'aux abonnés proches</td></tr></table>
<ul><li>Le fronthaul (CPRI, eCPRI) demande un débit élevé (10 Gbit/s et plus) et une très faible latence : jamais de coupleur.</li>
<li>Sur une liaison courte, un module trop puissant <b>sature</b> le récepteur : on choisit le module selon la distance, ou on ajoute un atténuateur.</li></ul>
<h3>2. Datacenter</h3>
<ul><li><b>Architecture leaf-spine</b> : chaque switch d'accès (<b>leaf</b>, en tête de baie) est relié à chaque switch de cœur (<b>spine</b>).</li>
<li>Liaisons courtes : fibre <b>multimode OM4</b> (400 m au plus à 10 Gbit/s) et modules <b>10GBASE-SR</b> à 850 nm.</li>
<li><b>Câblage pré-connectorisé</b> : un <b>trunk MPO/MTP</b> de 12 fibres relie deux <b>cassettes MPO</b> ; en façade, les ports LC sont brassés par jarretières.</li>
<li>Le budget est très serré : l'IEEE 802.3ae (10GBASE-SR) limite la perte du canal à 2,6 dB pour 300 m d'OM3 ; pour 400 m d'OM4, la valeur d'usage (TIA, constructeurs) est 2,9 dB. Chaque cassette compte une connexion MPO et une connexion LC : <b>faible perte</b> 0,35 + 0,15 dB, <b>standard</b> 0,75 + 0,5 dB.</li></ul>
<h3>3. Industrie</h3>
<ul><li>La fibre est insensible aux perturbations électromagnétiques (moteurs, soudage, variateurs) : on l'utilise pour la <b>dorsale</b> de l'usine, du local technique vers les ateliers.</li>
<li>Multimode dans un même bâtiment, monomode entre bâtiments éloignés.</li>
<li>Dans l'atelier, un <b>switch industriel</b> durci (rail DIN, indice IP) dessert les automates et les postes de supervision en RJ45.</li></ul>
<h3>Pour aller plus loin (Licence, Master, cycle d'ingénieur)</h3>
<ul><li><b>Dimensionnement</b> : portée maximale = (budget − marge − pertes hors fibre) ÷ atténuation linéique.</li>
<li><b>Latence</b> : environ 5 µs par km de fibre. En C-RAN (BBU regroupées au central), le fronthaul tolère un retard de l'ordre de 100 µs, soit une vingtaine de kilomètres.</li>
<li><b>Multiplexage en longueur d'onde</b> (CWDM, DWDM) : plusieurs liaisons sur une même fibre, au prix de la perte des multiplexeurs.</li>
<li><b>Multimode</b> : la dispersion modale limite le produit bande passante × distance (OM3 2 000 MHz·km, OM4 4 700 MHz·km à 850 nm) ; la norme réserve une part du budget aux pénalités de transmission.</li>
<li><b>MPO</b> : 40GBASE-SR4 et 100GBASE-SR4 sur 8 fibres d'un connecteur MPO ; polarité normalisée (TIA-568, méthodes A, B, C).</li></ul>
<div class="tip">À pratiquer : <b>TP 13</b> (site mobile et armoire de rue), <b>TP 14</b> (datacenter) et l'exemple <b>« Industrie : dorsale fibre d'une usine »</b> (bouton « Exemples &amp; TP »).</div>
` },
    { id: 'archi', group: 'Fiches d\'ingénierie FTTx', title: 'Architectures FTTH, FTTB, FTTO, P2P', html: `
<table class="doc-table"><tr><th>Architecture</th><th>Principe</th></tr>
<tr><td><b>FTTH</b> (Home)</td><td>Fibre jusqu'au logement. Pavillon : NRO → SRO → PBO extérieur → drop → PTO. Immeuble : NRO → PMI → colonne → PBO d'étage → PTO. Architecture PON (coupleurs).</td></tr>
<tr><td><b>FTTB</b> (Building)</td><td>Fibre jusqu'à un ONU en pied d'immeuble, puis cuivre (Ethernet ≤ 100 m, VDSL) vers les étages.</td></tr>
<tr><td><b>FTTO</b> (Office)</td><td>Fibre dédiée entreprise, souvent point-à-point, ODF d'étage et switchs optiques.</td></tr>
<tr><td><b>P2P</b></td><td>Une fibre dédiée entre deux équipements actifs (pas de coupleur).</td></tr></table>
<p>Longueurs d'onde GPON : <b>1490 nm</b> descendant, <b>1310 nm</b> montant, <b>1550 nm</b> vidéo (RF overlay).</p>` },

    { id: 'faults', group: 'Fiches d\'ingénierie FTTx', title: 'Pannes typiques & méthode de dépannage', html: `
<table class="doc-table"><tr><th>Panne</th><th>Symptôme</th><th>Outil</th></tr>
<tr><td>Fibre coupée</td><td>LOS en aval</td><td>OTDR (fin anormale), VFL (fuite rouge)</td></tr>
<tr><td>Écrasement / courbure</td><td>+5 dB, signal faible</td><td>OTDR 1310/1550 (perte ↑ à 1550), VFL</td></tr>
<tr><td>Mauvaise épissure</td><td>+1,5 dB</td><td>OTDR (marche non réflective anormale)</td></tr>
<tr><td>Connecteur sale</td><td>+3 dB</td><td>Photomètre avant/après, microscope</td></tr>
<tr><td>Erreur de brassage / inversion</td><td>LOS chez l'abonné, lumière ailleurs</td><td>VFL, photomètre port par port</td></tr></table>
<h4>Méthode</h4><ol><li>Constater (voyants ONT : LOS rouge, PON éteint).</li><li>Mesurer au photomètre en remontant vers le NRO.</li><li>Localiser à l'OTDR (distance) et au VFL.</li><li>Réparer.</li><li>Valider par une mesure et rédiger le compte rendu.</li></ol>` },

    { id: 'ont', group: 'Fiches d\'ingénierie FTTx', title: 'Voyants de l\'ONT', html: `
<table class="doc-table"><tr><th>Voyant</th><th>Signification</th></tr>
<tr><td>POWER</td><td>Vert : alimenté.</td></tr>
<tr><td>PON</td><td>Vert fixe : synchronisé avec l'OLT. Orange : signal faible. Éteint : pas de synchro.</td></tr>
<tr><td>LOS</td><td>Rouge : perte du signal optique (fibre coupée, puissance insuffisante ou saturation).</td></tr>
<tr><td>LAN</td><td>Vert : au moins un équipement Ethernet raccordé.</td></tr></table>` },

    { id: 'svc-intro', group: 'Équipements actifs & services', title: 'Couche service : du NRO à l\'abonné', html: `
<p>Une fibre bien raccordée ne suffit pas : l'opérateur doit encore <b>mettre en service</b> l'abonné. OptiSim simule cette « couche service » au-dessus du bilan optique.</p>
<h4>La chaîne logique</h4>
<p class="formula">Cœur de réseau → <b>Routeur de collecte</b> → (lien 10 GbE) → <b>OLT</b> ou <b>switch AON</b> → (fibre) → <b>ONT</b> → <b>Box</b> → PC · décodeur TV · téléphone</p>
<table class="doc-table"><tr><th>Équipement</th><th>Rôle</th></tr>
<tr><td>Routeur de collecte (BNG)</td><td>Relie les abonnés à Internet, ouvre leurs sessions (DHCP ou PPPoE), distribue les adresses WAN, porte les VLAN des services.</td></tr>
<tr><td>OLT</td><td>Tête du réseau GPON : n'accepte que les ONT déclarées (numéro de série) et leur attribue un profil de service.</td></tr>
<tr><td>Switch AON</td><td>Tête d'un réseau Active Ethernet : un port et une fibre par abonné.</td></tr>
<tr><td>ONT</td><td>Convertit la lumière en Ethernet ; identifiée par son numéro de série.</td></tr>
<tr><td>Box</td><td>Ouvre la session WAN chez l'opérateur, crée le réseau de la maison (LAN), distribue les adresses (DHCP).</td></tr>
<tr><td>Appareils</td><td>PC → Internet · décodeur → TV · téléphone IP → Téléphonie.</td></tr></table>
<h4>Comment l'activer dans OptiSim</h4>
<ol><li>Posez un <b>routeur de collecte</b> (boîte à outils, « Actifs & Répartition »).</li>
<li>Reliez un de ses ports 10G à l'<b>uplink</b> de l'OLT (ou du switch AON) avec le câble <b>« Lien de collecte 10 GbE »</b> (ports en losange magenta).</li>
<li>Sélectionnez un équipement actif et ouvrez l'onglet <b>« Configuration »</b> de l'inspecteur.</li></ol>
<p>Sans routeur de collecte raccordé, la couche service n'est pas évaluée : les TP optiques fonctionnent comme avant.</p>
<h4>Le diagnostic pas à pas</h4>
<p>Pour chaque appareil, OptiSim vérifie dans l'ordre et s'arrête à la <b>première étape en défaut</b> :</p>
<ol><li>Liaison optique de l'ONT (puissance, LOS).</li><li>Autorisation de l'ONT sur l'OLT (ou port activé sur le switch AON).</li><li>Service présent dans le profil.</li><li>Routeur de collecte : raccordé au cœur de réseau, service activé.</li><li>VLAN identique de bout en bout.</li><li>Session WAN de la Box (mode, identifiants PPPoE) → adresse WAN.</li><li>Adresse IP de l'appareil (DHCP de la Box ou configuration statique).</li></ol>
<p><b>À imprimer :</b> <a href="tutoriels-imprimables.html#tutoriel-11" target="_blank" rel="noopener">tutoriel 11 — Équipements actifs et services</a> et <a href="tutoriels-imprimables.html#fiche-memo" target="_blank" rel="noopener">fiche mémo</a> (débits, profils, VLAN, adresses). Voir aussi la rubrique <a href="#" data-doc-link="print">Supports imprimables</a>.</p>` },

    { id: 'svc-olt', group: 'Équipements actifs & services', title: 'OLT : autorisation des ONT et profils', html: `
<p>Sur un réseau GPON, plusieurs abonnés partagent la même fibre grâce au coupleur. L'OLT doit donc savoir <b>quelle ONT</b> appartient à <b>quel abonné</b>.</p>
<h4>Le numéro de série (SN)</h4>
<p>Chaque ONT possède un numéro de série unique, inscrit sur son étiquette (dans OptiSim : onglet « Configuration » de l'ONT). Exemple : <code>ALCL1A2B3C4D</code>.</p>
<h4>Autoriser une ONT</h4>
<ul><li><b>Liste blanche</b> (cas réel le plus courant) : seules les ONT dont le numéro de série est déclaré obtiennent les services. Dans « Configuration » de l'OLT, la liste <b>« ONT détectées »</b> affiche les ONT qui reçoivent de la lumière : le bouton <b>Autoriser</b> les déclare avec le profil Triple play.</li>
<li><b>Automatique</b> : toutes les ONT reçoivent le même profil (pratique en laboratoire, déconseillé en exploitation).</li></ul>
<p>Une ONT qui ne reçoit pas de lumière (LOS) n'est pas détectée par l'OLT.</p>
<h4>Les profils de service</h4>
<table class="doc-table"><tr><th>Profil</th><th>Services</th><th>Débit ↓ / ↑</th></tr>
<tr><td>Internet 300 Mbit/s</td><td>Internet</td><td>300 / 300 Mbit/s</td></tr>
<tr><td>Internet 1 Gbit/s</td><td>Internet</td><td>1 000 / 500 Mbit/s</td></tr>
<tr><td>Internet 1 Gbit/s + TV</td><td>Internet, TV</td><td>1 000 / 500 Mbit/s</td></tr>
<tr><td>Triple play</td><td>Internet, TV, Téléphonie</td><td>1 000 / 700 Mbit/s</td></tr></table>
<h4>Débit partagé</h4>
<p>Un port PON GPON offre <b>2 488 Mbit/s</b> descendant et <b>1 244 Mbit/s</b> montant, <b>partagés</b> entre les ONT actives du port. Débit maximal d'un abonné = le plus petit entre son profil et sa part du PON. Exemple : 4 ONT actives → 2 488 / 4 = 622 Mbit/s chacune.</p>
<h4>VLAN de service</h4>
<p>L'OLT transporte un VLAN par service (par défaut Internet 100, TV 200, VoIP 300). Ils doivent être identiques sur la collecte et sur la Box.</p>` },

    { id: 'svc-collecte', group: 'Équipements actifs & services', title: 'Routeur de collecte : DHCP, PPPoE et VLAN', html: `
<p>Le routeur de collecte (ou <b>BNG</b>, Broadband Network Gateway) est la porte d'entrée des abonnés vers Internet. Il est relié au <b>cœur de réseau</b> de l'opérateur.</p>
<h4>Modes d'accès des abonnés</h4>
<table class="doc-table"><tr><th>Mode</th><th>Fonctionnement</th><th>Côté Box</th></tr>
<tr><td>DHCP (IPoE)</td><td>La Box demande une adresse ; la collecte la donne automatiquement. L'abonné est reconnu par sa ligne (ONT autorisée).</td><td>Mode DHCP, rien d'autre à saisir.</td></tr>
<tr><td>PPPoE</td><td>La Box ouvre une session avec un <b>identifiant</b> et un <b>mot de passe</b> fournis par l'opérateur.</td><td>Mode PPPoE + identifiant + mot de passe identiques à un compte de la collecte.</td></tr></table>
<p>La Box et la collecte doivent utiliser <b>le même mode</b>.</p>
<h4>Pool d'adresses WAN</h4>
<p>La collecte attribue à chaque Box une adresse de son pool, à partir de la 10<sup>e</sup> adresse. Exemple avec le pool <code>100.64.0.0/24</code> : première Box 100.64.0.10, deuxième 100.64.0.11…</p>
<h4>Services et VLAN</h4>
<p>Chaque service (Internet, TV, Téléphonie) circule dans son propre VLAN. Désactiver un service sur la collecte le coupe pour tous les abonnés. Sans raccordement au cœur de réseau, aucun service ne fonctionne.</p>
<h4>Lien de collecte 10 GbE</h4>
<p>La collecte est reliée à l'uplink des OLT et des switchs AON par une liaison 10 Gbit/s (fibre duplex avec modules SFP+). Cette liaison de données ne compte pas dans le bilan optique PON.</p>` },

    { id: 'svc-aon', group: 'Équipements actifs & services', title: 'Active Ethernet (AON) ou GPON ?', html: `
<table class="doc-table"><tr><th></th><th>GPON (PON passif)</th><th>Active Ethernet (AON)</th></tr>
<tr><td>Architecture</td><td>Point à multipoint : une fibre partagée grâce à un coupleur</td><td>Point à point : une fibre par abonné, aucun coupleur</td></tr>
<tr><td>Équipement de tête</td><td>OLT (port PON)</td><td>Switch AON (un port SFP par abonné)</td></tr>
<tr><td>Identification de l'abonné</td><td>Numéro de série de l'ONT</td><td>Port physique du switch</td></tr>
<tr><td>Débit</td><td>2 488 Mbit/s partagés par port PON</td><td>Débit du port dédié (1 Gbit/s)</td></tr>
<tr><td>Usage typique</td><td>Particuliers (FTTH)</td><td>Entreprises, sites sensibles (FTTO)</td></tr></table>
<h4>Configurer un switch AON</h4>
<ol><li>Reliez son <b>uplink</b> au routeur de collecte (lien 10 GbE).</li>
<li>Câblez la fibre de l'abonné depuis un port SFP (jarretière → ODF → câble → PTO).</li>
<li>Onglet « Configuration » → <b>Ports abonnés</b> : activez le port de l'abonné et choisissez son profil.</li></ol>
<p><b>Attention à la puissance :</b> un SFP point à point émet fort (−3 dBm) sur une liaison courte. Utilisez une CPE fibre dont le seuil de saturation est adapté (−3 dBm), sinon l'ONT sature.</p>` },

    { id: 'svc-box', group: 'Équipements actifs & services', title: 'Box et appareils : WAN, LAN et adressage IP', html: `
<h4>Le côté WAN (vers l'opérateur)</h4>
<ul><li><b>Mode de connexion</b> : DHCP ou PPPoE, comme la collecte.</li><li><b>Identifiant / mot de passe PPPoE</b> : ceux du contrat de l'abonné.</li><li><b>VLAN Internet, TV, VoIP</b> : identiques à ceux de l'OLT et de la collecte.</li></ul>
<h4>Le côté LAN (réseau de la maison)</h4>
<ul><li><b>Adresse de la Box</b> (ex. 192.168.1.1) : c'est la <b>passerelle</b> des appareils.</li><li><b>Masque</b> /24 = 255.255.255.0 : les appareils doivent avoir une adresse du même réseau (192.168.1.x).</li><li><b>Serveur DHCP</b> : donne automatiquement une adresse de la plage (ex. 192.168.1.10 à 192.168.1.50).</li></ul>
<h4>Adressage des appareils</h4>
<table class="doc-table"><tr><th>Mode</th><th>Règles à respecter</th></tr>
<tr><td>Automatique (DHCP)</td><td>Le serveur DHCP de la Box doit être activé. Sinon l'appareil prend une adresse 169.254.x.x (APIPA) et ne communique pas.</td></tr>
<tr><td>Statique (manuel)</td><td>Adresse dans le réseau de la Box · pas l'adresse du réseau (.0) ni de diffusion (.255 en /24) · adresse unique (pas de conflit) · même masque · <b>passerelle = adresse de la Box</b>.</td></tr></table>
<p>En statique, choisissez une adresse <b>hors de la plage DHCP</b> pour éviter les conflits.</p>` },

    { id: 'svc-diag', group: 'Équipements actifs & services', title: 'Dépanner un service : erreurs typiques', html: `
<p>Commencez toujours par la <b>couche physique</b> (photomètre, voyants de l'ONT), puis suivez le diagnostic de l'onglet « Configuration » : il indique la première étape en défaut.</p>
<table class="doc-table"><tr><th>Symptôme dans le diagnostic</th><th>Cause probable</th><th>Où corriger</th></tr>
<tr><td>Liaison optique : LOS</td><td>Fibre coupée, mauvais brassage, connecteur</td><td>Réseau optique (mesures)</td></tr>
<tr><td>ONT non autorisée</td><td>Numéro de série non déclaré ou mal saisi</td><td>OLT → Autorisation des ONT</td></tr>
<tr><td>Port SFP désactivé</td><td>Port de l'abonné non activé</td><td>Switch AON → Ports abonnés</td></tr>
<tr><td>Le profil ne comprend pas le service</td><td>Mauvais profil (ex. pas de TV)</td><td>OLT ou switch AON → profil</td></tr>
<tr><td>Collecte non raccordée au cœur / service désactivé</td><td>Réglage de la collecte</td><td>Routeur de collecte</td></tr>
<tr><td>VLAN différents</td><td>VLAN mal saisi sur la Box ou un équipement</td><td>Box (WAN) ou OLT / switch / collecte</td></tr>
<tr><td>Box en DHCP, collecte en PPPoE</td><td>Mauvais mode WAN</td><td>Box → WAN</td></tr>
<tr><td>Identifiant inconnu / mot de passe incorrect</td><td>Erreur de saisie PPPoE</td><td>Box → WAN (ou comptes de la collecte)</td></tr>
<tr><td>Serveur DHCP désactivé (APIPA)</td><td>DHCP de la Box coupé</td><td>Box → LAN</td></tr>
<tr><td>Adresse hors réseau / passerelle incorrecte / conflit</td><td>Erreur d'adressage statique</td><td>Appareil → Adressage IP</td></tr>
<tr><td>Câble Cat6 de plus de 100 m</td><td>Limite Ethernet cuivre</td><td>Câble Ethernet</td></tr></table>
<p>Après chaque correction, relisez le diagnostic : une autre étape peut être en défaut derrière la première.</p>
<h3>Pannes de configuration cachées</h3>

<p>Tant qu'une panne de configuration est <b>cachée</b>, le diagnostic n'affiche que des <b>symptômes</b>, comme le ferait un vrai équipement : « ONT détectée mais refusée par l'OLT », « Session PPPoE refusée », « Aucune réponse du réseau opérateur », « adresse 169.254.x.x (APIPA) »… L'étape en défaut indique où chercher : comparez alors la configuration des équipements concernés. Dès que la bonne valeur est rétablie, la panne est déclarée <b>corrigée</b>.</p>
<p><b>Pour s'entraîner :</b> <a href="tutoriels-imprimables.html#tutoriel-12" target="_blank" rel="noopener">tutoriel 12 — Les pannes de configuration</a>, <a href="tp-complementaires-imprimables.html#tp-12" target="_blank" rel="noopener">TP 12 — Dépannage des services sur sujet</a> et <a href="exercices-imprimables.html#exercices-services" target="_blank" rel="noopener">exercices 12 à 14</a> (adressage IP, débit GPON, diagnostic d'un service).</p>` },

    { id: 'print', group: 'Supports imprimables', title: 'Livrets à imprimer (tutoriels, TP, exercices)', html: `
<p>Trois livrets au format <b>A4</b> accompagnent le simulateur. Ils s'ouvrent dans un nouvel onglet, fonctionnent sans Internet, et s'impriment (ou s'enregistrent en PDF) avec le bouton <b>Imprimer</b> en haut de page.</p>
<div class="print-cards">
<a class="print-card" href="tutoriels-imprimables.html" target="_blank" rel="noopener">
<img src="docs/captures/livrets/apercu-tutoriels.jpg" alt="Aperçu d'une page des tutoriels : tutoriel 12, les pannes de configuration" loading="lazy">
<b>Tutoriels</b><small>22 pages · ${ELEVE ? 17 : 19} captures d'écran</small>
<span>12 tutoriels pas à pas : interface, équipements, câblage, bâtiments, bilan optique, photomètre, VFL, OTDR, pannes, TP et fichiers, équipements actifs et services, pannes de configuration. Fiche mémo et grille d'auto-évaluation.</span></a>
<a class="print-card" href="tp-complementaires-imprimables.html" target="_blank" rel="noopener">
<img src="docs/captures/livrets/apercu-tp.jpg" alt="Aperçu d'une page du TP 12 : dépannage des services sur sujet" loading="lazy">
<b>TP complémentaires 6 à 9 et 12</b><small>${ELEVE ? '11 pages' : '16 pages · corrigé en images'}</small>
<span>Liaison FTTH de A à Z, ingénierie (coupleur, distance, longueur d'onde, erreurs d'installation), recette d'un immeuble, dépannage sur sujet, dépannage des services (pannes de configuration).</span></a>
<a class="print-card" href="exercices-imprimables.html" target="_blank" rel="noopener">
<img src="docs/captures/livrets/apercu-exercices.jpg" alt="Aperçu d'une page de l'exercice 14 : diagnostic d'un service" loading="lazy">
<b>${ELEVE ? 'Exercices' : 'Exercices corrigés'}</b><small>${ELEVE ? '9 pages' : '13 pages · corrigé en images'}</small>
<span>14 exercices : vocabulaire, dB et dBm, atténuation, coupleurs, bilan d'une villa, colonne montante, statut d'un ONT, dimensionnement, APC/UPC, OTDR, diagnostic, adressage IP, débit GPON partagé, diagnostic d'un service.</span></a>
</div>
<p class="muted">Cliquez sur un aperçu pour ouvrir le livret dans un nouvel onglet.</p>

<h4>Nouveautés : équipements actifs et services</h4>
<p>Les livrets couvrent maintenant la <b>couche service</b> (OLT, routeur de collecte, switch AON, Box, adressage IP) et les <b>pannes de configuration</b>. Accès direct aux nouvelles pages :</p>
<div class="print-cards">
<a class="print-card" href="tutoriels-imprimables.html#tutoriel-11" target="_blank" rel="noopener">
<img src="docs/captures/livrets/apercu-tutoriel-11.jpg" alt="Aperçu du tutoriel 11 : chaîne de service, tableau des équipements configurables et exemple FTTH triple play" loading="lazy">
<b>Tutoriels 11 et 12</b><small>4 pages · tutoriels</small>
<span>Équipements actifs et services : onglet « Configuration », diagnostic pas à pas, débit GPON. Pannes de configuration : symptômes, correction.</span></a>
<a class="print-card" href="tutoriels-imprimables.html#fiche-memo" target="_blank" rel="noopener">
<img src="docs/captures/livrets/apercu-fiche-memo.jpg" alt="Aperçu de la fiche mémo : valeurs optiques, débits et profils de service, VLAN, adresses usuelles, ordre du diagnostic" loading="lazy">
<b>Fiche mémo</b><small>1 page · tutoriels</small>
<span>Valeurs de référence optiques, débits GPON et profils, VLAN 100 / 200 / 300, adresses de la Box, APIPA, ordre du diagnostic.</span></a>
<a class="print-card" href="tp-complementaires-imprimables.html#tp-12" target="_blank" rel="noopener">
<img src="docs/captures/livrets/apercu-tp.jpg" alt="Aperçu du TP 12 : dépannage des services sur sujet" loading="lazy">
<b>TP 12</b><small>${ELEVE ? '2 pages' : '2 pages + corrigé'} · TP complémentaires</small>
<span>Dépannage des services sur un sujet préparé par l'enseignant : relevé de référence, fiches d'intervention.</span></a>
<a class="print-card" href="exercices-imprimables.html#exercices-services" target="_blank" rel="noopener">
<img src="docs/captures/livrets/apercu-exercices-services.jpg" alt="Aperçu des exercices 12 et 13 : adressage IP d'un réseau domestique et débit GPON partagé" loading="lazy">
<b>Exercices 12 à 14</b><small>${ELEVE ? '2 pages' : '2 pages + corrigé'} · exercices</small>
<span>Adressage IP (configurations statiques, APIPA), débit GPON partagé, diagnostic d'un service à partir des symptômes.</span></a>
</div>
<h4>Conseils d'utilisation</h4>
<ul>
<li>Commencez par les <b>tutoriels</b>, puis les TP intégrés 1 à 5 (bouton <b>Exemples &amp; TP</b>), puis les <b>TP complémentaires</b>.</li>
<li>Parcours <b>couche service</b> : tutoriel 11 → TP intégrés 10 et 11 → tutoriel 12 → TP 12 → exercices 12 à 14.</li>
<li>Vérifiez vos calculs dans l'onglet <b>Bilan optique</b> : les valeurs du simulateur font référence.</li>
<li>Les captures des <b>fiches élèves</b> montrent où cliquer et quoi régler, sans donner les résultats.</li>

</ul>` }
  ];

  global.OptiLabs = { LABS, EXAMPLES, DOCS, Topo };
})(typeof window !== 'undefined' ? window : globalThis);
