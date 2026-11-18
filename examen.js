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
    if (topo.recette) t.recette = Object.assign(clone(topo.recette), { mesures: {} }); // fiche de recette vierge
    t.devices.concat(t.links).forEach(o => { if (o.fault && o.fault.type) o.fault.hidden = true; if (o.cfgFault) o.cfgFault.hidden = true; });
    const exam = {
      id: newId(),
      title: String(meta.title || 'Examen de dépannage').trim() || 'Examen de dépannage',
      consignes: String(meta.consignes || ''),
      duree: Math.max(0, Math.round(+meta.duree || 0)),
      bareme: Object.assign({}, DEFAULT_BAREME, meta.bareme || {}),
      signaler: !!meta.signaler,
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
      bareme: B, faults, nRep, services, nSvc, units, methodical, inutiles, recette,
      mesures: J.filter(e => MEASURES.has(e.k)).length,
      pts, max, note, dureeMin, journal: J
    };
  }

  global.OptiExam = { DEFAULT_BAREME, BAREME_LABELS, encode, decode, listFaults, makeSujet, readFile, makeCopie, grade };
})(typeof window !== 'undefined' ? window : globalThis);
