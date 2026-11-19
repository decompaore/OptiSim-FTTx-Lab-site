/* =====================================================================
 * OptiSim FTTx Lab — examen.js
 * Auteur : Hassami COMPAORE
 * Sujets d'examen verrouillés, copies d'élèves, journal des actions et
 * correction automatique (barème sur 20). Aucun accès au DOM : testable
 * sous Node après physics.js et services.js.
 *
 * Fichiers échangés (JSON) :
 *   { app, kind: 'sujet' | 'copie', version: 1, title, data }
 * `data` est encodé (XOR + base64) pour que le contenu (liste des pannes,
 * journal, note) ne soit pas lisible dans un éditeur de texte. Ce n'est
 * pas un chiffrement : il empêche seulement la lecture directe.
 * ===================================================================== */
(function (global) {
  'use strict';

  const APP = 'OptiSim FTTx Lab';
  const KEY = 'OptiSim-FTTx-Lab/Hassami-COMPAORE';
  const DEFAULT_BAREME = { pannes: 12, services: 4, methode: 4, penalite: 1 };
  const BAREME_LABELS = {
    pannes: 'Pannes réparées',
    services: 'Services et liaisons rétablis',
    methode: 'Méthode (mesure, ou diagnostic d\'un appareil, avant chaque correction)',
    penalite: 'Pénalité par intervention inutile'
  };
  const MEASURES = new Set(['mesure', 'otdr', 'vfl']);

  /* ---------------- Encodage ---------------- */
  const toB64 = bytes => {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = str => {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
    const s = atob(str); const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  };
  function xor(bytes) {
    const k = new TextEncoder().encode(KEY);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ k[i % k.length] ^ (i * 31 & 255);
    return out;
  }
  const encode = obj => toB64(xor(new TextEncoder().encode(JSON.stringify(obj))));
  const decode = str => JSON.parse(new TextDecoder().decode(xor(fromB64(str))));

  const clone = o => JSON.parse(JSON.stringify(o));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------------- Pannes présentes dans une topologie ---------------- */
  function linkName(topo, l) {
    const A = topo.devices.find(d => d.id === l.a.dev), B = topo.devices.find(d => d.id === l.b.dev);
    return `${A ? A.props.name : '?'} → ${B ? B.props.name : '?'}`;
  }
  /** Liste les pannes (physiques et de configuration) d'une topologie. */
  function listFaults(topo) {
    const P = global.OptiPhysics, SV = global.OptiServices;
    const out = [];
    topo.devices.forEach(d => {
      if (d.fault && d.fault.type) out.push({ kind: 'dev', id: d.id, type: d.fault.type, label: P.FAULTS[d.fault.type] ? P.FAULTS[d.fault.type].label : d.fault.type, where: d.props.name });
      if (d.cfgFault && d.cfgFault.type) out.push({ kind: 'cfg', id: d.id, type: d.cfgFault.type, label: SV.CFG_FAULTS[d.cfgFault.type] ? SV.CFG_FAULTS[d.cfgFault.type].label : d.cfgFault.type, where: d.props.name });
    });
    topo.links.forEach(l => {
      if (l.fault && l.fault.type) out.push({ kind: 'link', id: l.id, type: l.fault.type, label: P.FAULTS[l.fault.type] ? P.FAULTS[l.fault.type].label : l.fault.type, where: linkName(topo, l) });
    });
    return out;
  }

  /* ---------------- Sujet ---------------- */
  /**
   * Crée le fichier « sujet » à partir de la topologie de l'enseignant.
   * Toutes les pannes deviennent cachées.
   */
  function makeSujet(topo, meta) {
    const t = { devices: clone(topo.devices), links: clone(topo.links) };
    if (topo.recette) t.recette = Object.assign(clone(topo.recette), { mesures: {}, tirs: [] }); // fiche de recette vierge
    t.devices.concat(t.links).forEach(o => { if (o.fault && o.fault.type) o.fault.hidden = true; if (o.cfgFault) o.cfgFault.hidden = true; });
    const exam = {
      id: newId(),
      title: String(meta.title || 'Examen de dépannage').trim() || 'Examen de dépannage',
      consignes: String(meta.consignes || ''),
      duree: Math.max(0, Math.round(+meta.duree || 0)),
      bareme: Object.assign({}, DEFAULT_BAREME, meta.bareme || {}),
      signaler: !!meta.signaler,
      eleve: String(meta.eleve || '').trim(),   // sujet nominatif (lot de sujets individuels)
      lot: String(meta.lot || ''),
      createdAt: new Date().toISOString(),
      faults: listFaults(t),
      topo: t
    };
    return { app: APP, kind: 'sujet', version: 1, title: exam.title, data: encode(exam) };
  }

  /** Lit un fichier sujet ou copie ; renvoie null si le fichier n'en est pas un. */
  function readFile(file) {
    if (!file || file.app !== APP || (file.kind !== 'sujet' && file.kind !== 'copie') || typeof file.data !== 'string') return null;
    const data = decode(file.data);
    return { kind: file.kind, data };
  }

  /* ---------------- Copie ---------------- */
  function makeCopie(exam, topo, journal, eleve) {
    const copie = {
      eleve: { nom: String(eleve.nom || '').trim(), prenom: String(eleve.prenom || '').trim(), classe: String(eleve.classe || '').trim() },
      renduLe: new Date().toISOString(),
      exam,
      topo: Object.assign({ devices: clone(topo.devices), links: clone(topo.links) }, topo.recette ? { recette: clone(topo.recette) } : {}),
      journal: clone(journal || [])
    };
    return { app: APP, kind: 'copie', version: 1, title: exam.title, data: encode(copie) };
  }

  /* ---------------- Lots de sujets individuels ---------------- */
  function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rngFrom(str) {
    let a = hashStr(str);
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const slugify = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sans-nom';
  const PASSIVES = ['odf', 'odf_int', 'pmi', 'sro', 'pbo_ext', 'pbo_int', 'pto', 'splice', 'coupler'];
  /**
   * Injecte des pannes cachées tirées au hasard (rnd) : nCfg pannes de configuration (si la
   * couche service est active), puis nOpt pannes optiques sur des éléments éclairés.
   */
  function injectRandomFaults(t, nOpt, nCfg, rnd) {
    const P = global.OptiPhysics, SV = global.OptiServices;
    for (let i = 0; i < nCfg; i++) {
      P.assignParents(t);
      const e = new P.Engine(t);
      if (!SV.randomCfgFault(t, e, rnd)) break;
    }
    P.assignParents(t);
    const e = new P.Engine(t);
    const cands = [];
    t.links.forEach(l => { if (P.CABLES[l.type].kind === 'opt' && !l.fault && e.linkState(l).lit) cands.push({ kind: 'link', o: l }); });
    t.devices.forEach(d => { if (PASSIVES.includes(d.type) && !d.fault) { const st = e.deviceState(d.id); if (st && st.res && !st.res.dark) cands.push({ kind: 'dev', o: d }); } });
    for (let i = 0; i < nOpt && cands.length; i++) {
      const c = cands.splice(Math.floor(rnd() * cands.length), 1)[0];
      const types = Object.keys(P.FAULTS).filter(k => c.kind === 'link' ? P.FAULTS[k].link : P.FAULTS[k].device);
      c.o.fault = { type: types[Math.floor(rnd() * types.length)], hidden: true };
      if (c.kind === 'link') c.o.fault.pos = Math.round(e.lengthInfo(c.o).total * (0.15 + rnd() * 0.7) * 10) / 10;
    }
    return t;
  }
  /**
   * Lot de sujets individuels : à partir d'une même topologie, un sujet nominatif par élève,
   * avec ses propres pannes. Renvoie les fichiers (sujets + corrigé) et l'archive .zip.
   */
  function makeLot(topo, eleves, opts) {
    const o = Object.assign({ optiques: 1, config: 0, meta: {} }, opts || {});
    const lot = newId();
    const noms = eleves.map(x => String(x).trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
    const files = [], rows = [['Élève', 'Fichier', 'Pannes']], seen = new Set();
    noms.forEach(nom => {
      let t, sig, k = 0;
      do { // évite deux sujets identiques quand c'est possible
        t = injectRandomFaults({ devices: clone(topo.devices), links: clone(topo.links), recette: topo.recette ? clone(topo.recette) : undefined }, o.optiques, o.config, rngFrom(lot + '|' + nom + '|' + k));
        sig = listFaults(t).map(f => f.kind + f.id + f.type).sort().join(',');
        k++;
      } while (seen.has(sig) && k < 8);
      seen.add(sig);
      if (!t.recette) delete t.recette;
      const file = makeSujet(t, Object.assign({}, o.meta, { eleve: nom, lot }));
      const name = `sujet-${slugify(file.title)}-${slugify(nom)}.json`;
      files.push({ name, text: JSON.stringify(file) });
      rows.push([nom, name, listFaults(t).map(f => `${f.label} — ${f.where}`).join(' | ')]);
    });
    const csv = '\ufeff' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    files.push({ name: 'CORRIGE-ne-pas-distribuer.csv', text: csv });
    return { lot, count: noms.length, files, zip: zipFiles(files) };
  }

  /* ---------------- Archive .zip (sans compression) ---------------- */
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  /** Archive ZIP (méthode « stockée », noms UTF-8) : files = [{ name, text }]. */
  function zipFiles(files) {
    const enc = new TextEncoder(), now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [], central = [];
    let offset = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      chunks.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cSize = central.reduce((s, x) => s + x.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cSize, true); e.setUint32(16, offset, true);
    const all = chunks.concat(central, [new Uint8Array(e.buffer)]);
    const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
    let p = 0; all.forEach(x => { out.set(x, p); p += x.length; });
    return out;
  }
  /** Le nom de la copie correspond-il à l'élève du sujet nominatif ? */
  function sameStudent(sujetEleve, eleve) {
    if (!sujetEleve) return true;
    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const ref = norm(sujetEleve), got = norm(`${eleve.nom} ${eleve.prenom}`);
    return got.length > 0 && got.every(w => ref.includes(w));
  }

  /* ---------------- Correction ---------------- */
  function isEnd(d, SV) {
    return d.type === 'ont' || d.type === 'router' || !!SV.TERMINAL_SERVICE[d.type] || (d.props && d.props.sensitivity !== undefined);
  }
  /** États de référence (ou finaux) des abonnés : liaison optique / Ethernet et services. */
  function states(topo) {
    const P = global.OptiPhysics, SV = global.OptiServices;
    const t = clone(topo);
    P.assignParents(t);
    const e = new P.Engine(t);
    const a = SV.analyze(t, e);
    const items = new Map();
    t.devices.forEach(d => {
      if (P.CATALOG[d.type] && P.CATALOG[d.type].container) return;
      if (!isEnd(d, SV)) return;
      const st = e.deviceState(d.id);
      if (st) items.set('lk:' + d.id, { name: d.props.name, what: 'Liaison', code: st.code });
      const r = a.terminals.get(d.id);
      if (r && r.evaluated) items.set('sv:' + d.id, { name: d.props.name, what: 'Service ' + r.label, code: r.ok ? 'ok' : 'los' });
    });
    return items;
  }
  /** Topologie de l'enseignant sans aucune panne (référence attendue). */
  function healthy(topo) {
    const SV = global.OptiServices;
    const t = clone(topo);
    t.devices.forEach(d => { delete d.fault; if (d.cfgFault) SV.repairCfgFault(d); });
    t.links.forEach(l => { delete l.fault; });
    return t;
  }

  const round05 = v => Math.round(v * 2) / 2;

  /**
   * Corrige une copie (objet décodé). `bareme` remplace celui du sujet.
   * Renvoie le détail : pannes, services, méthode, interventions inutiles, note /20.
   */
  function grade(copie, bareme) {
    const B = Object.assign({}, DEFAULT_BAREME, copie.exam.bareme || {}, bareme || {});
    const fin = copie.topo;
    const byId = id => fin.devices.find(d => d.id === id) || fin.links.find(l => l.id === id);
    const faults = copie.exam.faults.map(f => {
      const o = byId(f.id);
      const repaired = !!o && (f.kind === 'cfg' ? !(o.cfgFault && o.cfgFault.type === f.type) : !(o.fault && o.fault.type));
      return Object.assign({}, f, { repaired });
    });
    const nRep = faults.filter(f => f.repaired).length;

    // Services et liaisons : chaque élément en service dans la référence doit l'être à la fin
    const ref = states(healthy(copie.exam.topo));
    const now = states(fin);
    const services = [];
    ref.forEach((r, k) => {
      if (r.code !== 'ok' && r.code !== 'weak') return;
      const n = now.get(k);
      const ok = !!n && (n.code === 'ok' || (r.code === 'weak' && n.code === 'weak'));
      services.push({ name: r.name, what: r.what, ok });
    });
    const nSvc = services.filter(s => s.ok).length;

    // Fiche de recette (mode réaliste) : mesures saisies par l'élève comparées au réel
    let recette = null;
    if (fin.recette) {
      const P = global.OptiPhysics, SE = Object.assign({}, P.RECETTE_SEUILS, fin.recette.seuils || {});
      recette = P.recetteRows(fin).map(r => {
        const m = fin.recette.mesures && fin.recette.mesures[r.id] !== undefined ? +fin.recette.mesures[r.id] : null;
        const vs = P.recetteVerdict(r.theo, m, r.sens, r.over, SE);
        const vr = r.real === null ? { label: 'Non conforme : LOS' } : P.recetteVerdict(r.theo, r.real, r.sens, r.over, SE);
        return { name: r.name, theo: r.theo, saisie: m, reel: r.real, conclusion: vs ? vs.label : null, attendu: vr ? vr.label : null,
          juste: m !== null && r.real !== null && Math.abs(m - r.real) <= 0.1 };
      });
    }
    // Tirs OTDR enregistrés : complétude et analyse bidirectionnelle
    let otdr = null;
    if (fin.recette && Array.isArray(fin.recette.tirs) && fin.recette.tirs.length) {
      const P = global.OptiPhysics, T = fin.recette.tirs, seen = [];
      otdr = [];
      T.forEach(x => {
        const k = x.cible + '|' + x.lambda; if (seen.includes(k)) return; seen.push(k);
        const last = sens => T.filter(y => y.cible === x.cible && y.lambda === x.lambda && y.sens === sens).pop();
        const a = last('aller'), b = last('retour'), bi = a && b ? P.otdrBidir(a, b, fin.recette.seuils) : null;
        otdr.push({ nom: x.nom, lambda: x.lambda, aller: !!a, retour: !!b, conforme: bi ? bi.conforme : null, horsSeuil: bi ? bi.rows.filter(r => r.ok === false).length : null });
      });
    }

    // Méthode : chaque correction réussie doit être précédée d'une mesure (pannes physiques)
    // ou d'une consultation du diagnostic (pannes de configuration) depuis l'action précédente.
    const J = copie.journal || [];
    let seenMeasure = false, seenDiag = false, units = 0, methodical = 0;
    const inutiles = [];
    J.forEach(e => {
      if (MEASURES.has(e.k)) seenMeasure = true;
      else if (e.k === 'diag' && e.term) seenDiag = true;
      else if (e.k === 'intervention') {
        if (e.hit) { units++; if (seenMeasure) methodical++; } else inutiles.push(e);
        seenMeasure = false;
      } else if (e.k === 'cfg-corrigee') { units++; if (seenDiag || seenMeasure) methodical++; seenDiag = false; seenMeasure = false; }
    });

    const rPannes = faults.length ? nRep / faults.length : 1;
    const rSvc = services.length ? nSvc / services.length : 1;
    // Méthode : rien de corrigé alors que le sujet contient des pannes → 0 ; sujet sans panne → mesures effectuées
    const rMeth = units ? methodical / units : (!faults.length && J.some(e => MEASURES.has(e.k) || e.k === 'diag') ? 1 : 0);
    const pts = {
      pannes: B.pannes * rPannes,
      services: B.services * rSvc,
      methode: B.methode * rMeth,
      penalite: -B.penalite * inutiles.length
    };
    const max = B.pannes + B.services + B.methode;
    const brut = pts.pannes + pts.services + pts.methode + pts.penalite;
    const note = max > 0 ? round05(Math.max(0, Math.min(20, brut * 20 / max))) : 0;

    const times = J.map(e => Date.parse(e.t)).filter(isFinite);
    const debut = times.length ? Math.min(...times) : null;
    const fin_ = Date.parse(copie.renduLe);
    const dureeMin = debut !== null && isFinite(fin_) ? Math.max(0, Math.round((fin_ - debut) / 60000)) : null;

    return {
      eleve: copie.eleve, renduLe: copie.renduLe, title: copie.exam.title, examId: copie.exam.id,
      sujetDe: copie.exam.eleve || null, sujetConforme: sameStudent(copie.exam.eleve, copie.eleve),
      bareme: B, faults, nRep, services, nSvc, units, methodical, inutiles, recette, otdr,
      mesures: J.filter(e => MEASURES.has(e.k)).length,
      pts, max, note, dureeMin, journal: J
    };
  }

  global.OptiExam = { DEFAULT_BAREME, BAREME_LABELS, encode, decode, listFaults, makeSujet, readFile, makeCopie, grade, makeLot, injectRandomFaults, zipFiles, crc32, sameStudent };
})(typeof window !== 'undefined' ? window : globalThis);
