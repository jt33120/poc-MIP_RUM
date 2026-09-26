// Politique de confidentialité PUBLIQUE de l'extension navigateur MIP RUM.
// URL exigée par le Chrome Web Store pour toute extension qui traite des données :
// elle reste à /extension-privacy, mais se rend dans la coquille des documents
// légaux (même en-tête, même bandeau « modèle ») et figure dans l'index /legal.
// Publique (cf. middleware) : ni login, ni scope projet.
//
// UNE SEULE SOURCE AVEC /legal/confidentialite (recette du 26/09/2026). Cette page
// disait les fonctions de Vercel « servies depuis les États-Unis » quand l'autre
// les disait exécutées à Francfort, et « Data is hosted in the EU » sans nuance :
// l'hébergement, le pays, les identifiants, la conservation et le contact sont
// désormais lus dans lib/legal.ts.
import { LegalShell, LegalSection, LienLegal } from "@/components/legal/LegalShell";
import { TableauSousTraitants } from "@/components/legal/SousTraitants";
import { CONSERVATION_MESURES, IDENTIFIANTS_PSEUDONYMES, ORG, PAYS_ESTIME } from "@/lib/legal";

export const dynamic = "force-static";

export const metadata = {
  title: "MIP RUM — Confidentialité de l'extension navigateur",
  description:
    "Ce que le capteur navigateur MIP RUM mesure, comment, et vos droits. Données pseudonymes, traitées en Union européenne.",
};

