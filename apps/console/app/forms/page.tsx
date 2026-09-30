// Formulaires (F51, plan § 5.15 ; sur le contrat depuis B31 → F53) — « Quels
// formulaires perdent leurs visiteurs, et sur quel champ ? »
//
// CE QUE L'ÉCRAN REFUSE D'AFFIRMER.
//   - Une fenêtre qui n'est pas la sienne : depuis B31, la lecture est celle du
//     contrat (`[from, to)`, apps effectives, tablette et « Inconnu » compris) ; la
//     méta de chaque figure écrit la plage lue.
//   - Un écart qui mesurerait le plafond : sous `cmp=prev`, une période (courante
//     ou précédente) qui atteint 5 000 événements ne se compare pas.
//   - Un classement par volume : les formulaires sont classés par ABANDONS
//     (gravité, P3), et un formulaire sous 30 entamés ne passe pas devant.
//   - Une moyenne de temps : la tuile porte la MÉDIANE du temps jusqu'à la
//     soumission (P7) ; l'ancienne moyenne mêlait soumissions et abandons.
//   - Un verdict coloré sur la conversion : aucun seuil publié n'existe pour une
//     conversion de formulaire (R-S, S6) — les paliers 0,6 / 0,3 ont disparu.
//   - Un ordre inventé pour les champs : ils sont rendus dans l'ORDRE MÉDIAN de
//     première interaction, parce que la question est « où ça décroche ».
//   - Une barre plus courte que ce qu'on pose dessus : chaque champ vaut ses
//     tentatives, découpées en « abandons ici » + « autres » (somme = tentatives).
//   - Un zéro pour une absence : sans événement `form.*`, les tuiles affichent
//     « — » et la raison — jamais 0 (V3).
//   - Une fonction non livrée : « Abandons dans le temps » attend B34 (la lecture ne
//     renvoie pas l'horodatage des événements). La carte n'est PAS rendue : un
//     bandeau « Partiel » qui ne montrait qu'une série à créer se lisait comme une
//     panne (recette du 26/09/2026).
//
// CE QUE LA RECETTE DU 26/09/2026 A CHANGÉ À L'AFFICHAGE, sans toucher aux chiffres :
//   - une seule couleur pour « abandon » sur tout l'écran (la série principale), et
//     une légende visible au-dessus de chaque graphique à barres ;
//   - les sous-libellés passent à la ligne au lieu d'être coupés, et « échantillon
//     faible » est une marque à part, qui ne disparaît plus dans une troncature ;
//   - le formulaire dont les champs sont affichés est mis en évidence, et l'écran dit
//     qu'un clic sur un autre formulaire affiche les siens ;
//   - une ligne chiffrée par tuile, la méthode derrière l'aide « ? » ; la population
//     (des tentatives, pas des sessions) et la remarque sur le SDK mobile ne sont
//     dites qu'une fois, dans la carte de définition.
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ECRANS } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { HeroReading } from "@/components/SupervisionHero";
import { Figure, MethodeRepliee as Methode } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RangeeKpi } from "@/components/charts/RangeeKpi";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import { EtatSurface } from "@/components/states/EtatSurface";
import { SectionErreur } from "@/components/states/SectionErreur";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { accord, fmtNombre, pluriel } from "@/lib/format";
import { MAX_CHAMPS_SDK, SEUIL_ECHANTILLON_FAIBLE, type FieldReport, type FormReportRow } from "@/lib/form-analytics";
import { chargerForms, PLAFOND_EVENEMENTS } from "@/lib/chargeurs/forms";
import { chargerEcran } from "@/lib/ecran";
import { couvertureDeTuile, gesteElargir, plafondAtteint, plageDansPhrase } from "@/lib/lecture-usages";
import { SERIE } from "@/lib/palette";
import { hrefWithQuery, previousRange } from "@/lib/query-contract";
import { referencePrecedente } from "@/lib/sessions-kpi";
import { ecartProportions } from "@mip/stats/incertitude";

export const dynamic = "force-dynamic";

