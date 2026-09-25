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
//   - Une série dessinée pour un patch absent : « Abandons dans le temps » attend
//     B34 et le dit, sans axe ni zéro.
import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import { HeroReading } from "@/components/SupervisionHero";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import { EtatSurface } from "@/components/states/EtatSurface";
import { SectionErreur } from "@/components/states/SectionErreur";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { MAX_CHAMPS_SDK, SEUIL_ECHANTILLON_FAIBLE, type FieldReport, type FormReportRow } from "@/lib/form-analytics";
import { chargerForms, PLAFOND_EVENEMENTS } from "@/lib/chargeurs/forms";
import { chargerEcran } from "@/lib/ecran-local";
import { couvertureDeTuile, gesteElargir, plafondAtteint, plageDansPhrase } from "@/lib/lecture-usages";
import { hrefWithQuery, previousRange } from "@/lib/query-contract";
import { referencePrecedente } from "@/lib/sessions-kpi";
import { ecartProportions } from "@/lib/stats/incertitude";

export const dynamic = "force-dynamic";


/** La population de l'écran, nommée dans chaque méta (S1). */
const POPULATION = "tentatives de formulaire (un événement form.submit ou form.abandon par tentative, pas une session)";

// Jetons de F01 : l'abandon est le segment `bad`, le reste est neutre. Les deux
// suivent le mode sombre (variables CSS), aucune couleur n'est figée ici.
const COULEUR_ABANDONS = "rgb(var(--c-bad))";
const COULEUR_AUTRES = "rgb(var(--c-ink-faint))";

const TEXTE_PLAFOND = `${formater(
  "count",
  PLAFOND_EVENEMENTS,
)} derniers événements seulement : les formulaires plus anciens de la fenêtre ne sont pas comptés`;

/**
 * R-F, vérifié pour F51 dans `packages/rum-mobile/src` : le SDK React Native
 * n'émet AUCUN événement `form.*` (aucune occurrence de `form.` dans ses sources).
 * L'écran ne peut donc pas lire de formulaire mobile — c'est dit, plutôt que de
 * laisser une absence passer pour un parcours sans friction.
 */
const GARDE_MOBILE =
  "Le SDK React Native n'émet aucun événement de formulaire : une application mobile n'apparaît jamais ici, même si ses utilisateurs remplissent des formulaires.";

const TEXTE_VIDE_LECTURE =
  "Le SDK navigateur instrumente les formulaires par défaut (option « forms » active) : sans événement lu, aucun formulaire n'a été entamé sur la fenêtre, ou aucune page instrumentée n'en contient.";

