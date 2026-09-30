import { LegalShell, LegalSection, LienLegal } from "@/components/legal/LegalShell";
import { DPA, ORG } from "@/lib/legal";

export const dynamic = "force-static";
export const metadata = { title: "MIP RUM — Conditions générales d'utilisation" };

// Les termes définis (« l'Éditeur », « l'Utilisateur ») portent une capitale,
// comme dans les CGV : la recette du 26/09/2026 lisait « l'éditeur » ici et
// « l'Éditeur » là. Les champs de l'éditeur viennent de `ORG` (lib/legal.ts).
export default function CGU() {
  return (
    <LegalShell
      title="Conditions générales d'utilisation"
      intro={
        <p>
          Les présentes conditions (CGU) régissent l&apos;accès et l&apos;utilisation de la console {ORG.produit},
          éditée par {ORG.raisonSociale} (ci-après «&nbsp;l&apos;Éditeur&nbsp;»). En accédant au service,
          l&apos;utilisateur les accepte sans réserve.
        </p>
      }
    >
      <LegalSection n="1" title="Éditeur du service">
        <p>
          {ORG.raisonSociale}, {ORG.formeJuridique} au capital de {ORG.capital}, immatriculée au RCS de {ORG.rcs} sous
          le numéro {ORG.siren}, dont le siège est situé {ORG.adresse}. Numéro de TVA intracommunautaire&nbsp;:{" "}
          {ORG.tva}. Contact&nbsp;: {ORG.email}, {ORG.telephone}. Directeur ou directrice de la publication&nbsp;:{" "}
          {ORG.directeurPublication}.
        </p>
      </LegalSection>

      <LegalSection n="2" title="Objet">
        <p>
          Les CGU définissent les modalités de mise à disposition de la console {ORG.produit} et les conditions
          d&apos;utilisation par l&apos;utilisateur autorisé (ci-après «&nbsp;l&apos;Utilisateur&nbsp;»). Les
          conditions commerciales (souscription, prix) relèvent des <LienLegal href="/legal/cgv">CGV</LienLegal>.
        </p>
      </LegalSection>

      <LegalSection n="3" title="Description du service">
        <p>
          {ORG.produit} est une solution de supervision de l&apos;expérience réelle des utilisateurs (Real User
          Monitoring)&nbsp;: collecte de mesures de performance (Core Web Vitals), d&apos;erreurs techniques et de
          signaux agrégés, restituées dans une console d&apos;analyse. Le service est fourni «&nbsp;en
          l&apos;état&nbsp;», susceptible d&apos;évolutions.
        </p>
      </LegalSection>

      <LegalSection n="4" title="Accès et compte">
        <p>
          L&apos;accès requiert un compte nominatif, créé par un administrateur du service ou, lorsque l&apos;Éditeur
          l&apos;ouvre, par l&apos;inscription en libre-service. L&apos;Utilisateur est responsable de la
          confidentialité de ses identifiants et de toute action réalisée depuis son compte. Le service distingue deux
          rôles (administrateur et lecteur) et journalise les actions sensibles.
        </p>
        <p>
          Un compte créé par l&apos;inscription en libre-service est un compte d&apos;essai&nbsp;: il administre un
          seul site, créé en même temps que lui, dont la collecte est plafonnée. L&apos;Éditeur peut limiter ou
          fermer l&apos;inscription à tout moment, et désactiver un compte d&apos;essai dont l&apos;usage contrevient
          aux présentes conditions.
        </p>
      </LegalSection>

      <LegalSection n="5" title="Obligations de l'Utilisateur">
        <p>L&apos;Utilisateur s&apos;engage à&nbsp;:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>utiliser le service conformément à sa destination et à la réglementation applicable&nbsp;;</li>
          <li>
            n&apos;instrumenter que des sites et applications dont il détient les droits, et respecter
            l&apos;information des personnes concernées&nbsp;;
          </li>
          <li>ne pas tenter de compromettre la sécurité ou l&apos;intégrité du service&nbsp;;</li>
          <li>ne pas contourner les quotas ou restrictions d&apos;accès.</li>
        </ul>
      </LegalSection>

      <LegalSection n="6" title="Données et confidentialité">
        <p>
          Le traitement des données est décrit dans la{" "}
          <LienLegal href="/legal/confidentialite">politique de confidentialité</LienLegal> et, pour les données
          traitées pour le compte du client, dans {DPA}. Le service est conçu pour ne collecter aucune donnée
          directement identifiante dans les mesures&nbsp;: les identifiants qu&apos;il emploie sont des pseudonymes.
        </p>
      </LegalSection>

      <LegalSection n="7" title="Disponibilité et maintenance">
        <p>
          L&apos;Éditeur s&apos;efforce d&apos;assurer la disponibilité du service et peut l&apos;interrompre pour
          maintenance. Les engagements de niveau de service éventuels figurent aux CGV ou au contrat.
        </p>
      </LegalSection>

      <LegalSection n="8" title="Propriété intellectuelle">
        <p>
          Le service et ses composants demeurent la propriété de {ORG.raisonSociale}. L&apos;Utilisateur bénéficie
          d&apos;un droit d&apos;usage personnel, non exclusif et non transférable, limité à la durée d&apos;accès.
        </p>
      </LegalSection>

      <LegalSection n="9" title="Responsabilité">
        <p>
          Le service est fourni sans garantie que les résultats seront exempts d&apos;erreur. La responsabilité de
          l&apos;Éditeur ne saurait être engagée pour les décisions prises sur la base des indicateurs, ni pour les
          dommages indirects. Les limitations de responsabilité applicables aux clients figurent aux CGV.
        </p>
      </LegalSection>

      <LegalSection n="10" title="Résiliation">
        <p>
          En cas de manquement grave aux présentes, l&apos;Éditeur peut suspendre ou clôturer l&apos;accès après
          information de l&apos;Utilisateur. Les conditions de résiliation contractuelle figurent aux CGV.
        </p>
      </LegalSection>

      <LegalSection n="11" title="Droit applicable et litiges">
        <p>
          Les présentes CGU sont régies par le droit français. À défaut de résolution amiable, tout litige relève
          de la compétence des tribunaux du ressort du siège de l&apos;Éditeur, sauf disposition impérative
          contraire.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
