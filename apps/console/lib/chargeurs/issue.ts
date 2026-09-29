// LE CHARGEUR DU DÉTAIL D'UNE ISSUE (C4) — `app/errors/issues/[id]/page.tsx`.
//
// L'identifiant fait foi : une issue hors du périmètre est introuvable ; une URL
// qui porte une autre app que celle de l'issue est ramenée à la sienne (la page
// redirige, filtres conservés, curseur abandonné). Puis, comme sur la page d'un
// groupe, chaque lecture est une section (§ 3.8).
//
// CE QUI DÉPEND DU RÔLE est décidé ICI, par le principal (relu en base dans
// console-api) : les adresses des comptes (acteurs, assignés) et le contexte de
// code de la pile ne sont lus que pour un administrateur hors démo.
import type { PartGroupe } from "@/components/errors/DetailErreur";
import { issueWorkflowView, listIssueActivity } from "../error-issue-workflow";
import { isIssueId, issueDetail, resolveIssue } from "../error-issues";
import { errorSearchParams } from "../error-view";
import { analyserFiltres } from "../filtres-ecran";
import { listDeploys } from "../queries-deploys";
import { errorScopeFor, parseErrorCursor, parseOccurrencesPage, partSessionsTouchees, releasesDeLIssue, scopeApps } from "../queries-errors";
import { UnsupportedFilterError } from "../query-compiler";
import { section, type Chargeur } from "./commun";
import { lirePileErreur } from "./pile-erreur";

export const chargerIssue = (async (principal, sp, { id = "" }) => {
  if (!isIssueId(id)) return { etat: "introuvable" } as const;
  const ecran = await analyserFiltres(principal, sp, `/errors/issues/${id}`);
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.deviceFilters;
  const { label, bucketLabel, query } = ecran;
  const url = errorSearchParams(sp);
  const cursor = parseErrorCursor(url.get("cursor"));
  const apps = scopeApps(errorScopeFor(principal));

  const issue = await resolveIssue(id, apps);
  if (!issue) return { etat: "introuvable" } as const;
  // L'identifiant fait foi : une URL portant une autre app est ramenée à celle de l'issue.
  if (f.app !== issue.app_id) return { etat: "autre_app", issue, f } as const;
  if (cursor === undefined) return { etat: "curseur_invalide", issue, f } as const;

  const admin = principal?.role === "admin" && !principal.demo;
  // La part divise par des sessions avec VUE : un filtre que les pages vues ne
  // portent pas (`service`) la refuse — un refus de contrat pour CETTE phrase (V10).
  const [detail, part, deploys, versions] = await Promise.all([
    issueDetail(issue, f, { limit: parseOccurrencesPage(url).limit, cursor }),
    section<PartGroupe>(async () => {
      try {
        return { lu: await partSessionsTouchees(f, { app_id: issue.app_id, issue_id: issue.id }) };
      } catch (e) {
        if (e instanceof UnsupportedFilterError) return { refus: e.message };
        throw e;
      }
    }),
    section(() => listDeploys({ ...ecran.filters, app: issue.app_id }, 20)),
    // Toutes les releases de l'issue, de la plus récente à la plus ancienne (recette du
    // 26/09/2026 : première et dernière occurrence dans le temps ne disaient rien de
    // la release la plus récente touchée).
    section(() =>
      releasesDeLIssue({ app_id: issue.app_id, issue_id: issue.id, first_release: issue.first_release, first_seen: issue.first_seen }),
    ),
  ]);
  // Workflow P5.6 : null avant migration-v73. Un curseur d'historique illisible rend la page la plus récente.
  // Les adresses des comptes (acteurs, assignés) ne sont lues que pour un admin.
  const activiteCurseur = parseErrorCursor(url.get("activite")) ?? null;
  const [workflow, pile] = await Promise.all([
    issueWorkflowView(issue.id, issue.app_id, { emails: admin }),
    lirePileErreur(issue.app_id, detail.last_sample, admin),
  ]);
  const activite = workflow
    ? await listIssueActivity(issue.id, apps, { limit: 20, cursor: activiteCurseur }, { emails: admin })
    : null;

  return {
    etat: "ok",
    f,
    issue,
    label,
    bucketLabel,
    query,
    cursor,
    detail,
    part,
    deploys,
    versions,
    admin,
    workflow,
    activite,
    activiteCurseur,
    pile,
  } as const;
}) satisfies Chargeur<unknown>;
