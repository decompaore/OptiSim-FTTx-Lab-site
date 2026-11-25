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

  /* ---------------- Signature des sujets (HMAC-SHA-256) ----------------
     La version enseignant signe chaque sujet ; à la correction, elle vérifie que le sujet
     joint à la copie (pannes, topologie de référence, barème, élève) n'a pas été modifié.
     Le secret n'existe que dans la version enseignant (bloc retiré du paquet élève). */
  const K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  /** SHA-256 (synchrone, sans dépendance) : octets → octets. */
  function sha256(bytes) {
    const n = bytes.length, len = ((n + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(len); m.set(bytes); m[n] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(len - 8, Math.floor(n / 0x20000000)); dv.setUint32(len - 4, (n << 3) >>> 0);
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Uint32Array(64);
    const rotr = (x, r) => (x >>> r) | (x << (32 - r));
    for (let o = 0; o < len; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
    }
    const out = new Uint8Array(32), ov = new DataView(out.buffer);
    H.forEach((v, i) => ov.setUint32(i * 4, v >>> 0));
    return out;
  }
  /** HMAC-SHA-256 (texte, texte) → hexadécimal. */
  function hmac(key, msg) {
    const te = new TextEncoder();
    let k = te.encode(key); if (k.length > 64) k = sha256(k);
    const kb = new Uint8Array(64); kb.set(k);
    const m = te.encode(msg);
    const inner = new Uint8Array(64 + m.length), outer = new Uint8Array(96);
    for (let i = 0; i < 64; i++) { inner[i] = kb[i] ^ 0x36; outer[i] = kb[i] ^ 0x5c; }
    inner.set(m, 64); outer.set(sha256(inner), 64);
    return Array.from(sha256(outer), x => x.toString(16).padStart(2, '0')).join('');
  }
  /** Forme canonique (clés triées) : la signature ne dépend pas de l'ordre des champs. */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : canon(x))).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    const s = JSON.stringify(v); return s === undefined ? 'null' : s;
  }
  const examSansSig = exam => { const o = Object.assign({}, exam); delete o.sig; return canon(JSON.parse(JSON.stringify(o))); };
  

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

  /** Lit un fichier sujet ou copie ; renvoie null si le fichier n'en est pas un (ou une copie mal formée). */
  function readFile(file) {
    if (!file || file.app !== APP || (file.kind !== 'sujet' && file.kind !== 'copie') || typeof file.data !== 'string') return null;
    const raw = decode(file.data);
    const data = file.kind === 'copie' ? normCopie(raw) : raw;
    if (!data) return null;
    if (file.kind === 'copie') delete data.signature; // jamais celle écrite dans le fichier
    
    return { kind: file.kind, data };
  }

  /* Une copie vient du poste de l'élève : elle peut être modifiée à la main. Avant la correction,
     chaque champ reçoit le type attendu (texte, nombre, tableau) ; une copie sans sujet ni
     topologie exploitable est refusée. Une copie mal formée ne doit pas bloquer toute la classe. */
  const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
  const str = v => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
  const topoOk = t => isObj(t) && Array.isArray(t.devices) && Array.isArray(t.links) &&
    t.devices.every(d => isObj(d) && typeof d.id === 'string' && typeof d.type === 'string' && isObj(d.props)) &&
    t.links.every(l => isObj(l) && typeof l.id === 'string' && isObj(l.a) && isObj(l.b));
  function normCopie(c) {
    if (!isObj(c) || !isObj(c.exam) || !topoOk(c.exam.topo) || !topoOk(c.topo)) return null;
    const ex = c.exam, el = isObj(c.eleve) ? c.eleve : {};
    const bareme = {};
    if (isObj(ex.bareme)) Object.keys(DEFAULT_BAREME).forEach(k => { const v = +ex.bareme[k]; if (isFinite(v) && v >= 0) bareme[k] = v; });
    return Object.assign({}, c, {
      eleve: { nom: str(el.nom).trim(), prenom: str(el.prenom).trim(), classe: str(el.classe).trim() },
      renduLe: str(c.renduLe),
      exam: Object.assign({}, ex, {
        id: str(ex.id), title: str(ex.title), eleve: str(ex.eleve), lot: str(ex.lot), bareme,
        faults: (Array.isArray(ex.faults) ? ex.faults : []).filter(isObj).map(f => Object.assign({}, f, { kind: str(f.kind), id: str(f.id), type: str(f.type), label: str(f.label), where: str(f.where) }))
      }),
      journal: (Array.isArray(c.journal) ? c.journal : []).filter(isObj).map(e => Object.assign({}, e, { t: str(e.t), k: str(e.k), txt: str(e.txt) }))
    });
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
    const tous = eleves.map(x => String(x).trim()).filter(Boolean);
    const noms = tous.filter((x, i, a) => a.indexOf(x) === i);
    const doublons = tous.filter((x, i, a) => a.indexOf(x) !== i);   // signalés à l'enseignant (un seul sujet par nom)
    const files = [], rows = [['Élève', 'Fichier', 'Pannes']], seen = new Set(), usedNames = new Set();
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
      // Noms de fichier uniques : « Ouédraogo » et « OUEDRAOGO » donneraient le même fichier (écrasé dans le dossier)
      const base = `sujet-${slugify(file.title)}-${slugify(nom)}`;
      let name = base + '.json';
      for (let n = 2; usedNames.has(name.toLowerCase()); n++) name = `${base}-${n}.json`;
      usedNames.add(name.toLowerCase());
      files.push({ name, text: JSON.stringify(file) });
      rows.push([nom, name, listFaults(t).map(f => `${f.label} — ${f.where}`).join(' | ')]);
    });
    // Cellule commençant par = + - @ : préfixée d'une apostrophe (pas de formule dans le tableur)
    const cell = v => { const x = String(v); return `"${(/^[=+\-@]/.test(x) ? "'" + x : x).replace(/"/g, '""')}"`; };
    const csv = '\ufeff' + rows.map(r => r.map(cell).join(';')).join('\r\n');
    files.push({ name: 'CORRIGE-ne-pas-distribuer.csv', text: csv });
    return { lot, count: noms.length, doublons, files, zip: zipFiles(files) };
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

  /** Écarts de structure entre la topologie du sujet et celle de la copie (réseau verrouillé pendant l'examen). */
  function structureAnomalies(ref, fin) {
    const out = [];
    const near = (a, b) => (a === undefined && b === undefined) || Math.abs((+a || 0) - (+b || 0)) < 0.5;
    const fd = new Map(fin.devices.map(d => [d.id, d])), fl = new Map(fin.links.map(l => [l.id, l]));
    ref.devices.forEach(r => {
      const d = fd.get(r.id); const nom = (r.props && r.props.name) || r.id;
      if (!d) return out.push(`Équipement « ${nom} » absent de la copie.`);
      if (d.type !== r.type) out.push(`Équipement « ${nom} » : type modifié.`);
      else if (!near(d.x, r.x) || !near(d.y, r.y) || !near(d.w, r.w) || !near(d.h, r.h) || !near(d.floorPx, r.floorPx)) out.push(`Équipement « ${nom} » déplacé ou redimensionné.`);
      if (d.fault && d.fault.type && !(r.fault && r.fault.type === d.fault.type)) out.push(`Équipement « ${nom} » : panne absente du sujet.`);
      if (d.cfgFault && d.cfgFault.type && !(r.cfgFault && r.cfgFault.type === d.cfgFault.type)) out.push(`Équipement « ${nom} » : panne de configuration absente du sujet.`);
    });
    if (fin.devices.length > ref.devices.length) out.push(`${fin.devices.length - ref.devices.length} équipement(s) ajouté(s).`);
    const ends = l => [l.a && l.a.dev, l.a && l.a.port, l.b && l.b.dev, l.b && l.b.port].join('|');
    ref.links.forEach(r => {
      const l = fl.get(r.id);
      if (!l) return out.push(`Câble ${r.id} absent de la copie.`);
      if (l.type !== r.type || ends(l) !== ends(r) || Math.abs((+l.length || 0) - (+r.length || 0)) > 0.01) out.push(`Câble ${r.id} modifié (type, extrémités ou longueur).`);
      if (l.fault && l.fault.type && !(r.fault && r.fault.type === l.fault.type)) out.push(`Câble ${r.id} : panne absente du sujet.`);
    });
    if (fin.links.length > ref.links.length) out.push(`${fin.links.length - ref.links.length} câble(s) ajouté(s).`);
    return out;
  }
  /** Contrôles du journal : ordre, début, remise, temps imparti. */
  function journalAnomalies(J, exam, renduLe) {
    const out = [];
    const ts = J.map(e => Date.parse(e.t));
    if (ts.some(t => !isFinite(t))) out.push('Journal : date illisible.');
    if (!J.length || J[0].k !== 'debut') out.push('Journal : début de l\'examen absent.');
    for (let i = 1; i < ts.length; i++) if (ts[i] + 2000 < ts[i - 1]) { out.push('Journal : actions dans le désordre.'); break; }
    const fin = Date.parse(renduLe);
    if (isFinite(fin) && ts.some(t => t > fin + 5000)) out.push('Journal : actions datées après la remise de la copie.');
    const debut = J.length && J[0].k === 'debut' ? ts[0] : NaN;
    if (exam.duree > 0 && isFinite(debut)) {
      const limite = debut + exam.duree * 60000 + 60000;
      const tard = J.filter((e, i) => e.k !== 'fin' && e.k !== 'rendu' && ts[i] > limite).length;
      if (tard) out.push(`Journal : ${tard} action(s) après la fin du temps imparti.`);
    }
    return out;
  }

  /**
   * Corrige une copie (objet décodé). `bareme` remplace celui du sujet.
   * Renvoie le détail : pannes, services, méthode, interventions inutiles, note /20.
   */
  function grade(copie, bareme) {
    const B = Object.assign({}, DEFAULT_BAREME, copie.exam.bareme || {}, bareme || {});
    const fin = copie.topo;
    const byId = id => fin.devices.find(d => d.id === id) || fin.links.find(l => l.id === id);
    const J = copie.journal || [];
    const anomalies = [];
    if (copie.signature === 'invalide') anomalies.push('Sujet modifié : la signature du sujet ne correspond pas à son contenu.');
    else if (copie.signature === 'absente') anomalies.push('Sujet non signé : créé avec une version antérieure d\'OptiSim, ou fabriqué.');

    // Journal : le résultat de chaque intervention est recalculé à partir des pannes du sujet
    // (le champ « hit » écrit dans la copie n'est pas pris en compte).
    const phys = new Set(copie.exam.faults.filter(f => f.kind !== 'cfg').map(f => f.id));
    const cfg = new Set(copie.exam.faults.filter(f => f.kind === 'cfg').map(f => f.id));
    const doneP = new Set(), doneC = new Set();
    let incoherent = 0, cfgSansPanne = 0;
    const events = J.map(e => {
      if (e.k === 'intervention') {
        const hit = phys.has(e.id) && !doneP.has(e.id);
        if (hit) doneP.add(e.id);
        if (!!e.hit !== hit) incoherent++;
        return Object.assign({}, e, { hit });
      }
      if (e.k === 'cfg-corrigee') {
        const ok = cfg.has(e.id) && !doneC.has(e.id);
        if (ok) doneC.add(e.id); else cfgSansPanne++;
        return Object.assign({}, e, { ok });
      }
      return e;
    });
    if (incoherent) anomalies.push(`Journal : ${incoherent} intervention(s) au résultat incohérent avec le sujet.`);
    if (cfgSansPanne) anomalies.push(`Journal : ${cfgSansPanne} correction(s) de configuration sans panne correspondante.`);

    // Une panne compte comme réparée si l'état final le montre ET si le journal en garde la trace.
    const faults = copie.exam.faults.map(f => {
      const o = byId(f.id);
      const etat = !!o && (f.kind === 'cfg' ? !(o.cfgFault && o.cfgFault.type === f.type) : !(o.fault && o.fault.type));
      const trace = f.kind === 'cfg' ? doneC.has(f.id) : doneP.has(f.id);
      if (etat && !trace) anomalies.push(`Panne « ${f.label} — ${f.where} » réparée sans trace dans le journal : non comptée.`);
      return Object.assign({}, f, { repaired: etat && trace });
    });
    const nRep = faults.filter(f => f.repaired).length;
    structureAnomalies(copie.exam.topo, fin).forEach(a => anomalies.push(a));
    journalAnomalies(J, copie.exam, copie.renduLe).forEach(a => anomalies.push(a));

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
        otdr.push({ nom: str(x.nom), lambda: +x.lambda || 0, aller: !!a, retour: !!b, conforme: bi ? bi.conforme : null, horsSeuil: bi ? bi.rows.filter(r => r.ok === false).length : null });
      });
    }

    // Méthode : chaque correction réussie doit être précédée d'une mesure (pannes physiques)
    // ou d'une consultation du diagnostic (pannes de configuration) depuis l'action précédente.
    let seenMeasure = false, seenDiag = false, units = 0, methodical = 0;
    const inutiles = [];
    events.forEach(e => {
      if (MEASURES.has(e.k)) seenMeasure = true;
      else if (e.k === 'diag' && e.term) seenDiag = true;
      else if (e.k === 'intervention') {
        if (e.hit) { units++; if (seenMeasure) methodical++; } else inutiles.push(e);
        seenMeasure = false;
      } else if (e.k === 'cfg-corrigee' && e.ok) { units++; if (seenDiag || seenMeasure) methodical++; seenDiag = false; seenMeasure = false; }
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
      pts, max, note, dureeMin, journal: events, anomalies, signature: copie.signature || null
    };
  }

  global.OptiExam = { DEFAULT_BAREME, BAREME_LABELS, encode, decode, hmac, listFaults, makeSujet, readFile, normCopie, makeCopie, grade, makeLot, injectRandomFaults, zipFiles, crc32, sameStudent };
})(typeof window !== 'undefined' ? window : globalThis);
