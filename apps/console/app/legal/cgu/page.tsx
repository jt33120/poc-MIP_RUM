import { LegalShell, LegalSection } from "@/components/legal/LegalShell";
import { ORG } from "@/lib/legal";

export const dynamic = "force-static";
export const metadata = { title: "MIP RUM — Conditions générales d'utilisation" };

export default function CGU() {
  return (
    <LegalShell
      title="Conditions générales d'utilisation"
      intro={
        <p>
          Les présentes conditions (CGU) régissent l'accès et l'utilisation de la console {ORG.produit}. En
          accédant au service, l'utilisateur les accepte sans réserve.
        </p>
      }
    >
      <LegalSection n="1" title="Objet">
        <p>
          Les CGU définissent les modalités de mise à disposition de la console {ORG.produit} et les conditions
          d'utilisation par l'utilisateur autorisé (ci-après « l'Utilisateur »). Les conditions commerciales
          (souscription, prix) relèvent des <a href="/legal/cgv" className="text-accent-deep underline-offset-2 hover:underline dark:text-accent">CGV</a>.
        </p>
      </LegalSection>

      <LegalSection n="2" title="Description du service">
        <p>
          {ORG.produit} est une solution de supervision de l'expérience réelle des utilisateurs (Real User
          Monitoring) : collecte de mesures de performance (Core Web Vitals), d'erreurs techniques et de signaux
          agrégés, restituées dans une console d'analyse. Le service est fourni « en l'état », susceptible
          d'évolutions.
        </p>
      </LegalSection>

      <LegalSection n="3" title="Accès et compte">
        <p>
          L'accès requiert un compte nominatif. L'Utilisateur est responsable de la confidentialité de ses
          identifiants et de toute action réalisée depuis son compte. Le service met en œuvre une gestion des
          rôles (administrateur / lecteur) et journalise les actions sensibles.
        </p>
      </LegalSection>

      <LegalSection n="4" title="Obligations de l'Utilisateur">
        <p>L'Utilisateur s'engage à&nbsp;:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>utiliser le service conformément à sa destination et à la réglementation applicable&nbsp;;</li>
          <li>
            n'instrumenter que des sites/applications dont il détient les droits, et respecter l'information des
            personnes concernées&nbsp;;
          </li>
          <li>ne pas tenter de compromettre la sécurité ou l'intégrité du service&nbsp;;</li>
          <li>ne pas contourner les quotas ou restrictions d'accès.</li>
        </ul>
      </LegalSection>

      <LegalSection n="5" title="Données et confidentialité">
        <p>
          Le traitement des données est décrit dans la{" "}
          <a href="/legal/confidentialite" className="text-accent-deep underline-offset-2 hover:underline dark:text-accent">politique de confidentialité</a>{" "}
          et, pour les données traitées pour le compte du client, dans l'
          <a href="/legal/dpa" className="text-accent-deep underline-offset-2 hover:underline dark:text-accent">accord de traitement (DPA)</a>. Le
          service est conçu pour ne pas collecter de donnée directement identifiante côté RUM.
        </p>
      </LegalSection>

      <LegalSection n="6" title="Disponibilité et maintenance">
        <p>
          L'éditeur s'efforce d'assurer la disponibilité du service et peut l'interrompre pour maintenance. Les
          engagements de niveau de service éventuels figurent aux CGV ou au contrat.
        </p>
      </LegalSection>

      <LegalSection n="7" title="Propriété intellectuelle">
        <p>
          Le service et ses composants demeurent la propriété de {ORG.raisonSociale}. L'Utilisateur bénéficie d'un
          droit d'usage personnel, non exclusif et non transférable, limité à la durée d'accès.
        </p>
      </LegalSection>

      <LegalSection n="8" title="Responsabilité">
        <p>
          Le service est fourni sans garantie que les résultats seront exempts d'erreur. La responsabilité de
          l'éditeur ne saurait être engagée pour les décisions prises sur la base des indicateurs, ni pour les
          dommages indirects. Les limitations de responsabilité applicables aux clients figurent aux CGV.
        </p>
      </LegalSection>

      <LegalSection n="9" title="Résiliation">
        <p>
          En cas de manquement grave aux présentes, l'éditeur peut suspendre ou clôturer l'accès après information
          de l'Utilisateur. Les conditions de résiliation contractuelle figurent aux CGV.
        </p>
      </LegalSection>

      <LegalSection n="10" title="Droit applicable et litiges">
        <p>
          Les présentes CGU sont régies par le droit français. À défaut de résolution amiable, tout litige relève
          de la compétence des tribunaux du ressort du siège de l'éditeur, sauf disposition impérative contraire.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