/** Espace insécable, avant « : » dans les phrases construites ici. */
const NBSP = " ";

// UNE couleur pour « abandon » sur tout l'écran : la série principale de la palette
// (P15). Le rouge d'un verdict la remplaçait dans les champs alors que le classement
// était orange — deux couleurs pour un même sens (recette du 26/09/2026) ; un abandon
// n'est pas un verdict au regard d'un seuil publié. Le reste est neutre et suit le
// mode sombre (variable CSS).
const COULEUR_ABANDONS = SERIE.principale;
const COULEUR_AUTRES = "rgb(var(--c-ink-faint))";

const TEXTE_PLAFOND = `${formater(
  "count",
  PLAFOND_EVENEMENTS,
)} derniers événements seulement${NBSP}: les formulaires plus anciens de la période ne sont pas comptés`;

/**
 * R-F, vérifié pour F51 dans `packages/rum-mobile/src` : le SDK React Native
 * n'émet AUCUN événement `form.*` (aucune occurrence de `form.` dans ses sources).
 * L'écran ne peut donc pas lire de formulaire mobile — c'est dit, UNE fois (carte
 * de définition), plutôt que de laisser une absence passer pour un parcours sans
 * friction.
 */
const GARDE_MOBILE = `Le SDK React Native n'émet aucun événement de formulaire${NBSP}: une application mobile n'apparaît jamais ici, même si ses utilisateurs remplissent des formulaires.`;

const TEXTE_VIDE_LECTURE = `Le SDK navigateur suit les formulaires par défaut (option « forms » active)${NBSP}: sans aucun événement, soit aucun formulaire n'a été entamé sur la période, soit aucune page instrumentée n'en contient.`;