export default function ExtensionPrivacy() {
  return (
    <LegalShell
      title="Politique de confidentialité de l'extension navigateur"
      intro={
        <p>
          L&apos;extension «&nbsp;{ORG.produit} — capteur navigateur&nbsp;» mesure la{" "}
          <strong>performance perçue</strong> et la <strong>fiabilité technique</strong> des pages web, pour les
          seuls domaines que votre organisation a enregistrés dans la console {ORG.produit}, et{" "}
          <strong>uniquement après votre autorisation</strong>, domaine par domaine. Elle ne s&apos;active jamais sur
          d&apos;autres sites. Elle complète la{" "}
          <LienLegal href="/legal/confidentialite">politique de confidentialité du service</LienLegal>.
        </p>
      }
    >
      <LegalSection n="1" title="Données collectées">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Mesures de performance</strong> (Core Web Vitals&nbsp;: LCP, INP, CLS, FCP, TTFB) et temps de
            chargement des ressources.
          </li>
          <li>
            <strong>Erreurs techniques JavaScript</strong> (message, type, pile d&apos;appel, fichier source)&nbsp;;
            la chaîne de requête des adresses est retirée avant stockage.
          </li>
          <li>
            <strong>Contexte de page</strong>&nbsp;: adresse ou route normalisée, référent d&apos;origine, type
            d&apos;appareil (ordinateur, mobile), user-agent du navigateur.
          </li>
          <li>
            <strong>Identifiants pseudonymes</strong>&nbsp;: {IDENTIFIANTS_PSEUDONYMES}. Ils relient les pages
            d&apos;une visite, et les visites entre elles.
          </li>
          <li>
            <strong>Pays estimé</strong>&nbsp;: {PAYS_ESTIME}. <strong>Aucune adresse IP n&apos;est stockée.</strong>
          </li>
          <li>
            <strong>Déclaration d&apos;installation</strong>&nbsp;: toutes les 6&nbsp;h, l&apos;extension signale son
            existence à la console — un identifiant d&apos;installation tiré au hasard (dérivé d&apos;aucune
            caractéristique de la machine), sa version, et les applications supervisées pour lesquelles elle a
            effectivement mesuré. <strong>Aucune page visitée n&apos;accompagne cette déclaration.</strong> Elle sert
            à l&apos;administrateur du parc à savoir quels postes sont équipés et à jour. Si votre organisation pousse
            un libellé de poste par sa politique d&apos;entreprise, ce libellé est transmis avec&nbsp;: c&apos;est le
            seul nom que la console peut afficher, et il vient de votre organisation, jamais de l&apos;extension.
          </li>
        </ul>
      </LegalSection>

      <LegalSection n="2" title="Ce qui n'est pas collecté">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Aucun nom, aucune adresse e-mail, aucun profil publicitaire.</li>
          <li>Aucune frappe clavier, aucun contenu de formulaire, aucun mot de passe.</li>
          <li>Aucun historique de navigation hors des domaines enregistrés et autorisés.</li>
          <li>
            Aucune adresse de page dans la déclaration d&apos;installation, et aucun nom d&apos;utilisateur, de
            session Windows ou de compte&nbsp;: l&apos;identifiant d&apos;installation n&apos;est relié à aucune
            personne.
          </li>
          <li>Aucune revente de données, aucun usage étranger à la mesure de performance.</li>
        </ul>
      </LegalSection>

      <LegalSection n="3" title="Finalité">
        <p>
          Les données servent <strong>exclusivement</strong> à mesurer et améliorer la performance et la fiabilité
          des sites concernés (Real User Monitoring). Elles ne sont ni vendues, ni utilisées pour du ciblage.
        </p>
      </LegalSection>

      <LegalSection n="4" title="Hébergement et sous-traitants">
        <p>Les mesures sont traitées par les sous-traitants suivants&nbsp;:</p>
        <TableauSousTraitants />
      </LegalSection>

      <LegalSection n="5" title="Conservation">
        <p>Suppression automatique après {CONSERVATION_MESURES}.</p>
      </LegalSection>

      <LegalSection n="6" title="Vos droits et votre contrôle">
        <p>
          Vous disposez des droits d&apos;accès et d&apos;effacement, exercés à partir de l&apos;identifiant de
          visiteur. Les données étant pseudonymes, {ORG.raisonSociale} ne peut pas, seul, relier une mesure à une
          personne. Les demandes s&apos;exercent auprès de votre organisation, responsable de traitement, avec
          l&apos;assistance de {ORG.raisonSociale}. Contact&nbsp;: {ORG.dpo}.
        </p>
        <p>
          Vous accordez et retirez l&apos;autorisation, domaine par domaine, à tout moment depuis la fenêtre de
          l&apos;extension.
        </p>
      </LegalSection>

      <LegalSection n="7" title="Permissions de l'extension">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <code>scripting</code>&nbsp;: injecter le capteur de mesure sur les pages des domaines autorisés.
          </li>
          <li>
            <code>webNavigation</code>&nbsp;: détecter les changements de page pour savoir quand mesurer.
          </li>
          <li>
            <code>storage</code>&nbsp;: mémoriser l&apos;état (domaines autorisés, configuration en cache).
          </li>
          <li>
            <code>activeTab</code>&nbsp;: connaître le domaine de l&apos;onglet courant à l&apos;ouverture de la
            fenêtre de l&apos;extension.
          </li>
          <li>
            Accès aux sites&nbsp;: <strong>accordé par vous, domaine par domaine</strong>, jamais sur{" "}
            <code>&lt;all_urls&gt;</code> de façon implicite.
          </li>
        </ul>
      </LegalSection>

      <hr className="border-line" />

      <section lang="en">
        <h2 className="mb-2 text-base font-semibold text-ink">English summary</h2>
        <p className="text-ink-soft">
          The «&nbsp;{ORG.produit}&nbsp;» browser extension measures web performance (Core Web Vitals) and technical
          JavaScript errors, only on domains registered by your organisation and only after you grant permission per
          domain. It collects performance data tied to random session and visitor identifiers (pseudonymous, not
          anonymous) — <strong>no name, no email, no keystrokes, no form content, no IP address stored</strong>.
          Measurement data is stored and processed in the European Union (Frankfurt and Amsterdam) by hosting
          providers incorporated in the United States, under the European Commission&apos;s standard contractual
          clauses. It is deleted after 30 days by default, and never sold or used for advertising. You can revoke
          permission per domain at any time from the extension popup.
        </p>
      </section>
    </LegalShell>
  );
}
