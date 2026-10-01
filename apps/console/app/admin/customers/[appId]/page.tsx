import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { CopyBlock } from "@/components/CopyBlock";
import { InfoTip } from "@/components/InfoTip";
import { entreGuillemets } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { FormulaireSecret, SecretAffiche, SecretFourni } from "@/components/secret/SecretUnique";
import { BackendStep } from "@/components/wizard/BackendStep";
import { WizardBadge } from "@/components/wizard/WizardStep";
import { chargerClient } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { ingestEndpoint, voieRecommandee } from "@/lib/ingest-endpoint";
import { buildSnippet, deriveStatus } from "@/lib/onboarding";
import { recettesAgentsOtel } from "@/lib/recettes-agents-otel";
import { fmtDate } from "@/lib/format";
import { cleDe } from "@/lib/secret-remis";
import { BOUTON_LIGNE_DANGER, Erreur, LIBELLE_CHAMP, Panneau, Pastille } from "../../_ui/kit";
import { rotateKeyAction, updateOriginsAction } from "../actions";

export const dynamic = "force-dynamic";

// Refonte du 01/10/2026 (grammaire `app/admin/_ui`) : la fiche n'est plus un guide en
// cinq étapes de dix paragraphes. Le guide complet — placement selon la pile, CSP,
// consentement, injection sans toucher au code, recettes serveur — est `/installer`,
// lisible par l'équipe du client ; la fiche garde ce que seul l'administrateur fait
// (domaines, clé), l'état de l'intégration, le code à copier, et y renvoie. Chaque
// explication passe dans la bulle « ? » de son panneau.

const LIEN = "font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