export default async function Forms({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/forms.ts`) lit les événements `form.*` et les RÉDUIT
  // en rapports (par formulaire, champ par champ pour le formulaire affiché) ; sous
  // `cmp=prev` (F06, F53), la période précédente et sa couverture.
  const ecran = await chargerEcran(ECRANS.forms, chargerForms, sp);
  if (ecran.etat === "refus") return <FilterProblemNotice title="Formulaires" problem={ecran.problem} />;
  const query = ecran.query;
  const { lecture, lecturePrev, echantillonnage, couvertures } = ecran;
  const fenetre = ecran.label;
  const dansPhrase = plageDansPhrase(query.range, fenetre);
  // La méta d'une figure : son effectif, puis la plage. La population (des
  // tentatives, pas des sessions) est dite une fois dans la carte de définition :
  // répétée sous chaque figure, elle noyait les chiffres (recette du 26/09/2026).
  const meta = (extra?: string) => (
    <>
      {extra && <span>{extra}</span>}
      <span>{fenetre}</span>
    </>
  );

  const forms = lecture.ok ? lecture.data.forms : [];
  // Le formulaire demandé peut avoir disparu de la fenêtre : le chargeur retombe sur
  // le premier du classement plutôt que d'afficher une liste de champs vide.
  const selectionne = lecture.ok ? (lecture.data.selectionne ?? undefined) : undefined;
  const champs = lecture.ok ? lecture.data.champs : null;
  const nombreLus = lecture.ok ? lecture.data.nombre : 0;
  const ligneSelectionnee = forms.find((r) => r.form === selectionne);

  const formHref = (nom: string) => hrefWithQuery("/forms", query, { form: nom });
  const elargir = gesteElargir("/forms", query, Date.now());

  const entames = forms.reduce((a, r) => a + r.starters, 0);
  const soumissions = forms.reduce((a, r) => a + r.submits, 0);
  const abandons = forms.reduce((a, r) => a + r.abandons, 0);
  const aucunEvenement = lecture.ok && nombreLus === 0;
  const raisonVide = `aucun formulaire entamé sur ${dansPhrase}`;
  const raisonEchec = "les données n'ont pas pu être chargées";
  const raisonNull = lecture.ok ? raisonVide : raisonEchec;

  // `cmp=prev` (F53) : la même lecture sur la période précédente. Un plafond de 5 000
  // événements atteint d'un côté ou de l'autre tait l'écart (il mesurerait le plafond).
  const precEvents = lecturePrev?.ok ? lecturePrev.data : null;
  const precForms = precEvents ? precEvents.forms : null;
  const precEntames = precForms ? precForms.reduce((a, r) => a + r.starters, 0) : null;
  const precSoumissions = precForms ? precForms.reduce((a, r) => a + r.submits, 0) : null;
  const plafonds = [
    { atteint: lecture.ok && plafondAtteint(nombreLus, PLAFOND_EVENEMENTS), raison: `plafond de ${formater("count", PLAFOND_EVENEMENTS)} événements atteint sur la période affichée` },
    { atteint: precEvents !== null && plafondAtteint(precEvents.nombre, PLAFOND_EVENEMENTS), raison: `plafond de ${formater("count", PLAFOND_EVENEMENTS)} événements atteint sur la période précédente` },
  ];
  // La couverture de la période précédente est LA MÊME pour les quatre tuiles (même
  // lecture, même effectif) : calculée une fois, elle est aussi ce que `RangeeKpi`
  // dit une seule fois au-dessus de la rangée quand elle est incomplète.
  const couverturePrecedente = lecturePrev
    ? couvertureDeTuile(
        lecturePrev.ok ? couvertures : [{ etat: "inconnue", raison: "la période précédente n'a pas pu être chargée" }],
        plafonds,
        precEntames,
      )
    : undefined;
  /** Props de comparaison d'une tuile ; rien hors `cmp=prev`. L'effectif précédent (entamés) porte l'échantillon faible. */
  const comparer = (precedent: number | null) =>
    lecturePrev
      ? {
          precedent: precEvents ? precedent : null,
          reference: referencePrecedente(previousRange(query.range)),
          couverturePrecedente,
        }
      : {};

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Formulaires"
        domain="usages"
        sub={`Quels formulaires perdent leurs visiteurs, et sur quel champ${NBSP}? Aucune valeur saisie n'est collectée.`}
      />

      {/* Fm2 — quatre tuiles sur une seule population : les tentatives. Une ligne
          chiffrée par tuile ; la méthode est derrière l'aide « ? » (`methode`). */}
      <SectionErreur titre="Chiffres clés">
        <RangeeKpi couvertures={[couverturePrecedente]} className="mb-6 grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiTile
            label="Formulaires entamés"
            valeur={entames > 0 ? entames : null}
            format="count"
            raisonNull={raisonNull}
            lecture={entames > 0 ? `${pluriel(soumissions, "soumission")} · ${pluriel(abandons, "abandon")}` : undefined}
            methode={`Une tentative entamée a touché au moins un champ${NBSP}; elle se termine par une soumission ou par un abandon. Un visiteur peut entamer plusieurs fois le même formulaire.`}
            {...comparer(precEntames)}
          />
          <KpiTile
            label="Soumissions"
            valeur={entames > 0 ? soumissions : null}
            format="count"
            raisonNull={raisonNull}
            methode="Tentatives terminées par l'envoi du formulaire (événement « submit » du navigateur)."
            {...comparer(precSoumissions)}
          />
          {/* Sans verdict coloré (S6, R-S) : aucun seuil publié n'existe pour une
              conversion de formulaire ; les paliers 0,6 / 0,3 n'avaient pas de source. */}
          <KpiTile
            label="Conversion"
            valeur={entames > 0 ? soumissions / entames : null}
            format="pct"
            raisonNull={raisonNull}
            couverture={{
              n: entames,
              unite: accord(entames, "formulaire entamé", "formulaires entamés"),
              faibleSous: SEUIL_ECHANTILLON_FAIBLE,
            }}
            methode={`Soumissions ÷ formulaires entamés. Aucun seuil publié n'existe pour la conversion d'un formulaire${NBSP}: le taux n'a pas de verdict coloré.`}
            {...comparer(precEntames ? (precSoumissions ?? 0) / precEntames : null)}
            ecart={
              precEntames && entames > 0 ? ecartProportions(soumissions, entames, precSoumissions ?? 0, precEntames) : undefined
            }
          />
          <KpiTile
            label="Temps médian jusqu'à la soumission"
            valeur={lecture.ok ? lecture.data.mediane : null}
            format="s-auto"
            raisonNull={
              !lecture.ok
                ? raisonEchec
                : soumissions > 0
                  ? "les soumissions n'ont pas transmis leur durée"
                  : `aucune soumission sur ${dansPhrase}`
            }
            couverture={{ n: soumissions, unite: accord(soumissions, "soumission"), faibleSous: SEUIL_ECHANTILLON_FAIBLE }}
            methode={`Médiane du temps total des soumissions, jamais une moyenne${NBSP}: un abandon rapide raccourcirait le temps de remplissage sans que personne n'aille plus vite.`}
            {...comparer(precEvents ? precEvents.mediane : null)}
          />
        </RangeeKpi>
      </SectionErreur>

      {/* Un plafond atteint rend les données PARTIELLES : c'est l'emploi de « Partiel ». */}
      {lecture.ok && plafondAtteint(nombreLus, PLAFOND_EVENEMENTS) && (
        <div className="mb-6" data-testid="forms-plafond">
          <EtatSurface etat={{ kind: "partiel", raison: TEXTE_PLAFOND }} />
        </div>
      )}

      {/* Fm2b — S7, la probabilité d'inclusion de la population lue. */}
      <BandeauEchantillonnage lecture={echantillonnage} />

      {/* Fm3 — le hero (6 colonnes) et la définition de l'abandon (6 colonnes). */}
      <div className="mb-6 grid min-w-0 gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-6">
          <SectionErreur titre="Formulaires classés par abandons">
            <Figure
              id="forms-classement"
              titre="Formulaires classés par abandons"
              meta={meta(
                lecture.ok ? `${pluriel(forms.length, "formulaire")} · ${pluriel(abandons, "abandon")}` : undefined,
              )}
              etat={
                !lecture.ok
                  ? { kind: "erreur", titre: "Formulaires classés par abandons" }
                  : forms.length === 0
                    ? { kind: "vide", population: "tentative de formulaire", plage: dansPhrase, geste: elargir }
                    : undefined
              }
              lecture={lecture.ok && forms.length === 0 ? TEXTE_VIDE_LECTURE : undefined}
              alternative={{
                legende: `Formulaires classés par abandons, ${fenetre}`,
                colonnes: ["Formulaire", "Abandons", "Entamés", "Conversion", "Échantillon faible"],
                lignes: forms.map((r) => [
                  r.form,
                  formater("count", r.abandons),
                  formater("count", r.starters),
                  formater("pct", r.conversion),
                  r.faible ? "oui" : "non",
                ]),
              }}
            >
              {forms.length > 0 && (
                <>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <Legende items={[{ couleur: COULEUR_ABANDONS, libelle: "Abandons" }]} />
                    {forms.length > 1 && (
                      <p className="text-xs text-ink-soft" data-testid="forms-indication">
                        Cliquez sur un formulaire pour afficher ses champs ci-dessous.
                      </p>
                    )}
                  </div>
                  <BarresFormulaires forms={forms} selectionne={selectionne} formHref={formHref} />
                  <Methode>
                    Classement par nombre d&apos;abandons. Un formulaire entamé moins de {SEUIL_ECHANTILLON_FAIBLE} fois
                    ferme la liste, marqué «&nbsp;échantillon faible&nbsp;»&nbsp;: quelques abandons sur quelques
                    tentatives ne se comparent pas à un volume.
                  </Methode>
                </>
              )}
            </Figure>
          </SectionErreur>
        </div>
        <section
          className="card flex min-w-0 flex-col p-4 sm:p-5 lg:col-span-6"
          data-testid="forms-definition"
          aria-labelledby="forms-definition-titre"
        >
          <h2 id="forms-definition-titre" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Ce que nous appelons un abandon
          </h2>
          <ul className="mb-3 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink-soft">
            <li data-testid="forms-population">
              Chaque chiffre de l&apos;écran compte des tentatives de formulaire (une soumission ou un abandon), pas des
              sessions.
            </li>
            <li>
              {"Un abandon est émis quand la page passe en arrière-plan avec un formulaire entamé et non soumis"} —
              c&apos;est le seul déclencheur, il n&apos;y a pas de délai d&apos;inactivité.
            </li>
            <li>
              {"Changer d'onglet puis revenir soumettre compte un abandon et pas la soumission"}&nbsp;: le compteur du
              formulaire est vidé au moment de l&apos;abandon.
            </li>
            <li>
              {"Un envoi sans événement submit (bouton géré en JavaScript) compte comme un abandon"}&nbsp;: le SDK
              écoute l&apos;événement du navigateur, pas l&apos;intention.
            </li>
            <li>
              Aucune valeur saisie n&apos;est collectée&nbsp;: seuls un identifiant de champ (nom, id ou type&nbsp;; un
              mot de passe devient <code className="chip-mono">[password]</code>), des durées et des compteurs voyagent.
            </li>
            <li data-testid="forms-garde-mobile">{GARDE_MOBILE}</li>
          </ul>
          <HeroReading>
            Un taux d&apos;abandon élevé peut donc venir du parcours autant que de la manière de soumettre&nbsp;: avant
            de conclure, vérifiez que le bouton d&apos;envoi déclenche bien un envoi de formulaire.
          </HeroReading>
        </section>
      </div>

      {/* Fm4 — les champs du formulaire sélectionné, dans l'ordre de remplissage. */}
      <div className="mb-6">
        <SectionErreur titre="Champs dans l'ordre de remplissage">
          <ChampsDuFormulaire
            selectionne={selectionne}
            ligne={ligneSelectionnee}
            rapport={champs}
            meta={meta}
            dansPhrase={dansPhrase}
            fenetre={fenetre}
            lectureOk={lecture.ok}
            aucunEvenement={aucunEvenement}
          />
        </SectionErreur>
      </div>

      {/* Fm5 — « Abandons dans le temps » N'EST PAS RENDUE tant que B34 n'est pas livré :
          la lecture (`formEvents`) ne renvoie ni `ts` ni `session_id`, il n'y a donc
          aucune série à dessiner. La carte ne montrait qu'un bandeau « Partiel : série
          à créer (B34) » — une fonction absente montrée comme présente, avec un code de
          lot (recette du 26/09/2026). Quand B34 la livrera, elle se pose ici, dans sa
          `SectionErreur` (F54, § 3.8) : la série ne pourra pas faire tomber l'écran. */}
    </div>
  );
}

