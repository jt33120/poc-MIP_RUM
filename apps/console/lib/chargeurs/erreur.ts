// LE CHARGEUR DU DÉTAIL D'UN GROUPE D'ERREURS (C4) — `app/errors/[fingerprint]/page.tsx`.
//
// Une empreinte n'identifie pas un groupe : deux apps peuvent la partager. Le
// chargeur RÉSOUT d'abord (l'app demandée, puis le périmètre signé), et rend une
// décision que la page exécute — il ne redirige ni ne rend rien lui-même :
//   · `introuvable`       → 404 ;
//   · `curseur_invalide`  → le curseur ne vient pas de cette console ;
//   · `issue`             → une issue reprend seule ce groupe (P5.5) : la page redirige ;
//   · `choix_issues`      → plusieurs issues le reprennent : on fait choisir ;
//   · `choix_app`         → plusieurs apps, ou absente de l'app demandée : on fait choisir ;
//   · `ok`                → le détail et ses sections.
// Le détail historique reste à `legacy=1`, même quand des issues le reprennent.
import type { PartGroupe } from "@/components/errors/DetailErreur";
import { legacyIssueTargets } from "../error-issues";
import { errorSearchParams } from "../error-view";
import { analyserFiltres } from "../filtres-ecran";
import { fmtDate } from "../format";
import { listDeploys } from "../queries-deploys";
import {
  errorGroupDetail,
  errorScopeFor,
  isFingerprintParam,
  parseErrorCursor,
  parseOccurrencesPage,
  partSessionsTouchees,
  releasesDuGroupe,
  resolveErrorGroup,
  scopeApps,
  type ErrorFilters,
  type ErrorGroupRef,
} from "../queries-errors";
import { UnsupportedFilterError } from "../query-compiler";
import { authorizedScope } from "../query-contract";
import { section, type Chargeur } from "./commun";
import { lirePileErreur } from "./pile-erreur";

/** `fingerprint` : l'empreinte DÉCODÉE (la page décode le segment d'URL, le routeur du service aussi). */
export const chargerErreur = (async (principal, sp, { fingerprint = "" }) => {
  if (!isFingerprintParam(fingerprint)) return { etat: "introuvable" } as const;
  const ecran = await analyserFiltres(principal, sp, `/errors/${encodeURIComponent(fingerprint)}`);
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.deviceFilters;
  const { label, bucketLabel, query } = ecran;
  const url = errorSearchParams(sp);
  const historique = url.get("legacy") === "1";
  const cursor = parseErrorCursor(url.get("cursor"));
  if (cursor === undefined) return { etat: "curseur_invalide", f } as const;

  // ANCIENNES URL (P5.5). Quand le regroupement v2 est actif pour l'app, une issue
  // qui reprend seule ce groupe prend le relais ; plusieurs issues se choisissent
  // explicitement. Avec une app nommée, avant toute lecture de la fenêtre : une
  // issue dont le bug se tait garde son URL.
  const relais = async (groupe: ErrorGroupRef) => {
    if (historique) return null;
    const issues = await legacyIssueTargets(groupe);
    if (issues?.length === 1) return { etat: "issue", issue: { id: issues[0].id, app_id: groupe.app_id }, f } as const;
    return issues && issues.length > 1 ? ({ etat: "choix_issues", groupe, issues, f } as const) : null;
  };
  if (f.app) {
    const choix = await relais({ app_id: f.app, fingerprint });
    if (choix) return choix;
  }

  // RÉSOLUTION : l'app demandée d'abord ; sinon (« all », ou absente de l'app
  // demandée sur cette fenêtre) le périmètre signé ; plusieurs candidates → choisir.
  const explicite = f.app ? await resolveErrorGroup(fingerprint, f, null) : null;
  let ref: ErrorGroupRef;
  if (explicite?.kind === "found") {
    ref = explicite.ref;
  } else {
    const recherche = await resolveErrorGroup(
      fingerprint,
      { ...f, app: null, query: authorizedScope(query) },
      scopeApps(errorScopeFor(principal)),
    );
    if (recherche.kind === "not_found") return { etat: "introuvable" } as const;
    if (recherche.kind === "ambiguous" || f.app) {
      const choices =
        recherche.kind === "ambiguous"
          ? recherche.candidates.map((c) => ({
              app_id: c.app_id,
              detail: `${c.occurrences.toLocaleString("fr-FR")} occurrence(s) · dernière vue ${fmtDate(c.last_seen)}`,
            }))
          : [{ app_id: recherche.ref.app_id, detail: null }];
      return { etat: "choix_app", fingerprint, f, absentFrom: f.app, choices } as const;
    }
    ref = recherche.ref;
  }

  // Groupe trouvé dans une autre app que celle de l'URL : ses issues, s'il en a.
  if (ref.app_id !== f.app) {
    const choix = await relais(ref);
    if (choix) return choix;
  }

  const detail = await errorGroupDetail(ref, { ...f, app: ref.app_id }, { limit: parseOccurrencesPage(url).limit, cursor });
  // Résolue puis disparue entre les deux lectures (rétention, purge) : introuvable.
  if (!detail) return { etat: "introuvable" } as const;
  const fGroupe: ErrorFilters = { ...f, app: ref.app_id };
  const admin = principal?.role === "admin" && !principal.demo;

  // CHAQUE LECTURE EST INDÉPENDANTE (§ 3.8) : la part, les versions et les
  // déploiements sont trois sections. La part divise par des sessions avec VUE : un
  // filtre que les pages vues ne portent pas (`service`) la refuse — un refus de
  // contrat pour CETTE phrase, pas une panne de l'écran (V10).
  const [part, releases, deploys, pile] = await Promise.all([
    section<PartGroupe>(async () => {
      try {
        return { lu: await partSessionsTouchees(fGroupe, ref) };
      } catch (e) {
        if (e instanceof UnsupportedFilterError) return { refus: e.message };
        throw e;
      }
    }),
    section(() => releasesDuGroupe(ref, fGroupe)),
    section(() => listDeploys({ ...ecran.filters, app: ref.app_id }, 20)),
    // La pile du dernier exemplaire ; le contexte de code, à l'administrateur hors démo.
    lirePileErreur(detail.group.app_id, detail.last, admin),
  ]);

  return { etat: "ok", f, ref, label, bucketLabel, query, cursor, historique, detail, part, releases, deploys, pile, lectureSeule: !admin } as const;
}) satisfies Chargeur<unknown>;
