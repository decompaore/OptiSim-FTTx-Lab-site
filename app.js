/* =====================================================================
 * OptiSim FTTx Lab — app.js
 * Auteur : Hassami COMPAORE
 * Interface : canevas SVG (glisser-déposer, zoom, câblage), inspecteur,
 * bilan optique, instruments (photomètre, OTDR, VFL), pannes, TP, docs.
 * ===================================================================== */
(function () {
  'use strict';
  const P = window.OptiPhysics;
  const L = window.OptiLabs;
  const SV = window.OptiServices;
  const X = window.OptiExam;
  /** Version enseignant (complète) ou élève (paquet sans corrigés ni outils de pannes). */
  const TEACHER = !window.OptiEdition || window.OptiEdition.role !== 'eleve';
  /** Signature des documents imprimés (edition.js). */
  const SIGNATURE = (window.OptiEdition && window.OptiEdition.auteur && window.OptiEdition.auteur.signature) || 'Hassami COMPAORE · decompaore@gmail.com · Tél. / WhatsApp : +226 79 00 03 04';
  const clone = o => JSON.parse(JSON.stringify(o));
  const { CATALOG, CABLES, JOINTS, FAULTS, CATEGORIES, fmt, fmtLen, portsOf, deviceSize, portPos, buildingRect, mduLevels } = P;

  /* ------------------------------------------------------------------ */
  /*  Utilitaires DOM                                                     */
  /* ------------------------------------------------------------------ */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let uidN = 0;
  const uid = p => `${p}-${Date.now().toString(36)}${(++uidN).toString(36)}`;
  const dbm = v => (v === null || v === undefined || !isFinite(v)) ? '—' : (v > 0 ? '+' : '') + fmt(v) + ' dBm';
  const STORE_KEY = 'optisim-fttx-autosave';
  const EXAM_KEY = 'optisim-fttx-examen-' + (TEACHER ? 'enseignant' : 'eleve'); // examen en cours (propre à chaque version)
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* stockage indisponible */ } }
  };

  /* ------------------------------------------------------------------ */
  /*  État global                                                         */
  /* ------------------------------------------------------------------ */
  const S = {
    topo: { devices: [], links: [] },
    view: { x: 60, y: 40, k: 1 },
    mode: 'design',
    tool: null,          // {kind:'cable', type} | {kind:'pm'|'otdr'|'vfl'}
    cableStart: null,
    sel: null,           // {kind:'dev'|'link', id}
    engine: null,
    services: null,     // résultat de OptiServices.analyze()
    vfl: null,           // {devId, dir, result}
    pm: null,            // {devId, key}
    otdr: { devId: null, lambda: 1310, launch: 500, dir: 'aller', result: null, x0: null, x1: null, hover: null },
    tab: 'props',
    bilanPort: null,
    lab: null,           // {id, checks:[]}
    exam: null,          // sujet d'examen en cours (OptiExam) : topologie verrouillée
    examStart: null,
    journal: [],         // actions de l'élève pendant l'examen
    undo: [], redo: [],
    mouse: { x: 0, y: 0 }
  };
  const devById = id => S.topo.devices.find(d => d.id === id);
  const linkById = id => S.topo.links.find(l => l.id === id);
  const isContainer = d => d && CATALOG[d.type] && CATALOG[d.type].container;
  const isRoom = P.isRoom; // local : conteneur visuel dans un bâtiment
  /**
   * Choix du câble (compétence de l'élève) : conseils visibles dans la version enseignant
   * seulement ; la version élève ne signale rien.
   */
  let cableTips = () => [];
  
  /** Emplacement d'un équipement : bâtiment, étage, local. */
  function locationText(d) {
    if (!d || !d.parent) return '';
    const B = devById(d.parent), R = d.room ? devById(d.room) : null;
    if (!B) return '';
    return B.props.name + (B.type === 'bld_mdu' ? ' — ' + P.floorLabel(d.floor) : '') + (R ? ' — ' + R.props.name : '');
  }

  /* ------------------------------------------------------------------ */
  /*  Topologie : normalisation, mutations, annulation                    */
  /* ------------------------------------------------------------------ */
  /** Réglage de recette (mode réaliste, graine, seuils, mesures saisies). */
  function normRecette(r) {
    const mesures = {};
    Object.entries((r && r.mesures) || {}).forEach(([k, v]) => { if (Number.isFinite(+v)) mesures[k] = +v; });
    const tirs = Array.isArray(r && r.tirs) ? r.tirs.filter(x => x && x.cible && Array.isArray(x.events)).slice(-60) : [];
    return { actif: !!(r && r.actif), graine: +(r && r.graine) || 1, seuils: Object.assign({}, P.RECETTE_SEUILS, (r && r.seuils) || {}), mesures, tirs };
  }
  function normalize(topo) {
    const t = { devices: [], links: [] };
    if (topo && topo.recette) t.recette = normRecette(topo.recette);
    if (topo && topo.projet && typeof topo.projet === 'object') t.projet = Object.assign({}, topo.projet);
    // Fichier chargé = donnée non sûre : identifiants limités à [A-Za-z0-9_-], valeurs numériques forcées
    // (ils sont injectés dans des attributs HTML/SVG sans échappement).
    const safeId = v => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : null);
    const num = v => (isFinite(+v) ? +v : 0);
    const remap = new Map();
    for (const d of (topo && topo.devices) || []) {
      const def = CATALOG[d.type];
      if (!def) continue;
      let id = safeId(d.id);
      if (!id || remap.has(id)) { id = uid(d.type); if (d.id != null && !remap.has(d.id)) remap.set(d.id, id); }
      else remap.set(id, id);
      const nd = { id, type: d.type, x: +d.x || 0, y: +d.y || 0, props: Object.assign(clone(def.defaults), clone(d.props || {})) };
      // Champs numériques du catalogue (props et configuration) : toujours des nombres
      for (const f of [].concat(def.props || [], def.config || [])) if (f && f.type === 'number' && f.key in nd.props) nd.props[f.key] = num(nd.props[f.key]);
      if (nd.type === 'ont' && !nd.props.sn) nd.props.sn = P.autoSerial(nd.id);
      if (def.container) {
        nd.w = +d.w || (d.type === 'bld_mdu' ? 620 : d.type === 'local' ? 220 : 360);
        if (d.type === 'bld_mdu') nd.floorPx = +d.floorPx || 170; else nd.h = +d.h || (d.type === 'local' ? 120 : 230);
      }
      if (d.fault && P.FAULTS[d.fault.type]) nd.fault = { type: d.fault.type, hidden: !!d.fault.hidden };
      if (d.cfgFault && SV.CFG_FAULTS[d.cfgFault.type]) nd.cfgFault = clone(d.cfgFault);
      t.devices.push(nd);
    }
    const linkIds = new Set();
    for (const l of (topo && topo.links) || []) {
      if (!l || !CABLES[l.type] || !l.a || !l.b || !remap.has(l.a.dev) || !remap.has(l.b.dev)) continue;
      const nl = Object.assign(JSON.parse(JSON.stringify(CABLES[l.type].defaults)), JSON.parse(JSON.stringify(l)));
      let id = safeId(l.id);
      if (!id || linkIds.has(id)) id = uid('L');
      linkIds.add(id);
      nl.id = id;
      nl.a = { dev: remap.get(l.a.dev), port: Math.max(0, Math.floor(num(l.a.port))) };
      nl.b = { dev: remap.get(l.b.dev), port: Math.max(0, Math.floor(num(l.b.port))) };
      nl.length = Math.max(0, num(nl.length));
      for (const k of ['jointA', 'jointB']) if (nl[k] != null && !P.JOINTS[nl[k]]) nl[k] = 'none';
      if (nl.connector != null && !P.CONNECTORS.includes(nl.connector)) delete nl.connector;
      if (nl.fibers != null) nl.fibers = Math.max(1, Math.floor(num(nl.fibers)) || 1);
      if (nl.fault) nl.fault = P.FAULTS[nl.fault.type] ? Object.assign({}, nl.fault, { pos: num(nl.fault.pos), hidden: !!nl.fault.hidden }) : undefined;
      if (!nl.fault) delete nl.fault;
      t.links.push(nl);
    }
    sanitizeLinks(t);
    return t;
  }

  /** Supprime les liens dont les ports n'existent plus ou sont en double. */
  function sanitizeLinks(t) {
    const used = new Set();
    const before = t.links.length;
    t.links = t.links.filter(l => {
      const A = t.devices.find(d => d.id === l.a.dev), B = t.devices.find(d => d.id === l.b.dev);
      if (!A || !B) return false;
      const pa = portsOf(A).out[l.a.port], pb = portsOf(B).in[l.b.port];
      const kind = CABLES[l.type].kind;
      if (!pa || !pb || pa.kind !== kind || pb.kind !== kind) return false;
      const ka = 'o' + l.a.dev + '#' + l.a.port, kb = 'i' + l.b.dev + '#' + l.b.port;
      if (used.has(ka) || used.has(kb)) return false;
      used.add(ka); used.add(kb);
      return true;
    });
    return before - t.links.length;
  }

  function snapshot() { return JSON.stringify(S.topo); }
  function pushUndo(snap) {
    S.undo.push(snap);
    if (S.undo.length > 80) S.undo.shift();
    S.redo = [];
  }
  /** Applique une modification à la topologie avec historique. */
  function mutate(fn, opts = {}) {
    const snap = snapshot();
    fn();
    const removed = sanitizeLinks(S.topo);
    if (removed) toast(`${removed} câble(s) retiré(s) : ports devenus indisponibles.`, 'warn');
    if (snapshot() !== snap) pushUndo(snap);
    refresh(opts);
  }
  function undo() {
    if (!S.undo.length) return toast('Rien à annuler.');
    S.redo.push(snapshot());
    S.topo = JSON.parse(S.undo.pop());
    validateSelection(); refresh();
  }
  function redo() {
    if (!S.redo.length) return toast('Rien à rétablir.');
    S.undo.push(snapshot());
    S.topo = JSON.parse(S.redo.pop());
    validateSelection(); refresh();
  }
  function validateSelection() {
    if (S.sel && S.sel.kind === 'dev' && !devById(S.sel.id)) S.sel = null;
    if (S.sel && S.sel.kind === 'link' && !linkById(S.sel.id)) S.sel = null;
    if (S.pm && !devById(S.pm.devId)) S.pm = null;
    if (S.vfl && !devById(S.vfl.devId)) S.vfl = null;
    if (S.otdr.devId && !devById(S.otdr.devId)) { S.otdr.devId = null; S.otdr.result = null; }
  }

  function loadTopology(topo, opts = {}) {
    if (opts.undoable !== false && S.topo.devices.length) pushUndo(snapshot());
    S.topo = normalize(topo);
    S.sel = null; S.pm = null; S.vfl = null; S.cableStart = null;
    S.otdr.devId = null; S.otdr.result = null;
    refresh();
    requestAnimationFrame(fitView);
  }

  /** Analyse de la couche service ; symptômes seuls si une panne de configuration est cachée. */
  function analyzeServices() {
    return SV.analyze(S.topo, S.engine, { masked: S.topo.devices.some(d => d.cfgFault && d.cfgFault.hidden) });
  }

  /** Recalcule le moteur physique puis redessine tout. */
  function refresh(opts = {}) {
    P.assignParents(S.topo);
    S.engine = new P.Engine(S.topo);
    // Mode recette : les instruments mesurent le réseau réel (S.engine), le bilan affiche le calcul de référence (S.engineRef)
    S.engineRef = S.topo.recette && S.topo.recette.actif ? new P.Engine(S.topo, { reference: true }) : S.engine;
    S.services = analyzeServices();
    // Pannes de configuration corrigées par l'élève (valeurs d'origine ou correction équivalente)
    const fixedNow = S.topo.devices.filter(d => d.cfgFault && SV.cfgFaultFixed(d, { topo: S.topo, analysis: S.services }));
    if (fixedNow.length) {
      fixedNow.forEach(d => { delete d.cfgFault; logJ('cfg-corrigee', `Configuration corrigée : ${d.props.name}`, { id: d.id }); });
      S.services = analyzeServices();
      if (!S.exam || S.exam.signaler) toast(fixedNow.length > 1 ? `${fixedNow.length} pannes de configuration corrigées. Bravo !` : `Panne de configuration corrigée sur « ${fixedNow[0].props.name} ». Bravo !`, 'ok');
    }
    if (S.vfl) S.vfl.result = P.vflInject(S.engine, S.vfl.devId, S.vfl.dir);
    if (S.otdr.devId) runOtdr(false);
    render();
    if (!opts.keepInspector) renderInspector();
    renderInstrument();
    renderStatus();
    store.set(STORE_KEY, snapshot());
    saveExamState();
  }

  /* ------------------------------------------------------------------ */
  /*  Rendu SVG                                                           */
  /* ------------------------------------------------------------------ */
  const svg = $('#canvas');
  const vp = $('#viewport');
  const layerB = $('#layerBuildings'), layerL = $('#layerLinks'), layerD = $('#layerDevices'), layerO = $('#layerOverlay');

  function applyView() {
    vp.setAttribute('transform', `translate(${S.view.x},${S.view.y}) scale(${S.view.k})`);
    renderStatus();
  }

  function render() {
    applyView();
    const blds = S.topo.devices.filter(d => isContainer(d) && !isRoom(d)).concat(S.topo.devices.filter(isRoom));
    const devs = S.topo.devices.filter(d => !isContainer(d));
    roomObstacles = blds.some(isRoom) ? labelObstacles() : [];
    layerB.innerHTML = blds.map(b => isRoom(b) ? roomSVG(b) : bldSVG(b)).join('');
    layerL.innerHTML = S.topo.links.map(linkSVG).join('');
    layerD.innerHTML = devs.map(devSVG).join('') + selectionHandlesSVG();
    renderDecorations();
    renderRubber();
    $('#emptyHint').hidden = S.topo.devices.length > 0;
  }

  function bldSVG(b) {
    const r = buildingRect(b);
    const sel = S.sel && S.sel.kind === 'dev' && S.sel.id === b.id;
    const p = b.props;
    let s = `<g class="bld ${sel ? 'selected' : ''} ${b.type}" data-dev="${b.id}">`;
    s += `<rect class="bld-body" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10"/>`;
    s += `<path class="bld-head" d="M${r.x} ${r.y + 30}V${r.y + 10}Q${r.x} ${r.y} ${r.x + 10} ${r.y}H${r.x + r.w - 10}Q${r.x + r.w} ${r.y} ${r.x + r.w} ${r.y + 10}V${r.y + 30}Z"/>`;
    s += `<path class="bld-icon" d="M${r.x + 10} ${r.y + 22}V${r.y + 14}L${r.x + 17} ${r.y + 8}L${r.x + 24} ${r.y + 14}V${r.y + 22}Z"/>`;
    const sub = b.type === 'bld_mdu' ? `R+${p.floors}${p.basement ? ' + sous-sol' : ''} · ${esc(p.usage)} · ${fmt(p.floorHeight, 1)} m/étage` : `${esc(p.kind)} · gaine ${p.gaineLength} m`;
    s += `<text class="bld-title" x="${r.x + 32}" y="${r.y + 20}">${esc(p.name)}</text>`;
    s += `<text class="bld-sub" x="${r.x + r.w - 12}" y="${r.y + 20}" text-anchor="end">${sub}</text>`;
    if (b.type === 'bld_mdu') {
      const lv = mduLevels(b);
      lv.forEach((l, i) => {
        s += `<rect class="floor ${i % 2 ? 'alt' : ''} ${l.floor < 0 ? 'basement' : ''}" x="${r.x + 1}" y="${l.y0}" width="${r.w - 2}" height="${l.y1 - l.y0}"/>`;
        s += `<line class="floor-sep" x1="${r.x}" x2="${r.x + r.w}" y1="${l.y1}" y2="${l.y1}"/>`;
        s += `<text class="floor-label" x="${r.x + 8}" y="${l.y0 + 18}">${l.label}</text>`;
      });
      s += `<rect class="gaine" x="${r.x + 66}" y="${lv[0].y0 + 4}" width="30" height="${lv[lv.length - 1].y1 - lv[0].y0 - 8}" rx="4"/>`;
      s += `<text class="gaine-label" transform="translate(${r.x + 85},${lv[lv.length - 1].y1 - 12}) rotate(-90)">GAINE TECHNIQUE · COLONNE MONTANTE</text>`;
    } else {
      const my = r.y + 30 + (r.h - 30) / 2;
      s += `<rect class="pa" x="${r.x - 7}" y="${my - 11}" width="14" height="22" rx="3"/><text class="pa-label" x="${r.x}" y="${my + 4}" text-anchor="middle">PA</text>`;
    }
    s += handlesSVG(b, r, sel);
    return s + '</g>';
  }

  /* Étiquettes des locaux : placées dans le premier coin libre (ni équipement, ni câble). */
  let roomObstacles = [];
  function pathBoxes(d) {
    const tok = d.match(/[MHVC]|-?[\d.]+/g) || [], out = [];
    const seg = (x0, y0, x1, y1) => out.push({ x0: Math.min(x0, x1) - 4, y0: Math.min(y0, y1) - 4, x1: Math.max(x0, x1) + 4, y1: Math.max(y0, y1) + 4 });
    let cx = 0, cy = 0, i = 0, cmd = '';
    while (i < tok.length) {
      if (/[MHVC]/.test(tok[i])) cmd = tok[i++];
      if (cmd === 'M') { cx = +tok[i++]; cy = +tok[i++]; }
      else if (cmd === 'H') { const x = +tok[i++]; seg(cx, cy, x, cy); cx = x; }
      else if (cmd === 'V') { const y = +tok[i++]; seg(cx, cy, cx, y); cy = y; }
      else if (cmd === 'C') {
        const p = [cx, cy].concat(tok.slice(i, i + 6).map(Number)); i += 6;
        let px = cx, py = cy;
        for (let k = 1; k <= 12; k++) {
          const t = k / 12, u = 1 - t;
          const x = u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6];
          const y = u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7];
          seg(px, py, x, y); px = x; py = y;
        }
        cx = p[6]; cy = p[7];
      } else i++;
    }
    return out;
  }
  function labelObstacles() {
    const obs = [];
    S.topo.devices.filter(d => !isContainer(d)).forEach(d => { const s = deviceSize(d); obs.push({ x0: d.x - 4, y0: d.y - 4, x1: d.x + s.w + 4, y1: d.y + s.h + 18 }); });
    S.topo.links.forEach(l => { const g = linkGeom(l); if (g) pathBoxes(g).forEach(b => obs.push(b)); });
    return obs;
  }
  function roomLabelSpot(r, b) {
    const same = b.props.kind === b.props.name;
    const w = String(b.props.name).length * 6.4 + (same ? 0 : String(b.props.kind).length * 4.9 + 6) + 4;
    const spots = [
      { x: r.x + r.w - 8, y: r.y + 15, anchor: 'end' }, { x: r.x + 8, y: r.y + 15, anchor: 'start' },
      { x: r.x + r.w - 8, y: r.y + r.h - 7, anchor: 'end' }, { x: r.x + 8, y: r.y + r.h - 7, anchor: 'start' }
    ];
    const box = s => ({ x0: s.anchor === 'end' ? s.x - w : s.x, x1: s.anchor === 'end' ? s.x : s.x + w, y0: s.y - 12, y1: s.y + 3 });
    const free = s => { const q = box(s); return !roomObstacles.some(o => q.x0 < o.x1 && o.x0 < q.x1 && q.y0 < o.y1 && o.y0 < q.y1); };
    return spots.find(free) || spots[0];
  }

  /**
   * Poignées de redimensionnement : triangle en bas à droite ; si l'élément est
   * sélectionné, 8 poignées (coins et milieux des côtés). Immeuble : pas de poignée
   * en haut (les étages se recalculent depuis le haut du bâtiment).
   */
  const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  function handlesSVG(b, r, sel) {
    const t = isRoom(b) ? 10 : 12;
    let s = `<path class="handle" data-handle="${b.id}" data-dir="se" d="M${r.x + r.w - 3} ${r.y + r.h - t - 3}V${r.y + r.h - 3}H${r.x + r.w - t - 3}Z"/>`;
    return s; // les 8 poignées de la sélection sont dessinées au premier plan (selectionHandlesSVG)
  }
  /** Poignées de l'élément sélectionné, au premier plan (un câble ne doit pas les masquer). */
  function selectionHandlesSVG() {
    if (S.mode !== 'design' || S.exam || !S.sel || S.sel.kind !== 'dev') return '';
    const b = devById(S.sel.id);
    if (!isContainer(b)) return '';
    const r = buildingRect(b);
    let s = '<g class="sel-handles">';
    const pos = { nw: [0, 0], n: [.5, 0], ne: [1, 0], e: [1, .5], se: [1, 1], s: [.5, 1], sw: [0, 1], w: [0, .5] };
    HANDLE_DIRS.filter(d => !(b.type === 'bld_mdu' && d.includes('n'))).forEach(d => {
      const [fx, fy] = pos[d];
      s += `<rect class="handle sq h-${d}" data-handle="${b.id}" data-dir="${d}" x="${r.x + r.w * fx - 5}" y="${r.y + r.h * fy - 5}" width="10" height="10" rx="2"/>`;
    });
    return s + '</g>';
  }

  /** Local (logement, bureau, pièce…) dessiné dans un bâtiment. */
  function roomSVG(b) {
    const r = P.buildingRect(b);
    const sel = S.sel && S.sel.kind === 'dev' && S.sel.id === b.id;
    const col = P.ROOM_COLORS[b.props.kind] || '#64748b';
    let s = `<g class="room ${sel ? 'selected' : ''}" data-dev="${b.id}">`;
    s += `<rect class="room-body" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" style="fill:${col};stroke:${col}"/>`;
    const sp = roomLabelSpot(r, b);
    s += `<text class="room-title" x="${sp.x}" y="${sp.y}" text-anchor="${sp.anchor}"><tspan class="room-label" style="fill:${col}">${esc(b.props.name)}</tspan>${b.props.kind !== b.props.name ? `<tspan class="room-kind" dx="6">${esc(b.props.kind)}</tspan>` : ''}</text>`;
    s += handlesSVG(b, r, sel);
    return s + '</g>';
  }

  function devSubline(d) {
    const p = d.props, st = S.engine.deviceState(d.id);
    switch (d.type) {
      case 'olt': return `${p.txPower > 0 ? '+' : ''}${fmt(p.txPower, 1)} dBm · ${p.wavelength} nm`;
      case 'switch': return p.role === 'coeur' ? `Tx ${fmt(p.txPower, 1)} dBm · ${p.wavelength}` : (st.power !== undefined ? `Rx ${dbm(st.power)}` : `Rx — · ${p.wavelength} nm`);
      case 'odf': case 'odf_int': return `${p.ports} ports · ${p.connector}`;
      case 'sro': case 'pmi': return p.splitter !== 'none' ? `Coupleur ${p.splitter}` : 'Brassage';
      case 'splitter': return `PLC ${p.ratio}`;
      case 'pbo_ext': case 'pbo_int': return `${p.capacity} FO${p.splitter !== 'none' ? ' · ' + p.splitter : p.raccord === 'epissure' ? ' · épissures' : ' · connect.'}`;
      case 'splice': return p.spliceType === 'fusion' ? 'Fusion' : 'Mécanique';
      case 'coupler': return p.connector;
      case 'pto': return `${p.fibres === 'Quadri-fibre' ? '4 FO' : '1 FO'} · ${p.connector}`;
      case 'ont': return st.power !== undefined ? dbm(st.power) : 'Rx —';
      case 'collecte': return `${p.accessMode === 'pppoe' ? 'PPPoE' : 'DHCP'} · ${p.core ? 'cœur OK' : 'hors cœur'}`;
      case 'switch_aon': return `Tx ${fmt(p.txPower, 1)} dBm · ${p.wavelength}`;
      case 'router': { const w = S.services && S.services.boxes.get(d.id); return w ? (w.ok ? `WAN ${w.ip}` : 'WAN : échec') : `LAN ${p.lanIp}`; }
      case 'pc': case 'tv': case 'phone': { const r = S.services && S.services.terminals.get(d.id); return r && r.evaluated ? `${r.label} ${r.ok ? '✓' : '✗'}` : ''; }
      default: return '';
    }
  }

  function devSVG(d) {
    const def = CATALOG[d.type];
    const s = deviceSize(d);
    const st = S.engine.deviceState(d.id) || { code: 'nc' };
    const sel = S.sel && S.sel.kind === 'dev' && S.sel.id === d.id;
    const glow = S.vfl && S.vfl.result && S.vfl.result.glow.has(d.id);
    const start = S.cableStart === d.id;
    const ports = portsOf(d);
    let g = `<g class="dev ${sel ? 'selected' : ''} ${glow ? 'vfl-glow' : ''} ${start ? 'cable-start' : ''}" data-dev="${d.id}" transform="translate(${d.x},${d.y})">`;
    g += `<rect class="dev-shadow" x="2" y="3" width="${s.w}" height="${s.h}" rx="8"/>`;
    g += `<rect class="dev-body" width="${s.w}" height="${s.h}" rx="8"/>`;
    g += `<path d="M0 18V8Q0 0 8 0H${s.w - 8}Q${s.w} 0 ${s.w} 8V18Z" fill="${def.color}"/>`;
    g += `<text class="dev-short" x="8" y="13">${def.short}</text>`;
    const sub = devSubline(d);
    const svc = S.services && S.services.terminals.get(d.id);
    const subCode = svc && svc.evaluated ? (svc.ok ? 'ok' : 'los') : d.type === 'router' && S.services && S.services.boxes.get(d.id) ? (S.services.boxes.get(d.id).ok ? 'ok' : 'los') : st.code;
    const cy = 18 + (s.h - 18) / 2 + (d.type === 'ont' ? -6 : 4);
    g += `<text class="dev-sub st-${subCode}" x="${s.w / 2}" y="${cy}" text-anchor="middle">${esc(sub)}</text>`;
    if (d.type === 'ont') {
      const ledPon = st.code === 'ok' ? 'on-green' : st.code === 'weak' ? 'on-orange' : '';
      const ledLos = (st.code === 'los' || st.code === 'sat') ? 'on-red blink' : '';
      const lan = ports.out.some((p, k) => S.engine.outMap.has(d.id + '#' + k)) ? 'on-green' : '';
      const leds = [['PWR', 'on-green'], ['PON', ledPon], ['LOS', ledLos], ['LAN', lan]];
      leds.forEach(([lb, cls], i) => {
        const x = 18 + i * 29;
        g += `<circle class="led ${cls}" cx="${x}" cy="${s.h - 20}" r="4"/><text class="led-label" x="${x}" y="${s.h - 7}" text-anchor="middle">${lb}</text>`;
      });
    }
    // ports
    const drawPorts = (list, side) => {
      const n = list.length; if (!n) return;
      const sp = (s.h - 28) / n;
      list.forEach((p, i) => {
        const y = 20 + sp * (i + 0.5);
        const x = side === 'in' ? 0 : s.w;
        const used = side === 'in' ? S.engine.inMap.has(d.id + '#' + i) : S.engine.outMap.has(d.id + '#' + i);
        const conn = d.props.connector;
        const fill = p.kind === 'eth' ? '#facc15' : p.kind === 'up' ? '#d946ef' : conn ? P.connectorColor(conn) : '#94a3b8';
        if (sp < 6) g += `<rect class="port tick ${used ? 'used' : ''}" x="${x - 3}" y="${y - Math.max(0.6, sp / 2 - 0.4)}" width="6" height="${Math.max(1.2, sp - 0.8)}" fill="${fill}"/>`;
        else if (p.kind === 'eth') g += `<rect class="port ${used ? 'used' : ''}" x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1.5" fill="${fill}"><title>${esc(p.label)}</title></rect>`;
        else if (p.kind === 'up') g += `<rect class="port ${used ? 'used' : ''}" x="${x - 4}" y="${y - 4}" width="8" height="8" transform="rotate(45 ${x} ${y})" fill="${fill}"><title>${esc(p.label)} (10 GbE)</title></rect>`;
        else g += `<circle class="port ${used ? 'used' : ''}" cx="${x}" cy="${y}" r="${Math.min(4.5, sp / 2.2)}" fill="${fill}"><title>${esc(p.label)}</title></circle>`;
      });
    };
    drawPorts(ports.in, 'in'); drawPorts(ports.out, 'out');
    // badge
    g += `<circle class="badge st-${st.code}" cx="${s.w - 2}" cy="-2" r="6.5"><title>${esc(st.label || '')}</title></circle>`;
    if (d.fault && d.fault.type && !d.fault.hidden) g += `<g class="fault-mark" transform="translate(-4,-6)"><circle r="9"/><text y="4" text-anchor="middle">!</text><title>${esc(FAULTS[d.fault.type].label)}</title></g>`;
    if (d.cfgFault && !d.cfgFault.hidden) g += `<g class="fault-mark cfg" transform="translate(${d.fault && d.fault.type && !d.fault.hidden ? 16 : -4},-6)"><circle r="9"/><text y="4" text-anchor="middle">⚙</text><title>Panne de configuration : ${esc(SV.CFG_FAULTS[d.cfgFault.type].label)}</title></g>`;
    g += `<text class="dev-name" x="${s.w / 2}" y="${s.h + 14}" text-anchor="middle">${esc(d.props.name)}</text>`;
    return g + '</g>';
  }

  function linkGeom(l) {
    const A = devById(l.a.dev), B = devById(l.b.dev);
    if (!A || !B) return null;
    const a = portPos(A, 'out', l.a.port), b = portPos(B, 'in', l.b.port);
    if (b.x - a.x < 40) {
      // tracé orthogonal (colonne montante, retours)
      const sa = deviceSize(A), sb = deviceSize(B);
      const ex = Math.max(a.x + 18, b.x + 18);
      let my;
      if (B.y + sb.h < A.y) my = B.y - 10;                 // B au-dessus
      else if (B.y > A.y + sa.h) my = B.y - 10;            // B en dessous
      else my = Math.min(A.y, B.y) - 16;
      return `M${a.x} ${a.y}H${ex}V${my}H${b.x - 18}V${b.y}H${b.x}`;
    }
    const dx = Math.max(30, (b.x - a.x) * 0.45);
    return `M${a.x} ${a.y}C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
  }

  function linkSVG(l) {
    const d = linkGeom(l);
    if (!d) return '';
    const cable = CABLES[l.type];
    const sel = S.sel && S.sel.kind === 'link' && S.sel.id === l.id;
    const ls = S.engine.linkState(l);
    const color = l.type === 'patch' ? P.connectorColor(l.connector) : cable.color;
    let s = `<g class="link ${sel ? 'selected' : ''} t-${l.type}${cableTips(l).length ? ' cable-warn' : ''}" data-link="${l.id}">`;
    s += `<path class="link-hit" d="${d}"/>`;
    s += `<path class="link-outline" d="${d}"/>`;
    s += `<path class="link-base" d="${d}" stroke="${color}" data-path="${l.id}"/>`;
    if (ls.kind === 'opt' && ls.lit) {
      if (ls.litFrac >= 1) s += `<path class="flow st-${ls.code}" d="${d}"/>`;
      else s += `<path class="flow-partial st-${ls.code}" d="${d}" pathLength="1000" stroke-dasharray="${ls.litFrac * 1000} 1000"/>`;
    } else if (ls.kind === 'opt' && ls.code === 'los') s += `<path class="dead" d="${d}"/>`;
    else if (ls.kind === 'eth' && ls.up) s += `<path class="flow eth" d="${d}"/>`;
    else if (ls.kind === 'up' && ls.up) s += `<path class="flow up" d="${d}"/>`;
    if (S.vfl && S.vfl.result && S.vfl.result.lit.has(l.id)) {
      const r = S.vfl.result.lit.get(l.id);
      s += `<path class="vfl-light" d="${d}" pathLength="1000" stroke-dasharray="0 ${r.from * 1000} ${(r.to - r.from) * 1000} 1000"/>`;
    }
    return s + '</g>';
  }

  /** Étiquettes de longueur, marqueurs de pannes et fuites VFL (placés via la géométrie réelle des chemins). */
  function renderDecorations() {
    let out = '';
    const k = S.view.k;
    const showLabels = k > 0.45;
    for (const l of S.topo.links) {
      const path = layerL.querySelector(`path[data-path="${l.id}"]`);
      if (!path) continue;
      const len = path.getTotalLength();
      const li = S.engine.lengthInfo(l);
      if (showLabels && l.type !== 'patch') {
        const m = path.getPointAtLength(len / 2);
        const txt = CABLES[l.type].kind !== 'opt' ? `${l.length} m` : fmtLen(li.total) + (li.auto ? ' ⇅' : '');
        const w = txt.length * 6 + 10;
        out += `<g class="len-label" transform="translate(${m.x},${m.y})"><rect x="${-w / 2}" y="-8" width="${w}" height="16" rx="8"/><text y="4" text-anchor="middle">${esc(txt)}</text></g>`;
      }
      if (l.fault && l.fault.type && !l.fault.hidden) {
        const tot = li.total || 1;
        const frac = FAULTS[l.fault.type].positional ? Math.min(1, (+l.fault.pos || 0) / tot) : 0.92;
        const pt = path.getPointAtLength(len * frac);
        out += `<g class="fault-mark" transform="translate(${pt.x},${pt.y})"><circle r="9"/><text y="4" text-anchor="middle">${l.fault.type === 'cut' ? '✕' : '!'}</text><title>${esc(FAULTS[l.fault.type].label)}</title></g>`;
      }
    }
    if (S.vfl && S.vfl.result) {
      for (const lk of S.vfl.result.leaks) {
        if (lk.linkId) {
          const path = layerL.querySelector(`path[data-path="${lk.linkId}"]`);
          if (!path) continue;
          const pt = path.getPointAtLength(path.getTotalLength() * lk.frac);
          out += `<g class="vfl-leak" transform="translate(${pt.x},${pt.y})"><circle class="halo" r="16"/><circle r="5"/></g>`;
        } else if (lk.devId) {
          const D = devById(lk.devId); if (!D) continue;
          const sz = deviceSize(D);
          out += `<g class="vfl-leak" transform="translate(${D.x + sz.w / 2},${D.y + sz.h / 2})"><circle class="halo" r="22"/></g>`;
        }
      }
    }
    layerO.innerHTML = out + '<g id="rubber"></g>';
  }

  function renderRubber() {
    const g = $('#rubber');
    if (!g) return;
    if (S.tool && S.tool.kind === 'cable' && S.cableStart) {
      const A = devById(S.cableStart);
      if (!A) { g.innerHTML = ''; return; }
      const s = deviceSize(A);
      g.innerHTML = `<line class="rubber" x1="${A.x + s.w / 2}" y1="${A.y + s.h / 2}" x2="${S.mouse.x}" y2="${S.mouse.y}" stroke="${CABLES[S.tool.type].color}"/>`;
    } else g.innerHTML = '';
  }

  /* ------------------------------------------------------------------ */
  /*  Boîte à outils                                                      */
  /* ------------------------------------------------------------------ */
  const PALETTE = [
    { title: 'Actifs & Répartition (NRO)', items: ['collecte', 'olt', 'switch_aon', 'switch', 'odf'] },
    { title: 'Passifs extérieurs (ODN)', items: ['sro', 'pbo_ext', 'splitter', 'splice', 'coupler'] },
    { title: 'Bâtiments & équipements intérieurs', items: ['bld_simple', 'bld_mdu', 'local', 'odf_int', 'pmi', 'pbo_int'] },
    { title: 'Câbles & jarretières', cables: ['smf', 'drop', 'lszh', 'riser', 'om3', 'om4', 'patch', 'cat6', 'uplink'] },
    { title: 'Abonnés', items: ['pto', 'ont', 'router', 'pc', 'phone', 'tv'] },
    { title: 'Outils de mesure', tools: [['pm', 'Photomètre', 'Puissance reçue (dBm) et statut'], ['otdr', 'Réflectomètre OTDR', 'Courbe de rétrodiffusion'], ['vfl', 'Stylo optique (VFL)', 'Lumière rouge visible']] }
  ];
  const TOOL_ICONS = {
    pm: '<rect x="6" y="3" width="22" height="20" rx="3" fill="#334155"/><rect x="9" y="6" width="16" height="7" rx="1" fill="#86efac"/><circle cx="17" cy="18" r="2.5" fill="#94a3b8"/>',
    otdr: '<rect x="3" y="3" width="28" height="20" rx="3" fill="#334155"/><path d="M6 8 L12 10 L13 7 L14 12 L22 15 L23 13 L24 19 L28 19" stroke="#38bdf8" stroke-width="1.6" fill="none"/>',
    vfl: '<rect x="4" y="10" width="20" height="6" rx="3" fill="#475569"/><rect x="24" y="11" width="5" height="4" fill="#94a3b8"/><circle cx="31" cy="13" r="2.5" fill="#ef4444"/>'
  };

  function buildPalette() {
    let h = '';
    PALETTE.forEach((sec, si) => {
      h += `<details class="pal-sec" ${si < 6 ? 'open' : ''}><summary>${sec.title}</summary><div class="pal-grid">`;
      (sec.items || []).forEach(t => {
        const def = CATALOG[t];
        h += `<div class="pal-item" draggable="true" data-type="${t}" title="${esc(def.desc)}" data-search="${esc((def.label + ' ' + def.short).toLowerCase())}">
          <svg viewBox="0 0 34 26" width="34" height="26">${def.room ? `<rect x="3" y="4" width="28" height="19" rx="3" fill="${def.color}" fill-opacity=".15" stroke="${def.color}" stroke-width="1.6" stroke-dasharray="3 2"/><path d="M17 4V23M3 13H17" stroke="${def.color}" stroke-width="1" stroke-dasharray="2 2"/>` : def.container ? `<rect x="2" y="3" width="30" height="21" rx="3" fill="none" stroke="${def.color}" stroke-width="2"/><rect x="2" y="3" width="30" height="6" rx="2" fill="${def.color}"/>${t === 'bld_mdu' ? '<path d="M3 14H31M3 19H31" stroke="' + def.color + '" stroke-width="1"/>' : ''}` : `<rect x="2" y="4" width="30" height="19" rx="3" fill="var(--dev-body)" stroke="var(--dev-stroke)"/><rect x="2" y="4" width="30" height="6" rx="2" fill="${def.color}"/>`}${def.room ? '' : `<text x="17" y="20" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor">${def.short}</text>`}</svg>
          <span>${esc(def.label)}</span></div>`;
      });
      (sec.cables || []).forEach(t => {
        const c = CABLES[t];
        h += `<div class="pal-item tool" data-cable="${t}" title="${esc(c.help)}" data-search="${esc(c.label.toLowerCase())}">
          <svg viewBox="0 0 34 26" width="34" height="26"><path d="M3 20 C14 20 18 6 31 6" stroke="#0005" stroke-width="5" fill="none"/><path d="M3 20 C14 20 18 6 31 6" stroke="${t === 'patch' ? '#16a34a' : c.color}" stroke-width="3" fill="none" ${t === 'cat6' ? 'stroke-dasharray="4 2"' : ''}/></svg>
          <span>${esc(c.label)}</span></div>`;
      });
      (sec.tools || []).forEach(([t, lb, hint]) => {
        h += `<div class="pal-item tool" data-tool="${t}" title="${esc(hint)}" data-search="${esc(lb.toLowerCase())}"><svg viewBox="0 0 34 26" width="34" height="26">${TOOL_ICONS[t]}</svg><span>${lb}</span></div>`;
      });
      h += '</div></details>';
    });
    $('#paletteBody').innerHTML = h;

    $$('.pal-item[data-type]').forEach(el => {
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.dataset.type); e.dataTransfer.effectAllowed = 'copy'; });
      el.addEventListener('click', () => {
        const r = svg.getBoundingClientRect();
        addDevice(el.dataset.type, toWorld(r.left + r.width / 2, r.top + r.height / 2), true);
      });
    });
    $$('.pal-item[data-cable]').forEach(el => el.addEventListener('click', () => { if (!locked()) setTool({ kind: 'cable', type: el.dataset.cable }); }));
    $$('.pal-item[data-tool]').forEach(el => el.addEventListener('click', () => {
      if (S.mode !== 'test') setMode('test');
      setTool({ kind: el.dataset.tool });
    }));
    $('#paletteSearch').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      $$('.pal-item').forEach(it => { it.hidden = q && !it.dataset.search.includes(q); });
      $$('.pal-sec').forEach(sec => { if (q) sec.open = true; });
    });
  }

  function setTool(tool) {
    const same = S.tool && tool && S.tool.kind === tool.kind && S.tool.type === tool.type;
    S.tool = same ? null : tool;
    S.cableStart = null;
    $$('.pal-item.tool').forEach(el => el.classList.toggle('active', !!S.tool && (el.dataset.cable === S.tool.type && S.tool.kind === 'cable' || el.dataset.tool === S.tool.kind)));
    svg.classList.toggle('tool-active', !!S.tool);
    renderRubber();
    render();
    renderStatus();
  }

  function addDevice(type, pt, centered) {
    if (locked()) return;
    const def = CATALOG[type];
    const d = { id: uid(type), type, x: 0, y: 0, props: clone(def.defaults) };
    if (type === 'ont') d.props.sn = P.autoSerial(d.id);
    if (def.container) { d.w = type === 'bld_mdu' ? 620 : type === 'local' ? 220 : 380; if (type === 'bld_mdu') d.floorPx = 170; else d.h = type === 'local' ? 120 : 240; }
    // nom unique
    const same = S.topo.devices.filter(x => x.type === type).length;
    if (same) d.props.name = `${def.defaults.name} ${same + 1}`;
    const sz = deviceSize(d);
    d.x = Math.round((pt.x - (centered || !def.container ? sz.w / 2 : 0)) / 10) * 10;
    d.y = Math.round((pt.y - (centered || !def.container ? sz.h / 2 : 0)) / 10) * 10;
    mutate(() => S.topo.devices.push(d));
    select({ kind: 'dev', id: d.id });
    const dd = devById(d.id);
    if (isRoom(dd)) { if (!dd.parent) toast('Un local se place dans un bâtiment (ou un étage d\'immeuble) : déplacez-le à l\'intérieur.', 'warn'); else toast(`Local placé dans « ${locationText(dd)} ». Ajustez-le avec les poignées de ses coins et de ses côtés.`); }
    else if (dd.parent) toast(`${def.short} placé dans « ${devById(dd.parent).props.name} »${dd.floor !== undefined && devById(dd.parent).type === 'bld_mdu' ? ' — ' + P.floorLabel(dd.floor) : ''}.`);
  }

  /* ------------------------------------------------------------------ */
  /*  Interactions sur le canevas                                         */
  /* ------------------------------------------------------------------ */
  function toWorld(cx, cy) {
    const r = svg.getBoundingClientRect();
    return { x: (cx - r.left - S.view.x) / S.view.k, y: (cy - r.top - S.view.y) / S.view.k };
  }

  let drag = null;

  svg.addEventListener('pointerdown', e => {
    if (e.button === 2) return;
    const w = toWorld(e.clientX, e.clientY);
    const handle = e.target.closest('[data-handle]');
    const devEl = e.target.closest('[data-dev]');
    const linkEl = e.target.closest('[data-link]');

    if (handle && S.mode === 'design' && !S.exam) {
      const b = devById(handle.dataset.handle);
      drag = { kind: 'resize', id: b.id, dir: handle.dataset.dir || 'se', start: w, x0: b.x, y0: b.y, w0: b.w, h0: b.h, fp0: b.floorPx, snap: snapshot(), moved: false };
      svg.setPointerCapture(e.pointerId); return;
    }
    if (devEl) {
      const d = devById(devEl.dataset.dev);
      if (S.tool && !isContainer(d)) { toolClick(d); return; }
      if (S.tool && S.tool.kind === 'cable' && isContainer(d)) { /* clic dans un bâtiment : ignoré */ }
      select({ kind: 'dev', id: d.id });
      if (S.tool && S.tool.kind === 'cable') return;
      if (S.exam) return; // examen : équipements non déplaçables
      const children = isRoom(d) ? S.topo.devices.filter(x => x.room === d.id) : isContainer(d) ? S.topo.devices.filter(x => x.parent === d.id) : [];
      drag = { kind: 'move', id: d.id, start: w, orig: [d, ...children].map(x => ({ d: x, x: x.x, y: x.y })), snap: snapshot(), moved: false };
      svg.setPointerCapture(e.pointerId); return;
    }
    if (linkEl && !S.tool) { select({ kind: 'link', id: linkEl.dataset.link }); return; }
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y, moved: false };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('panning');
  });

  svg.addEventListener('pointermove', e => {
    const w = toWorld(e.clientX, e.clientY);
    S.mouse = w;
    if (S.cableStart) renderRubber();
    if (!drag) return;
    if (drag.kind === 'pan') {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      S.view.x = drag.vx + dx; S.view.y = drag.vy + dy;
      applyView();
    } else if (drag.kind === 'move') {
      const dx = w.x - drag.start.x, dy = w.y - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      if (!drag.moved) return;
      for (const o of drag.orig) { o.d.x = Math.round((o.x + dx) / 10) * 10; o.d.y = Math.round((o.y + dy) / 10) * 10; }
      render();
    } else if (drag.kind === 'resize') {
      const b = devById(drag.id);
      const dx = w.x - drag.start.x, dy = w.y - drag.start.y;
      drag.moved = true;
      const dir = drag.dir, minW = isRoom(b) ? 80 : 240, minH = isRoom(b) ? 50 : 140;
      const snap = v => Math.round(v / 10) * 10;
      if (dir.includes('e')) b.w = Math.max(minW, snap(drag.w0 + dx));
      if (dir.includes('w')) { const nw = Math.max(minW, snap(drag.w0 - dx)); b.x = drag.x0 + drag.w0 - nw; b.w = nw; }
      if (b.type === 'bld_mdu') {
        if (dir.includes('s')) { const n = mduLevels(b).length; b.floorPx = Math.max(110, Math.round((drag.fp0 + dy / n) / 5) * 5); }
      } else {
        if (dir.includes('s')) b.h = Math.max(minH, snap(drag.h0 + dy));
        if (dir.includes('n')) { const nh = Math.max(minH, snap(drag.h0 - dy)); b.y = drag.y0 + drag.h0 - nh; b.h = nh; }
      }
      render();
    }
  });

  svg.addEventListener('pointerup', () => {
    if (!drag) return;
    const dr = drag; drag = null;
    svg.classList.remove('panning');
    if (dr.kind === 'pan') {
      if (!dr.moved) { if (S.tool && S.tool.kind === 'cable' && S.cableStart) { S.cableStart = null; renderRubber(); render(); } else select(null); }
      return;
    }
    if (dr.moved) {
      pushUndo(dr.snap);
      refresh();
    }
  });

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0015);
    zoomAt(e.clientX, e.clientY, f);
  }, { passive: false });

  function zoomAt(cx, cy, f) {
    const r = svg.getBoundingClientRect();
    const k = Math.min(3, Math.max(0.2, S.view.k * f));
    const px = cx - r.left, py = cy - r.top;
    S.view.x = px - (px - S.view.x) * (k / S.view.k);
    S.view.y = py - (py - S.view.y) * (k / S.view.k);
    S.view.k = k;
    applyView();
    renderDecorations(); renderRubber();
  }

  function fitView() {
    if (!S.topo.devices.length) { S.view = { x: 60, y: 40, k: 1 }; applyView(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const d of S.topo.devices) {
      const s = deviceSize(d);
      x0 = Math.min(x0, d.x); y0 = Math.min(y0, d.y); x1 = Math.max(x1, d.x + s.w); y1 = Math.max(y1, d.y + s.h + 18);
    }
    const r = svg.getBoundingClientRect();
    const pad = 40;
    const tp = $('#tpPanel');
    const left = !tp.hidden && r.width > 900 ? (tp.classList.contains('collapsed') ? 0 : tp.offsetWidth + 12) : 0;
    const k = Math.min(1.4, Math.max(0.2, Math.min((r.width - left - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
    S.view.k = k;
    S.view.x = left + (r.width - left - (x1 - x0) * k) / 2 - x0 * k;
    S.view.y = (r.height - (y1 - y0) * k) / 2 - y0 * k;
    applyView(); renderDecorations();
  }

  // Dépôt depuis la boîte à outils
  svg.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  svg.addEventListener('drop', e => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain');
    if (!CATALOG[type]) return;
    const w = toWorld(e.clientX, e.clientY);
    addDevice(type, w, false);
  });

  function select(sel) {
    S.sel = sel;
    lastDiag = null;
    S.bilanPort = null;
    if (sel && sel.kind === 'dev' && S.tab === 'otdr' && !isContainer(devById(sel.id))) { /* garde l'OTDR */ }
    render();
    renderInspector();
  }

  /* ------------------------------------------------------------------ */
  /*  Outils : câblage et instruments                                     */
  /* ------------------------------------------------------------------ */
  function toolClick(d) {
    const t = S.tool;
    if (t.kind === 'cable') return cableClick(d);
    if (t.kind !== 'cable') logJ(t.kind === 'pm' ? 'mesure' : t.kind, `${t.kind === 'pm' ? 'Photomètre sur' : t.kind === 'vfl' ? 'VFL injecté sur' : 'OTDR vers'} ${d.props.name}${t.kind === 'otdr' ? ` (${S.otdr.lambda} nm)` : ''}`, { id: d.id });
    if (t.kind === 'pm') { S.pm = { devId: d.id, key: null }; S.sel = { kind: 'dev', id: d.id }; render(); renderInspector(); renderInstrument(); return; }
    if (t.kind === 'vfl') { S.vfl = { devId: d.id, dir: (S.vfl && S.vfl.dir) || 'down' }; S.vfl.result = P.vflInject(S.engine, d.id, S.vfl.dir); render(); renderInstrument(); return; }
    if (t.kind === 'otdr') { S.otdr.devId = d.id; S.otdr.x0 = S.otdr.x1 = null; S.sel = { kind: 'dev', id: d.id }; runOtdr(true); S.tab = 'otdr'; render(); renderInspector(); return; }
  }

  function cableClick(d) {
    const type = S.tool.type;
    if (!S.cableStart) {
      S.cableStart = d.id; render(); renderStatus();
      return;
    }
    if (S.cableStart === d.id) { S.cableStart = null; render(); renderStatus(); return; }
    const A = devById(S.cableStart);
    const alloc = allocatePorts(A, d, type);
    if (alloc.error) { toast(alloc.error, 'err'); return; }
    S.cableStart = null;
    openCableDialog(type, alloc);
  }

  function freeOut(D, kind) {
    const ports = portsOf(D).out;
    const def = CATALOG[D.type];
    const free = ports.map((p, k) => k).filter(k => ports[k].kind === kind && !S.engine.outMap.has(D.id + '#' + k));
    if (def.mapping === 'port') {
      const fed = free.filter(k => S.engine.inMap.has(D.id + '#' + k));
      if (fed.length) return fed[0];
    }
    return free.length ? free[0] : -1;
  }
  function freeIn(D, kind) {
    const ports = portsOf(D).in;
    const i = ports.findIndex((p, k) => p.kind === kind && !S.engine.inMap.has(D.id + '#' + k));
    return i;
  }
  function allocatePorts(A, B, type) {
    const kind = CABLES[type].kind;
    const tryDir = (X, Y) => {
      const o = freeOut(X, kind), i = freeIn(Y, kind);
      return o >= 0 && i >= 0 ? { a: { dev: X.id, port: o }, b: { dev: Y.id, port: i } } : null;
    };
    const r = tryDir(A, B) || tryDir(B, A);
    if (r) return r;
    const hasKind = D => portsOf(D).in.concat(portsOf(D).out).some(p => p.kind === kind);
    if (!hasKind(A) || !hasKind(B)) return { error: kind === 'up' ? 'Le lien de collecte 10 GbE relie un port 10G du routeur de collecte à l\'uplink d\'un OLT ou d\'un switch AON.' : kind === 'eth' ? 'Le câble Cat6 relie un port RJ45 (ONT, switch, routeur) à un terminal (PC, téléphone, décodeur).' : 'Ce câble optique ne peut pas être raccordé à un équipement sans port optique (utilisez un câble Cat6).' };
    return { error: `Aucun couple de ports libres compatible entre « ${A.props.name} » et « ${B.props.name} » (sortie libre côté amont / entrée libre côté aval).` };
  }

  function openCableDialog(type, alloc) {
    const c = CABLES[type];
    const A = devById(alloc.a.dev), B = devById(alloc.b.dev);
    const def = Object.assign({}, c.defaults);
    // Colonne montante qui repart d'un PBO d'étage : la fibre traverse sans être coupée
    if (type === 'riser' && A.type === 'pbo_int') def.jointA = 'none';
    const jointOpts = sel => Object.entries(JOINTS).map(([k, j]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(j.label)}</option>`).join('');
    const opt = c.kind === 'opt';
    const lenM = def.length;
    const useKm = lenM >= 1000;
    let body = `<p class="muted">${esc(c.help)}</p>
      <div class="cable-ends"><div><small>Amont (sortie)</small><b>${esc(A.props.name)}</b><span>${esc(portsOf(A).out[alloc.a.port].label)}</span></div><div class="arrow">→</div><div><small>Aval (entrée)</small><b>${esc(B.props.name)}</b><span>${esc(portsOf(B).in[alloc.b.port].label)}</span></div></div>
      <div class="form-grid">
        <label>Longueur<div class="inline"><input type="number" id="cdLen" min="0" step="any" value="${useKm ? lenM / 1000 : lenM}"><select id="cdUnit"><option value="m" ${useKm ? '' : 'selected'}>m</option><option value="km" ${useKm ? 'selected' : ''}>km</option></select></div></label>`;
    if (type === 'riser' || type === 'lszh') body += `<label class="check"><input type="checkbox" id="cdAuto" ${def.autoLength ? 'checked' : ''}> Longueur auto (écart d'étages × hauteur d'étage)</label>`;
    if (opt) body += `<label>Raccordement extrémité amont<select id="cdJA">${jointOpts(def.jointA)}</select></label><label>Raccordement extrémité aval<select id="cdJB">${jointOpts(def.jointB)}</select></label>`;
    if (type === 'patch') body += `<label>Connecteurs<select id="cdConn">${P.CONNECTORS.map(x => `<option ${x === (A.props.connector || B.props.connector || 'SC/APC') ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Type<select id="cdDuplex"><option>Simplex</option><option>Duplex</option></select></label>`;
    if (opt && type !== 'patch') body += `<label>Capacité du câble<select id="cdFibers">${[1, 2, 4, 6, 12, 24, 48, 72, 144].map(n => `<option ${n === def.fibers ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
    body += '</div>';
    if (B.parent && devById(B.parent).type === 'bld_simple' && A.parent !== B.parent && opt && type !== 'patch') body += `<p class="tip">Ce câble entre dans « ${esc(devById(B.parent).props.name)} » : la gaine intérieure (${fmt(+devById(B.parent).props.gaineLength || 0, 0)} m) sera ajoutée automatiquement.</p>`;
    openModal(`Nouveau câble : ${c.label}`, body, [
      { label: 'Annuler', action: closeModal },
      { label: 'Créer le câble', primary: true, action: () => {
        let len = parseFloat($('#cdLen').value.replace(',', '.'));
        if (!isFinite(len) || len < 0) { toast('Longueur invalide.', 'err'); return; }
        if ($('#cdUnit').value === 'km') len *= 1000;
        const link = Object.assign(JSON.parse(JSON.stringify(def)), { id: uid('L'), type, a: alloc.a, b: alloc.b, length: Math.round(len * 1000) / 1000 });
        if ($('#cdAuto')) link.autoLength = $('#cdAuto').checked;
        if ($('#cdJA')) { link.jointA = $('#cdJA').value; link.jointB = $('#cdJB').value; }
        if ($('#cdConn')) { link.connector = $('#cdConn').value; link.duplex = $('#cdDuplex').value; }
        if ($('#cdFibers')) link.fibers = +$('#cdFibers').value;
        closeModal();
        mutate(() => S.topo.links.push(link));
        select({ kind: 'link', id: link.id });
        const tips = cableTips(link);
        if (tips.length) toast(`Câble inadapté : ${tips[0].text}${tips[0].suggest.length ? ' Préférez : ' + cableNames(tips[0].suggest) + '.' : ''}`, 'warn');
        else toast(`Câble créé : ${A.props.name} → ${B.props.name}`, 'ok');
      } }
    ]);
    setTimeout(() => { const i = $('#cdLen'); if (i) { i.focus(); i.select(); } }, 30);
  }

  /* ------------------------------------------------------------------ */
  /*  Modes                                                               */
  /* ------------------------------------------------------------------ */
  const MODE_LABELS = { design: 'Conception', test: 'Mesure / Test', fault: 'Simulation de pannes' };
  function setMode(m) {
    S.mode = m;
    document.body.className = document.body.className.replace(/mode-\w+/, 'mode-' + m);
    $$('#modeSwitch button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    if (m !== 'test') { if (S.tool && S.tool.kind !== 'cable') setTool(null); S.vfl = null; S.pm = null; }
    if (m !== 'design' && S.tool && S.tool.kind === 'cable') setTool(null);
    render(); renderInspector(); renderInstrument(); renderStatus();
  }

  /* ------------------------------------------------------------------ */
  /*  Inspecteur                                                          */
  /* ------------------------------------------------------------------ */
  const insp = $('#inspectorBody');

  function renderInspector() {
    $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
    if (S.tab === 'bilan') insp.innerHTML = bilanHTML();
    else if (S.tab === 'otdr') { insp.innerHTML = otdrHTML(); drawOtdr(); }
    else if (S.tab === 'config') {
      insp.innerHTML = configHTML();
      const d = S.sel && S.sel.kind === 'dev' ? devById(S.sel.id) : null;
      if (d && CATALOG[d.type].config) logJ('diag', `Diagnostic consulté : ${d.props.name}`, { id: d.id, term: !!SV.TERMINAL_SERVICE[d.type] || d.type === 'router' });
    }
    else insp.innerHTML = propsHTML();
    bindInspector();
  }

  function fieldHTML(f, val, scope) {
    const id = `f-${scope}-${f.key}`;
    const unit = f.unit ? `<span class="unit">${f.unit}</span>` : '';
    if (f.type === 'select') {
      const opts = f.options.map(o => Array.isArray(o) ? o : [o, o === 'none' ? 'Aucun' : o]).map(([v, lb]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(lb)}</option>`).join('');
      return `<label for="${id}">${esc(f.label)}<div class="inline"><select id="${id}" data-k="${f.key}" data-scope="${scope}">${opts}</select>${unit}</div></label>`;
    }
    if (f.type === 'checkbox') return `<label class="check"><input type="checkbox" id="${id}" data-k="${f.key}" data-scope="${scope}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
    if (f.type === 'number') return `<label for="${id}">${esc(f.label)}<div class="inline"><input type="number" id="${id}" data-k="${f.key}" data-scope="${scope}" value="${esc(val)}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} step="${f.step || 'any'}">${unit}</div></label>`;
    return `<label for="${id}">${esc(f.label)}<input type="text" id="${id}" data-k="${f.key}" data-scope="${scope}" value="${esc(val)}"></label>`;
  }

  function statusPill(st) {
    if (!st) return '';
    return `<span class="pill st-${st.code}">${esc(st.label)}</span>`;
  }

  function faultEditor(obj, isLink) {
    const f = obj.fault || {};
    const allowed = Object.entries(FAULTS).filter(([, v]) => isLink ? v.link : v.device);
    if (S.mode !== 'fault') {
      if (f.type && !f.hidden) return `<div class="alert err"><b>Panne active :</b> ${esc(FAULTS[f.type].label)}${isLink && FAULTS[f.type].positional ? ` à ${fmt(f.pos, 1)} m de l'extrémité amont` : ''}. <small>(Mode « ${MODE_LABELS.fault} » pour ${TEACHER ? 'réparer' : 'intervenir'})</small></div>`;
      return '';
    }
    if (!TEACHER || S.exam) return interventionHTML(obj, isLink);
    
  }

  /** Intervention de l'élève : remet l'élément en état sans dire s'il était en panne. */
  function interventionHTML(obj, isLink) {
    if (!isLink && isContainer(obj)) return '';
    const txt = isLink ? 'Reprendre ce câble : refaire les épissures, nettoyer ou remplacer les connecteurs, corriger le cheminement (rayon de courbure).' : 'Nettoyer les connecteurs ou remplacer cet équipement.';
    return `<div class="section fault-box"><h4>Intervention</h4><p class="small">${txt} Intervenez seulement après avoir localisé le défaut par la mesure${S.exam ? ' : chaque intervention inutile est pénalisée' : ''}.</p><div class="row"><button class="btn ok" data-act="intervene">${isLink ? 'Reprendre le câble' : 'Nettoyer / remplacer'}</button></div>${TEACHER && S.exam ? '<p class="muted small">Examen en cours : l\'injection de pannes est désactivée (vue élève).</p>' : ''}</div>`;
  }

  function propsHTML() {
    if (!S.sel) return overviewHTML();
    if (S.sel.kind === 'link') return linkPropsHTML(linkById(S.sel.id));
    const d = devById(S.sel.id);
    if (!d) return overviewHTML();
    const def = CATALOG[d.type];
    let h = `<div class="insp-head"><span class="chip" style="background:${def.color}">${def.short}</span><div><b>${esc(d.props.name)}</b><small>${esc(def.label)}</small></div></div>`;
    h += `<p class="muted">${esc(def.desc)}</p>`;
    if (isRoom(d)) {
      h += `<div class="section"><h4>Paramètres du local</h4><div class="form-grid">${def.props.map(f => fieldHTML(f, d.props[f.key], 'dev')).join('')}</div></div>`;
      const inside = S.topo.devices.filter(x => x.room === d.id);
      const B = d.parent ? devById(d.parent) : null;
      h += `<div class="section"><h4>Informations</h4><table class="kv"><tr><td>Bâtiment</td><td>${B ? esc(B.props.name) + (B.type === 'bld_mdu' ? ' — ' + P.floorLabel(d.floor) : '') : '<span class="st-weak">hors bâtiment</span>'}</td></tr>`;
      h += `<tr><td>Équipements</td><td>${inside.length ? inside.map(x => `<a href="#" data-sel-dev="${x.id}">${esc(x.props.name)}</a>`).join(', ') : '<span class="muted">aucun</span>'}</td></tr><tr><td>Taille</td><td>${Math.round(d.w)} × ${Math.round(d.h)} px</td></tr></table>`;
      h += '<p class="muted small">Le local illustre le plan du bâtiment : il n\'intervient pas dans le bilan. Déplacez-le (ses équipements suivent) ou ajustez-le avec les poignées de ses coins et de ses côtés.</p></div>';
      return h + `<div class="row"><button class="btn danger" data-act="delete">Supprimer le local</button></div>`;
    }
    if (def.container) {
      h += `<div class="section"><h4>Paramètres du bâtiment</h4><div class="form-grid">${def.props.map(f => fieldHTML(f, d.props[f.key], 'dev')).join('')}</div></div>`;
      const kids = S.topo.devices.filter(x => x.parent === d.id && !isRoom(x));
      const rooms = S.topo.devices.filter(x => x.parent === d.id && isRoom(x));
      const r = buildingRect(d);
      h += `<div class="section"><h4>Informations</h4><table class="kv">`;
      if (d.type === 'bld_mdu') {
        const lv = mduLevels(d);
        h += `<tr><td>Niveaux</td><td>${lv.length} (${lv[lv.length - 1].label} → ${lv[0].label})</td></tr><tr><td>Hauteur totale</td><td>${fmt(lv.length * d.props.floorHeight, 1)} m</td></tr>`;
        lv.forEach(l => { const n = kids.filter(k => k.floor === l.floor).length, rl = rooms.filter(k => k.floor === l.floor); if (n || rl.length) h += `<tr><td>${l.label}</td><td>${n} équipement(s)${rl.length ? ' · ' + rl.map(x => esc(x.props.name)).join(', ') : ''}</td></tr>`; });
      } else h += `<tr><td>Gaine intérieure</td><td>${fmt(+d.props.gaineLength || 0, 0)} m (ajoutée aux câbles entrants)</td></tr>`;
      if (d.type !== 'bld_mdu' && rooms.length) h += `<tr><td>Locaux</td><td>${rooms.map(x => `<a href="#" data-sel-dev="${x.id}">${esc(x.props.name)}</a>`).join(', ')}</td></tr>`;
      h += `<tr><td>Équipements</td><td>${kids.length}</td></tr><tr><td>Taille</td><td>${Math.round(r.w)} × ${Math.round(r.h)} px</td></tr></table></div>`;
      h += `<div class="row"><button class="btn danger" data-act="delete">Supprimer le bâtiment</button></div>`;
      return h;
    }
    const st = S.engine.deviceState(d.id);
    h += `<div class="section status-line">${statusPill(st)}${st.power !== undefined ? `<b class="big">${dbm(st.power)}</b>` : ''}</div>`;
    if (d.parent) h += `<p class="loc">📍 ${esc(locationText(d))}</p>`;
    h += faultEditor(d, false);
    if (S.mode === 'fault' && def.config) h += `<p class="muted small">${TEACHER && !S.exam ? 'Pannes de configuration (VLAN, autorisation, PPPoE, DHCP…) : onglet « Configuration ».' : 'Une erreur de configuration (VLAN, autorisation, PPPoE, DHCP…) se corrige dans l\'onglet « Configuration ».'}</p>`;
    h += `<div class="section"><h4>Paramètres</h4><div class="form-grid">${def.props.map(f => fieldHTML(f, d.props[f.key], 'dev')).join('')}</div></div>`;
    // ports
    const ports = portsOf(d);
    const rows = [];
    const portRow = (p, k, side) => {
      const link = side === 'in' ? S.engine.inMap.get(d.id + '#' + k) : S.engine.outMap.get(d.id + '#' + k);
      let peer = '<span class="muted">libre</span>', pw = '';
      if (link) {
        const o = devById(side === 'in' ? link.a.dev : link.b.dev);
        const op = side === 'in' ? portsOf(o).out[link.a.port] : portsOf(o).in[link.b.port];
        peer = `<a href="#" data-sel-link="${link.id}">${esc(o.props.name)}</a> <small>${esc(op ? op.label : '')} · ${CABLES[link.type].short}</small>`;
      }
      if (p.kind === 'opt') {
        const r = side === 'in' ? (link ? S.engine.traceIn(d.id, k) : null) : S.engine.traceOut(d.id, k);
        const v = S.engine.power(r);
        if (link || side === 'out') pw = r ? (r.dark ? '<span class="muted">sombre</span>' : `<span class="st-${portCode(d, side, r, v)}">${dbm(v)}</span>`) : '';
      }
      if (link || ports[side].length <= 16) rows.push(`<tr><td><span class="pdot ${p.kind}"></span>${esc(p.label)}</td><td>${peer}</td><td class="num">${pw}</td></tr>`);
    };
    ports.in.forEach((p, k) => portRow(p, k, 'in'));
    ports.out.forEach((p, k) => portRow(p, k, 'out'));
    if (rows.length) h += `<div class="section"><h4>Ports & raccordements <small>(${ports.in.length} entrée(s), ${ports.out.length} sortie(s))</small></h4><table class="ports">${rows.join('')}</table>${ports.in.length + ports.out.length > 32 ? '<p class="muted small">Seuls les ports raccordés sont listés.</p>' : ''}</div>`;
    h += `<div class="row"><button class="btn" data-act="bilan">Voir le bilan optique</button><button class="btn" data-act="dup">Dupliquer</button><button class="btn danger" data-act="delete">Supprimer</button></div>`;
    return h;
  }

  /* ---------------- Configuration (couche service) ---------------- */
  const ROW_DEFAULTS = { onts: { sn: '', profile: 'trio' }, accounts: { login: '', password: '' }, ports: { enabled: false, profile: 'internet-1g' } };

  function profileSelect(val, attrs) {
    return `<select ${attrs}>${Object.entries(P.PROFILES).map(([k, p]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>`;
  }

  function svcPill(r) {
    if (!r || !r.evaluated) return '<span class="pill st-nc">Non évalué</span>';
    return r.ok ? '<span class="pill st-ok">En service</span>' : '<span class="pill st-los">En défaut</span>';
  }

  function stepsHTML(r) {
    let h = `<ol class="svc-steps">${r.steps.map(s => `<li class="${s.ok ? 'ok' : 'ko'}"><b>${esc(s.label)}</b><small>${esc(s.detail)}</small></li>`).join('')}</ol>`;
    if (!r.ok && r.steps.length) h += '<p class="muted small">Les étapes suivantes ne sont pas vérifiées tant que celle-ci est en défaut.</p>';
    return h;
  }

  function terminalPanelHTML(d) {
    const r = S.services.terminals.get(d.id);
    if (!r) return '';
    let h = `<div class="section"><h4>Service ${esc(r.label)}</h4><div class="status-line">${svcPill(r)}${r.ok ? `<b>${SV.nf(r.debit.down)} Mbit/s ↓ · ${SV.nf(r.debit.up)} Mbit/s ↑</b>` : ''}</div>`;
    if (!r.evaluated) return h + `<p class="muted">${esc(r.reason)}</p></div>`;
    if (r.ok) h += `<table class="kv"><tr><td>Adresse IP</td><td>${esc(r.ip)}</td></tr><tr><td>Débit maximal</td><td>${esc(r.debit.note)}</td></tr></table>`;
    return h + `<h5>Diagnostic pas à pas</h5>${stepsHTML(r)}</div>`;
  }

  function boxPanelHTML(d) {
    const w = S.services.boxes.get(d.id);
    let h = '<div class="section"><h4>État de la Box</h4>';
    if (!S.services.active) return h + '<p class="muted">Couche service non évaluée : aucun routeur de collecte raccordé.</p></div>';
    h += `<table class="kv"><tr><td>Session WAN</td><td>${w ? (w.ok ? `<span class="st-ok">Connectée</span> · ${esc(w.ip)} (${esc(SV.MODE_LABEL[w.mode])})` : `<span class="st-los">Échec</span> · ${esc(w.reason)}`) : '<span class="muted">Non testée (voir les appareils)</span>'}</td></tr>`;
    portsOf(d).out.forEach((p, k) => {
      const l = S.engine.outMap.get(d.id + '#' + k);
      const t = l ? devById(l.b.dev) : null;
      const r = t ? S.services.terminals.get(t.id) : null;
      if (r) h += `<tr><td>${esc(p.label)}</td><td>${esc(t.props.name)} · ${esc(r.label)} ${r.ok ? `<span class="st-ok">✓</span> ${esc(r.ip)}` : `<span class="st-los">✗</span> <small>${esc(r.reason)}</small>`}</td></tr>`;
    });
    return h + '</table></div>';
  }

  function ontPanelHTML(d) {
    const o = S.services.onts.get(d.id);
    let h = `<div class="section"><h4>Raccordement logique</h4><table class="kv"><tr><td>Numéro de série</td><td><code>${esc(o ? o.sn : SV.snOf(d))}</code></td></tr>`;
    if (o && o.head) {
      const isAon = o.head.type === 'switch_aon';
      h += `<tr><td>Équipement de tête</td><td>${esc(o.head.props.name)} · ${isAon ? 'SFP' : 'PON'} ${o.port + 1}</td></tr>`;
      if (o.auth) h += `<tr><td>${isAon ? 'Port' : 'Autorisation'}</td><td>${o.auth.ok ? `<span class="st-ok">${isAon ? 'Activé' : o.auth.how === 'auto' ? 'Automatique' : 'Déclarée'}</span> · ${esc(P.PROFILES[o.profile] ? P.PROFILES[o.profile].label : '')}` : `<span class="st-los">${isAon ? 'Port désactivé' : 'Non déclarée sur l\'OLT'}</span>`}</td></tr>`;
    } else h += '<tr><td>Équipement de tête</td><td class="muted">Aucun (pas de liaison optique vers un OLT ou un switch AON)</td></tr>';
    return h + '</table></div>';
  }

  function headPanelHTML(d) {
    const hd = S.services.heads.get(d.id);
    let h = '<div class="section"><h4>Raccordement au réseau de collecte</h4><table class="kv">';
    h += `<tr><td>Routeur de collecte</td><td>${hd && hd.collecte ? `<span class="st-ok">${esc(hd.collecte.props.name)}</span>` : '<span class="st-los">Non relié</span> <small>(câble « Lien de collecte 10 GbE » vers l\'uplink)</small>'}</td></tr>`;
    if (hd) {
      const up = hd.onts.filter(o => o.up).length;
      h += `<tr><td>${d.type === 'olt' ? 'ONT en ligne' : 'Abonnés raccordés'}</td><td>${up} / ${hd.onts.length}</td></tr>`;
    }
    return h + '</table></div>';
  }

  function collectePanelHTML(d) {
    let h = '<div class="section"><h4>Équipements desservis</h4><table class="kv">';
    let n = 0;
    portsOf(d).out.forEach((p, k) => {
      const l = S.engine.outMap.get(d.id + '#' + k);
      const t = l ? devById(l.b.dev) : null;
      if (!t) return;
      n++;
      const hd = S.services.heads.get(t.id);
      h += `<tr><td>${esc(p.label)}</td><td>${esc(t.props.name)}${hd ? ` · ${hd.onts.filter(o => o.up).length} abonné(s) en ligne` : ''}</td></tr>`;
    });
    const sessions = [...S.services.boxes.values()].filter(w => w.ok).length;
    if (!n) h += '<tr><td colspan="2" class="muted">Aucun lien de collecte : reliez un port 10G à l\'uplink d\'un OLT ou d\'un switch AON.</td></tr>';
    h += `<tr><td>Sessions WAN ouvertes</td><td>${sessions}</td></tr>`;
    return h + '</table></div>';
  }

  function ontTableHTML(d) {
    const list = d.props.onts || [];
    let h = '<p class="muted small">Déclarez chaque ONT par son numéro de série (inscrit sur l\'étiquette de l\'ONT) et choisissez son profil de service.</p>';
    h += '<table class="cfg-table"><tr><th>N° de série</th><th>Profil</th><th></th></tr>';
    list.forEach((e, i) => { h += `<tr><td><input type="text" data-row="onts" data-i="${i}" data-f="sn" value="${esc(e.sn)}" spellcheck="false" placeholder="ex. OPTI1A2B3C4D"></td><td>${profileSelect(e.profile, `data-row="onts" data-i="${i}" data-f="profile"`)}</td><td><button class="btn icon small" data-row-del="onts" data-i="${i}" title="Retirer cette ONT" aria-label="Retirer">✕</button></td></tr>`; });
    if (!list.length) h += '<tr><td colspan="3" class="muted">Aucune ONT déclarée.</td></tr>';
    h += '</table><div class="row"><button class="btn small" data-row-add="onts">+ Déclarer une ONT</button></div>';
    const hd = S.services && S.services.heads.get(d.id);
    const seen = hd ? hd.onts.filter(o => o.up) : [];
    h += '<h5>ONT détectées sur les ports PON</h5>';
    if (!seen.length) return h + '<p class="muted small">Aucune ONT détectée. Une ONT n\'apparaît que si elle reçoit assez de lumière.</p>';
    h += '<table class="cfg-table"><tr><th>ONT</th><th>N° de série</th><th>Port</th><th></th></tr>';
    seen.forEach(o => {
      const declared = list.some(e => String(e.sn || '').trim().toUpperCase() === o.sn);
      h += `<tr><td>${esc(o.name)}</td><td><code>${esc(o.sn)}</code></td><td>PON ${o.port + 1}</td><td>${declared ? '<span class="st-ok">Déclarée</span>' : `<button class="btn small" data-authorize="${esc(o.sn)}">Autoriser</button>`}</td></tr>`;
    });
    return h + '</table>';
  }

  function accountTableHTML(d) {
    const list = d.props.accounts || [];
    let h = '<h5>Comptes PPPoE des abonnés</h5><table class="cfg-table"><tr><th>Identifiant</th><th>Mot de passe</th><th></th></tr>';
    list.forEach((a, i) => { h += `<tr><td><input type="text" data-row="accounts" data-i="${i}" data-f="login" value="${esc(a.login)}" spellcheck="false"></td><td><input type="text" data-row="accounts" data-i="${i}" data-f="password" value="${esc(a.password)}" spellcheck="false"></td><td><button class="btn icon small" data-row-del="accounts" data-i="${i}" title="Supprimer ce compte" aria-label="Supprimer">✕</button></td></tr>`; });
    if (!list.length) h += '<tr><td colspan="3" class="muted">Aucun compte.</td></tr>';
    return h + '</table><div class="row"><button class="btn small" data-row-add="accounts">+ Ajouter un compte</button></div>';
  }

  function aonPortsHTML(d) {
    const ports = d.props.ports || [];
    let h = '<p class="muted small">En Active Ethernet, l\'abonné est identifié par le port physique : activez son port et choisissez son profil.</p>';
    h += '<table class="cfg-table"><tr><th>Port</th><th>Actif</th><th>Profil</th><th>Abonné</th></tr>';
    const onts = S.services ? [...S.services.onts.entries()].filter(([, o]) => o.head && o.head.id === d.id) : [];
    for (let k = 0; k < +d.props.sfpPorts; k++) {
      const c = Object.assign({}, ROW_DEFAULTS.ports, ports[k] || {});
      const who = onts.find(([, o]) => o.port === k);
      h += `<tr><td>SFP ${k + 1}</td><td><input type="checkbox" data-row="ports" data-i="${k}" data-f="enabled" ${c.enabled ? 'checked' : ''} aria-label="Port SFP ${k + 1} actif"></td><td>${profileSelect(c.profile, `data-row="ports" data-i="${k}" data-f="profile"`)}</td><td>${who ? esc(devById(who[0]).props.name) : '<span class="muted">—</span>'}</td></tr>`;
    }
    return h + '</table>';
  }

  function cfgFieldsHTML(d, def) {
    let h = '', open = false;
    const close = () => { if (open) { h += '</div></div>'; open = false; } };
    for (const f of def.config) {
      if (f.group) { close(); h += `<div class="section"><h4>${esc(f.group)}</h4><div class="form-grid">`; open = true; continue; }
      if (f.show && !f.show(d.props)) continue;
      if (f.type === 'ontTable') h += `<div>${ontTableHTML(d)}</div>`;
      else if (f.type === 'accountTable') h += `<div>${accountTableHTML(d)}</div>`;
      else if (f.type === 'aonPorts') h += `<div>${aonPortsHTML(d)}</div>`;
      else h += fieldHTML(f, d.props[f.key], 'cfg');
    }
    close();
    return h;
  }

  function servicesTableHTML() {
    const rows = S.topo.devices.filter(d => SV.TERMINAL_SERVICE[d.type]).map(d => ({ d, r: S.services.terminals.get(d.id) })).filter(x => x.r && x.r.evaluated);
    if (!rows.length) return '<p class="muted small">Aucun appareil abonné (PC, décodeur, téléphone) raccordé.</p>';
    return `<table class="cfg-table svc-table"><tr><th>Appareil</th><th>Service</th><th>État</th></tr>${rows.map(({ d, r }) => `<tr><td><a href="#" data-sel-dev="${d.id}">${esc(d.props.name)}</a></td><td>${esc(r.label)}</td><td>${r.ok ? `<span class="st-ok">✓ ${SV.nf(r.debit.down)} Mbit/s</span>` : `<span class="st-los">✗</span> <small>${esc(r.reason)}</small>`}</td></tr>`).join('')}</table>`;
  }

  const CFG_ARRAY_LABEL = { onts: 'Liste des ONT autorisées', accounts: 'Comptes PPPoE', ports: 'Ports SFP' };
  function cfgFaultEditor(d) {
    const f = d.cfgFault, def = f && SV.CFG_FAULTS[f.type];
    if (S.mode !== 'fault' || !TEACHER || S.exam) {
      if (f && !f.hidden) return `<div class="alert err"><b>Panne de configuration :</b> ${esc(def.label)}. <small>(Corrigez la configuration ci-dessous${TEACHER ? ', ou réparez en mode « Simulation de pannes »' : ''}.)</small></div>`;
      return '';
    }
    
  }

  function configHTML() {
    const d = S.sel && S.sel.kind === 'dev' ? devById(S.sel.id) : null;
    if (!d || isContainer(d)) {
      let h = '<div class="insp-head"><div><b>Configuration & services</b><small>Sélectionnez un équipement actif : routeur de collecte, OLT, switch AON, ONT, Box ou appareil.</small></div></div>';
      if (!S.services.active) return h + '<p class="muted">La couche service n\'est évaluée que lorsqu\'un <b>routeur de collecte</b> est relié par un « Lien de collecte 10 GbE » à un OLT ou à un switch AON. Voir la documentation : <a href="#" data-doc-link="svc-intro">Équipements actifs & services</a>.</p>';
      return h + `<div class="section"><h4>Services des abonnés</h4>${servicesTableHTML()}</div>`;
    }
    const def = CATALOG[d.type];
    let h = `<div class="insp-head"><span class="chip" style="background:${def.color}">${def.short}</span><div><b>${esc(d.props.name)}</b><small>${esc(def.label)}</small></div></div>`;
    if (!def.config) return h + '<p class="muted">Équipement passif ou sans configuration logique : ses réglages physiques sont dans l\'onglet « Propriétés ».</p>';
    h += cfgFaultEditor(d);
    if (SV.TERMINAL_SERVICE[d.type]) h += terminalPanelHTML(d);
    else if (d.type === 'router') h += boxPanelHTML(d);
    else if (d.type === 'ont') h += ontPanelHTML(d);
    else if (d.type === 'olt' || d.type === 'switch_aon') h += headPanelHTML(d);
    else if (d.type === 'collecte') h += collectePanelHTML(d);
    return h + cfgFieldsHTML(d, def);
  }

  function linkPropsHTML(l) {
    if (!l) return overviewHTML();
    const c = CABLES[l.type];
    const A = devById(l.a.dev), B = devById(l.b.dev);
    const li = S.engine.lengthInfo(l);
    const ls = S.engine.linkState(l);
    let h = `<div class="insp-head"><span class="chip" style="background:${l.type === 'patch' ? P.connectorColor(l.connector) : c.color};color:#111">${esc(c.short)}</span><div><b>${esc(c.label)}</b><small>${esc(A.props.name)} → ${esc(B.props.name)}</small></div></div>`;
    h += `<p class="muted">${esc(c.help)}</p>`;
    if (c.kind === 'opt') h += `<div class="section status-line">${statusPill(ls.code === 'dark' ? { code: 'nc', label: 'Pas de lumière (aucune source)' } : { code: ls.code, label: ls.label || 'LOS' })}${ls.power !== undefined && ls.power !== null ? `<b class="big">${dbm(ls.power)}</b><small>à l'arrivée</small>` : ''}</div>`;
    else h += `<div class="section status-line">${statusPill(ls.up ? { code: 'ok', label: c.kind === 'up' ? 'Lien de collecte actif (10 Gbit/s)' : 'Lien Ethernet actif' } : { code: 'los', label: ls.reason || 'Lien inactif' })}</div>`;
    
    h += faultEditor(l, true);
    const outOpts = portsOf(A).out.map((p, k) => [p, k]).filter(([p, k]) => p.kind === c.kind && (k === l.a.port || !S.engine.outMap.has(A.id + '#' + k)));
    const inOpts = portsOf(B).in.map((p, k) => [p, k]).filter(([p, k]) => p.kind === c.kind && (k === l.b.port || !S.engine.inMap.has(B.id + '#' + k)));
    h += `<div class="section"><h4>Raccordement</h4><div class="form-grid">
      <label>Port amont (${esc(A.props.name)})<select data-lk="aport">${outOpts.map(([p, k]) => `<option value="${k}" ${k === l.a.port ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
      <label>Port aval (${esc(B.props.name)})<select data-lk="bport">${inOpts.map(([p, k]) => `<option value="${k}" ${k === l.b.port ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>`;
    const autoOK = li.auto;
    h += `<label>Longueur ${l.autoLength && autoOK ? '(calculée)' : ''}<div class="inline"><input type="number" data-lk="length" min="0" step="any" value="${l.autoLength && autoOK ? li.base : l.length}" ${l.autoLength && autoOK ? 'disabled' : ''}><span class="unit">m</span></div></label>`;
    if (l.type === 'riser' || l.type === 'lszh') h += `<label class="check"><input type="checkbox" data-lk="autoLength" ${l.autoLength ? 'checked' : ''}> Longueur auto (étages)</label>`;
    if (c.kind === 'opt') {
      const jo = v => Object.entries(JOINTS).map(([k, j]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(j.label)}</option>`).join('');
      h += `<label>Raccordement amont<select data-lk="jointA">${jo(l.jointA)}</select></label><label>Raccordement aval<select data-lk="jointB">${jo(l.jointB)}</select></label>`;
      if (l.type === 'patch') h += `<label>Connecteurs<select data-lk="connector">${P.CONNECTORS.map(x => `<option ${x === l.connector ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Type<select data-lk="duplex">${['Simplex', 'Duplex'].map(x => `<option ${x === l.duplex ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`;
      else h += `<label>Capacité<div class="inline"><select data-lk="fibers">${[1, 2, 4, 6, 12, 24, 48, 72, 144].map(n => `<option ${n === +l.fibers ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="unit">FO</span></div></label>`;
    }
    h += '</div></div>';
    if (c.kind === 'opt') {
      const lambda = (ls.res && ls.res.lambda) || 1310;
      const seg = S.engineRef.linkSegment(l, lambda); // mode recette : valeurs de référence
      h += `<div class="section"><h4>Pertes du câble à ${lambda} nm</h4><table class="kv">`;
      seg.items.filter(it => !it.hidden).forEach(it => { h += `<tr><td>${esc(it.label)}</td><td class="num">${isFinite(it.loss) ? fmt(it.loss, 3) + ' dB' : '<b class="st-los">∞</b>'}</td></tr>`; });
      h += `<tr class="total"><td>Total câble</td><td class="num">${fmt(seg.items.filter(it => !it.hidden).reduce((s, it) => s + (isFinite(it.loss) ? it.loss : 0), 0), 3)} dB</td></tr></table>`;
      if (li.auto) h += `<p class="muted small">Colonne montante : ${Math.abs(A.floor - B.floor)} niveau(x) × ${fmt(devById(A.parent).props.floorHeight, 1)} m.</p>`;
      seg.warnings.forEach(w => { h += `<div class="alert warn">${esc(w)}</div>`; });
      h += '</div>';
    } else if (+l.length > P.ETH_MAX) h += `<div class="alert warn">Lien cuivre de ${l.length} m : la limite Ethernet est de 100 m.</div>`;
    h += `<div class="row"><button class="btn danger" data-act="delete">Supprimer le câble</button></div>`;
    return h;
  }

  function overviewHTML() {
    const n = S.topo.devices.filter(d => !isContainer(d)).length;
    const nb = S.topo.devices.filter(d => isContainer(d) && !isRoom(d)).length;
    const nr = S.topo.devices.filter(isRoom).length;
    let h = `<div class="insp-head"><div><b>Aucune sélection</b><small>Cliquez sur un équipement, un câble ou un bâtiment</small></div></div>`;
    h += `<div class="section"><h4>Topologie</h4><table class="kv"><tr><td>Équipements</td><td>${n}</td></tr><tr><td>Bâtiments</td><td>${nb}${nr ? ` (${nr} ${nr > 1 ? 'locaux' : 'local'})` : ''}</td></tr><tr><td>Câbles</td><td>${S.topo.links.length}</td></tr>`;
    
    const onts = S.topo.devices.filter(d => d.type === 'ont' || (d.type === 'switch' && d.props.role === 'acces'));
    if (onts.length) {
      const c = { ok: 0, weak: 0, los: 0, sat: 0, nc: 0, dark: 0 };
      onts.forEach(o => { const s = S.engine.deviceState(o.id); c[s.code] = (c[s.code] || 0) + 1; });
      h += `<tr><td>Récepteurs (ONT / switch)</td><td><span class="st-ok">${c.ok} OK</span> · <span class="st-weak">${c.weak} faibles</span> · <span class="st-los">${c.los + c.sat} LOS/sat.</span></td></tr>`;
    }
    h += '</table></div>';
    const w = S.engine.warnings();
    if (w.length) h += `<div class="section"><h4>Alertes d'ingénierie</h4>${w.map(x => `<div class="alert warn"><a href="#" data-sel-link="${x.id}">${esc(x.text)}</a></div>`).join('')}</div>`;
    if (S.services && S.services.active) h += `<div class="section"><h4>Services des abonnés</h4>${servicesTableHTML()}<p class="muted small">Détail et configuration : onglet « Configuration ».</p></div>`;
    if (S.exam) {
      h += `<div class="section"><h4>Examen en cours</h4><p class="small">Le réseau est verrouillé : seuls les mesures, les réglages et les interventions sont permis. Vos actions sont enregistrées.</p>
      <div class="row"><button class="btn" data-act="exam-consignes">Consignes</button><button class="btn primary" data-act="exam-rendre">Rendre ma copie</button></div></div>`;
      return h;
    }
    h += `<div class="section"><h4>Démarrage rapide</h4><ol class="small">
      <li>Glissez un <b>OLT</b>, un <b>ODF</b> et des équipements sur le canevas.</li>
      <li>Choisissez un <b>câble</b> dans la boîte à outils puis cliquez sur l'équipement amont et l'équipement aval.</li>
      <li>Passez en mode <b>Mesure / Test</b> pour utiliser photomètre, OTDR et VFL.</li>
      <li>Ou chargez un <a href="#" data-act="labs">TP prêt à l'emploi</a>.</li></ol></div>`;
    return h;
  }

  /* ---------------- Bilan optique ---------------- */
  function bilanTarget() {
    if (!S.sel) return null;
    if (S.sel.kind === 'link') { const l = linkById(S.sel.id); return l && CABLES[l.type].kind === 'opt' ? { d: devById(l.b.dev), port: l.b.port } : null; }
    const d = devById(S.sel.id);
    if (!d || isContainer(d)) return null;
    return { d, port: null };
  }

  /** Jauge du budget optique consommé, et conformité à la classe GPON de l'OLT. */
  function budgetBarHTML(bu, known) {
    let h = '';
    if (known && bu.utilise !== null) {
      const code = bu.reste < 0 ? 'los' : bu.tient ? 'ok' : 'weak';
      const adm = Math.max(0, Math.min(100, bu.admissible / bu.budget * 100));
      h += `<div class="budget-gauge" title="Pertes calculées / budget optique"><div class="bg-track"><i class="st-${code}" style="width:${Math.min(100, Math.max(1, bu.utilise))}%"></i><b style="left:${adm}%" title="Pertes admissibles (marge de sécurité)"></b></div>
        <small>Budget utilisé : <b>${fmt(bu.utilise, 1)} %</b> — ${bu.reste < 0 ? 'pertes supérieures au budget : le récepteur ne capte pas le signal' : bu.tient ? `il reste ${fmt(bu.reste - bu.marge)} dB avant la marge de sécurité` : 'la marge de sécurité est entamée : signal faible'}</small></div>`;
    }
    if (bu.classe) h += `<p class="small muted">Classe GPON <b>${esc(bu.classe.nom)}</b> de l'OLT : affaiblissement du réseau passif entre ${fmt(bu.classe.min, 0)} et ${fmt(bu.classe.max, 0)} dB (norme, pire cas)${known && bu.classeOk !== null ? ` → pertes de ${fmt(bu.pertes)} dB : <b class="st-${bu.classeOk ? 'ok' : 'los'}">${bu.classeOk ? 'conforme' : 'hors classe'}</b>` : ''}.</p>`;
    return h;
  }

  function bilanHTML() {
    const t = bilanTarget();
    if (!t) return `<div class="insp-head"><div><b>Bilan optique</b><small>Sélectionnez un équipement récepteur (ONT, PTO, switch…) ou un câble.</small></div></div><p class="muted">Le bilan détaille, tronçon par tronçon, toutes les pertes entre la source (OLT / switch) et le point choisi : NRO, extérieur, ODF/PMI, colonne montante, PBO d'étage et branchement abonné.</p>` + recetteHTML();
    const E = S.engineRef, recette = E !== S.engine;
    const d = t.d;
    const ports = portsOf(d).in.map((p, k) => [p, k]).filter(([p, k]) => p.kind === 'opt' && E.inMap.has(d.id + '#' + k));
    let port = S.bilanPort !== null ? S.bilanPort : t.port;
    if (port === null) { const b = E.bestIn(d.id); port = b ? b.port : (ports[0] ? ports[0][1] : null); }
    let h = `<div class="insp-head"><span class="chip" style="background:${CATALOG[d.type].color}">${CATALOG[d.type].short}</span><div><b>Bilan jusqu'à : ${esc(d.props.name)}</b>${d.parent ? `<small>📍 ${esc(locationText(d))}</small>` : ''}<small>Somme des pertes depuis la source</small></div></div>`;
    if (recette) h += '<div class="alert info small">Mode recette réaliste : ce bilan est le <b>calcul théorique</b> (valeurs de référence). La puissance réellement reçue se mesure au photomètre ; comparez-les dans la fiche de recette (onglet Bilan optique, sans sélection).</div>';
    if (ports.length > 1) h += `<label class="inline-label">Port d'entrée <select id="bilanPort">${ports.map(([p, k]) => `<option value="${k}" ${k === port ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>`;
    const res = port !== null ? E.traceIn(d.id, port) : null;
    if (!ports.length) return h + `<div class="alert warn">Aucun câble optique n'arrive sur cet équipement.</div>`;
    if (!res) return h + `<div class="alert warn">Aucun chemin optique continu n'arrive sur cet équipement (port non raccordé ou erreur de brassage en amont).</div>`;
    const groups = new Map(CATEGORIES.map(c => [c, []]));
    let src = null;
    for (const seg of res.segments) {
      if (seg.kind === 'source') { src = seg; continue; }
      for (const it of seg.items) {
        if (it.kind === 'pass' || (it.loss === 0 && it.kind !== 'fiber')) continue;
        const hidden = !!it.hidden;
        groups.get(seg.category).push({ label: hidden ? 'Pertes mesurées anormales (panne cachée ?)' : `${seg.label} — ${it.label}`, loss: hidden ? null : it.loss, hidden, fault: it.fault });
      }
    }
    const total = res.loss;
    const maxG = Math.max(0.01, ...Array.from(groups.values()).map(g => g.reduce((s, x) => s + (isFinite(x.loss) ? x.loss || 0 : 0), 0)));
    h += '<table class="bilan">';
    if (src) { const S0 = devById(src.id); h += `<tr class="src"><td>Émission ${esc(S0.props.name)} (${res.lambda} nm)</td><td class="num">${dbm(res.tx)}</td></tr>`; }
    else h += `<tr class="src"><td colspan="2">Aucune source en amont (réseau « sombre ») — pertes seules</td></tr>`;
    let hiddenFault = false;
    for (const [cat, items] of groups) {
      if (!items.length) continue;
      const sub = items.reduce((s, x) => s + (x.loss !== null && isFinite(x.loss) ? x.loss : 0), 0);
      const inf = items.some(x => x.loss === Infinity);
      h += `<tr class="cat"><td>${esc(cat)}<div class="bar"><i style="width:${inf ? 100 : Math.max(2, sub / maxG * 100)}%"></i></div></td><td class="num">${inf ? '∞' : fmt(sub, 3)} dB</td></tr>`;
      items.forEach(x => {
        if (x.hidden) hiddenFault = true;
        h += `<tr class="${x.fault && !x.hidden ? 'fault' : ''}"><td>${esc(x.label)}</td><td class="num">${x.hidden ? '?' : x.loss === Infinity ? '<b class="st-los">coupure</b>' : fmt(x.loss, 3)}</td></tr>`;
      });
    }
    h += '</table>';
    if (hiddenFault) h += '<p class="muted small">Une perte inconnue (panne cachée) est présente : utilisez les instruments pour la localiser.</p>';
    const sens = E.sensOf(d, res);
    const pw = E.power(res);
    const shownLoss = hiddenFault ? null : total;
    h += `<table class="kv summary"><tr><td>Σ pertes${res.lost ? ' (avant coupure)' : ''}</td><td class="num">${shownLoss === null ? '?' : fmt(shownLoss, 2) + ' dB'}</td></tr>
      <tr><td>Longueur optique totale</td><td class="num">${fmtLen(Math.round(res.length * 10) / 10)}</td></tr>`;
    if (!res.dark) {
      h += `<tr><td>${recette ? 'Puissance calculée' : 'Puissance reçue'}</td><td class="num"><b>${res.lost ? 'LOS' : hiddenFault ? '→ mesurer' : dbm(pw)}</b></td></tr>
        <tr><td>Sensibilité ${sens.passive ? `(réf. ONT ${sens.ref})` : ''}</td><td class="num">${dbm(sens.sens)}</td></tr>`;
      const bu = E.budget(d, res);
      h += `<tr class="budget"><td title="Pertes que la liaison peut supporter avant que le récepteur ne décroche">Budget optique <small>(P émise − sensibilité)</small></td><td class="num"><b>${fmt(bu.budget)} dB</b></td></tr>
        <tr><td>Pertes admissibles <small>(budget − marge ${fmt(bu.marge, 0)} dB)</small></td><td class="num">${fmt(bu.admissible)} dB</td></tr>`;
      if (!res.lost && !hiddenFault) {
        const st = P.classify(pw, sens.sens, sens.over, sens.passive);
        h += `<tr><td>Marge <small>(budget − pertes)</small></td><td class="num">${fmt(pw - sens.sens)} dB</td></tr><tr><td>Statut</td><td class="num">${statusPill(st)}</td></tr>`;
      }
      h += '</table>' + budgetBarHTML(bu, !res.lost && !hiddenFault);
    } else h += '</table>';
    if (!res.dark && !res.lost && !hiddenFault) {
      const bu = E.budget(d, res);
      h += `<p class="formula">P<sub>rx</sub> = ${dbm(res.tx)} − ${fmt(total)} dB = <b>${dbm(pw)}</b><br>Budget = ${dbm(res.tx)} − (${dbm(sens.sens)}) = ${fmt(bu.budget)} dB<br>Marge = ${fmt(bu.budget)} − ${fmt(total)} = <b>${fmt(bu.reste)} dB</b></p>`;
    }
    const avis = E.classeAvis(d, res);
    if (avis) h += `<div class="alert warn">${esc(avis)}</div>`;
    if (res.lost) {
      const cause = res.segments[res.lostAt];
      const cache = cause.items.some(it => !isFinite(it.loss) && it.hidden);
      h += `<div class="alert err">Signal interrompu : ${cache ? 'aucune lumière ne parvient au récepteur (utilisez les instruments pour localiser la coupure)' : esc(cause.label)}.</div>`;
    }
    return h;
  }

  /* ---------------- Fiche de recette ---------------- */
  const parseDbm = v => { const x = parseFloat(String(v).replace(/\u2212/g, '-').replace(',', '.').replace(/[^\d.+-]/g, '')); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };
  function ensureRecette() { if (!S.topo.recette) S.topo.recette = normRecette({}); return S.topo.recette; }
  function recetteHTML() {
    const rc = S.topo.recette, seuils = Object.assign({}, P.RECETTE_SEUILS, rc && rc.seuils);
    const rows = P.recetteRows(S.topo);
    let h = '<div class="section recette"><h4>Fiche de recette</h4>';
    h += rc && rc.actif
      ? '<p class="small">Mode <b>recette réaliste</b> : chaque composant du réseau a sa propre perte, proche des valeurs de référence (souvent meilleure). Mesurez chaque récepteur au <b>photomètre</b>, saisissez la valeur, puis concluez.</p>'
      : '<p class="muted small">Recette réaliste désactivée : la mesure est égale au calcul (valeurs de référence). Saisissez tout de même vos mesures pour vous entraîner.</p>';
    
    if (!rows.length) return h + '<p class="muted small">Aucun récepteur alimenté (ONT, switch, CPE).</p></div>';
    const cols = TEACHER ? 5 : 4;
    h += `<table class="cfg-table recette-table"><tr><th>Récepteur</th><th>Calcul</th><th>Mesure</th><th>Écart</th>${TEACHER ? '<th title="Puissance réellement reçue (enseignant)">Réel</th>' : ''}</tr>`;
    rows.forEach(r => {
      const m = rc && rc.mesures ? rc.mesures[r.id] : undefined;
      const v = P.recetteVerdict(r.theo, m, r.sens, r.over, seuils);
      h += `<tr><td><a href="#" data-sel-dev="${r.id}">${esc(r.name)}</a></td><td class="num">${fmt(r.theo)}</td>
        <td><input type="text" inputmode="decimal" class="rec-in" data-recette="${r.id}" value="${m !== undefined ? fmt(m) : ''}" placeholder="—" aria-label="Mesure de ${esc(r.name)} en dBm"></td>
        <td class="num">${v ? (v.ecart > 0 ? '+' : '') + fmt(v.ecart) : '—'}</td>${TEACHER ? `<td class="num muted">${r.real === null ? 'LOS' : fmt(r.real)}</td>` : ''}</tr>
        <tr class="rec-verdict"><td colspan="${cols}">${v ? `<span class="pill st-${v.code}">${esc(v.label)}</span>` : '<span class="muted small">À mesurer au photomètre (dBm)</span>'}</td></tr>`;
    });
    h += '</table>';
    const f = x => String(x).replace('.', ',');
    h += recetteOtdrHTML(rows);
    h += `<p class="muted small"><b>Écart</b> = perte mesurée − perte calculée = P<sub>calculée</sub> − P<sub>mesurée</sub>. ≤ 0 dB : conforme ; ≤ ${f(seuils.acceptable)} dB : acceptable (nettoyer) ; ≤ ${f(seuils.controle)} dB : à contrôler à l'OTDR ; au-delà : non conforme. Marge d'au moins ${f(seuils.marge)} dB au-dessus de la sensibilité. Une mesure meilleure de plus de ${f(seuils.suspect)} dB que le calcul est suspecte (référence du photomètre).</p></div>`;
    return h;
  }

  /** Fiche de recette : tirs OTDR enregistrés par récepteur et longueur d'onde. */
  function recetteOtdrHTML(rows) {
    const rc = S.topo.recette, tirs = (rc && rc.tirs) || [];
    let h = '<h4 class="sub">Recette OTDR (tirs bidirectionnels)</h4>';
    if (!tirs.length) h += '<p class="muted small">Aucun tir enregistré. Onglet OTDR : faites un tir <b>aller</b> puis un tir <b>retour</b> sur chaque récepteur, et enregistrez-les.</p>';
    else {
      h += '<table class="cfg-table recette-table"><tr><th>Récepteur</th><th>λ</th><th>Aller</th><th>Retour</th><th>Événements</th></tr>';
      const keys = [];
      tirs.forEach(x => { const k = x.cible + '|' + x.lambda; if (!keys.includes(k)) keys.push(k); });
      keys.forEach(k => {
        const [cible, l] = k.split('|'), lambda = +l, a = savedShot(cible, lambda, 'aller'), b = savedShot(cible, lambda, 'retour');
        const bi = a && b ? P.otdrBidir(a, b, rc.seuils) : null;
        h += `<tr><td>${esc((a || b).nom)}</td><td class="num">${lambda}</td><td>${a ? '✓' : '—'}</td><td>${b ? '✓' : '—'}</td><td>${bi ? (bi.conforme ? '<span class="pill st-ok">conformes</span>' : '<span class="pill st-los">hors seuil</span>') : '<span class="muted small">incomplet</span>'}</td></tr>`;
      });
      h += '</table>';
    }
    h += '<div class="row"><button class="btn small" id="recRapport" title="Rapport de recette imprimable (photomètre et OTDR)">Rapport de recette (imprimer)</button></div>';
    return h;
  }
  /** Rapport de recette imprimable : mesures au photomètre et analyse OTDR bidirectionnelle. */
  function recetteRapport() {
    const rc = S.topo.recette || normRecette({}), seuils = Object.assign({}, P.RECETTE_SEUILS, rc.seuils);
    const rows = P.recetteRows(S.topo);
    const blds = S.topo.devices.filter(d => isContainer(d) && !isRoom(d)).map(d => d.props.name).join(', ') || '—';
    let prev = {}; try { prev = JSON.parse(store.get('optisim-eleve') || '{}'); } catch (e) { prev = {}; }
    const who = [prev.prenom, prev.nom].filter(Boolean).join(' ');
    let nOk = 0, nKo = 0, nMiss = 0;
    let h = `<h1>Rapport de recette optique</h1><p class="small">Réseau : <b>${esc(blds)}</b> · ${esc(new Date().toLocaleString('fr-FR'))} · Technicien : ${who ? esc(who) : '..............................'}${rc.actif ? ' · mesures sur réseau réel (mode recette réaliste)' : ''}</p>`;
    h += '<h2>1. Puissance reçue (photomètre)</h2><table><tr><th>Récepteur</th><th>Emplacement</th><th>Budget (dB)</th><th>Calcul (dBm)</th><th>Mesure (dBm)</th><th>Écart (dB)</th><th>Conclusion</th></tr>';
    rows.forEach(r => {
      const m = rc.mesures[r.id], v = P.recetteVerdict(r.theo, m, r.sens, r.over, seuils);
      if (!v) nMiss++; else if (v.code === 'ok') nOk++; else nKo++;
      h += `<tr><td>${esc(r.name)}</td><td>${esc(locationText(devById(r.id)) || '—')}</td><td class="num">${fmt(r.budget)}<br><small>admis. ${fmt(r.admissible)}</small></td><td class="num">${fmt(r.theo)}</td><td class="num">${m === undefined ? '—' : fmt(m)}</td><td class="num">${v ? (v.ecart > 0 ? '+' : '') + fmt(v.ecart) : '—'}</td><td class="${v ? 'st-' + v.code : ''}">${v ? esc(v.label) : 'non mesuré'}</td></tr>`;
    });
    h += '</table>';
    h += '<h2>2. Réflectométrie (OTDR bidirectionnel)</h2>';
    const keys = [];
    (rc.tirs || []).forEach(x => { const k = x.cible + '|' + x.lambda; if (!keys.includes(k)) keys.push(k); });
    if (!keys.length) h += '<p>Aucun tir enregistré.</p>';
    keys.forEach(k => {
      const [cible, l] = k.split('|'), lambda = +l, a = savedShot(cible, lambda, 'aller'), b = savedShot(cible, lambda, 'retour');
      h += `<h3>${esc((a || b).nom)} — ${lambda} nm</h3>`;
      if (!a || !b) { nMiss++; h += `<p>Tir ${a ? 'retour' : 'aller'} manquant : analyse bidirectionnelle impossible.</p>`; return; }
      const bi = P.otdrBidir(a, b, seuils);
      bi.rows.forEach(r => { if (r.ok) nOk++; else nKo++; });
      h += bidirTableHTML(bi).replace(/class="cfg-table bidir"/, '') + `<p class="small">Longueur ${fmtLen(bi.longueur)} · perte totale aller ${fmt(bi.totalAller)} dB, retour ${fmt(bi.totalRetour)} dB.</p>`;
    });
    const f = x => String(x).replace('.', ',');
    h += `<h2>3. Seuils appliqués</h2><p class="small">Photomètre : écart ≤ 0 conforme, ≤ ${f(seuils.acceptable)} dB acceptable, ≤ ${f(seuils.controle)} dB à contrôler, au-delà non conforme ; marge ≥ ${f(seuils.marge)} dB ; mesure suspecte si meilleure de plus de ${f(seuils.suspect)} dB. OTDR (moyenne aller-retour) : épissure ≤ ${f(seuils.epissure)} dB, connecteur ≤ ${f(seuils.connecteur)} dB, coupleur ± ${f(seuils.coupleur)} dB autour de la valeur nominale.</p>`;
    h += `<h2>4. Conclusion</h2><p><b>${nKo ? 'Réseau NON CONFORME' : nMiss ? 'Recette incomplète' : 'Réseau CONFORME'}</b> — ${nOk} point(s) conforme(s), ${nKo} hors seuil, ${nMiss} manquant(s).</p><p class="small">Visa du technicien : .................................... Visa du responsable : ....................................</p>`;
    printDoc('Rapport de recette — OptiSim FTTx Lab', h);
    logJ('recette', 'Rapport de recette imprimé');
  }
  /** Impression d'un document (nouvelle fenêtre, styles d'impression). */
  function printDoc(title, html) {
    const w = window.open('', '_blank');
    if (!w) return toast('Fenêtre bloquée par le navigateur : autorisez les fenêtres surgissantes.', 'err');
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font:12px/1.45 system-ui,sans-serif;color:#111;margin:14mm}h1{font-size:19px;margin:0 0 4px}h2{font-size:14px;margin:16px 0 6px;border-bottom:1px solid #999}h3{font-size:12.5px;margin:10px 0 4px}
      table{border-collapse:collapse;width:100%;margin-bottom:6px}td,th{border:1px solid #bbb;padding:3px 6px;text-align:left;vertical-align:top}.num{text-align:right}th{background:#f1f5f9}
      .st-ok{color:#15803d}.st-los{color:#b91c1c}.st-weak{color:#b45309}.small{color:#333;font-size:11px}small{color:#555}
      </style></head><body>${html}<p class="small">OptiSim FTTx Lab — © ${esc(SIGNATURE)}</p></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }

  /* ---------------- OTDR ---------------- */
  function runOtdr(showErr) {
    const o = S.otdr;
    if (!o.devId) return;
    const r = P.otdrShot(S.engine, o.devId, { lambda: o.lambda, launch: o.launch, reverse: o.dir === 'retour' });
    if (r.error) { o.result = null; o.error = r.error; if (showErr) toast(r.error, 'err'); }
    else { o.result = r; o.error = null; }
  }

  function otdrHTML() {
    const o = S.otdr;
    let h = `<div class="insp-head"><div><b>Réflectomètre OTDR</b><small>${o.devId && devById(o.devId) ? 'Tir vers : ' + esc(devById(o.devId).props.name) : 'Mode Mesure → outil OTDR → cliquez sur un équipement'}</small></div></div>`;
    h += `<div class="otdr-ctl"><label>λ <select id="otdrLambda">${[1310, 1550].map(l => `<option ${l === o.lambda ? 'selected' : ''}>${l}</option>`).join('')}</select> nm</label>
      <label>Bobine amorce <select id="otdrLaunch">${[0, 300, 500, 1000].map(l => `<option value="${l}" ${l === o.launch ? 'selected' : ''}>${l ? l + ' m' : 'aucune'}</option>`).join('')}</select></label>
      ${S.sel && S.sel.kind === 'dev' && !isContainer(devById(S.sel.id)) ? '<button class="btn small" data-act="otdr-sel">Tirer sur la sélection</button>' : ''}
      <button class="btn small" data-act="otdr-full">Vue complète</button></div>
      <div class="segmented small otdr-dir"><button data-odir="aller" class="${o.dir === 'aller' ? 'active' : ''}" title="L'OTDR remplace la source, au NRO">Aller (depuis le NRO)</button><button data-odir="retour" class="${o.dir === 'retour' ? 'active' : ''}" title="L'OTDR est branché côté abonné, sur l'équipement visé">Retour (depuis l'abonné)</button></div>`;
    h += `<div class="otdr-screen"><canvas id="otdrCanvas" height="230"></canvas><div class="otdr-read" id="otdrRead"></div></div>`;
    if (o.error) h += `<div class="alert warn">${esc(o.error)}</div>`;
    if (o.result) {
      const r = o.result;
      h += `<table class="kv"><tr><td>Origine</td><td>${esc(r.origin)} (OTDR à la place de la source)</td></tr><tr><td>Fin de trace</td><td>${fmtLen(Math.round(r.endPos * 10) / 10)}</td></tr><tr><td>Perte totale mesurée</td><td>${fmt(r.totalLoss)} dB</td></tr></table>`;
      h += `<table class="events"><thead><tr><th>#</th><th>Distance</th><th>Perte</th><th>Type</th></tr></thead><tbody>`;
      r.events.forEach(e => {
        h += `<tr data-ev="${e.n}" class="${e.end && e.kind && e.kind.startsWith('fault') ? 'fault' : ''}" title="${esc(e.label)}"><td>${e.n}</td><td class="num">${fmt(e.pos, 1)} m</td><td class="num">${e.end ? '—' : fmt(e.loss, 2) + ' dB'}</td><td>${esc(e.type)}<small>${esc(e.label)}</small></td></tr>`;
      });
      h += '</tbody></table><p class="muted small">Cliquez sur un événement pour zoomer. Survolez la courbe pour lire distance et niveau.</p>';
      h += `<div class="row"><button class="btn small primary" data-act="otdr-save" title="Enregistre ce tir dans la fiche de recette (rapport, copie d'examen)">Enregistrer le tir ${r.direction} (${r.lambda} nm)</button></div>`;
      h += otdrBidirHTML(o.devId, r.lambda);
    }
    return h;
  }

  /* ---------------- Tirs enregistrés et analyse bidirectionnelle ---------------- */
  function savedShot(cible, lambda, sens) {
    const rc = S.topo.recette;
    return rc && rc.tirs ? rc.tirs.slice().reverse().find(x => x.cible === cible && x.lambda === lambda && x.sens === sens) : null;
  }
  function saveShot() {
    const r = S.otdr.result, d = devById(S.otdr.devId);
    if (!r || !d) return;
    const tir = { cible: d.id, nom: d.props.name, lambda: r.lambda, sens: r.direction, launch: r.launch, date: new Date().toISOString(), totalLoss: Math.round(r.totalLoss * 1000) / 1000, endPos: r.endPos, netLen: r.netLen,
      events: r.events.map(e => ({ n: e.n, net: e.net, pos: Math.round(e.pos * 10) / 10, loss: Math.round(e.loss * 1000) / 1000, type: e.type, label: e.label, kind: e.kind, reflective: e.reflective, end: e.end, parts: e.parts })) };
    logJ('otdr', `Tir ${r.direction} enregistré : ${d.props.name} (${r.lambda} nm)`, { id: d.id });
    mutate(() => { const rc = ensureRecette(); rc.tirs = rc.tirs.filter(x => !(x.cible === tir.cible && x.lambda === tir.lambda && x.sens === tir.sens)).concat([tir]); }, { keepInspector: false });
    toast(`Tir ${r.direction} à ${r.lambda} nm enregistré pour « ${d.props.name} ».${savedShot(d.id, r.lambda, r.direction === 'aller' ? 'retour' : 'aller') ? ' L\'analyse bidirectionnelle est disponible.' : ' Faites aussi le tir ' + (r.direction === 'aller' ? 'retour' : 'aller') + ' pour l\'analyse bidirectionnelle.'}`, 'ok');
  }
  function bidirTableHTML(bi) {
    const f3 = v => v === null ? '—' : fmt(v, 3);
    return `<table class="cfg-table bidir"><tr><th>Distance</th><th>Aller</th><th>Retour</th><th>Moyenne</th><th>Seuil</th><th></th></tr>${bi.rows.map(r => `<tr title="${esc(r.label)}"><td class="num">${fmt(r.net, 1)} m</td><td class="num">${f3(r.aller)}</td><td class="num">${f3(r.retour)}</td><td class="num"><b>${f3(r.moy)}</b></td><td><small>${esc(r.type)}<br>${esc(r.seuil)}</small></td><td>${r.ok === null ? '<span class="muted">?</span>' : r.ok ? '<span class="st-ok">✓</span>' : '<span class="st-los">✗</span>'}</td></tr>`).join('')}</table>`;
  }
  function otdrBidirHTML(cible, lambda) {
    const a = savedShot(cible, lambda, 'aller'), b = savedShot(cible, lambda, 'retour');
    if (!a && !b) return '';
    let h = `<div class="section"><h4>Analyse bidirectionnelle (${lambda} nm)</h4>`;
    if (!a || !b) return h + `<p class="muted small">Tir ${a ? 'aller' : 'retour'} enregistré. Faites et enregistrez le tir ${a ? 'retour' : 'aller'} pour calculer la moyenne de chaque événement.</p></div>`;
    const bi = P.otdrBidir(a, b, S.topo.recette.seuils);
    h += bidirTableHTML(bi);
    h += `<p class="small">Longueur ${fmtLen(bi.longueur)} · perte totale aller ${fmt(bi.totalAller)} dB, retour ${fmt(bi.totalRetour)} dB → <b class="${bi.conforme ? 'st-ok' : 'st-los'}">${bi.conforme ? 'événements conformes' : 'événement(s) hors seuil'}</b></p>
      <p class="muted small">Une épissure ne mesure pas la même perte dans les deux sens (diamètres de mode différents) : seule la <b>moyenne</b> aller-retour se compare au seuil. Un « gain » apparent sur un tir seul n'est pas une erreur.</p></div>`;
    return h;
  }

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  function drawOtdr() {
    const cv = $('#otdrCanvas');
    if (!cv) return;
    const wrap = cv.parentElement;
    const W = wrap.clientWidth || 320, H = 230;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = cssVar('--otdr-bg'); ctx.fillRect(0, 0, W, H);
    const o = S.otdr, r = o.result;
    const m = { l: 38, r: 10, t: 12, b: 24 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    ctx.font = '10px system-ui, sans-serif';
    if (!r) {
      ctx.fillStyle = cssVar('--otdr-grid-text');
      ctx.textAlign = 'center';
      ctx.fillText('Aucune trace — choisissez l\'outil OTDR et cliquez sur un équipement', W / 2, H / 2);
      return;
    }
    const x0 = o.x0 !== null ? o.x0 : 0, x1 = o.x1 !== null ? o.x1 : r.span;
    let lo = Infinity, hi = -Infinity;
    for (const [x, y] of r.points) if (x >= x0 && x <= x1) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    if (!isFinite(lo)) { lo = r.floor; hi = 20; }
    const pad = Math.max(0.5, (hi - lo) * 0.08);
    const yMin = lo - pad, yMax = hi + pad;
    const yStep = niceStep((yMax - yMin) / 6);
    const X = x => m.l + (x - x0) / (x1 - x0) * pw;
    const Y = y => m.t + (yMax - y) / (yMax - yMin) * ph;
    // grille
    ctx.strokeStyle = cssVar('--otdr-grid'); ctx.lineWidth = 1; ctx.fillStyle = cssVar('--otdr-grid-text');
    ctx.textAlign = 'right';
    for (let y = Math.floor(yMax / yStep) * yStep; y >= yMin; y -= yStep) { ctx.beginPath(); ctx.moveTo(m.l, Y(y)); ctx.lineTo(W - m.r, Y(y)); ctx.stroke(); ctx.fillText(fmt(y, yStep < 1 ? 1 : 0) + ' dB', m.l - 3, Y(y) + 3); }
    const span = x1 - x0;
    const step = niceStep(span / 5);
    ctx.textAlign = 'center';
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      ctx.beginPath(); ctx.moveTo(X(x), m.t); ctx.lineTo(X(x), m.t + ph); ctx.stroke();
      ctx.fillText(x >= 1000 ? fmt(x / 1000, step >= 1000 ? 0 : step >= 100 ? 1 : 2) + ' km' : Math.round(x) + ' m', X(x), H - 8);
    }
    // événements
    ctx.save(); ctx.setLineDash([3, 3]);
    r.events.forEach(e => {
      if (e.pos < x0 || e.pos > x1) return;
      ctx.strokeStyle = e.end && e.kind && e.kind.startsWith('fault') ? '#ef4444' : cssVar('--otdr-event');
      ctx.beginPath(); ctx.moveTo(X(e.pos), m.t); ctx.lineTo(X(e.pos), m.t + ph); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.fillText(String(e.n), X(e.pos) + 6, m.t + 9);
    });
    ctx.restore();
    // trace
    ctx.save();
    ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
    ctx.strokeStyle = cssVar('--otdr-trace'); ctx.lineWidth = 1.5;
    ctx.beginPath();
    let first = true;
    for (const [x, y] of r.points) {
      if (x < x0 - span * 0.02 || x > x1 + span * 0.02) continue;
      if (first) { ctx.moveTo(X(x), Y(y)); first = false; } else ctx.lineTo(X(x), Y(y));
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = cssVar('--otdr-grid-text'); ctx.textAlign = 'left';
    ctx.fillText(`${r.lambda} nm · ${r.launch ? 'bobine ' + r.launch + ' m' : 'sans bobine'}`, m.l + 4, H - m.b - 4);
    // curseur
    if (o.hover !== null && o.hover >= x0 && o.hover <= x1) {
      let best = r.points[0];
      for (const p of r.points) if (Math.abs(p[0] - o.hover) < Math.abs(best[0] - o.hover)) best = p;
      ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(best[0]), m.t); ctx.lineTo(X(best[0]), m.t + ph); ctx.stroke();
      ctx.fillStyle = cssVar('--accent'); ctx.beginPath(); ctx.arc(X(best[0]), Y(best[1]), 3, 0, Math.PI * 2); ctx.fill();
      const rd = $('#otdrRead'); if (rd) rd.textContent = `${fmt(best[0], 1)} m · ${fmt(best[1], 2)} dB`;
    }
    cv.onmousemove = e => {
      const rc = cv.getBoundingClientRect();
      const x = x0 + (e.clientX - rc.left - m.l) / pw * (x1 - x0);
      o.hover = x; drawOtdr();
    };
    cv.onmouseleave = () => { o.hover = null; const rd = $('#otdrRead'); if (rd) rd.textContent = ''; drawOtdr(); };
  }
  function niceStep(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 0.001))));
    const n = v / p;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
  }

  /* ---------------- Liaison des contrôles de l'inspecteur ---------------- */
  function bindInspector() {
    $$('[data-scope="cfg"]', insp).forEach(el => el.addEventListener('change', () => {
      const d = devById(S.sel.id);
      const f = CATALOG[d.type].config.find(x => x.key === el.dataset.k);
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (f.type === 'number') { v = Math.round(parseFloat(String(v).replace(',', '.'))); if (!isFinite(v)) return renderInspector(); if (f.min !== undefined) v = Math.max(f.min, v); if (f.max !== undefined) v = Math.min(f.max, v); }
      else if (f.type === 'select') { const o = f.options[0]; if (typeof (Array.isArray(o) ? o[0] : o) === 'number') v = +v; }
      else if (f.type === 'text') v = f.upper ? v.trim().toUpperCase() : v.trim();
      logJ('config', `${d.props.name} : ${f.label} = ${typeof v === 'boolean' ? (v ? 'activé' : 'désactivé') : v}`, { id: d.id });
      mutate(() => { d.props[f.key] = v; });
    }));
    $$('[data-row]', insp).forEach(el => el.addEventListener('change', () => {
      const d = devById(S.sel.id);
      const key = el.dataset.row, i = +el.dataset.i, f = el.dataset.f;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (f === 'sn') v = v.trim().toUpperCase(); else if (f === 'login') v = v.trim();
      logJ('config', `${d.props.name} : ${CFG_ARRAY_LABEL[key] || key}, ligne ${i + 1}, ${f} = ${typeof v === 'boolean' ? (v ? 'activé' : 'désactivé') : v}`, { id: d.id });
      mutate(() => {
        const arr = (d.props[key] || []).map(x => Object.assign({}, x));
        while (arr.length <= i) arr.push(Object.assign({}, ROW_DEFAULTS[key]));
        arr[i] = Object.assign({}, ROW_DEFAULTS[key], arr[i], { [f]: v });
        d.props[key] = arr;
      });
    }));
    $$('[data-row-add]', insp).forEach(b => b.addEventListener('click', () => {
      const d = devById(S.sel.id), key = b.dataset.rowAdd;
      logJ('config', `${d.props.name} : ligne ajoutée (${CFG_ARRAY_LABEL[key] || key})`, { id: d.id });
      mutate(() => { d.props[key] = (d.props[key] || []).concat([Object.assign({}, ROW_DEFAULTS[key])]); });
    }));
    $$('[data-row-del]', insp).forEach(b => b.addEventListener('click', () => {
      const d = devById(S.sel.id), key = b.dataset.rowDel, i = +b.dataset.i;
      logJ('config', `${d.props.name} : ligne ${i + 1} retirée (${CFG_ARRAY_LABEL[key] || key})`, { id: d.id });
      mutate(() => { d.props[key] = (d.props[key] || []).filter((x, k) => k !== i); });
    }));
    $$('[data-authorize]', insp).forEach(b => b.addEventListener('click', () => {
      const d = devById(S.sel.id), sn = b.dataset.authorize;
      logJ('config', `${d.props.name} : ONT ${sn} autorisée`, { id: d.id });
      mutate(() => { d.props.onts = (d.props.onts || []).concat([{ sn, profile: 'trio' }]); });
      toast(`ONT ${sn} autorisée sur ${d.props.name} (profil Triple play).`, 'ok');
    }));
    $$('[data-sel-dev]', insp).forEach(a => a.addEventListener('click', e => { e.preventDefault(); select({ kind: 'dev', id: a.dataset.selDev }); }));
    $$('[data-doc-link]', insp).forEach(a => a.addEventListener('click', e => { e.preventDefault(); openDocs(a.dataset.docLink); }));
    $$('[data-scope="dev"]', insp).forEach(el => el.addEventListener('change', () => {
      const d = devById(S.sel.id);
      const def = CATALOG[d.type];
      const f = def.props.find(x => x.key === el.dataset.k);
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (f.type === 'number') { v = parseFloat(String(v).replace(',', '.')); if (!isFinite(v)) return; if (f.min !== undefined) v = Math.max(f.min, v); if (f.max !== undefined) v = Math.min(f.max, v); }
      else if (f.type === 'select' && typeof (f.options[0]) === 'number') v = +v;
      logJ('reglage', `${d.props.name} : ${f.label} = ${v}`, { id: d.id });
      mutate(() => { d.props[f.key] = v; });
    }));
    $$('[data-lk]', insp).forEach(el => el.addEventListener('change', () => {
      const l = linkById(S.sel.id);
      const k = el.dataset.lk;
      logJ('reglage', `${linkLabel(l)} : ${k} = ${el.type === 'checkbox' ? el.checked : el.value}`, { id: l.id });
      mutate(() => {
        if (k === 'aport') l.a.port = +el.value;
        else if (k === 'bport') l.b.port = +el.value;
        else if (k === 'length') { const v = parseFloat(el.value.replace(',', '.')); if (isFinite(v) && v >= 0) l.length = v; }
        else if (k === 'autoLength') l.autoLength = el.checked;
        else if (k === 'fibers') l.fibers = +el.value;
        else l[k] = el.value;
      });
    }));
    $$('[data-sel-link]', insp).forEach(a => a.addEventListener('click', e => { e.preventDefault(); select({ kind: 'link', id: a.dataset.selLink }); }));
    $$('[data-act]', insp).forEach(b => b.addEventListener('click', e => { e.preventDefault(); inspectorAction(b.dataset.act); }));
    const bp = $('#bilanPort', insp); if (bp) bp.addEventListener('change', () => { S.bilanPort = +bp.value; renderInspector(); });
    const rp = $('#recRapport', insp); if (rp) rp.addEventListener('click', recetteRapport);
    $$('[data-recette]', insp).forEach(el => el.addEventListener('change', () => {
      const id = el.dataset.recette, v = parseDbm(el.value), d = devById(id);
      if (el.value.trim() && v === null) { toast('Mesure invalide : saisissez une puissance en dBm, par exemple −15,2.', 'err'); return renderInspector(); }
      logJ('recette', `Fiche de recette : ${d ? d.props.name : id} = ${v === null ? 'effacée' : fmt(v) + ' dBm'}`, { id });
      mutate(() => { const rc = ensureRecette(); if (v === null) delete rc.mesures[id]; else rc.mesures[id] = v; });
    }));
    
    const ol = $('#otdrLambda', insp); if (ol) ol.addEventListener('change', () => { S.otdr.lambda = +ol.value; if (S.otdr.devId) logJ('otdr', `OTDR vers ${devById(S.otdr.devId).props.name} (${S.otdr.lambda} nm)`, { id: S.otdr.devId }); runOtdr(true); renderInspector(); });
    $$('[data-odir]', insp).forEach(b => b.addEventListener('click', () => { S.otdr.dir = b.dataset.odir; S.otdr.x0 = S.otdr.x1 = null; if (S.otdr.devId) logJ('otdr', `OTDR ${S.otdr.dir} vers ${devById(S.otdr.devId).props.name} (${S.otdr.lambda} nm)`, { id: S.otdr.devId }); runOtdr(true); renderInspector(); }));
    const oL = $('#otdrLaunch', insp); if (oL) oL.addEventListener('change', () => { S.otdr.launch = +oL.value; S.otdr.x0 = S.otdr.x1 = null; runOtdr(true); renderInspector(); });
    $$('tr[data-ev]', insp).forEach(tr => tr.addEventListener('click', () => {
      const e = S.otdr.result.events[+tr.dataset.ev - 1];
      const w = Math.max(15, S.otdr.result.span * 0.03);
      S.otdr.x0 = Math.max(0, e.pos - w); S.otdr.x1 = e.pos + w;
      $$('tr[data-ev]', insp).forEach(x => x.classList.toggle('active', x === tr));
      drawOtdr();
    }));
  }

  function inspectorAction(act) {
    const sel = S.sel;
    const obj = sel ? (sel.kind === 'dev' ? devById(sel.id) : linkById(sel.id)) : null;
    switch (act) {
      case 'delete': return deleteSelection();
      case 'bilan': S.tab = 'bilan'; return renderInspector();
      case 'labs': return openLabs();
      case 'exam-consignes': return showConsignes();
      case 'exam-rendre': return submitCopy();
      case 'dup': {
        if (locked()) return;
        const d = obj; const c = JSON.parse(JSON.stringify(d)); c.id = uid(d.type); c.x += 30; c.y += 30; delete c.fault; delete c.cfgFault; c.props.name += ' (copie)';
        mutate(() => S.topo.devices.push(c)); return select({ kind: 'dev', id: c.id });
      }
      case 'intervene': {
        const hit = !!(obj.fault && obj.fault.type);
        const name = sel.kind === 'link' ? linkLabel(obj) : obj.props.name;
        mutate(() => { delete obj.fault; });
        logJ('intervention', `Intervention sur ${name}`, { id: obj.id, hit });
        return toast(`Intervention effectuée sur « ${name} ». Contrôlez le résultat par une mesure.`);
      }
      
      case 'otdr-sel': logJ('otdr', `OTDR vers ${obj.props.name} (${S.otdr.lambda} nm)`, { id: sel.id }); S.otdr.devId = sel.id; S.otdr.x0 = S.otdr.x1 = null; runOtdr(true); return renderInspector();
      case 'otdr-full': S.otdr.x0 = S.otdr.x1 = null; return drawOtdr();
      case 'otdr-save': return saveShot();
    }
  }

  function deleteSelection() {
    if (!S.sel || locked()) return;
    if (S.sel.kind === 'link') { const id = S.sel.id; S.sel = null; mutate(() => { S.topo.links = S.topo.links.filter(l => l.id !== id); }); return; }
    const d = devById(S.sel.id);
    if (!d) return;
    const doDel = withKids => {
      const ids = new Set([d.id]);
      if (withKids) S.topo.devices.filter(x => x.parent === d.id).forEach(x => ids.add(x.id));
      S.sel = null;
      mutate(() => {
        S.topo.devices = S.topo.devices.filter(x => !ids.has(x.id));
        S.topo.links = S.topo.links.filter(l => !ids.has(l.a.dev) && !ids.has(l.b.dev));
      });
      validateSelection(); refresh();
    };
    if (isContainer(d) && S.topo.devices.some(x => x.parent === d.id)) {
      openModal('Supprimer le bâtiment', `<p>Le bâtiment « ${esc(d.props.name)} » contient des équipements.</p>`, [
        { label: 'Annuler', action: closeModal },
        { label: 'Bâtiment seul', action: () => { closeModal(); doDel(false); } },
        { label: 'Bâtiment et contenu', primary: true, danger: true, action: () => { closeModal(); doDel(true); } }
      ]);
    } else doDel(false);
  }

  /* ------------------------------------------------------------------ */
  /*  Instrument flottant (photomètre / VFL)                              */
  /* ------------------------------------------------------------------ */
  const instr = $('#instrument');
  function renderInstrument() {
    if (S.mode === 'test' && S.pm && devById(S.pm.devId)) { instr.hidden = false; instr.innerHTML = pmHTML(); bindInstrument(); return; }
    if (S.mode === 'test' && S.vfl && devById(S.vfl.devId)) { instr.hidden = false; instr.innerHTML = vflHTML(); bindInstrument(); return; }
    if (S.mode === 'test' && S.tool && (S.tool.kind === 'pm' || S.tool.kind === 'vfl')) {
      instr.hidden = false;
      instr.innerHTML = `<div class="fc-head"><b>${S.tool.kind === 'pm' ? 'Photomètre' : 'Stylo optique VFL'}</b><button class="btn icon small" data-ia="close" aria-label="Fermer">✕</button></div><p class="muted small">Cliquez sur un équipement du canevas pour ${S.tool.kind === 'pm' ? 'mesurer la puissance' : 'injecter la lumière rouge'}.</p>`;
      bindInstrument(); return;
    }
    instr.hidden = true;
  }

  /** Statut d'un port optique : entrée jugée par le récepteur, sortie par l'ONT de référence de la classe de l'OLT. */
  function portCode(d, side, r, v) {
    const s = side === 'out' ? S.engine.sensOf({ type: 'pto' }, r) : S.engine.sensOf(d, r);
    return P.classify(v, s.sens, s.over, s.passive).code;
  }

  function pmHTML() {
    const d = devById(S.pm.devId);
    const rd = S.engine.portReadings(d.id).filter(x => x.linked || x.side === 'out');
    let key = S.pm.key;
    if (!key || !rd.find(x => x.side + x.idx === key)) {
      const st = S.engine.deviceState(d.id);
      const pref = rd.find(x => x.side === 'in' && x.idx === st.port) || rd.find(x => x.side === 'in' && x.linked) || rd.find(x => x.power !== null) || rd[0];
      key = pref ? pref.side + pref.idx : null;
    }
    const cur = rd.find(x => x.side + x.idx === key);
    // Port de sortie : jugé comme un port passif (ONT de référence de la classe de l'OLT)
    const sens = cur && cur.side === 'out' ? S.engine.sensOf({ type: 'pto' }, cur.res) : S.engine.sensOf(d, cur && cur.res);
    let lcd;
    if (!cur) lcd = '<div class="lcd"><div class="lcd-main">— — —</div><div class="lcd-sub">Aucun port optique</div></div>';
    else {
      const r = cur.res;
      const pw = cur.power;
      const st = !r ? { code: 'los', label: 'LOS (port non alimenté)' } : r.dark ? { code: 'los', label: 'LOS (pas de source)' } : P.classify(pw, sens.sens, sens.over, sens.passive);
      lcd = `<div class="lcd st-${st.code}">
        <div class="lcd-row"><span>λ ${r && !r.dark ? r.lambda : '----'} nm</span><span>${esc(cur.label)}</span></div>
        <div class="lcd-main">${pw === null ? 'LOS' : fmt(pw)}<small>${pw === null ? '' : ' dBm'}</small></div>
        <div class="lcd-row"><span>Att. cumulée : ${r && !r.dark && !r.lost ? fmt(r.loss) + ' dB' : '—'}</span><span>${r && !r.dark ? 'Src ' + (r.tx > 0 ? '+' : '') + fmt(r.tx, 1) : ''}</span></div>
        <div class="lcd-status">${esc(st.label)}</div></div>`;
    }
    let h = `<div class="fc-head"><b>Photomètre — ${esc(d.props.name)}</b><button class="btn icon small" data-ia="close" aria-label="Fermer">✕</button></div>${lcd}`;
    h += `<div class="pm-ports">${rd.map(x => `<button class="pm-port ${x.side + x.idx === key ? 'active' : ''}" data-key="${x.side + x.idx}"><span>${x.side === 'in' ? '⇥' : '↦'} ${esc(x.label)}</span><b class="st-${x.power === null ? 'los' : portCode(d, x.side, x.res, x.power)}">${x.power === null ? 'LOS' : fmt(x.power)}</b></button>`).join('')}</div>`;
    h += `<p class="muted small">Réf. : sensibilité ${dbm(sens.sens)}${sens.passive ? ` (ONT ${sens.ref})` : ''}, saturation ${dbm(sens.over)}.</p>`;
    return h;
  }

  function vflHTML() {
    const d = devById(S.vfl.devId);
    const r = S.vfl.result;
    const leaks = r.leaks.length;
    return `<div class="fc-head"><b><span class="red-dot"></span>VFL injecté : ${esc(d.props.name)}</b><button class="btn icon small" data-ia="close" aria-label="Éteindre">✕</button></div>
      <div class="segmented small"><button data-vdir="down" class="${S.vfl.dir === 'down' ? 'active' : ''}">Sens aval →</button><button data-vdir="up" class="${S.vfl.dir === 'up' ? 'active' : ''}">← Sens amont</button></div>
      <p class="small">${r.lit.size} câble(s) éclairé(s). ${leaks ? `<b class="st-los">${leaks} fuite(s) de lumière rouge visible(s)</b> : défaut localisé !` : 'Aucune fuite visible : continuité OK sur la portée du VFL (≈ 5 km).'}</p>
      <button class="btn small" data-ia="off">Éteindre le VFL</button>`;
  }

  function bindInstrument() {
    $$('[data-ia]', instr).forEach(b => b.addEventListener('click', () => {
      if (b.dataset.ia === 'close') { S.pm = null; S.vfl = null; if (S.tool && (S.tool.kind === 'pm' || S.tool.kind === 'vfl')) setTool(null); }
      if (b.dataset.ia === 'off') S.vfl = null;
      render(); renderInstrument();
    }));
    $$('[data-key]', instr).forEach(b => b.addEventListener('click', () => { S.pm.key = b.dataset.key; renderInstrument(); }));
    $$('[data-vdir]', instr).forEach(b => b.addEventListener('click', () => { S.vfl.dir = b.dataset.vdir; logJ('vfl', `VFL ${S.vfl.dir === 'up' ? 'sens amont' : 'sens aval'} sur ${devById(S.vfl.devId).props.name}`, { id: S.vfl.devId }); S.vfl.result = P.vflInject(S.engine, S.vfl.devId, S.vfl.dir); render(); renderInstrument(); }));
  }

  /* ------------------------------------------------------------------ */
  /*  Pannes (mode Simulation)                                            */
  /* ------------------------------------------------------------------ */


  /* ------------------------------------------------------------------ */
  /*  Modales : générique, TP, documentation                              */
  /* ------------------------------------------------------------------ */
  const modal = $('#modal');
  function openModal(title, body, buttons = [], cls = '') {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    const foot = $('#modalFoot');
    foot.innerHTML = '';
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      el.textContent = b.label;
      el.addEventListener('click', b.action);
      foot.appendChild(el);
    });
    foot.hidden = !buttons.length;
    modal.querySelector('.modal').className = 'modal ' + cls;
    modal.hidden = false;
  }
  function closeModal() { modal.hidden = true; }
  $('#modalClose').addEventListener('click', closeModal);
  modal.addEventListener('pointerdown', e => { if (e.target === modal) closeModal(); });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const p = $('#modalFoot .primary'); if (p) p.click(); }
  });

  function confirmReplace(then) {
    if (!S.topo.devices.length && !S.exam) return then();
    const msg = S.exam ? `<p>L'examen « ${esc(S.exam.title)} » est en cours : il sera <b>abandonné</b>. Avez-vous rendu votre copie ?</p>` : '<p>La topologie actuelle sera remplacée. Pensez à la sauvegarder si nécessaire (vous pourrez aussi annuler avec Ctrl+Z).</p>';
    openModal(S.exam ? 'Quitter l\'examen ?' : 'Remplacer la topologie ?', msg, [
      { label: 'Annuler', action: closeModal },
      { label: S.exam ? 'Quitter l\'examen' : 'Remplacer', primary: true, danger: !!S.exam, action: () => { closeModal(); endExam(); then(); } }
    ]);
  }

  let labSel = 'tp1';
  function openLabs(id) {
    if (id) labSel = id;
    const list = L.LABS.map(l => `<button class="lab-item ${l.id === labSel ? 'active' : ''}" data-lab="${l.id}"><span class="num">TP ${l.num}</span><b>${esc(l.title)}</b><small>${esc(l.archi)} · ${esc(l.level)} · ${esc(l.duration)}</small></button>`).join('')
      + '<div class="lab-sep">Exemples</div>'
      + L.EXAMPLES.map(x => `<button class="lab-item ${x.id === labSel ? 'active' : ''}" data-lab="${x.id}"><b>${esc(x.title)}</b></button>`).join('');
    let detail;
    const lab = L.LABS.find(l => l.id === labSel);
    if (lab) {
      detail = `<div class="lab-head"><span class="tag">TP ${lab.num}</span><span class="tag">${esc(lab.archi)}</span><span class="tag">${esc(lab.level)}</span><span class="tag">⏱ ${esc(lab.duration)}</span></div>
        <h2>${esc(lab.title)}</h2>
        <div class="lab-actions"><button class="btn primary" data-load="${lab.id}">Charger la topologie du TP</button></div>
        <h4>Objectifs</h4><ul>${lab.objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
        <h4>Situation professionnelle</h4><p>${esc(lab.context)}</p>
        <h4>Consignes pas-à-pas</h4><ol class="steps">${lab.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
        <h4>Questions d'évaluation</h4><ol class="questions">${lab.questions.map(q => `<li><p>${esc(q.q)}</p></li>`).join('')}</ol>`;
    } else {
      const ex = L.EXAMPLES.find(x => x.id === labSel);
      detail = `<h2>${esc(ex.title)}</h2><p>${esc(ex.desc)}</p><div class="lab-actions"><button class="btn primary" data-load-ex="${ex.id}">Charger l'exemple</button></div>`;
    }
    openModal('Exemples & Travaux Pratiques', `<div class="split"><nav class="lab-list">${list}</nav><article class="lab-detail">${detail}</article></div>`, [], 'wide');
    $$('[data-lab]').forEach(b => b.addEventListener('click', () => openLabs(b.dataset.lab)));
    $$('[data-load]').forEach(b => b.addEventListener('click', () => loadLab(b.dataset.load, false)));
    
    $$('[data-load-ex]').forEach(b => b.addEventListener('click', () => {
      const ex = L.EXAMPLES.find(x => x.id === b.dataset.loadEx);
      confirmReplace(() => { closeModal(); S.lab = null; renderTpPanel(); loadTopology(ex.topology()); setMode('design'); toast(`Exemple chargé : ${ex.title}`, 'ok'); });
    }));
  }

  function loadLab(id, full) {
    const lab = L.LABS.find(l => l.id === id);
    confirmReplace(() => {
      closeModal();
      loadTopology(lab.topology(full));
      S.lab = { id, checks: lab.steps.map(() => false), collapsed: false };
      setMode(id === 'tp5' ? 'test' : 'design');
      renderTpPanel();
      requestAnimationFrame(fitView);
      toast(`TP ${lab.num} chargé${full ? ' (correction)' : ''}.`, 'ok');
    });
  }

  function renderTpPanel() {
    const el = $('#tpPanel');
    if (!S.lab) { el.hidden = true; return; }
    const lab = L.LABS.find(l => l.id === S.lab.id);
    el.hidden = false;
    el.classList.toggle('collapsed', S.lab.collapsed);
    const done = S.lab.checks.filter(Boolean).length;
    el.innerHTML = `<div class="fc-head"><b>TP ${lab.num} — ${esc(lab.title)}</b><span class="tp-progress">${done}/${lab.steps.length}</span>
      <button class="btn icon small" data-tp="toggle" aria-label="Réduire">${S.lab.collapsed ? '▾' : '▴'}</button><button class="btn icon small" data-tp="close" aria-label="Fermer">✕</button></div>
      <div class="tp-body"><ol>${lab.steps.map((s, i) => `<li><label><input type="checkbox" data-step="${i}" ${S.lab.checks[i] ? 'checked' : ''}> <span>${esc(s)}</span></label></li>`).join('')}</ol>
      <button class="btn small" data-tp="questions">${TEACHER ? 'Questions & correction' : 'Questions'}</button></div>`;
    $$('[data-step]', el).forEach(c => c.addEventListener('change', () => { S.lab.checks[+c.dataset.step] = c.checked; renderTpPanel(); }));
    $$('[data-tp]', el).forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.tp;
      if (a === 'toggle') S.lab.collapsed = !S.lab.collapsed;
      if (a === 'close') S.lab = null;
      if (a === 'questions') return openLabs(lab.id);
      renderTpPanel();
    }));
  }

  let docSel = 'start';
  function openDocs(id) {
    if (id) docSel = id;
    const groups = {};
    L.DOCS.forEach(d => { (groups[d.group] = groups[d.group] || []).push(d); });
    const nav = Object.entries(groups).map(([g, items]) => `<div class="lab-sep">${esc(g)}</div>` + items.map(d => `<button class="lab-item ${d.id === docSel ? 'active' : ''}" data-doc="${d.id}"><b>${esc(d.title)}</b></button>`).join('')).join('');
    const doc = L.DOCS.find(d => d.id === docSel);
    openModal('Documentation — Guide de l\'utilisateur & Cours FTTx', `<div class="split"><nav class="lab-list">${nav}</nav><article class="lab-detail doc"><h2>${esc(doc.title)}</h2>${doc.html}</article></div>`, [], 'wide');
    $$('[data-doc]').forEach(b => b.addEventListener('click', () => openDocs(b.dataset.doc)));
    // Liens internes entre pages de documentation
    $$('.lab-detail [data-doc-link]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); openDocs(a.dataset.docLink); }));
  }

  /* ------------------------------------------------------------------ */
  /*  Fichiers                                                            */
  /* ------------------------------------------------------------------ */
  function download(text, name, type = 'application/json') {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  /**
   * Enregistre un fichier avec la boîte « Enregistrer sous » (Chrome, Edge) : le dossier
   * choisi (ex. dossier partagé de la salle) est retenu pour la fois suivante grâce à `id`.
   * Sinon, téléchargement classique. Renvoie 'dossier', 'telechargement' ou null (annulé).
   */
  async function saveAs(text, name, type = 'application/json', id = 'optisim') {
    if (window.showSaveFilePicker) {
      try {
        const ext = '.' + name.split('.').pop();
        const h = await window.showSaveFilePicker({ id, suggestedName: name, types: [{ description: ext === '.csv' ? 'Tableau CSV' : 'Fichier OptiSim', accept: { [type]: [ext] } }] });
        const w = await h.createWritable(); await w.write(text); await w.close();
        return 'dossier';
      } catch (e) { if (e && e.name === 'AbortError') return null; /* autre erreur : téléchargement */ }
    }
    download(text, name, type);
    return 'telechargement';
  }
  const slug = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sans-nom';
  function saveFile() {
    if (S.exam) return submitCopy();
    const data = { app: 'OptiSim FTTx Lab', author: 'Hassami COMPAORE', version: 1, savedAt: new Date().toISOString(), view: S.view, devices: S.topo.devices, links: S.topo.links };
    if (S.topo.recette) data.recette = S.topo.recette;
    if (S.topo.projet) data.projet = S.topo.projet;
    download(JSON.stringify(data, null, 2), `topologie-optisim-${new Date().toISOString().slice(0, 10)}.json`);
    toast('Topologie exportée en JSON.', 'ok');
  }
  function openFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        const ex = X.readFile(data);
        if (ex && ex.kind === 'sujet') {
          if (S.exam) return toast('Un examen est déjà en cours : rendez d\'abord votre copie.', 'warn');
          pendingSujet = ex.data; return openPasserExam();
        }
        if (ex && ex.kind === 'copie') {
          if (TEACHER) return openGrading([ex.data]);
          return toast('Ce fichier est une copie d\'élève : seule la version enseignant peut la corriger.', 'err');
        }
        if (!Array.isArray(data.devices) || !Array.isArray(data.links)) throw new Error('format');
        const go = () => {
          loadTopology(data);
          S.lab = null; renderTpPanel();
          toast(`Fichier « ${file.name} » chargé.`, 'ok');
        };
        if (S.exam) confirmReplace(go); else go();
      } catch (e) { toast('Fichier invalide : ce n\'est pas une topologie OptiSim (JSON).', 'err'); }
    };
    rd.readAsText(file);
  }

  /* ------------------------------------------------------------------ */
  /*  Examen : sujet verrouillé, journal, copie                           */
  /* ------------------------------------------------------------------ */
  let lastDiag = null; // dernier diagnostic journalisé (évite les doublons à chaque rafraîchissement)
  function linkLabel(l) { const A = devById(l.a.dev), B = devById(l.b.dev); return `${A ? A.props.name : '?'} → ${B ? B.props.name : '?'}`; }
  /** Ajoute une action au journal (seulement pendant un examen). */
  function logJ(k, txt, extra) {
    if (!S.exam) return;
    if (k === 'diag') { if (lastDiag === extra.id) return; lastDiag = extra.id; }
    if (S.journal.length >= 3000) return;
    S.journal.push(Object.assign({ t: new Date().toISOString(), k, txt }, extra || {}));
    saveExamState();
  }
  function saveExamState() {
    if (S.exam) store.set(EXAM_KEY, X.encode({ exam: S.exam, student: S.examStudent, start: S.examStart, journal: S.journal }));
  }
  function restoreExamState() {
    const raw = store.get(EXAM_KEY);
    if (!raw) return;
    try { const o = X.decode(raw); S.exam = o.exam; S.examStudent = o.student || null; S.examStart = o.start; S.journal = o.journal || []; document.body.classList.add('exam-locked'); }
    catch (e) { store.del(EXAM_KEY); }
  }
  /** Bloque les modifications de structure pendant un examen. */
  function locked() {
    if (!S.exam) return false;
    toast('Examen en cours : la topologie est verrouillée (mesures, interventions et réglages seulement).', 'warn');
    return true;
  }
  function startExam(exam, student) {
    S.exam = exam;
    S.examStudent = student || null;
    S.examStart = new Date().toISOString();
    S.journal = [];
    S.lab = null; renderTpPanel();
    S.topo = { devices: [], links: [] };
    loadTopology(exam.topo, { undoable: false });
    S.undo = []; S.redo = [];
    logJ('debut', `Ouverture du sujet « ${exam.title} »${student ? ` par ${student.prenom} ${student.nom} (${student.classe})` : ''}`);
    document.body.classList.add('exam-locked');
    setMode('test');
    renderExamBar();
    toast(`Examen commencé${exam.duree ? ` : ${exam.duree} min` : ''}. Les consignes restent accessibles dans la barre supérieure.`, 'ok');
  }
  function endExam() {
    if (!S.exam) return;
    S.exam = null; S.examStudent = null; S.examStart = null; S.journal = [];
    store.del(EXAM_KEY);
    document.body.classList.remove('exam-locked');
    renderExamBar();
  }
  /* Page « Passer un examen » (bouton de la version élève, ou « Ouvrir » sur un sujet) :
     marche à suivre, choix du sujet, résumé et consignes, identité, « Commencer l'examen ». */
  let pendingSujet = null;   // sujet choisi, examen pas encore commencé
  let passDraft = {};        // identité en cours de saisie (conservée quand la page est redessinée)
  function nominatif(s) { const w = String(s.eleve || '').trim().split(/\s+/); return s.eleve ? { nom: w[0] || '', prenom: w.slice(1).join(' ') } : null; }
  function openPasserExam(msg) {
    if (S.exam) return showConsignes();
    const s = pendingSujet, nm = s && nominatif(s);
    let prev = {};
    try { prev = JSON.parse(store.get('optisim-eleve') || '{}'); } catch (e) { prev = {}; }
    const id = Object.assign({ nom: prev.nom || '', prenom: prev.prenom || '', classe: prev.classe || '' }, passDraft, nm || {});
    const ro = nm ? ' readonly' : '';
    openModal('Examen — Passer un examen', `<div class="modal-pad exam-pass">
      <ol class="exam-howto">
        <li>Chargez le fichier <b>sujet</b> fourni par votre enseignant (clé USB, dossier partagé…) : ci-dessous, ou bouton <b>Ouvrir</b> de la barre supérieure.</li>
        <li>Indiquez votre <b>nom</b>, votre <b>prénom</b> et votre <b>classe</b>, puis cliquez sur <b>« Commencer l'examen »</b> : le chronomètre démarre.</li>
        <li>Pendant l'examen, le réseau est <b>verrouillé</b> (ni ajout, ni suppression, ni déplacement) et vos actions sont enregistrées. Les <b>consignes</b> restent accessibles dans la barre supérieure.</li>
        <li>À la fin, cliquez sur <b>« Rendre ma copie »</b> (barre supérieure, ou <kbd>Ctrl</kbd>+<kbd>S</kbd>) : un fichier <code>copie-NOM-PRENOM-….json</code> est enregistré. Remettez-le à votre enseignant.</li>
      </ol>
      <div class="exam-box">
        <label>Fichier sujet<input type="file" id="epFile" accept=".json,application/json"></label>
        ${s ? `<div class="alert ok" id="epResume">Sujet chargé : <b>${esc(s.title)}</b> — durée ${s.duree ? esc(s.duree) + '&nbsp;min' : 'libre'} · réseau verrouillé</div>` : '<p class="muted small">Aucun sujet choisi.</p>'}
        ${nm ? `<div class="alert warn" id="epNominatif">Sujet nominatif : <b>${esc(s.eleve)}</b>. Si ce n'est pas votre nom, signalez-le à votre enseignant.</div>` : ''}
        ${s && s.consignes ? `<div class="exam-consignes"><b>Consignes</b><div class="pre">${esc(s.consignes)}</div></div>` : ''}
        <div class="form-grid ident"><label>Nom<input type="text" id="epNom" value="${esc(id.nom)}" autocomplete="off"${ro}></label><label>Prénom<input type="text" id="epPrenom" value="${esc(id.prenom)}" autocomplete="off"${ro}></label><label>Classe<input type="text" id="epClasse" value="${esc(id.classe)}" autocomplete="off"></label></div>
        <div id="epMsg">${msg || ''}</div>
        ${s && S.topo.devices.length ? '<p class="muted small">La topologie actuelle sera remplacée par le réseau du sujet : sauvegardez-la avant si nécessaire.</p>' : ''}
      </div></div>`, [
      { label: 'Annuler', action: closeModal },
      { label: '▶ Commencer l\'examen', primary: true, action: beginExam }
    ], 'exam-pass-modal');
    $('#modalFoot .primary').disabled = !s;
    const keep = () => { passDraft = { nom: $('#epNom').value, prenom: $('#epPrenom').value, classe: $('#epClasse').value }; if (nm) { delete passDraft.nom; delete passDraft.prenom; } };
    ['#epNom', '#epPrenom', '#epClasse'].forEach(q => $(q).addEventListener('input', keep));
    $('#epFile').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      keep();
      const rd = new FileReader();
      rd.onload = () => {
        let ex = null;
        try { ex = X.readFile(JSON.parse(rd.result)); } catch (err) { ex = null; }
        if (!ex || ex.kind !== 'sujet') return ($('#epMsg').innerHTML = `<div class="alert err">Sujet refusé : « ${esc(f.name)} » n'est pas un sujet d'examen OptiSim FTTx Lab. Choisissez le fichier sujet-….json donné par votre enseignant.</div>`);
        pendingSujet = ex.data;
        openPasserExam();
      };
      rd.readAsText(f);
    });
    setTimeout(() => { const i = s && ['#epNom', '#epPrenom', '#epClasse'].map(q => $(q)).find(x => x && !x.value); if (i) i.focus(); }, 30);
  }
  function beginExam() {
    if (!pendingSujet) return;
    const st = { nom: $('#epNom').value.trim(), prenom: $('#epPrenom').value.trim(), classe: $('#epClasse').value.trim() };
    if (!st.nom || !st.prenom || !st.classe) { $('#epMsg').innerHTML = '<div class="alert warn">Indiquez votre nom, votre prénom et votre classe.</div>'; return; }
    store.set('optisim-eleve', JSON.stringify(st));
    const sujet = pendingSujet;
    closeModal();
    confirmReplace(() => { pendingSujet = null; passDraft = {}; startExam(sujet, st); });
  }
  function examElapsed() { return S.examStart ? Math.floor((Date.now() - Date.parse(S.examStart)) / 60000) : 0; }
  function renderExamBar() {
    const g = $('#examGroup');
    g.hidden = !S.exam;
    $('#btnPasserExam').hidden = TEACHER || !!S.exam;
    if (!S.exam) return;
    const el = examElapsed();
    const left = S.exam.duree ? S.exam.duree - el : null;
    const tag = $('#examTag');
    const who = S.examStudent ? `🎓 ${S.examStudent.prenom} ${S.examStudent.nom}` : 'Examen';
    tag.innerHTML = `<span class="who">${esc(who)}</span><span>&nbsp;· ${left === null ? `${el} min` : left > 0 ? `reste ${left} min` : 'temps écoulé'}</span>`;
    tag.title = S.examStudent ? `${S.examStudent.prenom} ${S.examStudent.nom} (${S.examStudent.classe}) — ${S.exam.title}` : S.exam.title;
    tag.classList.toggle('late', left !== null && left <= 0);
    if (left !== null && left <= 0 && !S.exam.lateWarned) { S.exam.lateWarned = true; toast('Temps écoulé : rendez votre copie.', 'warn'); }
  }
  function showConsignes() {
    if (!S.exam) return;
    const e = S.exam;
    const st = S.examStudent;
    const left = e.duree ? e.duree - examElapsed() : null;
    openModal(`Consignes — ${e.title}`, `<p>${st ? `<b>${esc(st.prenom)} ${esc(st.nom)}</b> (${esc(st.classe)}) · ` : ''}commencé à ${new Date(S.examStart).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · durée ${e.duree ? e.duree + '&nbsp;min' : 'libre'}${left !== null ? ` · temps restant <b>${left > 0 ? left + '&nbsp;min' : 'écoulé'}</b>` : ''}</p>
      ${e.eleve ? `<p class="small">Sujet nominatif : <b>${esc(e.eleve)}</b>.</p>` : ''}
      ${e.consignes ? `<div class="exam-consignes"><b>Consignes</b><div class="pre">${esc(e.consignes)}</div></div>` : '<p class="muted small">Pas de consigne particulière.</p>'}
      <p class="muted small">Le réseau est verrouillé : seuls les mesures, les réglages et les interventions sont permis. Vos actions sont enregistrées. Pour terminer : <b>« Rendre ma copie »</b> dans la barre supérieure, ou <kbd>Ctrl</kbd>+<kbd>S</kbd>.</p>`, [{ label: 'Fermer', primary: true, action: closeModal }]);
  }
  function submitCopy() {
    if (!S.exam) return;
    let prev = {};
    try { prev = JSON.parse(store.get('optisim-eleve') || '{}'); } catch (e) { prev = {}; }
    if (S.examStudent) prev = S.examStudent;
    else if (S.exam.eleve && !prev.nom) { const w = S.exam.eleve.split(/\s+/); prev = { nom: w[0] || '', prenom: w.slice(1).join(' ') }; }
    openModal('Rendre ma copie', `<p>Votre copie contient la topologie dans son état actuel et le journal de vos actions.</p>
      <div class="form-grid"><label>Nom<input type="text" id="cpNom" value="${esc(prev.nom || '')}" autocomplete="off"></label><label>Prénom<input type="text" id="cpPrenom" value="${esc(prev.prenom || '')}" autocomplete="off"></label><label>Classe<input type="text" id="cpClasse" value="${esc(prev.classe || '')}" autocomplete="off"></label></div>
      <p class="muted small">Choisissez le <b>dossier de dépôt</b> indiqué par votre enseignant (par exemple <code>Copies\\votre classe</code> sur le partage de la salle) : il sera proposé automatiquement la fois suivante. Selon le navigateur, le fichier peut aussi arriver dans Téléchargements : remettez-le alors à votre enseignant (clé USB, ENT…). Vous pouvez continuer puis rendre une nouvelle copie : l'enseignant corrige la plus récente.</p>`, [
      { label: 'Annuler', action: closeModal },
      { label: 'Enregistrer ma copie', primary: true, action: async () => {
        const eleve = { nom: $('#cpNom').value.trim(), prenom: $('#cpPrenom').value.trim(), classe: $('#cpClasse').value.trim() };
        if (!eleve.nom) { toast('Indiquez votre nom.', 'err'); return; }
        store.set('optisim-eleve', JSON.stringify(eleve));
        logJ('rendu', 'Copie rendue');
        const file = X.makeCopie(S.exam, S.topo, S.journal, eleve);
        const ou = await saveAs(JSON.stringify(file), `copie-${slug(eleve.nom)}-${slug(eleve.prenom)}-${slug(S.exam.title)}.json`, 'application/json', 'optisim-copies');
        if (!ou) return toast('Enregistrement annulé : votre copie n\'est pas encore rendue.', 'warn');
        closeModal();
        toast(ou === 'dossier' ? 'Copie enregistrée dans le dossier choisi. Vous pouvez la rendre de nouveau plus tard si besoin.' : 'Copie enregistrée dans Téléchargements. Remettez-la à votre enseignant.', 'ok');
      } }
    ]);
    setTimeout(() => { const i = $('#cpNom'); if (i && !i.value) i.focus(); }, 30);
  }

  

  /* ------------------------------------------------------------------ */
  /*  Barre d'état, notifications                                         */
  /* ------------------------------------------------------------------ */
  function renderStatus() {
    $('#sbMode').textContent = MODE_LABELS[S.mode];
    $('#sbMode').className = 'sb-mode m-' + S.mode;
    let hint = '';
    if (S.tool && S.tool.kind === 'cable') hint = S.cableStart ? `Câblage ${CABLES[S.tool.type].short} : cliquez sur l'équipement d'arrivée (aval) — Échap pour annuler` : `Câblage ${CABLES[S.tool.type].short} : cliquez sur l'équipement de départ (amont)`;
    else if (S.tool && S.tool.kind === 'pm') hint = 'Photomètre : cliquez sur un équipement pour mesurer la puissance optique';
    else if (S.tool && S.tool.kind === 'otdr') hint = 'OTDR : cliquez sur l\'équipement visé (le tir part de la tête de réseau)';
    else if (S.tool && S.tool.kind === 'vfl') hint = 'VFL : cliquez sur l\'équipement où injecter la lumière rouge';
    else if (S.mode === 'fault') hint = TEACHER && !S.exam ? 'Sélectionnez un câble ou un équipement pour injecter / réparer une panne (pannes de configuration : onglet Configuration)' : 'Localisez le défaut par la mesure, sélectionnez l\'élément puis « Intervenir » (erreurs de configuration : onglet Configuration)';
    else if (S.mode === 'test') hint = 'Choisissez un instrument de mesure dans la boîte à outils';
    else hint = 'Glissez des équipements · choisissez un câble pour relier · molette = zoom · glisser le fond = déplacer';
    $('#sbHint').textContent = hint;
    const n = S.topo.devices.filter(d => !isContainer(d)).length;
    $('#sbInfo').textContent = `${n} équipement(s) · ${S.topo.links.length} câble(s) · zoom ${Math.round(S.view.k * 100)} %`;
    $('#btnUndo').disabled = !S.undo.length;
    $('#btnRedo').disabled = !S.redo.length;
  }

  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3600);
  }

  /* ------------------------------------------------------------------ */
  /*  Branchements globaux                                                */
  /* ------------------------------------------------------------------ */
  function bindGlobal() {
    $('#btnNew').addEventListener('click', () => confirmReplace(() => { S.lab = null; renderTpPanel(); loadTopology({ devices: [], links: [] }); toast('Nouvelle topologie.'); }));
    $('#btnOpen').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; });
    $('#btnSave').addEventListener('click', saveFile);
    $('#btnUndo').addEventListener('click', undo);
    $('#btnRedo').addEventListener('click', redo);
    $$('#modeSwitch button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    
    $('#btnExamInfo').addEventListener('click', showConsignes);
    $('#btnPasserExam').addEventListener('click', () => openPasserExam());
    $('#btnSubmit').addEventListener('click', submitCopy);
    $('#btnLabs').addEventListener('click', () => openLabs());
    $('#btnEmptyLabs').addEventListener('click', () => openLabs());
    $('#btnDocs').addEventListener('click', () => openDocs());
    $('#btnTheme').addEventListener('click', () => {
      const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t;
      store.set('optisim-theme', t);
      renderInspector();
    });
    $$('.tabs button').forEach(b => b.addEventListener('click', () => { S.tab = b.dataset.tab; lastDiag = null; renderInspector(); }));
    $('#zoomIn').addEventListener('click', () => { const r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2); });
    $('#zoomOut').addEventListener('click', () => { const r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2); });
    $('#zoomFit').addEventListener('click', fitView);
    window.addEventListener('resize', () => { if (S.tab === 'otdr') drawOtdr(); });

    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'select' || tag === 'textarea';
      if (e.key === 'Escape') {
        if (!modal.hidden) return closeModal();
        if (S.cableStart) { S.cableStart = null; render(); renderStatus(); return; }
        if (S.tool) return setTool(null);
        return select(null);
      }
      if (!modal.hidden) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return saveFile(); }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return deleteSelection(); }
      if (e.key === 'f' || e.key === 'F') return fitView();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Disposition ajustable : panneaux latéraux et fenêtres flottantes    */
  /* ------------------------------------------------------------------ */
  const UI_KEY = 'optisim-disposition';
  let ui = {};
  function saveUi() { store.set(UI_KEY, JSON.stringify(ui)); }
  function applyUi() {
    const lay = $('#layout');
    ['pal', 'insp'].forEach(k => { if (ui[k]) lay.style.setProperty(`--${k}-w`, ui[k] + 'px'); else lay.style.removeProperty(`--${k}-w`); });
    [['instrument', instr], ['tpPanel', $('#tpPanel')]].forEach(([k, el]) => {
      const o = ui[k];
      el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.width = el.style.height = '';
      if (!o) return;
      if (o.left !== undefined) Object.assign(el.style, { left: o.left + 'px', top: o.top + 'px', right: 'auto', bottom: 'auto' });
      if (o.width) el.style.width = o.width + 'px';
      if (o.height) el.style.height = o.height + 'px';
    });
  }
  function bindLayout() {
    try { ui = JSON.parse(store.get(UI_KEY) || '{}') || {}; } catch (e) { ui = {}; }
    applyUi();
    // Largeur de la boîte à outils et de l'inspecteur
    $$('.panel-resizer').forEach(h => {
      const k = h.dataset.resize;
      h.addEventListener('pointerdown', e => {
        e.preventDefault();
        const lay = $('#layout').getBoundingClientRect();
        h.setPointerCapture(e.pointerId); h.classList.add('active');
        const move = ev => {
          const w = k === 'pal' ? ev.clientX - lay.left : lay.right - ev.clientX;
          ui[k] = Math.round(Math.max(170, Math.min(k === 'pal' ? 460 : 640, w)));
          applyUi();
        };
        const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.classList.remove('active'); saveUi(); if (S.tab === 'otdr') drawOtdr(); };
        h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
      });
      h.addEventListener('dblclick', () => { delete ui[k]; applyUi(); saveUi(); if (S.tab === 'otdr') drawOtdr(); });
    });
    // Fenêtres flottantes : déplacées par leur titre, redimensionnées par le coin (CSS resize)
    [['instrument', instr], ['tpPanel', $('#tpPanel')]].forEach(([k, el]) => {
      el.addEventListener('pointerdown', e => {
        const head = e.target.closest('.fc-head');
        if (!head || e.target.closest('button, input, select, a, label')) return;
        const st = $('#stage').getBoundingClientRect(), r = el.getBoundingClientRect();
        const ox = e.clientX - r.left, oy = e.clientY - r.top;
        el.setPointerCapture(e.pointerId); el.classList.add('dragging');
        const move = ev => {
          const x = Math.round(Math.min(Math.max(0, ev.clientX - st.left - ox), st.width - 80));
          const y = Math.round(Math.min(Math.max(0, ev.clientY - st.top - oy), st.height - 40));
          ui[k] = Object.assign({}, ui[k], { left: x, top: y });
          Object.assign(el.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
        };
        const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.classList.remove('dragging'); saveUi(); };
        el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
      });
      el.addEventListener('dblclick', e => { if (e.target.closest('.fc-head') && !e.target.closest('button')) { delete ui[k]; applyUi(); saveUi(); } });
      // Taille choisie avec la poignée du coin (redimensionnement CSS : style.width / style.height)
      if (window.ResizeObserver) new ResizeObserver(() => {
        if (el.hidden || (!el.style.width && !el.style.height)) return;
        const w = parseFloat(el.style.width) || undefined, h = parseFloat(el.style.height) || undefined;
        const o = ui[k] || {};
        if (o.width === w && o.height === h) return;
        ui[k] = Object.assign({}, o, { width: w, height: h }); saveUi();
      }).observe(el);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Démarrage                                                           */
  /* ------------------------------------------------------------------ */
  function init() {
    if (!TEACHER) {
      MODE_LABELS.fault = 'Dépannage';
      $('#modeSwitch [data-mode="fault"]').textContent = 'Dépannage';
    }
    $('#edition').textContent = TEACHER ? 'Version enseignant' : 'Version élève';
    $('#edition').title = 'OptiSim FTTx Lab ' + ((window.OptiEdition && window.OptiEdition.numero) || '') + ' — ' + SIGNATURE;
    document.body.classList.add(TEACHER ? 'ed-enseignant' : 'ed-eleve');
    const th = store.get('optisim-theme');
    if (th) document.documentElement.dataset.theme = th;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset.theme = 'light';
    buildPalette();
    bindGlobal();
    bindLayout();
    let restored = false;
    const saved = store.get(STORE_KEY);
    if (saved) {
      try { const t = JSON.parse(saved); if (t.devices && t.devices.length) { S.topo = normalize(t); restored = true; } } catch (e) { /* ignore */ }
    }
    if (restored) restoreExamState();
    refresh();
    renderExamBar();
    setInterval(renderExamBar, 30000);
    if (restored) { requestAnimationFrame(fitView); toast(S.exam ? `Examen « ${S.exam.title} » repris.` : 'Session précédente restaurée.'); }
  }
  init();
})();
