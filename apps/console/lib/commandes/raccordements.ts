// CE QUI RACCORDE UNE APPLICATION AU RESTE (C9) — jetons de lecture, jetons de CI
// des source maps, connecteurs de tickets, domaines de l'extension navigateur,
// inventaire des postes, recette d'une capacité mobile.
//
// Tout ce qui appartient à UNE application (un jeton, un connecteur, un domaine)
// revient à l'administrateur de cette application : portée `app`, et la ligne est
// relue DANS elle (`where id = $1 and app_id = $2`). Ce qui n'appartient à aucune —
// un poste de l'extension, qui en observe plusieurs ; la recette d'une capacité
// mobile, un constat d'opérateur sur le parc — revient à l'administrateur de la
// PLATEFORME.
//
// Un secret (jeton de lecture, jeton de CI) est généré ici, stocké haché, et RENDU
// UNE FOIS par la décision de la commande : jamais dans l'audit, jamais relu.
import { booleen, chaine, facultatif, nulle, objet, parmi } from "@mip/console-contract";
import { MOBILE_CAPABILITIES } from "@mip/backend/shared/mobile-capabilities.mjs";
import { tx } from "../db";
import { generateToken } from "../read-tokens";
import { allowOriginForApp, appDuDomaine, createExtensionScope, toggleExtensionScope } from "../queries-extension-scope";
import { forgetInstall } from "../queries-extension-installs";
import { createReadToken, revokeReadToken } from "../queries-read-tokens";
import { createSourcemapToken, parseTokenRequest, revokeSourcemapToken } from "../queries-sourcemap-tokens";
import { createTicketIntegration, parseIntegrationRequest, patchTicketIntegration } from "../queries-ticket-integrations";
import { commande, MOTIF_ENTIER } from "./commun";

