/* =====================================================================
 * OptiSim FTTx Lab — services.js
 * Auteur : Hassami COMPAORE
 * Couche service : provisionnement logique des équipements actifs
 * (routeur de collecte, OLT, switch AON, ONT, Box, terminaux) et
 * diagnostic pas à pas des services Internet, TV et Téléphonie.
 * Aucun accès au DOM : testable sous Node.
 * ===================================================================== */
(function (global) {
  'use strict';
  const P = global.OptiPhysics;
  const { PROFILES, GPON_DOWN, GPON_UP, portsOf, fmt } = P;
  /** Libellé d'un profil, « ? » s'il est inconnu (fichier d'une autre version ou modifié à la main). */
  const profLabel = k => (PROFILES[k] ? PROFILES[k].label : '?');

  /** Service utilisé par chaque type de terminal. */
  const TERMINAL_SERVICE = { pc: 'internet', tv: 'tv', phone: 'voip' };
  const SERVICE_LABEL = { internet: 'Internet', tv: 'TV', voip: 'Téléphonie' };
  const VLAN_KEY = { internet: 'vlanInternet', tv: 'vlanTv', voip: 'vlanVoip' };
  const MODE_LABEL = { dhcp: 'DHCP (IPoE)', pppoe: 'PPPoE' };

  /* ------------------------------------------------------------------ */
  /*  Adresses IPv4                                                       */
  /* ------------------------------------------------------------------ */
  function ipToInt(s) {
    const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(String(s == null ? '' : s));
    if (!m) return null;
    const a = m.slice(1).map(Number);
    if (a.some(x => x > 255)) return null;
    return ((a[0] << 24) >>> 0) + (a[1] << 16) + (a[2] << 8) + a[3];
  }
  function intToIp(n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
  function maskOf(prefix) { return prefix <= 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0; }
  function netOf(ip, prefix) { return (ip & maskOf(prefix)) >>> 0; }
  function broadcastOf(ip, prefix) { return (netOf(ip, prefix) | (~maskOf(prefix) >>> 0)) >>> 0; }
  function parseCidr(s) {
    const m = /^\s*([\d.]+)\s*\/\s*(\d{1,2})\s*$/.exec(String(s || ''));
    if (!m) return null;
    const ip = ipToInt(m[1]), prefix = +m[2];
    if (ip === null || prefix < 8 || prefix > 30) return null;
    return { net: netOf(ip, prefix), prefix };
  }
  function prefixToMask(prefix) { return intToIp(maskOf(prefix)); }
  /** Nombre entier avec espace des milliers (2 488). */
  const nf = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');

  /** Numéro de série normalisé d'une ONT. */
  function snOf(ont) { return (String(ont.props.sn || '').trim() || P.autoSerial(ont.id)).toUpperCase(); }

  /* ------------------------------------------------------------------ */
  /*  Analyse                                                             */
  /* ------------------------------------------------------------------ */
  /**
   * Analyse la couche service d'une topologie.
   * @param {object} topo   topologie (devices, links), parents déjà assignés
   * @param {Engine} engine moteur optique construit sur la même topologie
   */
  function analyze(topo, engine, opts) {
    // masked : une panne de configuration cachée est présente → n'afficher que les symptômes
    const masked = !!(opts && opts.masked);
    const dev = engine.dev;
    const out = {
      active: false,          // au moins un routeur de collecte raccordé
      terminals: new Map(),   // id terminal → résultat de service
      boxes: new Map(),       // id Box → { wan, steps… }
      onts: new Map(),        // id ONT → { sn, head, port, auth, profile }
      heads: new Map()        // id OLT / switch AON → { collecte, onts: [] }
    };

    const ethUp = d => {
      const k = portsOf(d).in.findIndex(p => p.kind === 'eth');
      const link = k >= 0 ? engine.inMap.get(d.id + '#' + k) : null;
      return link ? { link, dev: dev.get(link.a.dev) } : null;
    };
    const collecteOf = head => {
      const k = portsOf(head).in.findIndex(p => p.kind === 'up');
      const link = k >= 0 ? engine.inMap.get(head.id + '#' + k) : null;
      const c = link ? dev.get(link.a.dev) : null;
      return c && c.type === 'collecte' ? c : null;
    };

    out.active = topo.devices.some(d => d.type === 'collecte' && portsOf(d).out.some((p, k) => engine.outMap.has(d.id + '#' + k)));

    /* ---- ONT : tête de réseau, numéro de série, autorisation ---- */
    for (const o of topo.devices.filter(d => d.type === 'ont')) {
      const st = engine.deviceState(o.id);
      const res = st && st.res;
      const head = res && !res.dark && res.src ? dev.get(res.src) : null;
      const info = { sn: snOf(o), st, head, port: res ? res.srcPort : undefined, auth: null, profile: null, up: st.code === 'ok' || st.code === 'weak' };
      if (head && head.type === 'olt') {
        if (head.props.authMode === 'auto') { info.auth = { ok: true, how: 'auto' }; info.profile = head.props.autoProfile; }
        else {
          const e = (head.props.onts || []).find(x => String(x.sn || '').trim().toUpperCase() === info.sn);
          info.auth = e ? { ok: true, how: 'liste' } : { ok: false, how: 'liste' };
          info.profile = e ? e.profile : null;
        }
      } else if (head && head.type === 'switch_aon') {
        const cfg = (head.props.ports || [])[info.port] || {};
        info.auth = { ok: !!cfg.enabled, how: 'port' };
        info.profile = cfg.enabled ? (cfg.profile || 'internet-1g') : null;
      }
      out.onts.set(o.id, info);
      if (head && (head.type === 'olt' || head.type === 'switch_aon')) {
        if (!out.heads.has(head.id)) out.heads.set(head.id, { head, collecte: collecteOf(head), onts: [] });
        out.heads.get(head.id).onts.push(Object.assign({ id: o.id, name: o.props.name }, info));
      }
    }
    // Têtes de réseau sans ONT : connaître tout de même leur collecte
    for (const h of topo.devices.filter(d => d.type === 'olt' || d.type === 'switch_aon')) {
      if (!out.heads.has(h.id)) out.heads.set(h.id, { head: h, collecte: collecteOf(h), onts: [] });
    }

    /* ---- Allocation d'adresses WAN (pool de la collecte) ---- */
    const wanAlloc = new Map();   // collecte id → { next, used }
    const allocWan = (col, key) => {
      const pool = parseCidr(col.props.pool);
      if (!pool) return { error: `Pool d'adresses « ${col.props.pool} » invalide (format attendu : 100.64.0.0/24)` };
      if (!wanAlloc.has(col.id)) wanAlloc.set(col.id, { next: 10, byKey: new Map() });
      const a = wanAlloc.get(col.id);
      if (a.byKey.has(key)) return { ip: a.byKey.get(key) };
      const size = Math.pow(2, 32 - pool.prefix);
      if (a.next >= size - 1) return { error: 'Pool d\'adresses WAN épuisé' };
      const ip = intToIp(pool.net + a.next++);
      a.byKey.set(key, ip);
      return { ip, prefix: pool.prefix };
    };

    /* ---- Session WAN de chaque Box ---- */
    const boxWan = box => {
      if (out.boxes.has(box.id)) return out.boxes.get(box.id);
      const r = { ok: false, reason: '', ip: null };
      out.boxes.set(box.id, r);
      return r;
    };

    /* ---- Adressage LAN des Box : statiques d'abord, puis baux DHCP ---- */
    const lanPlan = new Map();    // box id → Map(terminal id → { ok, ip, reason })
    const planLan = box => {
      if (lanPlan.has(box.id)) return lanPlan.get(box.id);
      const plan = new Map();
      lanPlan.set(box.id, plan);
      const boxIp = ipToInt(box.props.lanIp), pre = +box.props.lanPrefix || 24;
      const kids = [];
      portsOf(box).out.forEach((p, k) => {
        const l = engine.outMap.get(box.id + '#' + k);
        const t = l ? dev.get(l.b.dev) : null;
        if (t && TERMINAL_SERVICE[t.type]) kids.push({ t, link: l });
      });
      if (boxIp === null) { kids.forEach(({ t }) => plan.set(t.id, { ok: false, reason: `Adresse LAN de la Box « ${box.props.lanIp} » invalide` })); return plan; }
      const used = new Map([[boxIp, box.props.name]]);
      // 1) terminaux en adressage statique
      for (const { t } of kids.filter(k => k.t.props.ipMode === 'static')) {
        const ip = ipToInt(t.props.ip), gw = ipToInt(t.props.gateway), tp = +t.props.prefix || 24;
        let reason = '';
        if (ip === null) reason = `Adresse IP « ${t.props.ip || '(vide)'} » invalide`;
        else if (netOf(ip, pre) !== netOf(boxIp, pre)) reason = `L'adresse ${intToIp(ip)} n'est pas dans le réseau de la Box (${intToIp(netOf(boxIp, pre))}/${pre})`;
        else if (ip === netOf(boxIp, pre) || ip === broadcastOf(boxIp, pre)) reason = `${intToIp(ip)} est l'adresse du réseau ou de diffusion : elle ne peut pas être attribuée à un appareil`;
        else if (used.has(ip)) reason = `Conflit d'adresse : ${intToIp(ip)} est déjà utilisée par « ${used.get(ip)} »`;
        else if (tp !== pre) reason = `Masque /${tp} différent de celui de la Box (/${pre})`;
        else if (gw === null) reason = `Passerelle « ${t.props.gateway || '(vide)'} » invalide : indiquez l'adresse de la Box (${intToIp(boxIp)})`;
        else if (gw !== boxIp) reason = `Passerelle ${intToIp(gw)} incorrecte : ce doit être l'adresse de la Box (${intToIp(boxIp)})`;
        if (!reason) used.set(ip, t.props.name);
        plan.set(t.id, reason ? { ok: false, reason } : { ok: true, ip: intToIp(ip), prefix: pre, gw: intToIp(boxIp), how: 'statique' });
      }
      // 2) terminaux en DHCP
      const dhcpKids = kids.filter(k => k.t.props.ipMode !== 'static');
      if (dhcpKids.length) {
        if (!box.props.dhcp) {
          dhcpKids.forEach(({ t }) => plan.set(t.id, { ok: false, reason: 'Serveur DHCP de la Box désactivé : l\'appareil se donne une adresse 169.254.x.x (APIPA) et ne peut pas communiquer' }));
        } else {
          const a = ipToInt(box.props.dhcpStart), b = ipToInt(box.props.dhcpEnd);
          let err = '';
          if (a === null || b === null || b < a) err = 'Plage DHCP de la Box invalide (début / fin)';
          else if (netOf(a, pre) !== netOf(boxIp, pre) || netOf(b, pre) !== netOf(boxIp, pre)) err = `Plage DHCP hors du réseau de la Box (${intToIp(netOf(boxIp, pre))}/${pre})`;
          let next = a;
          for (const { t } of dhcpKids) {
            if (err) { plan.set(t.id, { ok: false, reason: err }); continue; }
            while (next <= b && (used.has(next) || next === broadcastOf(boxIp, pre) || next === netOf(boxIp, pre))) next++;
            if (next > b) { plan.set(t.id, { ok: false, reason: 'Plage DHCP épuisée : plus d\'adresse disponible' }); continue; }
            used.set(next, t.props.name);
            plan.set(t.id, { ok: true, ip: intToIp(next), prefix: pre, gw: intToIp(boxIp), how: 'DHCP' });
            next++;
          }
        }
      }
      return plan;
    };

    /* ---- Nombre d'ONT actives par port PON (partage GPON) ---- */
    const ponCount = (headId, port) => {
      let n = 0;
      for (const info of out.onts.values()) if (info.up && info.head && info.head.id === headId && info.port === port) n++;
      return Math.max(1, n);
    };

    /* ---- Diagnostic de chaque terminal ---- */
    for (const t of topo.devices.filter(d => TERMINAL_SERVICE[d.type])) {
      const service = TERMINAL_SERVICE[t.type];
      const r = { service, label: SERVICE_LABEL[service], evaluated: false, ok: false, steps: [], reason: '', ip: null, debit: null };
      out.terminals.set(t.id, r);
      if (!out.active) { r.reason = 'Couche service non évaluée : aucun routeur de collecte raccordé.'; continue; }
      const steps = r.steps;
      const step = (label, ok, detail, sym) => { steps.push({ label, ok, detail: !ok && masked && sym ? sym : detail }); return ok; };
      const fail = reason => { r.reason = reason; return r; };

      const up1 = ethUp(t);
      if (!up1) { fail('Terminal non raccordé (câble Ethernet manquant)'); continue; }
      let box = null, ont = null;
      if (up1.dev.type === 'router') {
        box = up1.dev;
        const up2 = ethUp(box);
        if (!up2) { r.evaluated = true; step('Raccordement de la Box', false, 'Le port WAN de la Box n\'est relié à rien : reliez-le à un port LAN de l\'ONT.'); fail(steps[0].detail); continue; }
        if (up2.dev.type !== 'ont') { fail('Chemin non géré par la couche service (la Box doit être reliée à une ONT).'); continue; }
        ont = up2.dev;
      } else if (up1.dev.type === 'ont') ont = up1.dev;
      else { fail('Chemin non géré par la couche service (switch SFP / réseau local).'); continue; }
      r.evaluated = true;

      // Câbles Ethernet (100 m)
      const tooLong = [up1.link, box ? ethUp(box).link : null].find(l => l && (+l.length || 0) > P.ETH_MAX);
      if (tooLong) { step('Câblage Ethernet', false, `Câble Cat6 de ${tooLong.length} m : au-delà de ${P.ETH_MAX} m, le lien Ethernet ne monte pas.`); fail(steps[0].detail); continue; }

      // 1. Couche physique
      const oi = out.onts.get(ont.id);
      const st = oi.st;
      const physOk = oi.up;
      if (!step('Liaison optique de l\'ONT', physOk, physOk ? `${ont.props.name} : ${fmt(st.power)} dBm (${st.label})` : `${ont.props.name} : ${st.label}${st.power !== undefined && st.power !== null ? ` (${fmt(st.power)} dBm)` : ''}`)) { fail(steps[steps.length - 1].detail); continue; }
      const head = oi.head;
      if (!head || (head.type !== 'olt' && head.type !== 'switch_aon')) {
        step('Équipement de tête', false, 'L\'ONT n\'est pas alimentée par un OLT ou un switch AON.'); fail(steps[steps.length - 1].detail); continue;
      }
      const isAon = head.type === 'switch_aon';

      // 2. Authentification → profil
      if (isAon) {
        const n = oi.port + 1;
        if (!step('Port du switch AON', oi.auth.ok, oi.auth.ok ? `Port SFP ${n} de ${head.props.name} activé — profil « ${profLabel(oi.profile)} »` : `Port SFP ${n} de ${head.props.name} désactivé : activez-le dans la configuration du switch.`, `Aucun trafic sur le port SFP ${n} de ${head.props.name}.`)) { fail(steps[steps.length - 1].detail); continue; }
      } else {
        const okA = oi.auth.ok;
        const detail = okA
          ? (oi.auth.how === 'auto' ? `Autorisation automatique sur ${head.props.name} — profil « ${profLabel(oi.profile)} »` : `SN ${oi.sn} déclaré sur ${head.props.name} — profil « ${profLabel(oi.profile)} »`)
          : `ONT non autorisée : le numéro de série ${oi.sn} n'est pas déclaré sur ${head.props.name}.`;
        if (!step('Autorisation de l\'ONT sur l\'OLT', okA, detail, `ONT ${oi.sn} détectée sur le port PON ${oi.port + 1} mais refusée par ${head.props.name}.`)) { fail(steps[steps.length - 1].detail); continue; }
      }
      const prof = PROFILES[oi.profile];
      if (!prof) { step('Profil de service', false, 'Profil de service inconnu.'); fail(steps[steps.length - 1].detail); continue; }

      // 3. Service présent dans le profil
      if (!step(`Service ${SERVICE_LABEL[service]} dans le profil`, !!prof[service], prof[service] ? `Inclus dans « ${prof.label} »` : `Le profil « ${prof.label} » ne comprend pas le service ${SERVICE_LABEL[service]}.`, `Le service ${SERVICE_LABEL[service]} n'est pas fourni à cet abonné.`)) { fail(steps[steps.length - 1].detail); continue; }

      // 4. Routeur de collecte
      const col = out.heads.get(head.id).collecte;
      if (!col) { step('Routeur de collecte', false, `${head.props.name} n'est relié à aucun routeur de collecte (câble « Lien de collecte 10 GbE »).`); fail(steps[steps.length - 1].detail); continue; }
      let colReason = '';
      if (!col.props.core) colReason = `${col.props.name} n'est pas raccordé au cœur de réseau : aucun service ne sort vers Internet.`;
      else if (service === 'tv' && !col.props.tv) colReason = `Service TV désactivé sur ${col.props.name}.`;
      else if (service === 'voip' && !col.props.voip) colReason = `Service Téléphonie désactivé sur ${col.props.name}.`;
      if (!step('Routeur de collecte', !colReason, colReason || `${col.props.name} : service ${SERVICE_LABEL[service]} actif`, `Aucune réponse du réseau opérateur pour le service ${SERVICE_LABEL[service]}.`)) { fail(steps[steps.length - 1].detail); continue; }

      // 5. VLAN de bout en bout
      const vk = VLAN_KEY[service];
      const vH = +head.props[vk], vC = +col.props[vk], vB = box ? +box.props[vk] : null;
      const vOk = vH === vC && (vB === null || vB === vH);
      const hn = isAon ? 'Switch' : 'OLT';
      const vDetail = `${hn} ${vH} · collecte ${vC}${vB !== null ? ` · Box ${vB}` : ''}`;
      if (!step(`VLAN ${SERVICE_LABEL[service]}`, vOk, vOk ? `VLAN ${vH} identique de bout en bout (${vDetail})` : `VLAN différents : ${vDetail}. Le trafic est rejeté.`, `Le trafic ${SERVICE_LABEL[service]} n'aboutit pas : aucune réponse du réseau opérateur.`)) { fail(steps[steps.length - 1].detail); continue; }

      // 6. Session WAN
      const mode = col.props.accessMode;
      if (box) {
        const w = boxWan(box);
        let reason = '';
        if (box.props.wanMode !== mode) reason = `La Box est en ${MODE_LABEL[box.props.wanMode]} mais le routeur de collecte attend du ${MODE_LABEL[mode]}.`;
        else if (mode === 'pppoe') {
          const login = String(box.props.pppLogin || '').trim();
          const acc = (col.props.accounts || []).find(a => String(a.login || '').trim() === login);
          if (!login) reason = 'Identifiant PPPoE vide : saisissez celui fourni par l\'opérateur.';
          else if (!acc) reason = `Identifiant PPPoE « ${login} » inconnu du routeur de collecte.`;
          else if (String(acc.password || '') !== String(box.props.pppPassword || '')) reason = 'Mot de passe PPPoE incorrect : échec de l\'authentification.';
        }
        let ip = null;
        if (!reason) { const a = allocWan(col, box.id); if (a.error) reason = a.error; else ip = a.ip; }
        const wSym = box.props.wanMode === 'pppoe' ? 'Session PPPoE refusée par le réseau opérateur : le voyant Internet de la Box reste éteint.' : 'Aucune adresse WAN reçue : pas de réponse DHCP du réseau opérateur.';
        w.ok = !reason; w.reason = reason && masked ? wSym : reason; w.ip = ip; w.mode = mode;
        if (!step('Session WAN de la Box', !reason, reason || `Adresse WAN ${ip} obtenue en ${MODE_LABEL[mode]}`, wSym)) { fail(steps[steps.length - 1].detail); continue; }
      } else {
        let reason = '';
        if (mode === 'pppoe') reason = 'Sans Box, l\'appareil ne peut pas ouvrir de session PPPoE : ajoutez une Box entre l\'ONT et l\'appareil.';
        else if (t.props.ipMode === 'static') reason = 'Sans Box, l\'appareil doit être en adressage automatique (DHCP de l\'opérateur).';
        let ip = null;
        if (!reason) { const a = allocWan(col, t.id); if (a.error) reason = a.error; else ip = a.ip; }
        if (!step('Adresse fournie par l\'opérateur', !reason, reason || `Adresse ${ip} attribuée directement par ${col.props.name} (DHCP, sans Box)`)) { fail(reason); continue; }
        r.ip = ip;
      }

      // 7. Adressage LAN
      if (box) {
        const lan = planLan(box).get(t.id) || { ok: false, reason: 'Appareil non relié à un port LAN de la Box' };
        const lSym = t.props.ipMode === 'static' ? 'L\'appareil n\'arrive pas à joindre sa passerelle : Internet est inaccessible.' : !box.props.dhcp ? 'L\'appareil s\'est attribué une adresse 169.254.x.x (APIPA) : il ne communique pas.' : 'L\'appareil ne reçoit pas d\'adresse de la Box.';
        if (!step('Adresse IP de l\'appareil (LAN)', lan.ok, lan.ok ? `${lan.ip}/${lan.prefix} · passerelle ${lan.gw} (${lan.how})` : lan.reason, lSym)) { fail(steps[steps.length - 1].detail); continue; }
        r.ip = lan.ip;
      }

      // Service opérationnel : débit
      r.ok = true;
      if (isAon) {
        const sp = +head.props.portSpeed || 1000;
        r.debit = { down: Math.min(prof.down, sp), up: Math.min(prof.up, sp), note: `profil ${nf(prof.down)} Mbit/s · port ${nf(sp)} Mbit/s dédié (point à point)` };
      } else {
        const n = ponCount(head.id, oi.port);
        const sd = Math.floor(GPON_DOWN / n), su = Math.floor(GPON_UP / n);
        const share = n === 1 ? `GPON ${nf(GPON_DOWN)} Mbit/s, seule ONT active sur le port PON ${oi.port + 1}` : `GPON ${nf(GPON_DOWN)} Mbit/s partagé entre ${n} ONT actives (${nf(sd)} Mbit/s chacune)`;
        r.debit = { down: Math.min(prof.down, sd), up: Math.min(prof.up, su), note: `profil ${nf(prof.down)} Mbit/s · ${share}` };
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  Pannes de configuration (mode Simulation de pannes)                 */
  /* ------------------------------------------------------------------ */
  // Une panne de configuration modifie réellement des valeurs de `props`.
  // Elle est mémorisée dans `d.cfgFault = { type, hidden, restore, meta }` :
  // `restore` contient les valeurs d'origine (réparation), `meta` ce qu'il
  // faut pour savoir si l'élève l'a corrigée lui-même.
  const cp = v => JSON.parse(JSON.stringify(v));
  const up = s => String(s || '').trim().toUpperCase();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

  /** ONT raccordées (analyse) à une tête de réseau. */
  const headOnts = (ctx, head) => { const h = ctx.analysis && ctx.analysis.heads.get(head.id); return h ? h.onts : []; };
  /** Services utilisés par des terminaux de la topologie. */
  const usedServices = ctx => {
    const set = new Set(ctx.topo.devices.filter(d => TERMINAL_SERVICE[d.type]).map(d => TERMINAL_SERVICE[d.type]));
    return set.size ? [...set] : ['internet'];
  };
  /** Entrée de la liste blanche correspondant à une ONT raccordée (sinon la première). */
  function oltEntry(d, ctx) {
    const list = d.props.onts || [];
    if (d.props.authMode === 'auto' || !list.length) return -1;
    const sns = new Set(headOnts(ctx, d).map(o => o.sn));
    const i = list.findIndex(e => sns.has(up(e.sn)));
    return i >= 0 ? i : 0;
  }
  const declaredOn = (olt, sn) => (olt.props.onts || []).some(e => up(e.sn) === up(sn));
  const accountOk = (topo, login, password) => topo.devices.some(c => c.type === 'collecte' && (c.props.accounts || []).some(a => String(a.login || '').trim() === String(login || '').trim() && String(a.password || '') === String(password || '')));
  /** Change un caractère d'un numéro de série (faute de frappe réaliste). */
  function typo(sn, rnd) {
    const look = { '0': 'O', 'O': '0', '1': 'I', 'I': '1', '8': 'B', 'B': '8', '5': 'S', 'S': '5', '2': 'Z', 'Z': '2' };
    const s = up(sn).split('');
    const idx = s.map((c, i) => (look[c] && i >= 4 ? i : -1)).filter(i => i >= 0);
    const i = idx.length ? pick(idx, rnd) : s.length - 1;
    s[i] = look[s[i]] || (s[i] === 'A' ? 'B' : 'A');
    return s.join('');
  }
  const vlanFault = types => ({
    label: 'VLAN de service modifié', short: 'VLAN', types,
    can: () => true,
    make: (d, ctx, rnd) => {
      const k = VLAN_KEY[pick(usedServices(ctx), rnd)];
      return { patch: { [k]: (+d.props[k] || 100) + 10 } };
    }
  });

  const CFG_FAULTS = {
    ontRemoved: {
      label: 'ONT retirée de la liste d\'autorisation', short: 'ONT non déclarée', types: ['olt'],
      can: (d, ctx) => oltEntry(d, ctx) >= 0,
      make: (d, ctx) => {
        const i = oltEntry(d, ctx), e = d.props.onts[i];
        return { patch: { onts: d.props.onts.filter((x, j) => j !== i) }, meta: { sn: up(e.sn) } };
      },
      fixed: (d, f) => declaredOn(d, f.meta.sn)
    },
    snTypo: {
      label: 'Numéro de série mal saisi sur l\'OLT', short: 'Erreur de SN', types: ['olt'],
      can: (d, ctx) => oltEntry(d, ctx) >= 0,
      make: (d, ctx, rnd) => {
        const i = oltEntry(d, ctx), e = d.props.onts[i];
        const onts = cp(d.props.onts); onts[i].sn = typo(e.sn, rnd);
        return { patch: { onts }, meta: { sn: up(e.sn) } };
      },
      fixed: (d, f) => declaredOn(d, f.meta.sn)
    },
    profileDown: {
      label: 'Profil de l\'abonné réduit (Internet seul)', short: 'Profil', types: ['olt', 'switch_aon'],
      can: (d, ctx) => {
        if (d.type === 'olt') { const i = oltEntry(d, ctx); return i >= 0 && d.props.onts[i].profile !== 'internet-300'; }
        return (d.props.ports || []).some(p => p && p.enabled && p.profile !== 'internet-300');
      },
      make: (d, ctx) => {
        if (d.type === 'olt') {
          const i = oltEntry(d, ctx), onts = cp(d.props.onts);
          const meta = { sn: up(onts[i].sn), profile: onts[i].profile };
          onts[i].profile = 'internet-300';
          return { patch: { onts }, meta };
        }
        const ports = cp(d.props.ports), used = headOnts(ctx, d).map(o => o.port);
        let i = ports.findIndex((p, k) => p && p.enabled && p.profile !== 'internet-300' && used.includes(k));
        if (i < 0) i = ports.findIndex(p => p && p.enabled && p.profile !== 'internet-300');
        const meta = { port: i, profile: ports[i].profile };
        ports[i].profile = 'internet-300';
        return { patch: { ports }, meta };
      },
      fixed: (d, f) => {
        const cur = d.type === 'olt' ? ((d.props.onts || []).find(e => up(e.sn) === f.meta.sn) || {}).profile : ((d.props.ports || [])[f.meta.port] || {}).profile;
        const a = PROFILES[cur], b = PROFILES[f.meta.profile];
        return !!(a && b) && ['internet', 'tv', 'voip'].every(s => !b[s] || a[s]);
      }
    },
    portOff: {
      label: 'Port SFP de l\'abonné désactivé', short: 'Port désactivé', types: ['switch_aon'],
      can: d => (d.props.ports || []).some(p => p && p.enabled),
      make: (d, ctx) => {
        const ports = cp(d.props.ports), used = headOnts(ctx, d).map(o => o.port);
        let i = ports.findIndex((p, k) => p && p.enabled && used.includes(k));
        if (i < 0) i = ports.findIndex(p => p && p.enabled);
        ports[i].enabled = false;
        return { patch: { ports }, meta: { port: i } };
      },
      fixed: (d, f) => !!((d.props.ports || [])[f.meta.port] || {}).enabled
    },
    oltVlan: vlanFault(['olt', 'switch_aon', 'collecte', 'router']),
    coreDown: {
      label: 'Raccordement au cœur de réseau désactivé', short: 'Cœur de réseau', types: ['collecte'],
      can: d => !!d.props.core,
      make: () => ({ patch: { core: false } })
    },
    serviceOff: {
      label: 'Service TV ou Téléphonie désactivé', short: 'Service désactivé', types: ['collecte'],
      can: (d, ctx) => usedServices(ctx).some(s => s !== 'internet' && d.props[s]),
      make: (d, ctx, rnd) => ({ patch: { [pick(usedServices(ctx).filter(s => s !== 'internet' && d.props[s]), rnd)]: false } })
    },
    accessMode: {
      label: 'Mode d\'accès inversé (DHCP ↔ PPPoE)', short: 'Mode d\'accès', types: ['collecte', 'router'],
      can: () => true,
      make: d => { const k = d.type === 'router' ? 'wanMode' : 'accessMode'; return { patch: { [k]: d.props[k] === 'pppoe' ? 'dhcp' : 'pppoe' } }; }
    },
    pppPassword: {
      label: 'Mot de passe PPPoE modifié', short: 'Mot de passe PPPoE', types: ['collecte', 'router'],
      can: d => d.type === 'router' ? d.props.wanMode === 'pppoe' && !!d.props.pppPassword : d.props.accessMode === 'pppoe' && (d.props.accounts || []).length > 0,
      make: (d, ctx) => {
        if (d.type === 'router') return { patch: { pppPassword: String(d.props.pppPassword).toLowerCase() === String(d.props.pppPassword) ? d.props.pppPassword + '1' : String(d.props.pppPassword).toLowerCase() } };
        const logins = ctx.topo.devices.filter(b => b.type === 'router').map(b => String(b.props.pppLogin || '').trim());
        const accounts = cp(d.props.accounts);
        let i = accounts.findIndex(a => logins.includes(String(a.login || '').trim()));
        if (i < 0) i = 0;
        accounts[i].password = String(accounts[i].password || '') + '!';
        return { patch: { accounts }, meta: { login: accounts[i].login } };
      },
      fixed: (d, f, ctx) => d.type === 'router'
        ? accountOk(ctx.topo, d.props.pppLogin, d.props.pppPassword)
        : ctx.topo.devices.some(b => b.type === 'router' && String(b.props.pppLogin || '').trim() === String(f.meta.login || '').trim() && accountOk(ctx.topo, b.props.pppLogin, b.props.pppPassword))
    },
    pppLogin: {
      label: 'Identifiant PPPoE mal saisi', short: 'Identifiant PPPoE', types: ['router'],
      can: d => d.props.wanMode === 'pppoe' && !!String(d.props.pppLogin || '').trim(),
      make: d => ({ patch: { pppLogin: String(d.props.pppLogin).replace('@', '@@') === String(d.props.pppLogin) ? d.props.pppLogin + 'x' : String(d.props.pppLogin).replace('@', '.') } }),
      fixed: (d, f, ctx) => accountOk(ctx.topo, d.props.pppLogin, d.props.pppPassword)
    },
    dhcpOff: {
      label: 'Serveur DHCP de la Box désactivé', short: 'DHCP désactivé', types: ['router'],
      can: (d, ctx) => !!d.props.dhcp && ctx.topo.devices.some(t => TERMINAL_SERVICE[t.type] && t.props.ipMode !== 'static'),
      make: () => ({ patch: { dhcp: false } })
    },
    dhcpRange: {
      label: 'Plage DHCP hors du réseau de la Box', short: 'Plage DHCP', types: ['router'],
      can: (d, ctx) => !!d.props.dhcp && ipToInt(d.props.dhcpStart) !== null && ipToInt(d.props.dhcpEnd) !== null && ctx.topo.devices.some(t => TERMINAL_SERVICE[t.type] && t.props.ipMode !== 'static'),
      make: d => {
        const shift = s => { const a = String(s).trim().split('.'); a[2] = String((+a[2] + 1) % 256); return a.join('.'); };
        return { patch: { dhcpStart: shift(d.props.dhcpStart), dhcpEnd: shift(d.props.dhcpEnd) } };
      },
      fixed: d => {
        const box = ipToInt(d.props.lanIp), pre = +d.props.lanPrefix || 24, a = ipToInt(d.props.dhcpStart), b = ipToInt(d.props.dhcpEnd);
        return !d.props.dhcp || (box !== null && a !== null && b !== null && a <= b && netOf(a, pre) === netOf(box, pre) && netOf(b, pre) === netOf(box, pre));
      }
    },
    ontReplaced: {
      label: 'ONT remplacée (nouveau numéro de série)', short: 'ONT remplacée', types: ['ont'],
      can: (d, ctx) => { const o = ctx.analysis && ctx.analysis.onts.get(d.id); return !!(o && o.head && o.head.type === 'olt' && o.head.props.authMode !== 'auto'); },
      make: (d, ctx, rnd) => {
        const o = ctx.analysis.onts.get(d.id);
        let sn = '';
        do sn = 'ALCL' + Math.floor(rnd() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0'); while (declaredOn(o.head, sn));
        return { patch: { sn }, meta: { head: o.head.id } };
      },
      fixed: (d, f, ctx) => { const h = ctx.topo.devices.find(x => x.id === f.meta.head); return !!h && (h.props.authMode === 'auto' || declaredOn(h, snOf(d))); }
    },
    ipOutside: {
      label: 'Adresse IP fixe hors du réseau de la Box', short: 'IP hors réseau', types: ['pc', 'tv', 'phone'],
      can: d => d.props.ipMode !== 'static',
      make: d => ({ patch: { ipMode: 'static', ip: '192.168.0.50', prefix: 24, gateway: '192.168.0.1' } }),
      fixed: (d, f, ctx) => d.props.ipMode !== 'static' || !!(ctx.analysis && (ctx.analysis.terminals.get(d.id) || {}).ok)
    },
    gateway: {
      label: 'Passerelle incorrecte', short: 'Passerelle', types: ['pc', 'tv', 'phone'],
      can: d => d.props.ipMode === 'static' && ipToInt(d.props.gateway) !== null,
      make: d => { const g = ipToInt(d.props.gateway); return { patch: { gateway: intToIp((g & 255) === 254 ? g - 1 : (g & ~255) + 254) } }; },
      fixed: (d, f, ctx) => !!(ctx.analysis && (ctx.analysis.terminals.get(d.id) || {}).ok)
    }
  };

  /** Pannes de configuration applicables à un équipement. ctx = { topo, analysis } */
  function cfgFaultOptions(d, ctx) {
    return Object.entries(CFG_FAULTS).filter(([, f]) => f.types.includes(d.type) && f.can(d, ctx)).map(([k, f]) => ({ key: k, label: f.label, short: f.short }));
  }

  /** Applique une panne de configuration (modifie d.props). */
  function applyCfgFault(d, type, hidden, ctx, rnd) {
    const f = CFG_FAULTS[type];
    if (!f || !f.types.includes(d.type) || !f.can(d, ctx)) return false;
    if (d.cfgFault) repairCfgFault(d);
    const r = f.make(d, ctx, rnd || Math.random);
    const restore = {};
    for (const k of Object.keys(r.patch)) restore[k] = d.props[k] === undefined ? null : cp(d.props[k]);
    Object.assign(d.props, cp(r.patch));
    d.cfgFault = { type, hidden: !!hidden, restore, meta: r.meta || {} };
    return true;
  }

  /** Remet les valeurs d'origine. */
  function repairCfgFault(d) {
    if (!d.cfgFault) return;
    for (const [k, v] of Object.entries(d.cfgFault.restore || {})) { if (v === null) delete d.props[k]; else d.props[k] = cp(v); }
    delete d.cfgFault;
  }

  /** La panne a-t-elle été corrigée (valeurs d'origine ou correction équivalente) ? */
  function cfgFaultFixed(d, ctx) {
    const f = d.cfgFault, def = f && CFG_FAULTS[f.type];
    if (!def) return true;
    if (Object.entries(f.restore || {}).every(([k, v]) => same(d.props[k] === undefined ? null : d.props[k], v))) return true;
    return def.fixed ? !!def.fixed(d, f, ctx) : false;
  }

  /**
   * Injecte une panne de configuration cachée qui met réellement un service en défaut.
   * @returns l'équipement modifié, ou null si aucun service ne fonctionne.
   */
  function randomCfgFault(topo, engine, rnd) {
    rnd = rnd || Math.random;
    const base = analyze(topo, engine);
    const okBefore = [...base.terminals.entries()].filter(([, r]) => r.ok).map(([id]) => id);
    if (!okBefore.length) return null;
    const ctx = { topo, analysis: base };
    const cands = [];
    for (const d of topo.devices) if (!d.cfgFault) for (const o of cfgFaultOptions(d, ctx)) cands.push({ d, type: o.key });
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    for (const c of cands) {
      const saved = cp(c.d.props);
      if (!applyCfgFault(c.d, c.type, true, ctx, rnd)) continue;
      const after = analyze(topo, engine);
      if (okBefore.some(id => !after.terminals.get(id).ok)) return c.d;
      c.d.props = saved; delete c.d.cfgFault;
    }
    return null;
  }

  global.OptiServices = {
    analyze, TERMINAL_SERVICE, SERVICE_LABEL, MODE_LABEL, nf,
    CFG_FAULTS, cfgFaultOptions, applyCfgFault, repairCfgFault, cfgFaultFixed, randomCfgFault,
    ipToInt, intToIp, parseCidr, prefixToMask, snOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