export default async function Forms({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/forms.ts`) lit les événements `form.*` et les RÉDUIT
  // en rapports (par formulaire, champ par champ pour le formulaire affiché) ; sous
  // `cmp=prev` (F06, F53), la période précédente et sa couverture.
  const ecran = await chargerEcran(chargerForms, sp);
  if (ecran.etat === "refus") return <FilterProblemNotice title="Formulaires" problem={ecran.problem} />;
  const query = ecran.query;
  const { lecture, lecturePrev, echantillonnage, couvertures } = ecran;
  const fenetre = ecran.label;
  const dansPhrase = plageDansPhrase(query.range, fenetre);
  const meta = (extra?: string) => (
    <>
      {extra && <span>{extra}</span>}
      <span>Population : {POPULATION}</span>
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
  const raisonVide = `aucun événement de formulaire lu sur ${dansPhrase}`;
  const raisonEchec = "lecture en échec : aucun événement n'a pu être lu";
  const raisonNull = lecture.ok ? raisonVide : raisonEchec;

  // `cmp=prev` (F53) : la même lecture sur la période précédente. Un plafond de 5 000
  // événements atteint d'un côté ou de l'autre tait l'écart (il mesurerait le plafond).
  const precEvents = lecturePrev?.ok ? lecturePrev.data : null;
  const precForms = precEvents ? precEvents.forms : null;
  const precEntames = precForms ? precForms.reduce((a, r) => a + r.starters, 0) : null;
  const precSoumissions = precForms ? precForms.reduce((a, r) => a + r.submits, 0) : null;
  const plafonds = [
    { atteint: lecture.ok && plafondAtteint(nombreLus, PLAFOND_EVENEMENTS), raison: `plafond de ${formater("count", PLAFOND_EVENEMENTS)} événements atteint sur la période lue` },
    { atteint: precEvents !== null && plafondAtteint(precEvents.nombre, PLAFOND_EVENEMENTS), raison: `plafond de ${formater("count", PLAFOND_EVENEMENTS)} événements atteint sur la période précédente` },
  ];
  /** Props de comparaison d'une tuile ; rien hors `cmp=prev`. L'effectif précédent (entamés) porte l'échantillon faible. */
  const comparer = (precedent: number | null) =>
    lecturePrev
      ? {
          precedent: precEvents ? precedent : null,
          reference: referencePrecedente(previousRange(query.range)),
          couverturePrecedente: couvertureDeTuile(
            lecturePrev.ok ? couvertures : [{ etat: "inconnue", raison: "la période précédente n'a pas pu être lue" }],
            plafonds,
            precEntames,
          ),
        }
      : {};

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Formulaires"
        domain="usages"
        sub="Quels formulaires perdent leurs visiteurs, et sur quel champ ? Aucune valeur saisie n'est collectée."
      />

      {/* Fm2 — quatre tuiles sur une seule population : les tentatives lues. */}
      <SectionErreur titre="Chiffres clés">
        <div className="mb-6 grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiTile
            label="Formulaires entamés"
            valeur={entames > 0 ? entames : null}
            format="count"
            raisonNull={raisonNull}
            lecture="Soumissions + abandons : une tentative entamée est une tentative qui a touché au moins un champ."
            {...comparer(precEntames)}
          />
          <KpiTile
            label="Soumissions"
            valeur={entames > 0 ? soumissions : null}
            format="count"
            raisonNull={raisonNull}
            lecture="Événements form.submit lus sur la fenêtre."
            {...comparer(precSoumissions)}
          />
          {/* Sans verdict coloré (S6, R-S) : aucun seuil publié n'existe pour une
              conversion de formulaire ; les paliers 0,6 / 0,3 n'avaient pas de source. */}
          <KpiTile
            label="Conversion"
            valeur={entames > 0 ? soumissions / entames : null}
            format="pct"
            raisonNull={lecture.ok ? "aucun formulaire entamé : pas de dénominateur" : raisonEchec}
            couverture={{ n: entames, unite: "formulaires entamés", faibleSous: SEUIL_ECHANTILLON_FAIBLE }}
            lecture="Soumis / entamés. Aucun seuil publié n'existe pour une conversion de formulaire : aucun verdict coloré."
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
                  ? "aucune soumission chronométrée : le temps total n'a pas été émis"
                  : `aucune soumission lue sur ${dansPhrase}`
            }
            couverture={{ n: soumissions, unite: "soumissions", faibleSous: SEUIL_ECHANTILLON_FAIBLE }}
            lecture="Médiane, jamais une moyenne : un abandon rapide raccourcirait le temps de remplissage sans que personne n'aille plus vite."
            {...comparer(precEvents ? precEvents.mediane : null)}
          />
        </div>
      </SectionErreur>

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
                lecture.ok
                  ? `${formater("count", forms.length)} formulaires lus · ${formater("count", abandons)} abandons`
                  : undefined,
              )}
              etat={
                !lecture.ok
                  ? { kind: "erreur", titre: "Formulaires classés par abandons" }
                  : forms.length === 0
                    ? { kind: "vide", population: "tentative de formulaire", plage: dansPhrase, geste: elargir }
                    : undefined
              }
              lecture={
                forms.length === 0
                  ? `${TEXTE_VIDE_LECTURE} ${GARDE_MOBILE}`
                  : `Longueur = abandons. Un formulaire entamé moins de ${SEUIL_ECHANTILLON_FAIBLE} fois ferme la liste, marqué « échantillon faible » : quelques abandons sur quelques tentatives ne se comparent pas à un volume. ${GARDE_MOBILE}`
              }
            >
              {forms.length > 0 && <BarresFormulaires forms={forms} formHref={formHref} fenetre={fenetre} />}
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
            <li>
              {"un abandon est émis quand la page passe en arrière-plan avec un formulaire entamé et non soumis"} —
              c&apos;est le seul déclencheur, il n&apos;y a pas de délai d&apos;inactivité.
            </li>
            <li>
              {"changer d'onglet puis revenir soumettre compte un abandon et pas la soumission"} : le compteur du
              formulaire est vidé au moment de l&apos;abandon.
            </li>
            <li>
              {"un envoi sans événement submit (bouton géré en JavaScript) compte comme un abandon"} : le SDK écoute
              l&apos;événement du navigateur, pas l&apos;intention.
            </li>
            <li>
              Aucune valeur saisie n&apos;est collectée : seuls un identifiant de champ (nom, id ou type ; un mot de
              passe devient <code className="chip-mono">[password]</code>), des durées et des compteurs voyagent.
            </li>
            <li data-testid="forms-garde-mobile">{GARDE_MOBILE}</li>
          </ul>
          <HeroReading>
            Un taux d&apos;abandon élevé peut donc venir du parcours autant que de la manière de soumettre : avant de
            conclure, vérifiez que le bouton d&apos;envoi déclenche bien un envoi de formulaire.
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

      {/* Fm5 — attend B34 : la lecture ne renvoie ni `ts` ni `session_id`. Sa frontière
          est posée comme autour de chaque figure (F54, § 3.8) : la série, quand B34 la
          livrera, ne pourra pas faire tomber l'écran. */}
      <SectionErreur titre="Abandons dans le temps">
        <Figure
          id="forms-serie"
          titre="Abandons dans le temps"
          meta={meta()}
          etat={{ kind: "partiel", raison: "série à créer (B34) : la lecture actuelle ne renvoie pas l'horodatage des événements" }}
        />
      </SectionErreur>
    </div>
  );
}

/** Le hero : abandons décroissants, échantillons faibles en fin (P3). */
function BarresFormulaires({
  forms,
  formHref,
  fenetre,
}: {
  forms: FormReportRow[];
  formHref: (nom: string) => string;
  fenetre: string;
}) {
  const data: RankDatum[] = forms.map((r) => {
    const sous = `${formater("count", r.starters)} entamés · conversion ${formater("pct", r.conversion)}${
      r.faible ? " · échantillon faible" : ""
    }`;
    return {
      label: r.form,
      value: r.abandons,
      href: formHref(r.form),
      sub: sous,
      title: `${r.form} : ${formater("count", r.abandons)} abandons, ${sous}`,
    };
  });
  return (
    <RankBar
      data={data}
      labelWidth="12rem"
      legende={`Formulaires classés par abandons (entamés et conversion en détail), ${fenetre}`}
    />
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
        lecture={
          aucunEvenement
            ? TEXTE_VIDE_LECTURE
            : "Les tentatives lues n'ont détaillé aucun champ : un émetteur qui n'envoie pas la liste des champs n'est pas décomposable."
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
    return {
      label: c.name,
      value: c.interactions,
      display: formater("count", c.interactions),
      segments: [
        { value: c.abandonsIci, color: COULEUR_ABANDONS, label: `Abandons ici : ${formater("count", c.abandonsIci)}` },
        { value: c.autres, color: COULEUR_AUTRES, label: `Autres tentatives : ${formater("count", c.autres)}` },
      ],
      sub: `p50 ${formater("s-auto", c.tempsMedianMs)} · p75 ${formater("s-auto", c.tempsP75Ms)} · ${formater(
        "ratio",
        c.retoursMoyens,
      )} retour en moyenne`,
      title: `${c.name} — ${detail} ; part des tentatives ${formater("pct", c.partAbandons)}`,
    };
  });

  const notes: string[] = [];
  if (rapport.incoherents > 0) {
    notes.push(
      `${formater("count", rapport.incoherents)} abandons dont le dernier champ n'est pas dans la liste des champs touchés : exclus des barres`,
    );
  }
  if (rapport.tronqueParSdk) {
    notes.push(
      `au moins une tentative a atteint le plafond de ${formater(
        "count",
        MAX_CHAMPS_SDK,
      )} champs du SDK : les champs au-delà ne sont pas suivis`,
    );
  }

  return (
    <>
      <Figure
        id="forms-champs"
        titre={titre}
        meta={meta(
          ligne
            ? `${formater("count", champs.length)} champs · ${formater("count", ligne.starters)} tentatives du formulaire`
            : `${formater("count", champs.length)} champs`,
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
        lecture="Ordre médian de première interaction, pas un tri par abandons : la question est où ça décroche. Ce n'est pas un entonnoir : un champ peut être sauté. Chaque barre vaut les tentatives qui ont touché le champ, découpées en « abandons dont c'est le dernier champ » puis « autres tentatives »."
      >
        <RankBar
          data={data}
          labelWidth="12rem"
          alternative={false}
          legende={`Champs de ${selectionne} dans l'ordre médian de première interaction, ${fenetre}`}
        />
      </Figure>
      {notes.map((raison) => (
        <div key={raison} className="mt-3" data-testid="forms-champs-note">
          <EtatSurface etat={{ kind: "partiel", raison }} />
        </div>
      ))}
    </>
  );
}
