// Politique de confidentialité PUBLIQUE de l'extension navigateur MIP RUM.
// URL exigée par le Chrome Web Store pour toute extension qui traite des données.
// Publique (cf. middleware) : ni login, ni scope projet. Contenu factuel, aligné
// sur la réalité de l'ingestion (scrub PII, résidence UE, TTL 30 j, DSAR).
export const dynamic = "force-static";

export const metadata = {
  title: "MIP RUM — Confidentialité de l'extension navigateur",
  description:
    "Ce que le capteur navigateur MIP RUM mesure, comment, et vos droits. Données pseudonymes, stockées en UE (Francfort).",
};

const UPDATED = "15 juillet 2026";

export default function ExtensionPrivacy() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-ink">
      <h1 className="text-2xl font-bold">Politique de confidentialité — Extension navigateur MIP RUM</h1>
      <p className="mt-2 text-sm text-ink-faint">Dernière mise à jour : {UPDATED}</p>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <p>
          L&apos;extension « MIP RUM — capteur navigateur » mesure la <strong>performance perçue</strong> et la
          <strong> fiabilité technique</strong> des pages web, pour les <em>domaines explicitement enregistrés</em>{" "}
          par MIP et <em>uniquement après votre autorisation</em>. Elle ne s&apos;active jamais sur d&apos;autres
          sites.
        </p>
      </section>

      <h2 className="mt-8 text-lg font-semibold">Données collectées</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
        <li>
          <strong>Métriques de performance</strong> (Core Web Vitals : LCP, INP, CLS, FCP, TTFB) et temps de
          chargement des ressources.
        </li>
        <li>
          <strong>Erreurs techniques JavaScript</strong> (message, type, pile d&apos;appel, fichier source) — la
          chaîne de requête des URL est retirée avant stockage.
        </li>
        <li>
          <strong>Contexte de page</strong> : URL/route normalisée, référent d&apos;origine, type d&apos;appareil
          (desktop/mobile), user-agent du navigateur.
        </li>
        <li>
          <strong>Identifiants pseudonymes</strong> : un identifiant de session et un identifiant de visiteur,
          tirés au hasard et gardés dans le stockage local du navigateur, sans lien avec votre identité ni avec
          le poste. Ils relient les pages d&apos;une visite, et les visites entre elles. C&apos;est un
          pseudonyme, pas une donnée anonyme : vider le stockage local du site l&apos;efface.
        </li>
        <li>
          <strong>Pays approximatif</strong> déduit du <em>fuseau horaire</em> du navigateur — <strong>aucune
          adresse IP n&apos;est stockée</strong>.
        </li>
        <li>
          <strong>Déclaration d&apos;installation</strong> : toutes les 6 h, l&apos;extension signale son
          existence à la console — un identifiant d&apos;installation tiré au hasard (dérivé d&apos;aucune
          caractéristique de la machine), sa version, et les applications supervisées pour lesquelles elle a
          effectivement mesuré. <strong>Aucune page visitée n&apos;accompagne cette déclaration.</strong> Elle
          sert à l&apos;administrateur du parc à savoir quels postes sont équipés et à jour. Si votre
          organisation pousse un libellé de poste par sa politique d&apos;entreprise, ce libellé est transmis
          avec — c&apos;est le seul nom que la console peut afficher, et il vient d&apos;elle, jamais de MIP.
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Ce qui n&apos;est PAS collecté</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
        <li>Aucun nom, aucune adresse e-mail, aucun profil publicitaire.</li>
        <li>Aucune frappe clavier, aucun contenu de formulaire, aucun mot de passe.</li>
        <li>Aucun historique de navigation hors des domaines enregistrés et autorisés.</li>
        <li>
          Aucune URL dans la déclaration d&apos;installation, et aucun nom d&apos;utilisateur, de session
          Windows ou de compte : l&apos;identifiant d&apos;installation n&apos;est relié à aucune personne.
        </li>
        <li>Aucune revente de données, aucun usage à des fins étrangères à la mesure de performance.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Finalité et base</h2>
      <p className="mt-3 text-sm leading-relaxed">
        Les données servent <strong>exclusivement</strong> à mesurer et améliorer la performance et la fiabilité
        des sites concernés (Real User Monitoring). Elles ne sont ni vendues, ni transférées à des tiers, ni
        utilisées pour du ciblage.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Hébergement, conservation, droits</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
        <li>
          <strong>Résidence UE</strong> : base de données en Union européenne (Neon, AWS Francfort). Le
          traitement, lui, passe par la console hébergée sur Vercel, dont les fonctions serveur sont
          servies depuis les États-Unis.
        </li>
        <li>
          <strong>Conservation</strong> : purge automatique après <strong>30 jours</strong> (TTL).
        </li>
        <li>
          <strong>Droits RGPD</strong> (accès, effacement) : exerçables via MIP, à partir de l&apos;identifiant
          de visiteur. Les données étant pseudonymes, MIP ne peut pas, seul, relier une mesure à une personne.
        </li>
        <li>
          <strong>Contrôle</strong> : vous activez et retirez l&apos;autorisation par domaine à tout moment depuis
          le popup de l&apos;extension.
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Permissions de l&apos;extension</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
        <li>
          <code>scripting</code> — injecter le capteur de mesure sur les pages des domaines autorisés.
        </li>
        <li>
          <code>webNavigation</code> — détecter les changements de page pour savoir quand mesurer.
        </li>
        <li>
          <code>storage</code> — mémoriser l&apos;état (domaines autorisés, cache de configuration).
        </li>
        <li>
          <code>activeTab</code> — connaître le domaine de l&apos;onglet courant lors de l&apos;ouverture du popup.
        </li>
        <li>
          Accès aux hôtes — <strong>accordé par vous, domaine par domaine</strong> ; jamais sur
          <code> &lt;all_urls&gt;</code> de façon implicite.
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Contact</h2>
      <p className="mt-3 text-sm leading-relaxed">
        Pour toute question relative à cette politique ou à l&apos;exercice de vos droits : contactez MIP.
      </p>

      <hr className="my-10 border-line" />

      <h2 className="text-base font-semibold">English summary</h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        The « MIP RUM » browser extension measures web performance (Core Web Vitals) and technical JavaScript
        errors, only on domains explicitly registered by MIP and only after you grant permission per domain. It
        collects performance data tied to random session and visitor identifiers (pseudonymous, not anonymous)
        — <strong>no name, no email, no keystrokes, no form content, no IP address stored</strong>. Data is hosted in the EU, deleted after 30
        days, and never sold or used for advertising. You can revoke permission per domain at any time from the
        extension popup.
      </p>
    </main>
  );
}
