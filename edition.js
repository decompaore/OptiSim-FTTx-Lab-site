/* =====================================================================
 * OptiSim FTTx Lab — edition.js
 * Auteur : Hassami COMPAORE
 * Version de l'application : 'enseignant' (dépôt, complète) ou 'eleve'.
 * Le script outils/paquets.js écrit 'eleve' dans le paquet élève.
 * ===================================================================== */
(function (global) {
  'use strict';
  // Auteur et contact : signature de toute la documentation générée
  const auteur = { nom: 'Hassami COMPAORE', email: 'decompaore@gmail.com', tel: '+226 79 00 03 04' };
  auteur.signature = `${auteur.nom} · ${auteur.email} · Tél. / WhatsApp : ${auteur.tel}`;
  // Numéro de version (NOTES-DE-VERSION.md, étiquette git vX.Y.Z)
  const numero = '1.0.0';
  global.OptiEdition = { role: 'eleve', numero, auteur };
})(typeof window !== 'undefined' ? window : globalThis);