const CHEMIN_ID = objet({ id: chaine({ max: 18, motif: MOTIF_ENTIER, description: "identifiant entier" }) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Jetons de lecture (API `/api/rum/summary`) ──────────────────────────────

export const creerJetonLecture = commande(
  { regle: { auth: "admin", portee: "app", audit: "read_token.create" }, corps: objet({ label: chaine({ min: 0, max: 200 }) }) },
  async ({ app, corps, auditer }) => {
    const jeton = generateToken();
    const label = corps.label.trim();
    await tx(async (c) => {
      await createReadToken(app!, label, jeton, c);
      await auditer(c, `${app} "${label || "-"}"`);
    });
    return { etat: "cree", app: app!, jeton } as const;
  },
);

export const revoquerJetonLecture = commande(
  { regle: { auth: "admin", portee: "app", audit: "read_token.revoke" }, chemin: CHEMIN_ID },
  async ({ app, chemin, auditer }) =>
    tx(async (c) => {
      const verdict = await revokeReadToken(Number(chemin.id), app!, c);
      if (verdict === "introuvable") return { etat: "introuvable" } as const;
      // Idempotent : l'audit n'est écrit qu'au passage effectif à « révoqué ».
      if (verdict === "revoque") await auditer(c, `id=${chemin.id}`);
      return { etat: "ok" } as const;
    }),
);

// ─── Jetons de CI des source maps (P5.4) ─────────────────────────────────────

export const creerJetonSourcemap = commande(
  {
    regle: { auth: "admin", portee: "app", audit: "sourcemap_token.create" },
    corps: objet({ name: chaine({ min: 0, max: 200 }), expiresInDays: facultatif(chaine({ max: 3, motif: /^[0-9]{1,3}$/ })) }),
  },
  async ({ principal, app, corps, auditer }) => {
    const demande = parseTokenRequest({
      appId: app,
      name: corps.name,
      ...(corps.expiresInDays === undefined ? {} : { expiresInDays: Number(corps.expiresInDays) }),
    });
    if (!demande.ok) return { etat: "refus", message: demande.error } as const;
    const cree = await createSourcemapToken(demande, principal.email, auditer);
    if (!cree) return { etat: "introuvable" } as const;
    return { etat: "cree", token: cree.token, secret: cree.secret } as const;
  },
);

export const revoquerJetonSourcemap = commande(
  {
    regle: { auth: "admin", portee: "app", audit: "sourcemap_token.revoke" },
    chemin: objet({ id: chaine({ max: 36, motif: UUID, description: "identifiant de jeton" }) }),
  },
  async ({ principal, app, chemin, auditer }) => {
    const jeton = await revokeSourcemapToken(chemin.id.toLowerCase(), principal.email, app, auditer);
    return jeton ? ({ etat: "ok", token: jeton } as const) : ({ etat: "introuvable" } as const);
  },
);

// ─── Connecteurs de tickets (P8.6) ───────────────────────────────────────────

/**
 * Le formulaire d'un connecteur : aucune donnée secrète n'y transite — une
 * RÉFÉRENCE (`env:TICKET_NOM` ou `enc:v1:…`), refusée si c'est un jeton collé.
 * La cible est saisie, jamais déduite.
 */
export const creerIntegration = commande(
  {
    regle: { auth: "admin", portee: "app", audit: "ticket_integration.create" },
    corps: objet({
      provider: chaine({ max: 40 }),
      target: chaine({ min: 0, max: 400 }),
      credentialRef: chaine({ min: 0, max: 400 }),
      webhookSecretRef: facultatif(chaine({ max: 400 })),
      mapClosed: facultatif(chaine({ max: 40 })),
      mapReopened: facultatif(chaine({ max: 40 })),
    }),
  },
  async ({ principal, app, corps, auditer }) => {
    const demande = parseIntegrationRequest({
      app,
      provider: corps.provider.trim(),
      target: corps.target.trim(),
      credentialRef: corps.credentialRef.trim(),
      webhookSecretRef: corps.webhookSecretRef?.trim() || null,
      statusMapping: { closed: corps.mapClosed || null, reopened: corps.mapReopened || null },
    });
    if (!demande.ok) return { etat: "refus", message: demande.error } as const;
    try {
      const cree = await createTicketIntegration(demande.value, principal.email, auditer);
      return cree ? ({ etat: "cree", id: cree.id } as const) : ({ etat: "refus", message: `application inconnue : ${app}` } as const);
    } catch (err) {
      if (String((err as { code?: string })?.code) === "23505") {
        return { etat: "refus", message: "cette cible est déjà configurée pour cette application" } as const;
      }
      throw err;
    }
  },
);

/** Activer, marquer la recette jouée, sortir de `degraded` : un champ à la fois, jamais l'inverse de `degraded`. */
export const majIntegration = commande(
  {
    regle: { auth: "admin", portee: "app", audit: "ticket_integration.update" },
    chemin: CHEMIN_ID,
    corps: objet({ champ: parmi(["enabled", "verified", "state"] as const), valeur: booleen() }),
  },
  async ({ principal, app, chemin, corps, auditer }) => {
    const patch =
      corps.champ === "enabled" ? { enabled: corps.valeur } : corps.champ === "verified" ? { verified: corps.valeur } : ({ state: "active" } as const);
    const maj = await patchTicketIntegration(chemin.id, patch, principal.email, [app!], auditer);
    return maj ? ({ etat: "ok" } as const) : ({ etat: "introuvable" } as const);
  },
);

// ─── Domaines de l'extension navigateur (Ext-C) ──────────────────────────────

/** Un hostname saisi, sans protocole, chemin ni port. */
function domaineDe(brut: string): string {
  return brut.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
}

/**
 * Rattache un domaine à l'application, et autorise son origine HTTPS à poster vers
 * l'ingestion (CORS) — sans elle, le préflight bloquerait la collecte. Un domaine
 * déjà rattaché à une AUTRE application n'est pas repris ici : il appartient à son
 * administrateur (avant C9, l'enregistrement le déplaçait sans rien vérifier).
 */
export const creerDomaineExtension = commande(
  {
    regle: { auth: "admin", portee: "app", audit: "extension_scope.create" },
    corps: objet({ domain: chaine({ min: 0, max: 253 }) }),
  },
  async ({ principal, app, corps, auditer }) => {
    const domaine = domaineDe(corps.domain);
    if (!domaine || !/^[a-z0-9.-]+$/.test(domaine)) return { etat: "refus", message: "domaine invalide" } as const;
    return tx(async (c) => {
      const actuelle = await appDuDomaine(domaine, c);
      if (actuelle !== null && actuelle !== app && principal.apps !== null && !principal.apps.includes(actuelle)) {
        return { etat: "refus", message: "ce domaine est rattaché à une application hors de votre périmètre" } as const;
      }
      await createExtensionScope(domaine, app!, c);
      await allowOriginForApp(domaine, app!, c);
      await auditer(c, `${domaine} -> ${app} (+origine CORS)${actuelle && actuelle !== app ? ` (repris de ${actuelle})` : ""}`);
      return { etat: "ok" } as const;
    });
  },
);

export const activerDomaineExtension = commande(
  { regle: { auth: "admin", portee: "app", audit: "extension_scope.set_active" }, chemin: CHEMIN_ID, corps: objet({ active: booleen() }) },
  async ({ app, chemin, corps, auditer }) =>
    tx(async (c) => {
      if (!(await toggleExtensionScope(Number(chemin.id), app!, corps.active, c))) return { etat: "introuvable" } as const;
      await auditer(c, `id=${chemin.id} active=${corps.active}`);
      return { etat: "ok" } as const;
    }),
);

/**
 * Retire un poste de l'inventaire de l'extension. Rien ici ne pilote l'extension à
 * distance : le seul levier d'arrêt de la collecte reste le registre de domaines.
 */
export const oublierPoste = commande(
  {
    regle: { auth: "admin-plateforme", portee: "globale", audit: "extension_install.forget" },
    chemin: objet({ installId: chaine({ max: 36, motif: UUID, description: "identifiant de poste" }) }),
  },
  async ({ chemin, auditer }) =>
    tx(async (c) => {
      if (!(await forgetInstall(chemin.installId.toLowerCase(), c))) return { etat: "introuvable" } as const;
      await auditer(c, chemin.installId);
      return { etat: "ok" } as const;
    }),
);

// ─── Recette d'une capacité mobile (R5, P7.5) ────────────────────────────────

/**
 * Pose la RECETTE d'une capacité mobile déclarée : un signal réellement reçu, lu
 * et affiché sur un appareil (`verified_at`). Aucun chemin d'ingestion n'écrit
 * cette colonne — un booléen client ne vaut pas un test passé. Avant C9, elle se
 * posait par un `update` direct, sans contrôle de droits : c'est maintenant une
 * commande de l'administrateur de la plateforme, auditée. Seule une capacité
 * DÉCLARÉE active se recette.
 */
export const validerCapaciteMobile = commande(
  {
    regle: { auth: "admin-plateforme", portee: "globale", audit: "mobile_capability.verify" },
    corps: objet({
      app_id: chaine({ max: 128 }),
      runtime: chaine({ max: 40 }),
      release: nulle(chaine({ max: 120 })),
      capability: parmi(MOBILE_CAPABILITIES as readonly string[]),
      note: chaine({ min: 0, max: 1000 }),
    }),
  },
  async ({ principal, corps, auditer }) =>
    tx(async (c) => {
      const { rowCount } = await c.query(
        `update mobile_capabilities
            set verified_at = now(), verified_by = $5, verified_note = nullif($6, '')
          where app_id = $1 and runtime = $2 and release is not distinct from $3 and capability = $4 and declared`,
        [corps.app_id, corps.runtime, corps.release, corps.capability, principal.email, corps.note.trim()],
      );
      if (!rowCount) return { etat: "introuvable" } as const;
      await auditer(c, JSON.stringify({ runtime: corps.runtime, release: corps.release, capability: corps.capability }), corps.app_id);
      return { etat: "ok" } as const;
    }),
);
