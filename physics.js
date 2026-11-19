/* =====================================================================
 * OptiSim FTTx Lab — physics.js
 * Auteur : Hassami COMPAORE
 * Catalogue des équipements, supports de transmission et moteur de calcul
 * (bilan de liaison optique, statut des ports, OTDR simplifié, VFL).
 * Script autonome (pas de module ES) pour fonctionner en file:// hors-ligne.
 * ===================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Constantes physiques                                                */
  /* ------------------------------------------------------------------ */

  /** Atténuation linéique (dB/km) par famille de fibre et longueur d'onde. */
  const ATTENUATION = {
    smf:  { 850: 2.0, 1310: 0.35, 1490: 0.25, 1550: 0.22 }, // G.652D / G.657A2
    om3:  { 850: 3.0, 1310: 1.0,  1490: 1.0,  1550: 1.0 },
    om4:  { 850: 2.5, 1310: 0.8,  1490: 0.8,  1550: 0.8 }
  };

  /** Pertes d'insertion typiques des coupleurs (splitters PLC). */
  const SPLITTER_LOSS = { '1:2': 3.5, '1:4': 7.2, '1:8': 10.5, '1:16': 13.8, '1:32': 17.2, '1:64': 21.0 };

  /** Modes de raccordement d'une extrémité de câble. */
  const JOINTS = {
    none:       { label: 'Aucun (compté dans l\'équipement)', short: '—',          loss: 0,    reflective: false },
    fusion:     { label: 'Épissure par fusion (0,05 dB)',     short: 'Ép. fusion',  loss: 0.05, reflective: false },
    mechanical: { label: 'Épissure mécanique (0,2 dB)',       short: 'Ép. méca.',   loss: 0.2,  reflective: true  },
    connector:  { label: 'Connecteur (0,5 dB)',               short: 'Connecteur',  loss: 0.5,  reflective: true  }
  };

  /** Pannes injectables. */
  const FAULTS = {
    cut:       { label: 'Fibre coupée',                         short: 'Coupure',         link: true,  device: false, positional: true  },
    bend:      { label: 'Écrasement / courbure excessive (+5 dB)', short: 'Courbure',     link: true,  device: false, positional: true  },
    badSplice: { label: 'Mauvaise épissure (+1,5 dB)',          short: 'Mauvaise épissure', link: true, device: true, positional: true },
    dirty:     { label: 'Connecteur sale / brassage défectueux (+3 dB)', short: 'Connecteur sale', link: true, device: true, positional: false },
    swap:      { label: 'Inversion de fibre (mauvaise fibre)',  short: 'Inversion',       link: true,  device: true,  positional: false }
  };

  /** Perte d'une courbure selon λ (les grandes longueurs d'onde y sont plus sensibles). */
  function bendLoss(lambda) {
    if (lambda >= 1490) return 5;
    if (lambda >= 1300) return 2.5;
    return 1.5;
  }

  function faultLoss(type, lambda) {
    switch (type) {
      case 'cut': case 'swap': return Infinity;
      case 'bend': return bendLoss(lambda);
      case 'badSplice': return 1.5;
      case 'dirty': return 3;
      default: return 0;
    }
  }

  /** Référence d'évaluation des ports passifs : ONT GPON classe B+. */
  const REF_SENSITIVITY = -27;
  const REF_OVERLOAD = -8;
  const WEAK_MARGIN = 3;          // marge minimale conseillée (dB)
  const VFL_RANGE = 5000;         // portée d'un stylo optique (m)
  const ETH_MAX = 100;            // longueur max d'un lien cuivre Cat6 (m)

  /* ------------------------------------------------------------------ */
  /*  Supports de transmission                                            */
  /* ------------------------------------------------------------------ */
  const CABLES = {
    smf: {
      label: 'Câble Monomode G.652D (transport / distribution)', short: 'SMF G.652D', kind: 'opt', fiber: 'smf',
      color: '#eab308', defaults: { length: 1000, jointA: 'fusion', jointB: 'fusion', fibers: 12 }, help: 'Câble extérieur multi-fibres (conduite, aérien). Raccordé par épissure aux deux extrémités.'
    },
    drop: {
      label: 'Câble Drop extérieur (G.657A2)', short: 'Drop', kind: 'opt', fiber: 'smf',
      color: '#78716c', defaults: { length: 50, jointA: 'fusion', jointB: 'fusion', fibers: 1 }, help: 'Câble de branchement abonné du PBO extérieur jusqu\'à la PTO.'
    },
    lszh: {
      label: 'Câble intérieur LSZH (G.657A2)', short: 'LSZH', kind: 'opt', fiber: 'smf',
      color: '#e2e8f0', defaults: { length: 15, jointA: 'fusion', jointB: 'fusion', fibers: 1 }, help: 'Câble de branchement palier (horizontal) : faible émission de fumée, rayon de courbure réduit.'
    },
    riser: {
      label: 'Câble de colonne montante (riser G.657A2)', short: 'Colonne', kind: 'opt', fiber: 'smf',
      color: '#f97316', defaults: { length: 3, jointA: 'fusion', jointB: 'none', fibers: 24, autoLength: true }, help: 'Câble vertical multi-fibres PMI/ODF → PBO d\'étage. Longueur calculée automatiquement (écart d\'étages × hauteur d\'étage).'
    },
    om3: {
      label: 'Fibre Multimode OM3 (dorsale interne)', short: 'MMF OM3', kind: 'opt', fiber: 'om3',
      color: '#22d3ee', defaults: { length: 150, jointA: 'connector', jointB: 'connector', fibers: 12 }, help: 'Dorsale d\'entreprise/campus, courtes distances (≤ 300 m à 10 Gbit/s).'
    },
    om4: {
      label: 'Fibre Multimode OM4 (dorsale interne)', short: 'MMF OM4', kind: 'opt', fiber: 'om4',
      color: '#a855f7', defaults: { length: 150, jointA: 'connector', jointB: 'connector', fibers: 12 }, help: 'Multimode haute performance (≤ 400 m à 10 Gbit/s). Gaine violette.'
    },
    patch: {
      label: 'Jarretière optique (patch cord)', short: 'Jarretière', kind: 'opt', fiber: 'smf',
      color: '#16a34a', defaults: { length: 2, jointA: 'none', jointB: 'none', fibers: 1, connector: 'SC/APC', duplex: 'Simplex' }, help: 'Câble court (1 à 5 m) de brassage entre ports d\'ODF, PBO pré-connectorisés et équipements actifs.'
    },
    cat6: {
      label: 'Câble Ethernet RJ45 Cat6', short: 'Cat6', kind: 'eth', fiber: null,
      color: '#60a5fa', defaults: { length: 5, jointA: 'none', jointB: 'none' }, help: 'Liaison cuivre ONT/Switch → terminaux. 100 m maximum.'
    },
    uplink: {
      label: 'Lien de collecte 10 GbE (fibre duplex SFP+)', short: 'Collecte 10G', kind: 'up', fiber: null,
      color: '#c026d3', defaults: { length: 20, jointA: 'none', jointB: 'none' }, help: 'Liaison de données 10 Gbit/s entre le routeur de collecte et un OLT ou un switch AON (modules SFP+). Elle transporte les VLAN de service ; elle ne fait pas partie du bilan optique PON.'
    }
  };

  const CONNECTORS = ['SC/APC', 'SC/UPC', 'LC/APC', 'LC/UPC'];
  function connectorFamily(c) { return /APC/.test(c || '') ? 'APC' : 'UPC'; }
  function connectorFormat(c) { return (c || 'SC').split('/')[0]; }
  function connectorColor(c) { return connectorFamily(c) === 'APC' ? '#16a34a' : '#2563eb'; }

  /* ------------------------------------------------------------------ */
  /*  Catalogue des équipements                                           */
  /* ------------------------------------------------------------------ */
  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const optPorts = (n, lbl) => range(n, i => ({ kind: 'opt', label: `${lbl} ${i + 1}` }));
  const upPorts = (n, lbl) => range(n, i => ({ kind: 'up', label: n > 1 ? `${lbl} ${i + 1}` : lbl }));

  /* ------------------------------------------------------------------ */
  /*  Couche service : profils, champs de configuration                   */
  /* ------------------------------------------------------------------ */
  /** Profils de service (débits en Mbit/s). */
  const PROFILES = {
    'internet-300': { label: 'Internet 300 Mbit/s', down: 300, up: 300, internet: true, tv: false, voip: false },
    'internet-1g': { label: 'Internet 1 Gbit/s', down: 1000, up: 500, internet: true, tv: false, voip: false },
    'duo': { label: 'Internet 1 Gbit/s + TV', down: 1000, up: 500, internet: true, tv: true, voip: false },
    'trio': { label: 'Triple play 1 Gbit/s (Internet + TV + VoIP)', down: 1000, up: 700, internet: true, tv: true, voip: true }
  };
  const PROFILE_OPTIONS = Object.entries(PROFILES).map(([k, p]) => [k, p.label]);
  const GPON_DOWN = 2488;          // débit descendant GPON partagé par port PON (Mbit/s)
  const GPON_UP = 1244;            // débit montant GPON partagé (Mbit/s)
  const ACCESS_MODES = [['dhcp', 'DHCP (IPoE)'], ['pppoe', 'PPPoE']];
  const vlanField = (key, label, show) => ({ key, label, type: 'number', min: 1, max: 4094, step: 1, show });

  /** Numéro de série d'ONT déterministe (ex. OPTI3FA21C07) dérivé de l'identifiant. */
  function autoSerial(id) {
    let h = 2166136261;
    for (const c of String(id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return 'OPTI' + h.toString(16).toUpperCase().padStart(8, '0');
  }
  const ethPorts = (n, lbl) => range(n, i => ({ kind: 'eth', label: `${lbl} ${i + 1}` }));
  const splitterOut = s => (s && s !== 'none' ? parseInt(s.split(':')[1], 10) : 0);

  const P = {
    name: { key: 'name', label: 'Nom / repère', type: 'text' },
    connector: { key: 'connector', label: 'Connecteurs', type: 'select', options: CONNECTORS },
    connLoss: { key: 'connLoss', label: 'Perte de traversée (raccord)', type: 'number', min: 0.1, max: 1, step: 0.05, unit: 'dB' }
  };

  const CATALOG = {
    /* ---------------- Actifs & répartition centrale ---------------- */
    olt: {
      label: 'OLT (Optical Line Terminal)', short: 'OLT', cat: 'actifs', color: '#2563eb',
      desc: 'Équipement actif du NRO. Émet le signal descendant GPON vers les abonnés.',
      defaults: { name: 'OLT', txPower: 4, wavelength: 1490, ponPorts: 4, classe: 'B+',
        vlanInternet: 100, vlanTv: 200, vlanVoip: 300, authMode: 'liste', autoProfile: 'trio', onts: [] },
      props: [P.name,
        { key: 'txPower', label: 'Puissance d\'émission', type: 'number', min: 0, max: 7, step: 0.5, unit: 'dBm' },
        { key: 'wavelength', label: 'Longueur d\'onde', type: 'select', options: [1490, 1310, 1550], unit: 'nm' },
        { key: 'ponPorts', label: 'Ports PON', type: 'select', options: [1, 2, 4, 8, 16] },
        { key: 'classe', label: 'Classe optique', type: 'select', options: ['B+', 'C+'] }],
      config: [
        { group: 'VLAN de service transportés' },
        vlanField('vlanInternet', 'VLAN Internet'), vlanField('vlanTv', 'VLAN TV (IPTV)'), vlanField('vlanVoip', 'VLAN Téléphonie (VoIP)'),
        { group: 'Autorisation des ONT' },
        { key: 'authMode', label: 'Mode d\'autorisation', type: 'select', options: [['liste', 'Liste blanche (numéros de série déclarés)'], ['auto', 'Automatique (toutes les ONT)']] },
        { key: 'autoProfile', label: 'Profil attribué automatiquement', type: 'select', options: PROFILE_OPTIONS, show: p => p.authMode === 'auto' },
        { key: 'onts', type: 'ontTable', show: p => p.authMode !== 'auto' }],
      inPorts: () => upPorts(1, 'Uplink 10G'), outPorts: p => optPorts(+p.ponPorts, 'PON'),
      mapping: 'none', isSource: () => true
    },
    collecte: {
      label: 'Routeur de collecte (BNG)', short: 'BNG', cat: 'actifs', color: '#be185d',
      desc: 'Routeur de l\'opérateur relié au cœur de réseau. Il termine les sessions des abonnés (DHCP ou PPPoE), attribue les adresses WAN et porte les VLAN Internet, TV et VoIP vers les OLT et les switchs AON.',
      defaults: { name: 'Routeur de collecte', upPorts: 4, core: true, accessMode: 'dhcp', pool: '100.64.0.0/24',
        accounts: [{ login: 'abonne1@optisim', password: 'fibre2026' }],
        vlanInternet: 100, tv: true, vlanTv: 200, voip: true, vlanVoip: 300 },
      props: [P.name, { key: 'upPorts', label: 'Ports de collecte 10 GbE', type: 'select', options: [2, 4, 8] }],
      config: [
        { group: 'Cœur de réseau' },
        { key: 'core', label: 'Raccordé au cœur de réseau (accès Internet)', type: 'checkbox' },
        { group: 'Accès des abonnés' },
        { key: 'accessMode', label: 'Mode d\'accès', type: 'select', options: ACCESS_MODES },
        { key: 'pool', label: 'Pool d\'adresses WAN (réseau/préfixe)', type: 'text' },
        { key: 'accounts', type: 'accountTable', show: p => p.accessMode === 'pppoe' },
        { group: 'Services et VLAN' },
        vlanField('vlanInternet', 'VLAN Internet'),
        { key: 'tv', label: 'Service TV (IPTV) activé', type: 'checkbox' }, vlanField('vlanTv', 'VLAN TV', p => p.tv),
        { key: 'voip', label: 'Service Téléphonie (VoIP) activé', type: 'checkbox' }, vlanField('vlanVoip', 'VLAN VoIP', p => p.voip)],
      inPorts: () => [], outPorts: p => upPorts(+p.upPorts, '10G'),
      mapping: 'none'
    },
    switch_aon: {
      label: 'Switch d\'accès Active Ethernet (AON)', short: 'AON', cat: 'actifs', color: '#0369a1',
      desc: 'Switch point à point : une fibre et un port SFP par abonné, sans coupleur. L\'abonné est identifié par son port physique. Uplink 10 GbE vers le routeur de collecte.',
      defaults: { name: 'Switch AON', txPower: -3, wavelength: 1490, sfpPorts: 8, portSpeed: 1000,
        vlanInternet: 100, vlanTv: 200, vlanVoip: 300, ports: [] },
      props: [P.name,
        { key: 'txPower', label: 'Puissance d\'émission SFP', type: 'number', min: -10, max: 5, step: 0.5, unit: 'dBm' },
        { key: 'wavelength', label: 'Longueur d\'onde descendante', type: 'select', options: [1490, 1310, 1550], unit: 'nm' },
        { key: 'sfpPorts', label: 'Ports SFP abonnés', type: 'select', options: [4, 8, 16] },
        { key: 'portSpeed', label: 'Vitesse des ports', type: 'select', options: [[100, '100 Mbit/s'], [1000, '1 Gbit/s']] }],
      config: [
        { group: 'VLAN de service transportés' },
        vlanField('vlanInternet', 'VLAN Internet'), vlanField('vlanTv', 'VLAN TV (IPTV)'), vlanField('vlanVoip', 'VLAN Téléphonie (VoIP)'),
        { group: 'Ports abonnés' },
        { key: 'ports', type: 'aonPorts' }],
      inPorts: () => upPorts(1, 'Uplink 10G'), outPorts: p => optPorts(+p.sfpPorts, 'SFP'),
      mapping: 'none', isSource: () => true
    },
    switch: {
      label: 'Switch optique / SFP', short: 'SW', cat: 'actifs', color: '#1d4ed8',
      desc: 'Commutateur avec modules SFP pour liaisons point-à-point (P2P) ou campus (FTTO).',
      defaults: { name: 'Switch', role: 'coeur', txPower: -3, sensitivity: -20, overload: -3, wavelength: 1310, fiberMode: 'Monomode (SM)', sfpPorts: 2, ethPorts: 4 },
      props: [P.name,
        { key: 'role', label: 'Rôle', type: 'select', options: [['coeur', 'Cœur / NRO (émetteur)'], ['acces', 'Accès / client (récepteur)']] },
        { key: 'wavelength', label: 'Longueur d\'onde SFP', type: 'select', options: [1310, 1550, 850], unit: 'nm' },
        { key: 'fiberMode', label: 'Type de SFP', type: 'select', options: ['Monomode (SM)', 'Multimode (MM)'] },
        { key: 'txPower', label: 'Puissance d\'émission SFP', type: 'number', min: -10, max: 5, step: 0.5, unit: 'dBm' },
        { key: 'sensitivity', label: 'Sensibilité récepteur', type: 'number', min: -35, max: -10, step: 0.5, unit: 'dBm' },
        { key: 'overload', label: 'Seuil de saturation', type: 'number', min: -10, max: 5, step: 0.5, unit: 'dBm' },
        { key: 'sfpPorts', label: 'Ports SFP (émission)', type: 'select', options: [1, 2, 4] },
        { key: 'ethPorts', label: 'Ports RJ45', type: 'select', options: [0, 2, 4, 8] }],
      inPorts: () => [{ kind: 'opt', label: 'SFP RX (uplink)' }],
      outPorts: p => optPorts(+p.sfpPorts, 'SFP TX').concat(ethPorts(+p.ethPorts, 'GE')),
      mapping: 'none', isSource: (d, i) => i < +d.props.sfpPorts
    },
    odf: {
      label: 'ODF / Répartiteur optique (NRO)', short: 'ODF', cat: 'actifs', color: '#0f766e',
      desc: 'Tiroir optique 19" ou baie murale. Termine les câbles (épissures pigtails) et permet le brassage par jarretières. Correspondance port à port : amont n ↔ aval n.',
      defaults: { name: 'ODF NRO', ports: 12, connector: 'SC/APC', connLoss: 0.5, format: 'Tiroir 19"' },
      props: [P.name,
        { key: 'ports', label: 'Nombre de ports', type: 'select', options: [12, 24, 48] },
        P.connector, P.connLoss,
        { key: 'format', label: 'Format', type: 'select', options: ['Tiroir 19"', 'Baie murale'] }],
      inPorts: p => optPorts(+p.ports, 'Amont'), outPorts: p => optPorts(+p.ports, 'Aval'),
      mapping: 'port',
      loss: p => [{ label: `Traversée ODF (${p.connector})`, loss: +p.connLoss, reflective: true, kind: 'connector' }]
    },

    /* ---------------- Passifs extérieurs (ODN) ---------------- */
    sro: {
      label: 'SRO / PM (armoire de rue)', short: 'SRO', cat: 'ext', color: '#7c3aed',
      desc: 'Sous-Répartiteur Optique / Point de Mutualisation de quartier. Brassage et coupleurs.',
      defaults: { name: 'SRO', outPorts: 8, splitter: '1:8', connector: 'SC/APC', connLoss: 0.5 },
      props: [P.name,
        { key: 'splitter', label: 'Coupleur intégré', type: 'select', options: ['none', '1:2', '1:4', '1:8', '1:16', '1:32', '1:64'] },
        { key: 'outPorts', label: 'Ports de sortie', type: 'select', options: [4, 8, 16, 32, 64] },
        P.connector, P.connLoss],
      inPorts: () => optPorts(1, 'Entrée'), outPorts: p => optPorts(+p.outPorts, 'Sortie'),
      mapping: 'broadcast',
      loss: p => {
        const l = [{ label: `Brassage SRO (${p.connector})`, loss: +p.connLoss, reflective: true, kind: 'connector' }];
        if (p.splitter && p.splitter !== 'none') l.push({ label: `Coupleur ${p.splitter}`, loss: SPLITTER_LOSS[p.splitter], reflective: false, kind: 'splitter' });
        return l;
      }
    },
    splitter: {
      label: 'Coupleur optique (splitter PLC)', short: 'SPL', cat: 'ext', color: '#9333ea',
      desc: 'Divise la puissance optique vers N sorties. Perte ≈ 10·log(N) + pertes d\'excès.',
      defaults: { name: 'Coupleur', ratio: '1:8' },
      props: [P.name, { key: 'ratio', label: 'Ratio', type: 'select', options: Object.keys(SPLITTER_LOSS) }],
      inPorts: () => optPorts(1, 'Entrée'), outPorts: p => optPorts(splitterOut(p.ratio), 'Sortie'),
      mapping: 'broadcast',
      loss: p => [{ label: `Coupleur ${p.ratio}`, loss: SPLITTER_LOSS[p.ratio], reflective: false, kind: 'splitter' }]
    },
    pbo_ext: {
      label: 'PBO extérieur (aérien, façade, chambre)', short: 'PBO-E', cat: 'ext', color: '#6d28d9',
      desc: 'Point de Branchement Optique de rue desservant villas et petits bâtiments.',
      defaults: { name: 'PBO', capacity: 8, mount: 'Aérien (poteau)', raccord: 'epissure', splitter: 'none' },
      props: [P.name,
        { key: 'capacity', label: 'Capacité (ports/épissures)', type: 'select', options: [4, 8, 12] },
        { key: 'mount', label: 'Pose', type: 'select', options: ['Aérien (poteau)', 'Façade', 'Chambre (souterrain)'] },
        { key: 'raccord', label: 'Raccordement interne', type: 'select', options: [['epissure', 'Épissurage (pertes sur les câbles)'], ['connectorise', 'Pré-connectorisé (0,5 dB)']] },
        { key: 'splitter', label: 'Mini-coupleur', type: 'select', options: ['none', '1:2', '1:4', '1:8'] }],
      inPorts: () => optPorts(1, 'Câble amont'), outPorts: p => optPorts(+p.capacity, 'Branchement'),
      mapping: 'broadcast', loss: p => pboLoss(p)
    },
    splice: {
      label: 'Boîtier d\'épissure (BPE)', short: 'BPE', cat: 'ext', color: '#8b5cf6',
      desc: 'Boîte de Protection d\'Épissures : raccorde deux tronçons de câble.',
      defaults: { name: 'BPE', spliceType: 'fusion' },
      props: [P.name, { key: 'spliceType', label: 'Type d\'épissure', type: 'select', options: [['fusion', 'Fusion (0,05 dB)'], ['mechanical', 'Mécanique (0,2 dB)']] }],
      inPorts: () => optPorts(1, 'Entrée'), outPorts: () => optPorts(1, 'Sortie'),
      mapping: 'broadcast',
      loss: p => [{ label: JOINTS[p.spliceType].label, loss: JOINTS[p.spliceType].loss, reflective: p.spliceType === 'mechanical', kind: 'splice' }]
    },
    coupler: {
      label: 'Raccord / traversée connecteur', short: 'RAC', cat: 'ext', color: '#a78bfa',
      desc: 'Adaptateur reliant deux connecteurs (perte d\'insertion d\'une connexion).',
      defaults: { name: 'Raccord', connector: 'SC/APC', connLoss: 0.5 },
      props: [P.name, P.connector, P.connLoss],
      inPorts: () => optPorts(1, 'Entrée'), outPorts: () => optPorts(1, 'Sortie'),
      mapping: 'broadcast',
      loss: p => [{ label: `Connexion ${p.connector}`, loss: +p.connLoss, reflective: true, kind: 'connector' }]
    },

    /* ---------------- Bâtiments & équipements intérieurs ---------------- */
    bld_simple: {
      label: 'Bâtiment simple (villa, boutique, bureau RDC)', short: 'BÂT', cat: 'bat', color: '#0891b2', container: true,
      desc: 'Zone bâtiment de plain-pied. Un câble qui y entre depuis l\'extérieur traverse le point d\'adduction puis la gaine intérieure.',
      defaults: { name: 'Villa', kind: 'Villa / Pavillon', gaineLength: 15 },
      props: [P.name,
        { key: 'kind', label: 'Type', type: 'select', options: ['Villa / Pavillon', 'Boutique', 'Bureau RDC', 'Bâtiment administratif'] },
        { key: 'gaineLength', label: 'Gaine intérieure (adduction → PTO)', type: 'number', min: 0, max: 200, step: 1, unit: 'm' }],
      inPorts: () => [], outPorts: () => [], mapping: 'none'
    },
    bld_mdu: {
      label: 'Immeuble multi-niveaux (R+N)', short: 'IMM', cat: 'bat', color: '#0e7490', container: true,
      desc: 'Immeuble découpé par étages. La colonne montante est calculée à partir de la hauteur d\'étage.',
      defaults: { name: 'Immeuble', usage: 'Résidentiel', floors: 3, basement: true, floorHeight: 3 },
      props: [P.name,
        { key: 'usage', label: 'Usage', type: 'select', options: ['Résidentiel', 'Bureaux'] },
        { key: 'floors', label: 'Nombre d\'étages (R+N)', type: 'number', min: 1, max: 12, step: 1 },
        { key: 'basement', label: 'Sous-sol', type: 'checkbox' },
        { key: 'floorHeight', label: 'Hauteur d\'étage', type: 'number', min: 2.5, max: 5, step: 0.1, unit: 'm' }],
      inPorts: () => [], outPorts: () => [], mapping: 'none'
    },
    local: {
      label: 'Local (logement, bureau, pièce)', short: 'LOC', cat: 'bat', color: '#64748b', container: true, room: true,
      desc: 'Compartiment d\'un bâtiment : appartement, bureau, commerce, pièce, parties communes ou local technique. Il se dessine dans un bâtiment ou un étage, se déplace et s\'ajuste à la souris (poignées des coins et des côtés) ; les équipements posés dedans y sont rattachés. Il n\'intervient pas dans les calculs.',
      defaults: { name: 'Logement', kind: 'Logement' },
      props: [P.name,
        { key: 'kind', label: 'Type de local', type: 'select', options: ['Logement', 'Bureau', 'Commerce', 'Pièce', 'Parties communes', 'Local technique'] }],
      inPorts: () => [], outPorts: () => [], mapping: 'none'
    },
    odf_int: {
      label: 'ODF intérieur / tiroir de baie', short: 'ODF-I', cat: 'bat', color: '#0d9488',
      desc: 'Répartiteur en local technique (pied d\'immeuble) ou sous-répartiteur d\'étage (FTTO). Port à port.',
      defaults: { name: 'ODF local tech.', ports: 12, connector: 'SC/APC', connLoss: 0.5, format: 'Tiroir 19"' },
      props: [P.name,
        { key: 'ports', label: 'Nombre de ports', type: 'select', options: [12, 24, 48] },
        P.connector, P.connLoss,
        { key: 'format', label: 'Format', type: 'select', options: ['Tiroir 19"', 'Baie murale'] }],
      inPorts: p => optPorts(+p.ports, 'Amont'), outPorts: p => optPorts(+p.ports, 'Aval'),
      mapping: 'port',
      loss: p => [{ label: `Traversée ODF (${p.connector})`, loss: +p.connLoss, reflective: true, kind: 'connector' }]
    },
    pmi: {
      label: 'PMI (Point de Mutualisation d\'Immeuble)', short: 'PMI', cat: 'bat', color: '#14b8a6',
      desc: 'Armoire en pied d\'immeuble recevant le câble opérateur. Brassage + coupleur éventuel.',
      defaults: { name: 'PMI', outPorts: 12, splitter: 'none', connector: 'SC/APC', connLoss: 0.5 },
      props: [P.name,
        { key: 'splitter', label: 'Coupleur intégré', type: 'select', options: ['none', '1:8', '1:16', '1:32', '1:64'] },
        { key: 'outPorts', label: 'Ports colonne', type: 'select', options: [12, 24, 48] },
        P.connector, P.connLoss],
      inPorts: () => optPorts(1, 'Adduction'), outPorts: p => optPorts(+p.outPorts, 'Colonne'),
      mapping: 'broadcast',
      loss: p => {
        const l = [{ label: `Brassage PMI (${p.connector})`, loss: +p.connLoss, reflective: true, kind: 'connector' }];
        if (p.splitter && p.splitter !== 'none') l.push({ label: `Coupleur ${p.splitter}`, loss: SPLITTER_LOSS[p.splitter], reflective: false, kind: 'splitter' });
        return l;
      }
    },
    pbo_int: {
      label: 'PBO intérieur (palier / gaine technique)', short: 'PBO-I', cat: 'bat', color: '#0f766e',
      desc: 'Boîtier d\'étage : piquage des fibres de la colonne montante vers les logements du palier.',
      defaults: { name: 'PBO étage', capacity: 6, raccord: 'epissure', splitter: 'none' },
      props: [P.name,
        { key: 'capacity', label: 'Capacité (fibres)', type: 'select', options: [4, 6, 12] },
        { key: 'raccord', label: 'Raccordement interne', type: 'select', options: [['epissure', 'Épissurage (pertes sur les câbles)'], ['connectorise', 'Pré-connectorisé (0,5 dB)']] },
        { key: 'splitter', label: 'Mini-coupleur', type: 'select', options: ['none', '1:2', '1:4', '1:8'] }],
      inPorts: () => optPorts(1, 'Colonne'), outPorts: p => optPorts(+p.capacity, 'Sortie'),
      mapping: 'broadcast', loss: p => pboLoss(p)
    },

    /* ---------------- Abonnés ---------------- */
    pto: {
      label: 'PTO (Prise Terminale Optique)', short: 'PTO', cat: 'abonnes', color: '#d97706',
      desc: 'Prise murale chez l\'abonné. Le câble y est épissuré, l\'ONT s\'y branche par jarretière.',
      defaults: { name: 'PTO', fibres: 'Mono-fibre', connector: 'SC/APC', connLoss: 0.5 },
      props: [P.name,
        { key: 'fibres', label: 'Type', type: 'select', options: ['Mono-fibre', 'Quadri-fibre'] },
        P.connector, P.connLoss],
      inPorts: p => optPorts(p.fibres === 'Quadri-fibre' ? 4 : 1, 'Fibre'),
      outPorts: p => optPorts(p.fibres === 'Quadri-fibre' ? 4 : 1, 'Prise'),
      mapping: 'port',
      loss: p => [{ label: `Connecteur PTO (${p.connector})`, loss: +p.connLoss, reflective: true, kind: 'connector' }]
    },
    ont: {
      label: 'ONT / ONU (box fibre)', short: 'ONT', cat: 'abonnes', color: '#f59e0b',
      desc: 'Terminal optique abonné : convertit le signal optique en Ethernet. Voyants Power, PON, LOS, LAN.',
      defaults: { name: 'ONT', sensitivity: -27, overload: -8, connector: 'SC/APC', sn: '' },
      props: [P.name,
        { key: 'sensitivity', label: 'Sensibilité', type: 'number', min: -32, max: -20, step: 0.5, unit: 'dBm' },
        { key: 'overload', label: 'Saturation', type: 'number', min: -12, max: 0, step: 0.5, unit: 'dBm' },
        P.connector],
      config: [
        { group: 'Identification' },
        { key: 'sn', label: 'Numéro de série (SN)', type: 'text', upper: true }],
      inPorts: () => [{ kind: 'opt', label: 'PON' }], outPorts: () => ethPorts(4, 'LAN'),
      mapping: 'none'
    },
    router: {
      label: 'Box opérateur / Routeur Wi-Fi', short: 'BOX', cat: 'abonnes', color: '#64748b',
      desc: 'Box de l\'abonné reliée en RJ45 à l\'ONT : session WAN vers l\'opérateur (DHCP ou PPPoE), réseau local, serveur DHCP et Wi-Fi.',
      defaults: { name: 'Box', wanMode: 'dhcp', pppLogin: '', pppPassword: '', vlanInternet: 100, vlanTv: 200, vlanVoip: 300,
        lanIp: '192.168.1.1', lanPrefix: 24, dhcp: true, dhcpStart: '192.168.1.10', dhcpEnd: '192.168.1.50', wifi: true, ssid: 'Box-OptiSim' },
      props: [P.name],
      config: [
        { group: 'WAN (vers l\'opérateur)' },
        { key: 'wanMode', label: 'Mode de connexion', type: 'select', options: ACCESS_MODES },
        { key: 'pppLogin', label: 'Identifiant PPPoE', type: 'text', show: p => p.wanMode === 'pppoe' },
        { key: 'pppPassword', label: 'Mot de passe PPPoE', type: 'text', show: p => p.wanMode === 'pppoe' },
        vlanField('vlanInternet', 'VLAN Internet'), vlanField('vlanTv', 'VLAN TV'), vlanField('vlanVoip', 'VLAN VoIP'),
        { group: 'LAN (réseau de la maison)' },
        { key: 'lanIp', label: 'Adresse IP de la Box', type: 'text' },
        { key: 'lanPrefix', label: 'Masque (préfixe)', type: 'select', options: [[24, '/24 — 255.255.255.0'], [25, '/25 — 255.255.255.128'], [26, '/26 — 255.255.255.192'], [16, '/16 — 255.255.0.0']] },
        { key: 'dhcp', label: 'Serveur DHCP activé', type: 'checkbox' },
        { key: 'dhcpStart', label: 'Début de la plage DHCP', type: 'text', show: p => p.dhcp },
        { key: 'dhcpEnd', label: 'Fin de la plage DHCP', type: 'text', show: p => p.dhcp },
        { group: 'Wi-Fi' },
        { key: 'wifi', label: 'Wi-Fi activé', type: 'checkbox' },
        { key: 'ssid', label: 'Nom du réseau (SSID)', type: 'text', show: p => p.wifi }],
      inPorts: () => [{ kind: 'eth', label: 'WAN' }], outPorts: () => ethPorts(4, 'LAN'), mapping: 'none'
    },
    pc: terminal('PC', 'PC', 'Poste de travail : utilise le service Internet.', 'PC'),
    phone: terminal('Téléphone IP', 'TEL', 'Téléphone VoIP : utilise le service Téléphonie.', 'Tél. IP'),
    tv: terminal('Décodeur TV', 'TV', 'Décodeur IPTV : utilise le service TV.', 'Décodeur TV')
  };

  /** Terminal abonné (PC, téléphone, décodeur) avec adressage IP configurable. */
  function terminal(label, short, desc, name) {
    return {
      label, short, cat: 'abonnes', color: '#475569', desc,
      defaults: { name, ipMode: 'dhcp', ip: '', prefix: 24, gateway: '' },
      props: [P.name],
      config: [
        { group: 'Adressage IP' },
        { key: 'ipMode', label: 'Mode d\'adressage', type: 'select', options: [['dhcp', 'Automatique (DHCP)'], ['static', 'Statique (manuel)']] },
        { key: 'ip', label: 'Adresse IP', type: 'text', show: p => p.ipMode === 'static' },
        { key: 'prefix', label: 'Masque (préfixe)', type: 'select', options: [[24, '/24 — 255.255.255.0'], [25, '/25 — 255.255.255.128'], [26, '/26 — 255.255.255.192'], [16, '/16 — 255.255.0.0']], show: p => p.ipMode === 'static' },
        { key: 'gateway', label: 'Passerelle', type: 'text', show: p => p.ipMode === 'static' }],
      inPorts: () => [{ kind: 'eth', label: 'RJ45' }], outPorts: () => [], mapping: 'none'
    };
  }

  function pboLoss(p) {
    const l = [];
    if (p.raccord === 'connectorise') l.push({ label: 'Connecteur PBO pré-connectorisé', loss: 0.5, reflective: true, kind: 'connector' });
    if (p.splitter && p.splitter !== 'none') l.push({ label: `Mini-coupleur ${p.splitter}`, loss: SPLITTER_LOSS[p.splitter], reflective: false, kind: 'splitter' });
    if (!l.length) l.push({ label: 'Piquage (épissures comptées sur les câbles)', loss: 0, reflective: false, kind: 'pass' });
    return l;
  }

  const TERMINALS = new Set(['pc', 'phone', 'tv']);

  /* ------------------------------------------------------------------ */
  /*  Géométrie des bâtiments                                             */
  /* ------------------------------------------------------------------ */
  const BLD_HEADER = 30;

  function mduLevels(b) {
    const floors = Math.max(1, +b.props.floors || 1);
    const fl = [];
    for (let f = floors; f >= 1; f--) fl.push(f);
    fl.push(0);
    if (b.props.basement) fl.push(-1);
    const fp = b.floorPx || 170;
    return fl.map((f, i) => ({ floor: f, y0: b.y + BLD_HEADER + i * fp, y1: b.y + BLD_HEADER + (i + 1) * fp, label: floorLabel(f) }));
  }
  function floorLabel(f) { return f === 0 ? 'RDC' : f < 0 ? 'Sous-sol' : `Étage ${f}`; }
  function buildingRect(b) {
    if (b.type === 'bld_mdu') {
      const n = mduLevels(b).length;
      return { x: b.x, y: b.y, w: b.w || 620, h: BLD_HEADER + n * (b.floorPx || 170) };
    }
    if (b.type === 'local') return { x: b.x, y: b.y, w: b.w || 220, h: b.h || 120 };
    return { x: b.x, y: b.y, w: b.w || 360, h: b.h || 230 };
  }
  /** Local (compartiment) : conteneur visuel, sans effet sur les calculs. */
  const isRoom = d => !!(d && CATALOG[d.type] && CATALOG[d.type].room);
  /** Couleur d'un type de local. */
  const ROOM_COLORS = { 'Logement': '#16a34a', 'Bureau': '#2563eb', 'Commerce': '#d97706', 'Pièce': '#9333ea', 'Parties communes': '#64748b', 'Local technique': '#475569' };

  /** Dimensions d'un équipement sur le canevas. */
  const DEV_W = 124;
  function deviceSize(d) {
    const def = CATALOG[d.type];
    if (def && def.container) { const r = buildingRect(d); return { w: r.w, h: r.h }; }
    const p = portsOf(d);
    const n = Math.max(p.in.length, p.out.length, 1);
    let h = Math.min(140, Math.max(58, 22 + n * 11));
    if (d.type === 'ont') h = Math.max(h, 74);
    return { w: DEV_W, h };
  }
  /** Position (coordonnées monde) d'un port. side: 'in' | 'out'. */
  function portPos(d, side, idx) {
    const s = deviceSize(d), p = portsOf(d);
    const n = Math.max(1, (side === 'in' ? p.in : p.out).length);
    const sp = (s.h - 28) / n;
    return { x: d.x + (side === 'in' ? 0 : s.w), y: d.y + 20 + sp * (idx + 0.5) };
  }
  /**
   * Rattache chaque équipement (et chaque local) au bâtiment qui le contient et à
   * son étage, puis chaque équipement au local qui le contient (`room`).
   * Les locaux ne servent qu'à illustrer : seuls `parent` et `floor` entrent dans les calculs.
   */
  function assignParents(topo) {
    const blds = topo.devices.filter(d => CATALOG[d.type] && CATALOG[d.type].container && !isRoom(d));
    const rooms = topo.devices.filter(isRoom);
    for (const d of topo.devices) {
      if (CATALOG[d.type].container && !isRoom(d)) continue;
      const s = deviceSize(d);
      const cx = d.x + s.w / 2, cy = d.y + s.h / 2;
      let best = null, area = Infinity;
      for (const b of blds) {
        const r = buildingRect(b);
        if (cx >= r.x && cx <= r.x + r.w && cy >= r.y + BLD_HEADER && cy <= r.y + r.h && r.w * r.h < area) { best = b; area = r.w * r.h; }
      }
      d.parent = best ? best.id : null;
      d.floor = undefined;
      if (best) {
        if (best.type === 'bld_mdu') {
          const lv = mduLevels(best).find(l => cy >= l.y0 && cy < l.y1);
          d.floor = lv ? lv.floor : 0;
        } else d.floor = 0;
      }
      d.room = undefined;
      if (!isRoom(d)) {
        let rArea = Infinity;
        for (const r of rooms) {
          const rr = buildingRect(r);
          if (cx >= rr.x && cx <= rr.x + rr.w && cy >= rr.y && cy <= rr.y + rr.h && rr.w * rr.h < rArea) { d.room = r.id; rArea = rr.w * rr.h; }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Utilitaires                                                         */
  /* ------------------------------------------------------------------ */
  function portsOf(d) {
    const def = CATALOG[d.type];
    if (!def) return { in: [], out: [] };
    return { in: def.inPorts ? def.inPorts(d.props) : [], out: def.outPorts ? def.outPorts(d.props) : [] };
  }
  function fmt(n, dec = 2) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (+n).toFixed(dec).replace('.', ',');
  }
  function fmtLen(m) {
    if (m >= 1000) return fmt(m / 1000, m % 1000 === 0 ? 0 : 3).replace(/,?0+$/, '') + ' km';
    return fmt(m, m % 1 === 0 ? 0 : 1) + ' m';
  }
  function attFor(cableType, lambda) {
    const c = CABLES[cableType];
    if (!c || !c.fiber) return 0;
    const tbl = ATTENUATION[c.fiber];
    return tbl[lambda] !== undefined ? tbl[lambda] : tbl[1310];
  }

  /** Classement d'un niveau de puissance reçu. */
  function classify(power, sens = REF_SENSITIVITY, over = REF_OVERLOAD, passive = false) {
    if (power === null || power === undefined || !isFinite(power)) return { code: 'los', label: 'LOS (pas de lumière)' };
    if (!passive && power > over) return { code: 'sat', label: 'Saturation' };
    if (power < sens) return { code: 'los', label: 'LOS (signal insuffisant)' };
    if (power < sens + WEAK_MARGIN) return { code: 'weak', label: 'Signal faible' };
    return { code: 'ok', label: 'OK' };
  }

  const CATEGORIES = ['NRO', 'Transport & distribution (extérieur)', 'ODF / PMI (pied d\'immeuble)', 'Colonne montante', 'PBO d\'étage', 'Branchement abonné'];

  /* ------------------------------------------------------------------ */
  /*  Moteur de calcul                                                    */
  /* ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ */
  /*  Recette réaliste : dispersion des composants d'un réseau réel       */
  /* ------------------------------------------------------------------ */
  // Les valeurs de référence (0,5 dB par connecteur, 0,05 dB par épissure…) servent au
  // calcul théorique. Sur un vrai réseau, chaque composant est un peu différent, et le plus
  // souvent meilleur. En mode recette (topo.recette.actif), chaque élément reçoit une perte
  // « réelle » tirée au hasard, reproductible (graine du réseau + identifiant de l'élément).
  // Les pannes et les incompatibilités APC/UPC gardent leur valeur exacte.
  const RECETTE_SEUILS = { acceptable: 0.5, controle: 1.0, marge: 3, suspect: 2, epissure: 0.15, connecteur: 0.5, coupleur: 0.5 };
  function hash32(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function seeded(seed) {
    return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const gauss = r => (r() + r() + r() + r() - 2) * Math.sqrt(3); // ≈ loi normale centrée réduite
  const clampV = (v, a, b) => Math.min(b, Math.max(a, v));
  const REAL_MODEL = {
    fiber: (nom, r) => nom * clampV(0.94 + 0.04 * gauss(r), 0.85, 1.05),        // fibre souvent un peu meilleure que la valeur typique
    fusion: (nom, r) => clampV(0.035 + 0.02 * gauss(r), 0.01, 0.12),             // épissure fusion : 0,01 à 0,12 dB
    mechanical: (nom, r) => clampV(0.15 + 0.05 * gauss(r), 0.05, 0.3),          // épissure mécanique
    connector: (nom, r) => clampV(nom * 0.55 + 0.08 * gauss(r), 0.1, nom + 0.05), // connecteur propre : ≈ 0,15 à 0,45 dB
    splitter: (nom, r) => clampV(nom - 0.25 + 0.25 * gauss(r), nom - 0.8, nom + 0.4)
  };
  function realLoss(seed, key, it) {
    if (it.fault || it.kind === 'mismatch' || !isFinite(it.loss) || !(it.loss > 0)) return it.loss;
    const k = it.kind === 'splice' ? (it.loss <= 0.1 ? 'fusion' : 'mechanical') : it.kind;
    const f = REAL_MODEL[k];
    return f ? Math.round(f(it.loss, seeded(hash32(seed + '|' + key))) * 10000) / 10000 : it.loss;
  }
  /**
   * Verdict de recette d'un récepteur : puissance calculée (théorique) et mesurée (dBm).
   * Écart = perte mesurée − perte calculée = P théorique − P mesurée.
   */
  function recetteVerdict(theo, mes, sens, over, seuils) {
    if (mes === null || mes === undefined || mes === '' || !Number.isFinite(+mes)) return null;
    mes = +mes;
    const S = Object.assign({}, RECETTE_SEUILS, seuils || {});
    const ecart = Math.round((theo - mes) * 100) / 100;
    const v = (code, label) => ({ code, label, ecart });
    if (mes < sens) return v('los', 'Non conforme : sous la sensibilité');
    if (mes > over) return v('los', 'Non conforme : saturation');
    if (mes - sens < S.marge) return v('los', `Non conforme : marge < ${String(S.marge).replace('.', ',')} dB`);
    if (ecart < -S.suspect) return v('weak', 'Mesure suspecte : vérifier la référence du photomètre');
    if (ecart <= 0) return v('ok', 'Conforme');
    if (ecart <= S.acceptable) return v('ok', 'Acceptable : nettoyer les connecteurs');
    if (ecart <= S.controle) return v('weak', 'À contrôler à l\'OTDR');
    return v('los', 'Non conforme : défaut à localiser');
  }

  class Engine {
    /** opts.reference : ignore le mode recette (calcul avec les valeurs de référence). */
    constructor(topo, opts = {}) {
      const rc = topo.recette;
      this.real = !opts.reference && !!(rc && rc.actif);
      this.seed = String((rc && rc.graine) || 1);
      this.topo = topo;
      this.dev = new Map(topo.devices.map(d => [d.id, d]));
      this.inMap = new Map();
      this.outMap = new Map();
      for (const l of topo.links) {
        this.outMap.set(l.a.dev + '#' + l.a.port, l);
        this.inMap.set(l.b.dev + '#' + l.b.port, l);
      }
      this.memo = new Map();
      this.stack = new Set();
      this.stateMemo = new Map();
    }

    def(d) { return CATALOG[d.type]; }
    building(d) { return d && d.parent ? this.dev.get(d.parent) : null; }

    /**
     * Choix du câble : le type de câble convient-il pour relier ces deux équipements ?
     * Renvoie une liste de conseils { text, suggest: [types de câbles adaptés] }.
     * Compétence évaluée chez l'élève : seul l'enseignant voit ces conseils (app.js).
     */
    cableAdvice(link) {
      const A = this.dev.get(link.a.dev), B = this.dev.get(link.b.dev);
      if (!A || !B) return [];
      const t = link.type, out = [];
      const add = (text, suggest) => out.push({ text, suggest: suggest || [] });
      const ba = this.building(A), bb = this.building(B);
      const same = !!ba && ba === bb;
      const len = Math.max(0, +link.length || 0);
      const isMM = t === 'om3' || t === 'om4';
      const ACCESS_SM = new Set(['olt', 'ont', 'sro', 'pbo_ext', 'pbo_int', 'pmi', 'pto', 'splitter']);
      const ACTIVE = new Set(['olt', 'ont', 'switch', 'switch_aon']);
      const mmSfp = d => d.type === 'switch' && /Multimode/.test(d.props.fiberMode || '');
      const smSfp = d => d.type === 'switch' && !/Multimode/.test(d.props.fiberMode || '');
      const name = d => d.props.name;
      const where = d => { const b = this.building(d); return b ? `dans « ${b.props.name} »` : 'à l\'extérieur'; };
      if (CABLES[t].kind !== 'opt') return out;

      // Monomode / multimode
      if (isMM) {
        const sm = [A, B].find(d => ACCESS_SM.has(d.type));
        if (sm) add(`Fibre multimode raccordée à ${name(sm)} : le réseau d'accès FTTH (GPON, PBO, PTO) utilise uniquement de la fibre monomode.`, ['smf', 'drop', 'lszh', 'riser', 'patch']);
        const s = [A, B].find(smSfp);
        if (s) add(`${name(s)} a un SFP monomode : il faut une fibre monomode (ou un SFP multimode 850 nm).`, ['smf', 'patch']);
        const max = t === 'om3' ? 300 : 400;
        if (len > max) add(`${CABLES[t].short} sur ${len} m : au-delà de ${max} m à 10 Gbit/s, passez en ${t === 'om3' ? 'OM4 ou en ' : ''}monomode.`, t === 'om3' ? ['om4', 'smf'] : ['smf']);
      } else if (t !== 'patch') { // une jarretière existe en monomode comme en multimode
        const s = [A, B].find(mmSfp);
        if (s) add(`${name(s)} a un SFP multimode (850 nm) : il se raccorde en fibre multimode OM3 / OM4.`, ['om3', 'om4']);
      }

      switch (t) {
        case 'patch':
          if (len > 20) add(`Jarretière de ${len} m : une jarretière sert au brassage court (1 à 5 m) dans une baie ou un local. Pour une liaison, choisissez un câble.`, same ? ['lszh', 'riser'] : ['smf', 'drop']);
          else if ((ba || null) !== (bb || null)) add(`Jarretière entre ${name(A)} (${where(A)}) et ${name(B)} (${where(B)}) : une jarretière ne sort pas du local ; entre deux sites, il faut un câble.`, ['smf', 'drop']);
          break;
        case 'smf':
          if (same) add(`Câble de transport extérieur G.652D à l'intérieur de « ${ba.props.name} » : dans un bâtiment, utilisez la colonne montante (entre étages) ou un câble intérieur LSZH.`, ['riser', 'lszh']);
          else if (A.type === 'pbo_ext' && B.type === 'pto') add(`Branchement d'abonné (PBO extérieur → PTO) : on utilise un câble drop G.657A2, plus souple et prévu pour l'aérien ou la façade.`, ['drop']);
          break;
        case 'drop':
          if (B.type !== 'pto' && B.type !== 'splice') add(`Le drop arrive normalement sur une PTO, pas sur ${name(B)}.`, B.type === 'odf' || A.type === 'odf' ? ['smf'] : ['patch']);
          if (A.type === 'odf' || A.type === 'olt' || A.type === 'sro') add(`Drop au départ de ${name(A)} : le drop est le câble de branchement depuis le PBO ; entre NRO, SRO et PBO, c'est un câble de transport / distribution.`, ['smf']);
          if (bb && bb.type === 'bld_mdu' && ba === bb) add(`Branchement à l'intérieur d'un immeuble : du PBO d'étage à la PTO, on utilise un câble intérieur LSZH.`, ['lszh']);
          break;
        case 'lszh':
          if (!same) add(`Câble intérieur LSZH entre ${name(A)} (${where(A)}) et ${name(B)} (${where(B)}) : il ne doit pas cheminer à l'extérieur. Utilisez un drop ou un câble de transport.`, ['drop', 'smf']);
          else if (ba.type === 'bld_mdu' && A.floor !== B.floor) add(`LSZH entre deux étages : la liaison verticale se fait en câble de colonne montante.`, ['riser']);
          break;
        case 'riser':
          if (!same || ba.type !== 'bld_mdu') add(`La colonne montante relie deux étages d'un même immeuble ; ici, ${name(A)} et ${name(B)} ne sont pas dans un même immeuble.`, ['smf', 'drop']);
          else if (A.floor === B.floor) add(`Colonne montante sur un même étage : pour une liaison horizontale, utilisez un câble intérieur LSZH (ou une jarretière dans le même local).`, ['lszh', 'patch']);
          break;
      }
      // Un équipement actif se raccorde par une jarretière (sur ODF, PTO, PMI…), pas directement sur un câble posé
      if (t !== 'patch' && !isMM) {
        const act = [A, B].find(d => ACTIVE.has(d.type));
        if (act) add(`${name(act)} est un équipement actif : il se branche par une jarretière sur un ODF, un PMI ou une PTO, pas directement sur un ${CABLES[t].short}.`, ['patch']);
      }
      return out;
    }

    /** Longueur effective d'un lien (auto colonne montante, gaine de bâtiment simple). */
    lengthInfo(link) {
      const A = this.dev.get(link.a.dev), B = this.dev.get(link.b.dev);
      let base = Math.max(0, +link.length || 0), auto = false, gaine = 0, gaineBld = null;
      if (link.autoLength && A && B) {
        const ba = this.building(A), bb = this.building(B);
        if (ba && ba === bb && ba.type === 'bld_mdu' && A.floor !== undefined && B.floor !== undefined && A.floor !== B.floor) {
          base = Math.abs(A.floor - B.floor) * (+ba.props.floorHeight || 3);
          auto = true;
        }
      }
      if (A && B && CABLES[link.type].kind === 'opt' && link.type !== 'patch') {
        const bb = this.building(B), ba = this.building(A);
        if (bb && bb.type === 'bld_simple' && ba !== bb) { gaine = Math.max(0, +bb.props.gaineLength || 0); gaineBld = bb; }
      }
      return { base, auto, gaine, gaineBld, total: base + gaine };
    }

    category(obj, isLink) {
      if (isLink) {
        const A = this.dev.get(obj.a.dev), B = this.dev.get(obj.b.dev);
        const ba = this.building(A), bb = this.building(B);
        if (obj.type === 'cat6') return 'Branchement abonné';
        if (obj.type === 'riser') return 'Colonne montante';
        if (ba && ba === bb && A.floor !== B.floor && ba.type === 'bld_mdu') return 'Colonne montante';
        if (obj.type === 'patch') {
          if (!ba && !bb) return 'NRO';
          const near = [A, B].find(x => x.type === 'odf_int' || x.type === 'pmi' || x.type === 'odf');
          if (near && this.building(near)) return 'ODF / PMI (pied d\'immeuble)';
          return 'Branchement abonné';
        }
        if (obj.type === 'drop' || obj.type === 'lszh') return 'Branchement abonné';
        if (!ba && !bb) return 'Transport & distribution (extérieur)';
        if (!ba && bb) return 'Transport & distribution (extérieur)';
        return 'Branchement abonné';
      }
      const d = obj, t = d.type, b = this.building(d);
      if (t === 'olt' || t === 'switch' || t === 'switch_aon' || t === 'collecte') return b ? 'Branchement abonné' : 'NRO';
      if (t === 'odf') return b ? 'ODF / PMI (pied d\'immeuble)' : 'NRO';
      if (t === 'odf_int' || t === 'pmi') return 'ODF / PMI (pied d\'immeuble)';
      if (t === 'pbo_int') return 'PBO d\'étage';
      if (t === 'pto' || t === 'ont') return 'Branchement abonné';
      return b ? 'Branchement abonné' : 'Transport & distribution (extérieur)';
    }

    /** Segment de câble : liste d'éléments de perte positionnés. */
    linkSegment(link, lambda) {
      const cable = CABLES[link.type];
      const li = this.lengthInfo(link);
      const att = attFor(link.type, lambda);
      const items = [];
      const ja = JOINTS[link.jointA || 'none'], jb = JOINTS[link.jointB || 'none'];
      if (ja.loss > 0) items.push({ label: `Extrémité A : ${ja.label}`, loss: ja.loss, pos: 0, reflective: ja.reflective, kind: link.jointA });
      items.push({ label: `Fibre ${fmtLen(li.base)} × ${fmt(att, 2)} dB/km${li.auto ? ' (longueur auto)' : ''}`, loss: att * li.base / 1000, pos: 0, len: li.base, att, kind: 'fiber' });
      if (li.gaine > 0) items.push({ label: `Gaine intérieure ${li.gaineBld.props.name} ${fmtLen(li.gaine)} × ${fmt(att, 2)} dB/km`, loss: att * li.gaine / 1000, pos: li.base, len: li.gaine, att, kind: 'fiber' });
      // Compatibilité connecteurs (jarretières)
      const warnings = [];
      if (link.type === 'patch') {
        for (const end of ['a', 'b']) {
          const D = this.dev.get(link[end].dev);
          if (D && D.props && D.props.connector) {
            if (connectorFamily(D.props.connector) !== connectorFamily(link.connector)) {
              items.push({ label: `Incompatibilité ${link.connector} ↔ ${D.props.connector} (${D.props.name})`, loss: 3, pos: end === 'a' ? 0 : li.total, reflective: true, kind: 'mismatch' });
              warnings.push(`Connecteur ${link.connector} branché sur un port ${D.props.connector} (${D.props.name}) : APC et UPC ne doivent jamais être accouplés (+3 dB, risque d'endommager les férules).`);
            } else if (connectorFormat(D.props.connector) !== connectorFormat(link.connector)) {
              warnings.push(`Format ${connectorFormat(link.connector)} ≠ ${connectorFormat(D.props.connector)} sur ${D.props.name} : jarretière hybride nécessaire.`);
            }
          }
        }
      }
      if (cable.fiber && cable.fiber !== 'smf' && lambda > 1310) warnings.push('Fibre multimode utilisée à ' + lambda + ' nm : non adaptée (prévue pour 850/1300 nm).');
      const f = link.fault;
      if (f && f.type) {
        const pos = FAULTS[f.type].positional ? Math.min(Math.max(0, +f.pos || 0), li.total) : li.total;
        items.push({ label: FAULTS[f.type].label, loss: faultLoss(f.type, lambda), pos, reflective: f.type === 'cut' || f.type === 'dirty', kind: 'fault-' + f.type, fault: true, hidden: !!f.hidden });
      }
      if (jb.loss > 0) items.push({ label: `Extrémité B : ${jb.label}`, loss: jb.loss, pos: li.total, reflective: jb.reflective, kind: link.jointB });
      return this._seg('link', link, `${cable.short} ${fmtLen(li.total)}`, this.category(link, true), items, li.total, warnings);
    }

    deviceSegment(d, lambda) {
      const def = this.def(d);
      const items = def.loss ? def.loss(d.props).map(x => Object.assign({ pos: 0 }, x)) : [];
      if (d.fault && d.fault.type) items.push({ label: `${FAULTS[d.fault.type].label} (${d.props.name})`, loss: faultLoss(d.fault.type, lambda), pos: 0, reflective: d.fault.type === 'dirty', kind: 'fault-' + d.fault.type, fault: true, hidden: !!d.fault.hidden });
      return this._seg('device', d, d.props.name, this.category(d, false), items, 0, []);
    }

    _seg(kind, obj, label, category, items, length, warnings) {
      if (this.real) items = items.map((it, i) => {
        const r = realLoss(this.seed, `${obj.id}:${i}:${it.kind}`, it);
        return r === it.loss ? it : Object.assign({}, it, { loss: r, nominal: it.loss });
      });
      let loss = 0, cut = false;
      for (const it of items) { if (isFinite(it.loss)) loss += it.loss; else cut = true; }
      return { kind, id: obj.id, label, category, items, loss, cut, length, warnings };
    }

    _extend(res, seg) {
      const r = Object.assign({}, res);
      r.segments = res.segments.concat([seg]);
      r.loss = res.loss + seg.loss;
      r.length = res.length + seg.length;
      if (seg.cut && !res.lost) { r.lost = true; r.lostAt = r.segments.length - 1; }
      return r;
    }

    /** Chemin optique arrivant sur un port d'entrée. */
    traceIn(devId, i) {
      const key = 'i:' + devId + ':' + i;
      if (this.memo.has(key)) return this.memo.get(key);
      if (this.stack.has(key)) return null;
      this.stack.add(key);
      let res = null;
      const link = this.inMap.get(devId + '#' + i);
      if (link && CABLES[link.type].kind === 'opt') {
        const up = this.traceOut(link.a.dev, link.a.port);
        if (up) res = this._extend(up, this.linkSegment(link, up.lambda));
      }
      this.stack.delete(key);
      this.memo.set(key, res);
      return res;
    }

    /** Chemin optique sortant d'un port de sortie. */
    traceOut(devId, i) {
      const key = 'o:' + devId + ':' + i;
      if (this.memo.has(key)) return this.memo.get(key);
      if (this.stack.has(key)) return null;
      this.stack.add(key);
      const d = this.dev.get(devId);
      let res = null;
      if (d) {
        const def = this.def(d), ports = portsOf(d);
        if (ports.out[i] && ports.out[i].kind === 'opt') {
          if (def.isSource && def.isSource(d, i)) {
            res = { src: d.id, srcPort: i, lambda: +d.props.wavelength, tx: +d.props.txPower, dark: false, lost: false, lostAt: null, loss: 0, length: 0,
              segments: [{ kind: 'source', id: d.id, label: d.props.name, category: this.category(d, false), items: [], loss: 0, length: 0, warnings: [] }] };
          } else {
            let cands = [];
            if (def.mapping === 'port') cands = i < ports.in.length ? [i] : [];
            else if (def.mapping === 'broadcast') cands = ports.in.map((p, k) => k).filter(k => this.inMap.has(devId + '#' + k));
            let best = null;
            for (const k of cands) {
              const up = this.traceIn(devId, k);
              if (up && (!best || (best.dark && !up.dark) || (best.lost && !up.lost && !up.dark))) best = up;
            }
            const linkedIn = ports.in.some((p, k) => this.inMap.has(devId + '#' + k));
            if (!best && def.mapping !== 'none' && !linkedIn) {
              // Tête de réseau sans source : chemin "sombre" utilisable par l'OTDR
              best = { src: null, lambda: 1310, tx: null, dark: true, lost: false, lostAt: null, loss: 0, length: 0, segments: [] };
            }
            if (best) res = this._extend(best, this.deviceSegment(d, best.lambda));
          }
        }
      }
      this.stack.delete(key);
      this.memo.set(key, res);
      return res;
    }

    power(res) { return !res || res.dark || res.lost ? null : res.tx - res.loss; }

    /** Meilleure entrée optique d'un équipement. */
    bestIn(devId) {
      const d = this.dev.get(devId); if (!d) return null;
      const ports = portsOf(d);
      let best = null, bestIdx = -1;
      ports.in.forEach((p, k) => {
        if (p.kind !== 'opt') return;
        const r = this.traceIn(devId, k);
        if (!r) return;
        const pw = this.power(r);
        const bp = best ? this.power(best) : null;
        if (!best || (bp === null && pw !== null) || (pw !== null && bp !== null && pw > bp) || (best.dark && !r.dark)) { best = r; bestIdx = k; }
      });
      return best ? { res: best, port: bestIdx } : null;
    }

    sensOf(d) {
      if (d.type === 'ont' || (d.type === 'switch' && d.props.role === 'acces'))
        return { sens: +d.props.sensitivity, over: +d.props.overload, passive: false };
      return { sens: REF_SENSITIVITY, over: REF_OVERLOAD, passive: true };
    }

    /** État synthétique d'un équipement (badge). */
    deviceState(devId) {
      if (this.stateMemo.has(devId)) return this.stateMemo.get(devId);
      const d = this.dev.get(devId);
      let st = { code: 'nc', label: 'Non raccordé' };
      if (!d) return st;
      const def = this.def(d);
      if (def.container) st = null;
      else if (d.type === 'collecte') {
        const used = portsOf(d).out.some((p, k) => this.outMap.has(devId + '#' + k));
        st = !d.props.core ? { code: 'weak', label: 'Non raccordé au cœur de réseau' } : used ? { code: 'ok', label: 'En service' } : { code: 'idle', label: 'En service (aucun lien de collecte)' };
      } else if (d.type === 'olt' || d.type === 'switch_aon' || (d.type === 'switch' && d.props.role === 'coeur')) {
        const used = portsOf(d).out.some((p, k) => this.outMap.has(devId + '#' + k));
        st = used ? { code: 'ok', label: 'En émission' } : { code: 'idle', label: 'En service (aucun port raccordé)' };
      } else if (d.type === 'router' || TERMINALS.has(d.type)) {
        const e = this.ethIn(devId);
        st = e.nc ? { code: 'nc', label: 'Non raccordé' } : e.up ? { code: 'ok', label: 'Connecté au réseau' } : { code: 'los', label: e.reason || 'Pas de connexion' };
      } else {
        const b = this.bestIn(devId);
        if (!b) st = { code: 'nc', label: 'Non raccordé' };
        else if (b.res.dark) st = { code: 'dark', label: 'Pas de source optique en amont' };
        else {
          const s = this.sensOf(d);
          const pw = this.power(b.res);
          st = classify(pw, s.sens, s.over, s.passive);
          st.power = pw; st.res = b.res; st.port = b.port;
        }
      }
      this.stateMemo.set(devId, st);
      return st;
    }

    /** Disponibilité Ethernet d'un équipement (ONT, switch, routeur). */
    devUp(d, depth = 0) {
      if (!d || depth > 20) return { up: false, reason: 'Boucle' };
      if (d.type === 'ont' || (d.type === 'switch' && d.props.role === 'acces')) {
        const st = this.deviceState(d.id);
        return (st.code === 'ok' || st.code === 'weak') ? { up: true } : { up: false, reason: `${d.props.name} : ${st.label}` };
      }
      if (d.type === 'switch') return { up: true };
      if (d.type === 'router') return this.ethIn(d.id, depth + 1);
      return { up: false, reason: 'Équipement non actif' };
    }

    ethIn(devId, depth = 0) {
      const d = this.dev.get(devId);
      const ports = portsOf(d);
      const k = ports.in.findIndex(p => p.kind === 'eth');
      const link = k >= 0 ? this.inMap.get(devId + '#' + k) : null;
      if (!link) return { up: false, nc: true };
      if ((+link.length || 0) > ETH_MAX) return { up: false, reason: `Câble Cat6 de ${link.length} m (> ${ETH_MAX} m)` };
      return this.devUp(this.dev.get(link.a.dev), depth);
    }

    /** État d'un lien (couleur, animation). */
    linkState(link) {
      if (CABLES[link.type].kind === 'up') {
        const A = this.dev.get(link.a.dev);
        const up = !!(A && A.type === 'collecte');
        return { kind: 'up', up, code: up ? 'ok' : 'nc', reason: up ? '' : 'Le lien de collecte doit partir d\'un routeur de collecte' };
      }
      if (CABLES[link.type].kind === 'eth') {
        const e = this.ethIn(link.b.dev);
        return { kind: 'eth', up: e.up, code: e.up ? 'ok' : 'nc', reason: e.reason };
      }
      const res = this.traceIn(link.b.dev, link.b.port);
      if (!res || res.dark) return { kind: 'opt', code: 'dark', lit: false };
      const last = res.segments[res.segments.length - 1];
      const lostHere = res.lost && res.lostAt === res.segments.length - 1;
      if (res.lost && !lostHere) return { kind: 'opt', code: 'los', lit: false, res };
      const B = this.dev.get(link.b.dev);
      const s = this.sensOf(B);
      const pw = this.power(res);
      const c = lostHere ? { code: 'los', label: 'Coupure' } : classify(pw, s.sens, s.over, s.passive);
      let litFrac = 1;
      if (lostHere) {
        const cutItem = last.items.find(it => !isFinite(it.loss));
        litFrac = last.length > 0 ? Math.max(0.02, cutItem.pos / last.length) : 0.5;
      }
      return { kind: 'opt', code: c.code, label: c.label, lit: true, litFrac, power: pw, res, lambda: res.lambda };
    }

    /** Tableau des puissances par port pour le photomètre. */
    portReadings(devId) {
      const d = this.dev.get(devId);
      const ports = portsOf(d);
      const out = [];
      ports.in.forEach((p, k) => {
        if (p.kind !== 'opt') return;
        const linked = this.inMap.has(devId + '#' + k);
        const r = linked ? this.traceIn(devId, k) : null;
        out.push({ side: 'in', idx: k, label: p.label, linked, res: r, power: this.power(r) });
      });
      ports.out.forEach((p, k) => {
        if (p.kind !== 'opt') return;
        const linked = this.outMap.has(devId + '#' + k);
        const r = this.traceOut(devId, k);
        out.push({ side: 'out', idx: k, label: p.label, linked, res: r, power: this.power(r) });
      });
      return out;
    }

    /** Liste de toutes les alertes de cohérence. */
    warnings() {
      const w = [];
      for (const l of this.topo.links) {
        if (CABLES[l.type].kind === 'opt') {
          const seg = this.linkSegment(l, 1310);
          seg.warnings.forEach(x => w.push({ id: l.id, text: x }));
        } else if (CABLES[l.type].kind === 'eth' && (+l.length || 0) > ETH_MAX) w.push({ id: l.id, text: `Lien Cat6 de ${l.length} m : la norme Ethernet limite le cuivre à 100 m (FTTB).` });
      }
      return w;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Réflectomètre (OTDR simplifié)                                      */
  /* ------------------------------------------------------------------ */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /**
   * Tir OTDR depuis la tête de réseau (l'OTDR remplace la source) jusqu'à l'équipement ciblé.
   * opts: { lambda: 1310|1550, launch: m, dynamic: dB }
   */
  function otdrShot(engine, devId, opts = {}) {
    const lambda = opts.lambda || 1310;
    const launch = opts.launch !== undefined ? +opts.launch : 500;
    const dyn = opts.dynamic || 40;
    const d = engine.dev.get(devId);
    if (!d) return { error: 'Équipement introuvable.' };
    let path = null;
    const ports = portsOf(d);
    ports.in.forEach((p, k) => { if (!path && p.kind === 'opt') path = engine.traceIn(devId, k); });
    if (!path) return { error: `Aucun chemin optique continu n'arrive sur « ${d.props.name} » (port non raccordé ou erreur de brassage en amont).` };

    // Reconstruit le chemin à la longueur d'onde de l'OTDR
    const segs = [];
    for (const s of path.segments) {
      if (s.kind === 'source') continue;
      if (s.kind === 'link') segs.push(engine.linkSegment(engine.topo.links.find(l => l.id === s.id), lambda));
      else segs.push(engine.deviceSegment(engine.dev.get(s.id), lambda));
    }
    const origin = path.segments[0];
    const originName = origin.kind === 'source' ? engine.dev.get(origin.id).props.name : (segs[0] ? segs[0].label : '');

    let events = [];
    let fibers = []; // {from, to, att}
    // part : composant de l'événement (type, perte nominale, panne) pour calculer son seuil de recette
    const addEv = (pos, loss, reflective, label, kind, part) => {
      const last = events[events.length - 1];
      if (last && Math.abs(last.pos - pos) < 0.5 && !last.end) {
        if (part) last.parts.push(part);
        last.loss += isFinite(loss) ? loss : 0;
        last.reflective = last.reflective || reflective;
        if (label && last.labels.indexOf(label) < 0) last.labels.push(label);
        if (kind === 'splitter') last.kind = 'splitter';
        else if (kind && kind.startsWith('fault')) last.kind = kind;
        return last;
      }
      const ev = { pos, loss: isFinite(loss) ? loss : 0, reflective, labels: label ? [label] : [], kind, parts: part ? [part] : [] };
      events.push(ev); return ev;
    };
    addEv(0, 0, true, 'Connecteur de l\'OTDR', 'start');
    let pos = 0;
    if (launch > 0) {
      fibers.push({ from: 0, to: launch, att: ATTENUATION.smf[lambda] });
      pos = launch;
      addEv(pos, 0.3, true, 'Raccord bobine amorce → réseau (' + originName + ')', 'connector');
    }
    let end = null;
    for (const s of segs) {
      if (end) break;
      if (s.kind === 'device') {
        for (const it of s.items) {
          if (!isFinite(it.loss)) { end = it.hidden ? { pos, label: 'Fin de trace', kind: 'end' } : { pos, label: it.label, kind: it.kind }; break; }
          if (it.loss > 0 || it.reflective) addEv(pos, it.loss, it.reflective, it.hidden ? `${s.label} — événement à analyser` : `${s.label} — ${it.label}`, it.hidden ? (it.reflective ? 'connector' : 'splice') : it.kind, { k: it.kind, nom: it.nominal !== undefined ? it.nominal : it.loss, fault: !!it.fault });
        }
        continue;
      }
      // segment câble
      const start = pos;
      const fiberItems = s.items.filter(it => it.kind === 'fiber');
      let cursor = start;
      for (const fi of fiberItems) { fibers.push({ from: cursor, to: cursor + fi.len, att: fi.att, label: s.label }); cursor += fi.len; }
      const others = s.items.filter(it => it.kind !== 'fiber').sort((a, b) => a.pos - b.pos);
      for (const it of others) {
        const p = start + it.pos;
        if (!isFinite(it.loss)) {
          end = it.hidden ? { pos: p, label: 'Fin de trace', kind: 'end' } : { pos: p, label: it.label, kind: it.kind };
          // tronque la dernière portion de fibre
          for (const f of fibers) if (f.to > p) f.to = Math.max(f.from, p);
          break;
        }
        addEv(p, it.loss, it.reflective, it.hidden ? 'Événement à analyser' : it.label, it.hidden ? (it.reflective ? 'connector' : 'splice') : it.kind, { k: it.kind, nom: it.nominal !== undefined ? it.nominal : it.loss, fault: !!it.fault });
      }
      if (!end) pos = start + s.length;
    }
    if (!end) end = { pos, label: `Extrémité : ${d.props.name} (connecteur ouvert)`, kind: 'end' };
    const endEv = { pos: end.pos, loss: 0, reflective: end.kind !== 'fault-swap', labels: [end.label], kind: end.kind, end: true };
    events.push(endEv);

    // Asymétrie de mesure (mode recette réaliste) : une épissure ou un connecteur ne mesure pas
    // la même perte dans les deux sens (diamètres de mode différents). La moyenne aller-retour
    // donne la vraie valeur ; un tir seul peut même montrer un « gain » apparent.
    const isLaunch = e => /bobine amorce/.test(e.labels[0] || '');
    events.forEach(e => {
      e.trueLoss = e.loss; e.asym = 0;
      if (!engine.real || e.end || e.kind === 'start' || isLaunch(e)) return;
      const sc = e.reflective ? 0.03 : e.kind === 'splitter' ? 0.08 : 0.06;
      const r = mulberry32(hash32(engine.seed + '|otdr|' + Math.round(e.pos * 10) + '|' + lambda));
      e.asym = Math.round((r() * 2 - 1) * sc * 1000) / 1000;
    });
    let target = d.props.name, originLabel = originName;
    if (opts.reverse) {
      // Tir retour : l'OTDR est branché côté abonné ; le chemin est parcouru dans l'autre sens
      if (end.kind !== 'end' || String(end.label).indexOf('Extrémité') !== 0) return { error: 'Tir retour impossible : la trace aller n\'atteint pas l\'extrémité (coupure ou fin anormale). Localisez d\'abord le défaut avec le tir aller.' };
      const P = end.pos, L0 = launch > 0 ? launch : 0;
      const inner = events.filter(e => !e.end && e.kind !== 'start' && !isLaunch(e));
      const rev = [{ pos: 0, loss: 0, reflective: true, labels: ['Connecteur de l\'OTDR'], kind: 'start', asym: 0 }];
      if (L0) rev.push({ pos: L0, loss: 0.3, reflective: true, labels: ['Raccord bobine amorce → réseau (' + d.props.name + ')'], kind: 'connector', asym: 0 });
      inner.slice().reverse().forEach(e => rev.push({ pos: L0 + (P - e.pos), loss: e.trueLoss - e.asym, reflective: e.reflective, labels: e.labels.slice(), kind: e.kind, asym: -e.asym, parts: e.parts }));
      const endLabel = `Extrémité : ${originName} (côté NRO)`;
      rev.push({ pos: P, loss: 0, reflective: true, labels: [endLabel], kind: 'end', end: true });
      fibers = fibers.map(f => (L0 && f.to <= L0 + 1e-9) ? f : { from: L0 + (P - f.to), to: L0 + (P - Math.max(f.from, L0)), att: f.att, label: f.label });
      events = rev; end = { pos: P, label: endLabel, kind: 'end' };
      target = originName; originLabel = d.props.name;
    } else events.forEach(e => { e.loss = e.trueLoss + e.asym; });

    // Niveau de rétrodiffusion à une distance x (en dB, 0 = départ)
    const levelAt = x => {
      let L = 0;
      for (const f of fibers) if (x > f.from) L += f.att * (Math.min(x, f.to) - f.from) / 1000;
      for (const e of events) if (!e.end && e.pos < x) L += e.loss;
      return -L;
    };
    const span = Math.max(end.pos * 1.12, end.pos + 150, 300);
    const floor = -dyn;
    const rnd = mulberry32(Math.round(end.pos * 7 + events.length * 131 + lambda));
    const xs = [];
    const N = 900;
    for (let i = 0; i <= N; i++) xs.push(span * i / N);
    const spikeW = Math.max(1.5, span / 260);
    for (const e of events) [e.pos - 0.01, e.pos, e.pos + 0.01, e.pos + spikeW * 0.5, e.pos + spikeW].forEach(x => { if (x >= 0 && x <= span) xs.push(x); });
    xs.sort((a, b) => a - b);
    const pts = [];
    for (const x of xs) {
      let y;
      if (x > end.pos + spikeW) y = floor;
      else y = Math.max(floor, levelAt(x));
      // réflexions (pics de Fresnel)
      for (const e of events) {
        if (!e.reflective) continue;
        if (x >= e.pos && x <= e.pos + spikeW) {
          const base = Math.max(floor, levelAt(e.pos));
          const amp = e.end ? 14 : e.kind === 'start' ? 18 : e.kind === 'mechanical' ? 3 : 7;
          y = Math.max(y, base + amp * (1 - (x - e.pos) / spikeW));
        }
      }
      const prox = y - floor;
      const noiseAmp = 0.015 + (prox < 8 ? (8 - prox) * 0.12 : 0);
      y += (rnd() - 0.5) * 2 * noiseAmp;
      pts.push([x, y]);
    }
    const numbered = events.map((e, i) => ({
      n: i + 1, pos: e.pos, loss: e.loss, reflective: e.reflective, end: !!e.end, kind: e.kind, parts: e.parts || [],
      label: e.labels.join(' + '),
      type: e.end ? (e.kind && e.kind.startsWith('fault') ? 'Fin anormale (coupure)' : 'Fin de fibre') :
        e.kind === 'start' ? 'Départ' : e.kind === 'splitter' ? 'Coupleur' :
        (e.kind && e.kind.startsWith('fault-bend')) ? 'Perte non réflective (courbure)' :
        e.reflective ? 'Événement réflectif' : 'Événement non réflectif'
    }));
    const netLen = end.pos - (launch > 0 ? launch : 0);
    numbered.forEach(e => { e.net = Math.round((opts.reverse ? end.pos - e.pos : e.pos - (launch > 0 ? launch : 0)) * 10) / 10; });
    return { lambda, launch, span, floor, points: pts, events: numbered, endPos: end.pos, netLen, direction: opts.reverse ? 'retour' : 'aller', target, origin: originLabel, targetId: devId, totalLoss: -levelAt(end.pos) };
  }

  /* ------------------------------------------------------------------ */
  /*  Stylo optique (VFL)                                                 */
  /* ------------------------------------------------------------------ */
  function vflInject(engine, devId, dir = 'down') {
    const lit = new Map();   // linkId -> {from, to} fractions éclairées
    const leaks = [];        // {linkId, frac, kind}
    const glow = new Set();  // devId éclairés
    const seen = new Set();
    const queue = [];
    const d0 = engine.dev.get(devId);
    if (!d0) return { lit, leaks, glow };
    glow.add(devId);
    const ports0 = portsOf(d0);
    const side0 = dir === 'down' ? ports0.out : ports0.in;
    side0.forEach((p, k) => { if (p.kind === 'opt') queue.push({ dev: devId, port: k, dist: 0 }); });
    const linksAll = engine.topo.links;
    while (queue.length) {
      const q = queue.shift();
      const key = q.dev + ':' + q.port;
      if (seen.has(key)) continue;
      seen.add(key);
      const link = dir === 'down' ? engine.outMap.get(q.dev + '#' + q.port) : engine.inMap.get(q.dev + '#' + q.port);
      if (!link || CABLES[link.type].kind !== 'opt') continue;
      const li = engine.lengthInfo(link);
      const L = li.total || 0.001;
      const f = link.fault;
      let reach = 1, stop = false;
      if (f && f.type) {
        const fpos = FAULTS[f.type].positional ? Math.min(+f.pos || 0, L) : (dir === 'down' ? L : 0);
        const frac = Math.max(0, Math.min(1, fpos / L));
        if (f.type === 'cut' || f.type === 'swap') {
          reach = dir === 'down' ? frac : 1 - frac; stop = true;
          leaks.push({ linkId: link.id, frac, kind: f.type });
        } else if (f.type === 'bend') leaks.push({ linkId: link.id, frac, kind: 'bend' });
        else if (f.type === 'dirty') leaks.push({ linkId: link.id, frac: dir === 'down' ? 1 : 0, kind: 'dirty' });
      }
      const remaining = VFL_RANGE - q.dist;
      if (remaining <= 0) continue;
      if (L * reach > remaining) { reach = remaining / L; stop = true; }
      lit.set(link.id, dir === 'down' ? { from: 0, to: reach } : { from: 1 - reach, to: 1 });
      if (stop) continue;
      const nextDev = dir === 'down' ? link.b.dev : link.a.dev;
      const nextPort = dir === 'down' ? link.b.port : link.a.port;
      const D = engine.dev.get(nextDev);
      glow.add(nextDev);
      if (D.fault && D.fault.type === 'swap') { leaks.push({ devId: nextDev, kind: 'swap' }); continue; }
      const def = CATALOG[D.type];
      const ps = portsOf(D);
      const nd = q.dist + L;
      if (dir === 'down') {
        if (def.mapping === 'port') queue.push({ dev: nextDev, port: nextPort, dist: nd });
        else if (def.mapping === 'broadcast') ps.out.forEach((p, k) => queue.push({ dev: nextDev, port: k, dist: nd }));
      } else {
        if (def.mapping === 'port') queue.push({ dev: nextDev, port: nextPort, dist: nd });
        else if (def.mapping === 'broadcast') ps.in.forEach((p, k) => queue.push({ dev: nextDev, port: k, dist: nd }));
      }
    }
    void linksAll;
    return { lit, leaks, glow };
  }

  /**
   * Lignes de la fiche de recette : pour chaque récepteur alimenté (ONT, switch, CPE…),
   * puissance calculée avec les valeurs de référence sur le réseau sans panne (théorique)
   * et puissance réellement reçue (avec dispersion et pannes).
   */
  function recetteRows(topo) {
    const t = JSON.parse(JSON.stringify({ devices: topo.devices, links: topo.links, recette: topo.recette }));
    assignParents(t);
    const real = new Engine(t);
    const d0 = JSON.parse(JSON.stringify(t));
    d0.devices.forEach(d => { delete d.fault; }); d0.links.forEach(l => { delete l.fault; });
    assignParents(d0);
    const design = new Engine(d0, { reference: true });
    const rows = [];
    t.devices.forEach(d => {
      if (CATALOG[d.type].container) return;
      const s = real.sensOf(d);
      if (s.passive) return;
      const sd = design.deviceState(d.id);
      if (!sd || !sd.res || sd.res.dark || sd.power === undefined || sd.power === null) return;
      const sr = real.deviceState(d.id);
      rows.push({ id: d.id, name: d.props.name, theo: Math.round(sd.power * 100) / 100, theoLoss: Math.round(sd.res.loss * 100) / 100, tx: sd.res.tx,
        real: sr && Number.isFinite(sr.power) ? Math.round(sr.power * 100) / 100 : null, sens: s.sens, over: s.over });
    });
    return rows;
  }

  /**
   * Analyse bidirectionnelle de deux tirs OTDR (aller depuis le NRO, retour depuis l'abonné)
   * à la même longueur d'onde : moyenne des pertes par événement et verdict par seuil.
   * Les tirs peuvent être des résultats d'otdrShot ou des tirs enregistrés (mêmes champs).
   */
  function otdrBidir(aller, retour, seuils) {
    const S = Object.assign({}, RECETTE_SEUILS, seuils || {});
    const keep = e => !e.end && e.kind !== 'start' && !/bobine amorce/.test(e.label || '');
    const B = retour.events.filter(keep);
    const rows = aller.events.filter(keep).map(a => {
      const b = B.find(x => Math.abs(x.net - a.net) <= 1.5);
      const moy = b ? Math.round((a.loss + b.loss) / 2 * 1000) / 1000 : null;
      // Seuil de l'événement = somme des tolérances de ses composants (l'OTDR fusionne les éléments proches)
      const parts = Array.isArray(a.parts) && a.parts.length ? a.parts : [{ k: a.kind === 'splitter' ? 'splitter' : a.reflective ? 'connector' : 'fusion', nom: 0 }];
      let max = 0, nomSplit = null;
      const nb = { c: 0, e: 0 };
      parts.forEach(pt => {
        if (pt.fault || pt.k === 'mismatch' || pt.k === 'pass') return;          // une panne n'apporte aucune tolérance
        if (pt.k === 'splitter') { nomSplit = (nomSplit || 0) + pt.nom; max += pt.nom + S.coupleur; }
        else if (pt.k === 'connector') { nb.c++; max += S.connecteur; }
        else if (pt.k === 'mechanical') { nb.e++; max += Math.max(0.3, S.epissure); }
        else { nb.e++; max += S.epissure; }
      });
      max = Math.round(max * 1000) / 1000;
      const comp = [nb.c ? `${nb.c} connecteur${nb.c > 1 ? 's' : ''}` : '', nb.e ? `${nb.e} épissure${nb.e > 1 ? 's' : ''}` : ''].filter(Boolean).join(' + ');
      const type = nomSplit !== null ? `Coupleur (${fmt(nomSplit, 1)} dB nominal)${comp ? ' + ' + comp : ''}` : (comp || (a.reflective ? 'Événement réflectif' : 'Événement non réflectif'));
      const ok = moy !== null && moy <= max + 1e-9;
      return { net: a.net, aller: a.loss, retour: b ? b.loss : null, moy, type, seuil: `≤ ${fmt(max, 2)} dB`, max, ok: moy === null ? null : ok, label: a.label };
    });
    return { rows, longueur: aller.netLen, totalAller: aller.totalLoss, totalRetour: retour.totalLoss, conforme: rows.every(r => r.ok !== false) && rows.every(r => r.ok !== null) };
  }

  global.OptiPhysics = {
    ATTENUATION, SPLITTER_LOSS, JOINTS, FAULTS, CABLES, CATALOG, CONNECTORS, CATEGORIES, TERMINALS,
    PROFILES, GPON_DOWN, GPON_UP, ACCESS_MODES, autoSerial,
    REF_SENSITIVITY, REF_OVERLOAD, WEAK_MARGIN, VFL_RANGE, ETH_MAX, BLD_HEADER,
    connectorFamily, connectorColor, connectorFormat, bendLoss, faultLoss,
    mduLevels, floorLabel, buildingRect, isRoom, ROOM_COLORS, deviceSize, portPos, assignParents, DEV_W, portsOf, fmt, fmtLen, attFor, classify,
    Engine, otdrShot, otdrBidir, vflInject, RECETTE_SEUILS, recetteVerdict, recetteRows
  };
})(typeof window !== 'undefined' ? window : globalThis);
