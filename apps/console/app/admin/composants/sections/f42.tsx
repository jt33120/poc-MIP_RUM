// Vitrine — F42 : le hero « À regarder d'abord » et la table « Toutes les
// sessions » de `/sessions` (plan § 4.3, § 5.11.4). Données FIXES écrites ici,
// passées par les mêmes fonctions pures que l'écran (`ordonnerPrioritaires`,
// `hrefsPriorite`) : aucune lecture en base.
//
// CE QUE CETTE SECTION EXISTE POUR MONTRER — les deux mondes, côte à côte :
//   - AVEC B30 : le hero classé, ses raisons écrites, ▶ présent / absent / non lu,
//     et la table avec ses colonnes Frustration et Rejeu renseignées ;
//   - SANS B30 (ce que l'écran rend aujourd'hui) : le hero en état `partiel`, et
//     la table dont les deux colonnes disent « — » avec leur raison, jamais « 0 ».
//
// Fichier propre au lot (les lots d'une même vague ajoutent chacun le leur) : la
// page n'en porte que l'import et une ligne de rendu.
import { Figure } from "@/components/charts/Figure";
import { PrioriteSessions, alternativePriorite } from "@/components/sessions/PrioriteSessions";
import { SessionsTable } from "@/components/sessions/SessionsTable";
import type { SessionRow } from "@/lib/queries";
import {
  RAISON_PRIORITE,
  hrefsPriorite,
  ordonnerPrioritaires,
  type LigneSessions,
  type SessionPrioritaire,
} from "@/lib/sessions-priorite";

const PLAGE = "24 dernières heures";
const T0 = Date.UTC(2026, 8, 21, 14, 0, 0);

function session(n: number, o: Partial<SessionRow> = {}): SessionRow {
  const debut = new Date(T0 - n * 3_600_000);
  return {
    session_id: `f42vitrine${n}00000000`,
    app_id: "vitrine",
    device_type: "desktop",
    geo_country: "FR",
    geo_source: "ip",
    user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0",
    started_at: debut,
    last_seen_at: new Date(debut.getTime() + 8 * 60_000),
    page_count: 3,
    routes: ["/", "/produit/[id]", "/panier"],
    err_count: 0,
    collection_source: "sdk",
    cursor_ts: debut.toISOString(),
    browser: "Chrome",
    os: "Windows",
    ...o,
  };
}

/** Quatre lignes qui départagent les quatre critères, dans le désordre exprès. */
const PRIORITAIRES: SessionPrioritaire[] = [
  {
    ...session(2, { err_count: 1, device_type: "mobile", geo_country: null }),
    frustration: 4,
    api_echecs: 0,
    premiere_erreur_ts: new Date(T0 - 2 * 3_600_000 + 120_000).toISOString(),
    rejeu: true,
    raison: {
      erreurs: [{ type: "RangeError", occurrences: 1 }],
      frustration: [{ kind: "rage", cible: "Payer", n: 4 }],
      api: [],
    },
  },
  {
    ...session(1, { err_count: 3, browser: null, user_agent: "Mozilla/5.0 Firefox/130.0", os: null }),
    frustration: 2,
    api_echecs: 1,
    premiere_erreur_ts: new Date(T0 - 3_600_000 + 45_000).toISOString(),
    rejeu: true,
    raison: {
      erreurs: [{ type: "TypeError", occurrences: 3 }],
      frustration: [{ kind: "dead", cible: "Valider", n: 2 }],
      api: [{ methode: "POST", chemin: "/api/panier", statut: 500 }],
    },
  },
  {
    ...session(4, { err_count: 1, collection_source: "extension" }),
    frustration: 4,
    api_echecs: 2,
    premiere_erreur_ts: null,
    rejeu: false,
    raison: {
      erreurs: [{ type: "TypeError", occurrences: 1 }],
      frustration: [{ kind: "error", cible: "", n: 4 }],
      api: [{ methode: "GET", chemin: "/api/stock", statut: null }],
    },
  },
  {
    ...session(6, { err_count: 0, routes: ["/"] }),
    frustration: 1,
    api_echecs: 0,
    premiere_erreur_ts: null,
    rejeu: null,
    raison: { erreurs: [], frustration: [{ kind: "rage", cible: "Filtrer", n: 1 }], api: [] },
  },
];