/** Une légende visible : la couleur d'une barre ne se lit plus seulement dans le texte. */
function Legende({ items }: { items: { couleur: string; libelle: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" data-testid="forms-legende">
      {items.map((i) => (
        <li key={i.libelle} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: i.couleur }} />
          {i.libelle}
        </li>
      ))}
    </ul>
  );
}


/**
 * Le hero : abandons décroissants, échantillons faibles en fin (P3).
 *
 * Pas `RankBar` : il faut ici (recette du 26/09/2026) une ligne ENTIÈRE cliquable et
 * marquée quand ses champs sont affichés (`aria-current`), des sous-libellés qui
 * passent à la ligne au lieu d'être coupés, et « échantillon faible » en marque à
 * part — `RankBar` coupe son sous-texte sur une ligne et ne connaît pas de ligne
 * sélectionnée. Les mesures (colonne des libellés, piste, pastille de valeur) sont
 * les siennes, pour que les deux graphiques de l'écran se ressemblent.
 */
function BarresFormulaires({
  forms,
  selectionne,
  formHref,
}: {
  forms: FormReportRow[];
  selectionne: string | undefined;
  formHref: (nom: string) => string;
}) {
  const base = Math.max(...forms.map((r) => r.abandons), 1);
  const largeurLibelle = { "--rank-label": "12rem" } as CSSProperties;
  return (
    <ul className="flex flex-col gap-1" style={largeurLibelle} data-testid="forms-barres">
      {forms.map((r) => {
        const actif = r.form === selectionne;
        const detail = `${formater("count", r.starters)} entamés · conversion ${formater("pct", r.conversion)}`;
        // Aucune barre pour zéro abandon : une barre minimale se lirait « un peu ».
        const largeur = r.abandons > 0 ? Math.max(2, (r.abandons / base) * 100) : 0;
        return (
          <li key={r.form}>
            <Link
              href={formHref(r.form)}
              aria-current={actif ? "true" : undefined}
              title={`${r.form} : ${pluriel(r.abandons, "abandon")}, ${detail}${r.faible ? ", échantillon faible" : ""}`}
              data-testid="forms-ligne"
              className={`flex items-center gap-3 rounded-md border px-2 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
                actif ? "border-perf/50 bg-perf/5" : "border-transparent hover:bg-panel2"
              }`}
            >
              <span className="block w-[min(7rem,var(--rank-label))] shrink-0 text-xs sm:w-[var(--rank-label)]">
                <span className="block truncate font-medium text-ink">{r.form}</span>
                <span className="block text-[10px] leading-snug text-ink-faint">{detail}</span>
                {(r.faible || actif) && (
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {r.faible && (
                      <span
                        className="rounded-full border border-warn/40 bg-warn/10 px-1.5 text-[10px] font-medium text-warn-ink"
                        data-testid="forms-echantillon-faible"
                      >
                        échantillon faible
                      </span>
                    )}
                    {actif && (
                      <span className="rounded-full border border-perf/40 bg-perf/10 px-1.5 text-[10px] font-medium text-perf">
                        champs affichés
                      </span>
                    )}
                  </span>
                )}
              </span>
              <span className="relative block h-6 min-w-0 flex-1 overflow-hidden rounded bg-panel2">
                <span className="block h-full rounded" style={{ width: `${largeur}%`, backgroundColor: COULEUR_ABANDONS }} />
                <span className="absolute inset-y-0 right-2 flex items-center">
                  <span className="rounded bg-panel/90 px-1 text-xs font-semibold tabular-nums text-ink">
                    {formater("count", r.abandons)}
                  </span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Fm4 — un champ par barre, dans l'ordre médian de première interaction. Ce n'est
 * PAS un entonnoir : un champ peut être sauté, donc les barres ne décroissent pas
 * forcément. Chaque barre vaut les tentatives qui ont touché le champ.
 */
function ChampsDuFormulaire({
  selectionne,
  ligne,
  rapport,
  meta,
  dansPhrase,
  fenetre,
  lectureOk,
  aucunEvenement,
}: {
  selectionne: string | undefined;
  ligne: FormReportRow | undefined;
  rapport: FieldReport | null;
  meta: (extra?: string) => ReactNode;
  dansPhrase: string;
  fenetre: string;
  lectureOk: boolean;
  aucunEvenement: boolean;
}) {
  const titre = selectionne ? `Champs de ${selectionne} dans l'ordre de remplissage` : "Champs dans l'ordre de remplissage";
  if (!lectureOk) return <Figure id="forms-champs" titre={titre} meta={meta()} etat={{ kind: "erreur", titre }} />;
  if (!rapport || !rapport.champs.length) {
    return (
      <Figure
        id="forms-champs"
        titre={titre}
        meta={meta()}
        etat={{
          kind: "vide",
          population: "tentative n'a touché de champ suivi",
          plage: dansPhrase,
        }}
        // Sans aucun événement, le classement voisin dit déjà pourquoi : pas de redite.
        lecture={
          aucunEvenement
            ? undefined
            : `Les tentatives de ce formulaire ne détaillent aucun champ${NBSP}: l'émetteur n'envoie pas la liste des champs.`
        }
      />
    );
  }

  const champs = rapport.champs;
  const data: RankDatum[] = champs.map((c) => {
    const detail = `${formater("count", c.interactions)} tentatives, dont ${formater(
      "count",
      c.abandonsIci,
    )} abandons dont c'est le dernier champ`;
    const retours =
      c.retoursMoyens == null ? "" : ` · ${fmtNombre(c.retoursMoyens, 1)} ${accord(c.retoursMoyens, "retour")} en moyenne`;
    return {
      label: c.name,
      value: c.interactions,
      display: formater("count", c.interactions),
      segments: [
        { value: c.abandonsIci, color: COULEUR_ABANDONS, label: `Abandons ici${NBSP}: ${formater("count", c.abandonsIci)}` },
        { value: c.autres, color: COULEUR_AUTRES, label: `Autres tentatives${NBSP}: ${formater("count", c.autres)}` },
      ],
      // `RankBar` coupe son sous-texte sur une ligne : le bloc `whitespace-normal`
      // le fait passer à la ligne (« 0,00 retour en mo… » était illisible).
      sub: (
        <span className="block whitespace-normal leading-snug">
          p50 {formater("s-auto", c.tempsMedianMs)} · p75 {formater("s-auto", c.tempsP75Ms)}
          {retours}
        </span>
      ),
      title: `${c.name} — ${detail}${NBSP}; part des tentatives ${formater("pct", c.partAbandons)}`,
    };
  });

  const notes: string[] = [];
  if (rapport.incoherents > 0) {
    notes.push(
      `${formater("count", rapport.incoherents)} abandons dont le dernier champ n'est pas dans la liste des champs touchés${NBSP}: exclus des barres`,
    );
  }
  if (rapport.tronqueParSdk) {
    notes.push(
      `au moins une tentative a atteint le plafond de ${formater(
        "count",
        MAX_CHAMPS_SDK,
      )} champs du SDK${NBSP}: les champs au-delà ne sont pas suivis`,
    );
  }

  return (
    <>
      <Figure
        id="forms-champs"
        titre={titre}
        meta={meta(
          ligne
            ? `${pluriel(champs.length, "champ")} · ${pluriel(ligne.starters, "tentative")} du formulaire`
            : pluriel(champs.length, "champ"),
        )}
        alternative={{
          legende: `Champs de ${selectionne} dans l'ordre médian de première interaction, ${fenetre}`,
          colonnes: ["Champ", "Tentatives", "Abandons ici", "Part des tentatives"],
          lignes: champs.map((c) => [
            c.name,
            formater("count", c.interactions),
            formater("count", c.abandonsIci),
            formater("pct", c.partAbandons),
          ]),
        }}
      >
        <Legende
          items={[
            { couleur: COULEUR_ABANDONS, libelle: "Abandons dont c'est le dernier champ" },
            { couleur: COULEUR_AUTRES, libelle: "Autres tentatives" },
          ]}
        />
        <div className="mt-3">
          <RankBar
            data={data}
            labelWidth="12rem"
            alternative={false}
            legende={`Champs de ${selectionne} dans l'ordre médian de première interaction, ${fenetre}`}
          />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-soft">
          Les champs sont rangés dans l&apos;ordre où les visiteurs les remplissent&nbsp;; chaque barre vaut les tentatives
          qui ont touché le champ.
        </p>
        <Methode>
          Ordre médian de première interaction, pas un tri par abandons&nbsp;: la place du champ dans le formulaire est
          l&apos;information. Ce n&apos;est pas un entonnoir&nbsp;: un champ peut être sauté, les barres ne décroissent
          donc pas forcément. p50 et p75&nbsp;: temps passé sur le champ par la moitié et par les trois quarts des
          tentatives. Retours&nbsp;: nombre moyen de retours sur le champ après l&apos;avoir quitté.
        </Methode>
      </Figure>
      {/* Données PARTIELLES (abandons hors barres, liste tronquée) : l'emploi de « Partiel ». */}
      {notes.map((raison) => (
        <div key={raison} className="mt-3" data-testid="forms-champs-note">
          <EtatSurface etat={{ kind: "partiel", raison }} />
        </div>
      ))}
    </>
  );
}
