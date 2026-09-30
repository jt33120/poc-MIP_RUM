import { LegalShell, LegalSection, LienLegal } from "@/components/legal/LegalShell";
import { TableauSousTraitants } from "@/components/legal/SousTraitants";
import {
  CONSERVATION_MESURES,
  DATA_SOURCES,
  DPA,
  IDENTIFIANTS_PSEUDONYMES,
  IDENTITE_CLIENT,
  ORG,
  PAYS_ESTIME,
} from "@/lib/legal";

export const dynamic = "force-static";
export const metadata = { title: "MIP RUM — Politique de confidentialité" };

// Toutes les phrases qui décrivent la donnée (identifiants, pays, conservation,
// sous-traitants, DPA) viennent de lib/legal.ts, comme dans la politique de
// l'extension : la recette du 26/09/2026 lisait ici « identifiant de session
// anonyme » et « mesures anonymisées », là « pseudonyme, pas une donnée anonyme ».
// Ce n'est pas le même régime RGPD ; le vocabulaire est désormais celui du code.
export default function Confidentialite() {
  return (
    <LegalShell
      title="Politique de confidentialité"
      intro={
        <p>
          Cette politique décrit le traitement des données dans le cadre du service {ORG.produit}. Pour le capteur
          installé dans le navigateur, elle est complétée par la{" "}
          <LienLegal href="/extension-privacy">politique de l&apos;extension</LienLegal>.
        </p>
      }
    >
      <LegalSection n="1" title="Responsable de traitement et sous-traitant">
        <p>
          Pour les mesures collectées sur les sites des clients, {ORG.raisonSociale} agit en qualité de{" "}
          <strong>sous-traitant</strong> pour le compte du client, responsable de traitement, dans le cadre de {DPA}.
          Pour les données des comptes de la console, {ORG.raisonSociale} agit en qualité de{" "}
          <strong>responsable de traitement</strong>.
        </p>
      </LegalSection>

      <LegalSection n="2" title="Données traitées">
        <p>
          <strong>Mesures</strong>&nbsp;:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>indicateurs de performance (Core Web Vitals)&nbsp;;</li>
          <li>erreurs techniques (message, type, pile d&apos;appel, fichier source sans chaîne de requête)&nbsp;;</li>
          <li>route ou adresse de page normalisée, type d&apos;appareil, user-agent du navigateur&nbsp;;</li>
          <li>
            <strong>identifiants pseudonymes</strong>&nbsp;: {IDENTIFIANTS_PSEUDONYMES}&nbsp;;
          </li>
          <li>{IDENTITE_CLIENT}&nbsp;;</li>
          <li>
            <strong>pays estimé</strong>&nbsp;: {PAYS_ESTIME}.
          </li>
        </ul>
        <p>
          <strong>Aucune adresse IP de visiteur n&apos;est stockée</strong>, sous aucune forme, et aucune donnée directement
          identifiante n&apos;est conservée en clair.
        </p>
        {DATA_SOURCES.map((d) => (
          <p key={d.name}>
            Le pays peut être résolu localement à partir de l&apos;adresse, avec la base {d.name} (
            <a href={d.url} className="text-accent-ink underline-offset-2 hover:underline" rel="noopener noreferrer">
              {d.attribution}
            </a>
            , licence {d.licence})&nbsp;: aucune adresse n&apos;est transmise à son éditeur, qui n&apos;est pas un
            sous-traitant.
          </p>
        ))}
        <p>
          <strong>Comptes de la console</strong>&nbsp;: adresse e-mail, rôle, applications autorisées, journal des
          actions sensibles&nbsp;; pour un compte créé par l&apos;inscription en libre-service, la date de
          l&apos;inscription. <strong>Alertes</strong>&nbsp;: adresse e-mail des opérateurs destinataires et texte de
          l&apos;alerte.
        </p>
      </LegalSection>

      <LegalSection n="3" title="Finalités et bases légales">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Mesurer et améliorer la performance et la fiabilité des sites (exécution du contrat, intérêt légitime du
            client).
          </li>
          <li>Gérer les accès et la sécurité de la console (exécution du contrat, obligation de sécurité).</li>
          <li>Émettre des alertes et des rapports (exécution du contrat).</li>
        </ul>
        <p>Les données ne sont ni vendues, ni utilisées à des fins publicitaires.</p>
      </LegalSection>

      <LegalSection n="4" title="Destinataires et sous-traitants ultérieurs">
        <p>Les données sont traitées par les sous-traitants suivants&nbsp;:</p>
        <TableauSousTraitants />
      </LegalSection>

      <LegalSection n="5" title="Transferts hors de l'Union européenne">
        <p>
          Les sous-traitants ci-dessus sont des sociétés de droit américain&nbsp;; le tableau indique où chacun traite
          les données. Les transferts vers un pays tiers, et l&apos;accès éventuel depuis l&apos;extérieur de
          l&apos;Union européenne, sont encadrés par les garanties qui y figurent.
        </p>
      </LegalSection>

      <LegalSection n="6" title="Durée de conservation">
        <p>
          Mesures&nbsp;: suppression automatique après {CONSERVATION_MESURES}. Comptes et journaux&nbsp;: durée de la
          relation contractuelle, puis archivage ou suppression selon les obligations légales.
        </p>
      </LegalSection>

      <LegalSection n="7" title="Vos droits">
        <p>
          Conformément au RGPD, les personnes concernées disposent des droits d&apos;accès, de rectification,
          d&apos;effacement, de limitation et d&apos;opposition. Les mesures étant pseudonymisées, l&apos;identification
          directe d&apos;une personne n&apos;est en principe pas possible&nbsp;; une demande peut porter sur
          l&apos;identifiant de visiteur. Les demandes s&apos;exercent auprès du responsable de traitement (le client,
          pour les mesures), avec l&apos;assistance de {ORG.raisonSociale}. Contact&nbsp;: {ORG.dpo}.
        </p>
        <p>Une réclamation peut être introduite auprès de la CNIL.</p>
      </LegalSection>

      <LegalSection n="8" title="Cookies et stockage local">
        <p>
          La console n&apos;utilise que des cookies nécessaires à son fonctionnement&nbsp;: la session
          d&apos;authentification, le projet affiché et la date de la connexion précédente. Aucun n&apos;est
          publicitaire ni partagé avec un tiers. Le capteur de mesure ne dépose aucun cookie&nbsp;: ses identifiants
          pseudonymes sont gardés dans le stockage local du navigateur.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