const CLASSEES = ordonnerPrioritaires(PRIORITAIRES);
const PAGES = Object.fromEntries(CLASSEES.map((s) => [s.session_id, `/sessions/${s.session_id}?app=vitrine`]));

/** Deux lignes de table : l'une avec les signaux de B30, l'autre sans lecture. */
const AVEC_B30: LigneSessions[] = [
  { ...session(1, { err_count: 3 }), frustration: 2, rejeu: true },
  { ...session(3, { err_count: 0, geo_country: null, collection_source: "extension" }), frustration: 0, rejeu: false },
];
const SANS_B30: LigneSessions[] = [
  { ...session(1, { err_count: 3, browser: null, user_agent: "Mozilla/5.0 Firefox/130.0" }), frustration: null, rejeu: null },
  { ...session(3, { err_count: 0, os: null }), frustration: null, rejeu: null },
];
const LIENS = (l: LigneSessions[]) => Object.fromEntries(l.map((s) => [s.session_id, `/sessions/${s.session_id}?app=vitrine`]));

export function SectionF42() {
  return (
    <section id="sessions-priorite" className="mb-10 min-w-0" aria-labelledby="sessions-priorite-titre">
      <h2 id="sessions-priorite-titre" className="text-base font-semibold text-ink">
        PrioriteSessions et SessionsTable
      </h2>
      <p className="mb-4 mt-1 text-sm text-ink-soft">
        Ordre : occurrences d&apos;erreur, puis signaux de frustration, puis appels API en échec, puis dernière
        activité. ▶ présent (rejeu lu), absent (lu et sans rejeu), « ▶ — » (existence non lue). Frustration et
        Rejeu non lus se disent « — », jamais « 0 ».
      </p>
      <div className="flex flex-col gap-4">
        <Figure
          titre="À regarder d'abord"
          id="vitrine-priorite"
          meta={
            <>
              <span>4 sessions sur 10 au plus</span>
              <span>{PLAGE}</span>
            </>
          }
          alternative={alternativePriorite(CLASSEES, PLAGE)}
        >
          <PrioriteSessions lignes={CLASSEES} hrefs={hrefsPriorite(CLASSEES, PAGES)} plage={PLAGE} />
        </Figure>

        <Figure titre="À regarder d'abord — sans classement (B30 absent)" id="vitrine-priorite-partiel" etat={{ kind: "partiel", raison: RAISON_PRIORITE }} />

        <Figure titre="À regarder d'abord — aucune session à signal" id="vitrine-priorite-vide">
          <PrioriteSessions lignes={[]} hrefs={{}} plage={PLAGE} />
        </Figure>

        <div className="card min-w-0 p-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Toutes les sessions — signaux lus (B30)
          </h3>
          <SessionsTable
            lignes={AVEC_B30}
            panelHrefs={{}}
            pageHrefs={LIENS(AVEC_B30)}
            rejeuHrefs={Object.fromEntries(AVEC_B30.map((s) => [s.session_id, `/sessions/${s.session_id}?app=vitrine&tab=replay`]))}
            suivantHref="/sessions?app=vitrine&cursor=exemple"
            vide="Aucune session sur les 24 dernières heures"
          />
        </div>

        <div className="card min-w-0 p-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Toutes les sessions — signaux non lus (B30 absent)
          </h3>
          <SessionsTable
            lignes={SANS_B30}
            panelHrefs={{}}
            pageHrefs={LIENS(SANS_B30)}
            suivantHref={null}
            debutHref="/sessions?app=vitrine"
            vide="Aucune session sur les 24 dernières heures"
          />
        </div>
      </div>
    </section>
  );
}