/** Fiche d'une application cliente : sa configuration, l'arrivée de ses données, son code de suivi. */
export default async function CustomerWizard({
  params,
  searchParams,
}: {
  params: Promise<{ appId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { appId } = await params;
  // Le refus de « Mettre à jour » (domaine invalide) revenait ici sans être dit.
  const erreurDomaines = (await searchParams).error === "origin";
  // Le chargeur (`lib/chargeurs/administration.ts`) : l'application et sa sonde
  // d'intégration — hors du périmètre de l'administrateur, introuvable (C9).
  const ecran = accesAdmin(await chargerEcran(ECRANS_ADMIN.client, chargerClient, {}, { appId }));
  if (ecran.etat === "introuvable") notFound();
  const { client: customer, sonde: probe } = ecran;
  const status = deriveStatus(probe);

  // URLs réelles : ingestion via env (prod), SDK servi par cette console
  const host = (await headers()).get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const sdkUrl = `${proto}://${host}/mip-rum.js`;
  // Collecte directe (P6b.G) : dès que sa variable est posée, le code proposé PAR
  // DÉFAUT vise le collecteur (le pays vient de l'adresse IP), et celui par la
  // console reste à côté pour un site dont la CSP fige `connect-src`. Sans elle,
  // `voie` vaut « console » et rien ne change.
  const voie = voieRecommandee();
  const endpoint = ingestEndpoint("traces", host, voie);
  const endpointConsole = ingestEndpoint("traces", host);

  // Le code de suivi porte le REPÈRE de la clé, jamais la clé remise : il se recopie
  // dans un ticket, un courriel, un dépôt. La clé, affichée une fois en tête, se colle
  // à la main.
  const snippet = buildSnippet({
    sdkUrl,
    endpoint,
    appId,
    clientId: customer.client_id,
    withConsent: false,
    voie,
  });
  const snippetConsole =
    voie === "directe"
      ? buildSnippet({ sdkUrl, endpoint: endpointConsole, appId, clientId: customer.client_id, withConsent: false })
      : null;

  // Recettes serveur (tracing navigateur → serveur) : les agents OpenTelemetry
  // officiels, préremplis avec l'app_id et les adresses complètes de collecte.
  // TOUJOURS par la console : l'adresse d'un serveur ne dit rien du pays d'un
  // visiteur, et la collecte directe n'a d'objet que pour un navigateur.
  const recettesServeur = recettesAgentsOtel({
    appId,
    adresses: { traces: endpointConsole, logs: ingestEndpoint("logs", host) },
  });

  const installer = `/installer?app=${encodeURIComponent(appId)}`;
  const parApp = (chemin: string) => `${chemin}?app=${encodeURIComponent(appId)}`;
  const verifications = [
    { cle: "snippet", libelle: "Premières Web Vitals", detail: "code de suivi posé", etat: status.snippet, valeur: probe.first_metric_at ? fmtDate(probe.first_metric_at) : "en attente" },
    { cle: "trafic", libelle: "Sessions sur 24 h", detail: "trafic récent", etat: status.traffic, valeur: probe.sessions_24h ? probe.sessions_24h.toLocaleString("fr-FR") : "aucune" },
    { cle: "front", libelle: "Appels d'API suivis", detail: "depuis le navigateur", etat: status.tracingFront, valeur: probe.first_front_span_at ? fmtDate(probe.first_front_span_at) : "en attente" },
    { cle: "back", libelle: "Temps serveur reçus", detail: "serveur branché", etat: status.tracingBack, valeur: probe.first_back_span_at ? fmtDate(probe.first_back_span_at) : "en attente" },
  ] as const;
  const faites = verifications.filter((v) => v.etat === "done").length;

  // Jetons du thème partout (recette du 26/09/2026) : les `bg-white` / `slate` /
  // `blue` écrits en dur rendaient le champ des domaines illisible en sombre.
  // `SecretFourni` : la clé remise est lue UNE fois pour tout l'écran — le bandeau
  // et les recettes serveur, qui la portent à la place de leur repère. Sans lui, le
  // premier composant à la lire la retirerait aux autres.
  return (
    <SecretFourni nom={cleDe(appId)}>
      <div className="min-w-0 animate-fade-up">
        <PageHeader title={customer.name}>
          <span data-testid="live-badge">
            <Pastille ton={status.live ? "bon" : "attention"}>{status.live ? "Données reçues" : "Intégration en cours"}</Pastille>
          </span>
          {/* La même installation, écrite pour l'équipe du client et lisible par elle
              (cette fiche est réservée aux administrateurs). */}
          <Link href={installer} className="btn-ghost" data-testid="lien-installer" title="Guide d'installation pour le client : pile, CSP, consentement, extension, serveur">
            Guide d&apos;installation →
          </Link>
          {/* Donner un accès au client : un compte en lecture seule, limité à cette
              application — tableaux de bord, sessions, erreurs, traces, rien d'autre. */}
          <Link
            href={`/admin/users?app=${encodeURIComponent(appId)}`}
            className="btn-ghost"
            title={`Un compte en lecture seule, limité à ${appId}, n'en voit que les données : tableaux de bord, sessions, erreurs, traces — rien d'autre.`}
          >
            Compte en lecture seule →
          </Link>
        </PageHeader>

        {/* L'identité de l'application, sur une ligne (l'ancien sous-titre). */}
        <p className="-mt-3 mb-4 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-soft" data-testid="fiche-identite">
          <code className="chip-mono">{appId}</code>
          {customer.client_id && <span>client {customer.client_id}</span>}
          <span>
            créée le {fmtDate(customer.created_at)}
            {customer.created_by && <> par {customer.created_by}</>}
          </span>
          <Link href="/admin/customers" className={LIEN}>
            ← toutes les applications
          </Link>
        </p>

        {/* La clé d'API (création de l'application ou rotation) : rendue au formulaire
            par l'action, remise ici, affichée une seule fois (C9c). */}
        <SecretAffiche
          nom={cleDe(appId)}
          testid="one-time-key"
          testidValeur="generated-key"
          className="mb-4 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn-ink"
          codeClassName="break-all rounded bg-panel px-2 py-0.5 font-mono text-ink"
          prefixe="Clé d'API de"
          suffixe="(affichée une seule fois : copiez-la maintenant dans le code de suivi et la configuration du site) :"
        />

        {erreurDomaines && (
          <Erreur>
            Domaines non enregistrés : chacun doit être une adresse http(s) complète (ex. https://app.exemple.fr), et il en faut
            au moins un.
          </Erreur>
        )}

        <div className="mb-4 grid min-w-0 items-stretch gap-2 lg:grid-cols-2">
          <Panneau
            titre="Configuration"
            className="h-full"
            aide={
              <>
                Les domaines autorisés à envoyer des mesures : modifiables à tout moment, pris en compte en moins
                d&apos;une minute ; le navigateur bloque tout autre site (CORS). La clé d&apos;API identifie
                l&apos;application : depuis le 29/09/2026, la collecte refuse toute mesure sans clé. Régénérer la clé coupe
                aussitôt l&apos;ancienne, sur le site comme sur le serveur.
              </>
            }
          >
            <div className="grid gap-2 px-3 py-2.5">
              <form action={updateOriginsAction} className="flex min-w-0 flex-wrap items-end gap-2">
                <input type="hidden" name="app_id" value={appId} />
                <label className={`${LIBELLE_CHAMP} grow`}>
                  Domaines autorisés
                  <input
                    name="origins"
                    type="text"
                    defaultValue={customer.allowed_origins.join(", ")}
                    className="field block w-full py-1 font-mono text-xs"
                  />
                </label>
                <button type="submit" className="btn-ghost py-1.5 text-xs">
                  Mettre à jour
                </button>
              </form>
              {/* Régénérer invalide la clé posée chez le client : confirmé, et laissé
                  ici plutôt qu'en bas de page — la nouvelle clé s'affiche en tête. Sans
                  clé (intégration ancienne), en générer une part d'un clic. */}
              <FormulaireSecret action={rotateKeyAction} className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                <input type="hidden" name="app_id" value={appId} />
                <span className="text-[11px] font-medium text-ink-soft">Clé d&apos;API</span>
                {customer.has_key ? (
                  <>
                    <Pastille ton="bon">posée</Pastille>
                    <ConfirmationDanger
                      libelle="Régénérer la clé d’API"
                      question={`Régénérer la clé d’API de ${entreGuillemets(customer.name)} ?`}
                      consequence="L’ancienne clé cessera aussitôt de fonctionner : il faudra poser la nouvelle, affichée une seule fois, sur le site du client."
                      confirmer="Régénérer la clé"
                      enCours="Régénération…"
                      classeDeclencheur={BOUTON_LIGNE_DANGER}
                      testid="regenerer-cle"
                    />
                  </>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-2" data-testid="sans-cle">
                    <Pastille ton="mauvais">aucune</Pastille>
                    <span className="sr-only">Cette application n&apos;a pas encore de clé d&apos;API : le code de suivi en attend une.</span>
                    <button type="submit" className="btn-accent py-1 text-xs">
                      Générer une clé d&apos;API
                    </button>
                  </span>
                )}
              </FormulaireSecret>
            </div>
          </Panneau>

          <Panneau
            titre="Arrivée des données"
            compte={`${faites}/${verifications.length}`}
            className="h-full"
            aide={
              <>
                Relue à chaque rafraîchissement du direct (toutes les 5 secondes). Ouvrez le site du client dans un autre
                onglet : les lignes passent au vert à mesure que les données arrivent. Les temps serveur demandent le
                serveur branché (recettes ci-dessous).
              </>
            }
          >
            <ul className="divide-y divide-line/60" data-testid="onboarding-checklist">
              {verifications.map((v) => (
                <li key={v.cle} className="flex min-h-[2rem] min-w-0 items-center justify-between gap-3 px-3 py-1">
                  <span className="min-w-0 text-sm text-ink">
                    {v.libelle} <span className="text-[11px] text-ink-faint">· {v.detail}</span>
                  </span>
                  <WizardBadge state={v.etat}>{v.valeur}</WizardBadge>
                </li>
              ))}
            </ul>
            {status.live && (
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 border-t border-line px-3 py-1.5 text-xs text-good-ink">
                <span aria-hidden>✓</span>
                <span>Visible dans</span>
                <Link href={parApp("/")} className={LIEN}>Vue d&apos;ensemble</Link>
                <Link href={parApp("/sessions")} className={LIEN}>Sessions</Link>
                <Link href={parApp("/tracing")} className={LIEN}>Tracing</Link>
              </p>
            )}
          </Panneau>
        </div>

        <Panneau
          titre="Code de suivi · navigateur"
          className="mb-4"
          aide={
            <>
              Deux balises en tête du <code>&lt;head&gt;</code>, avant tout autre script : Web Vitals, erreurs, sessions et
              appels réseau sont ensuite mesurés sans autre code. Remplacez <code>COLLE_ICI_LA_CLE_API</code> par la clé ;
              sans clé, ou avec une clé fausse, chaque envoi est refusé (403). Posée dans la page, la clé est lisible par tout
              visiteur : elle identifie l&apos;application, elle ne protège rien.
              {snippetConsole && (
                <>
                  {" "}Ce code envoie directement au collecteur, qui déduit le pays de l&apos;adresse IP sans la conserver ; le
                  site doit alors autoriser <code>connect-src {new URL(endpoint).origin}</code> s&apos;il a une CSP.
                </>
              )}
            </>
          }
          actions={
            <Link href={`${installer}#snippet`} className={`${LIEN} text-xs`}>
              Next.js, CSP, consentement, sans toucher au code →
            </Link>
          }
        >
          <div className="grid min-w-0 gap-2 px-3 py-2.5">
            <CopyBlock code={snippet} />
            {snippetConsole && (
              <details className="min-w-0 text-xs" data-testid="voie-console">
                <summary className="cursor-pointer select-none font-medium text-ink-soft hover:text-ink">
                  CSP qui fige <code>connect-src</code> : le code par la console
                </summary>
                <div className="mt-2">
                  <CopyBlock code={snippetConsole} />
                </div>
              </details>
            )}
          </div>
        </Panneau>

        <Panneau
          titre="Serveur · facultatif"
          aide={
            <>
              Suivre un appel du navigateur jusqu&apos;au serveur. Rien à télécharger chez MIP : l&apos;agent OpenTelemetry
              officiel du langage du serveur, réglé par quelques variables d&apos;environnement. Sans cette étape, la mesure
              côté navigateur fonctionne déjà.
            </>
          }
          actions={
            <Link href={`${installer}#serveur`} className={`${LIEN} text-xs`}>
              Parcours serveur pas à pas →
            </Link>
          }
        >
          {/* Les recettes des agents, repliées : l'administrateur les ouvre pour les
              transmettre ; elles portent la clé remise à la place du repère. */}
          <details className="min-w-0 px-3 py-2 text-xs">
            <summary className="cursor-pointer select-none font-medium text-ink-soft hover:text-ink">
              Recettes des agents OpenTelemetry (Python, Node.js, Java, .NET, autres)
            </summary>
            <div className="mt-2">
              <BackendStep recettes={recettesServeur} nomSecret={cleDe(appId)} />
            </div>
          </details>
        </Panneau>
      </div>
    </SecretFourni>
  );
}
