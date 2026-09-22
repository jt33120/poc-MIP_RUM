import { Icon, ICON_PATHS } from "@/components/icons";

/** Une étape numérotée du parcours d'activation (séquence réelle → marqueurs 1..n). */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold tabular-nums text-accent"
        aria-hidden
      >
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{children}</p>
      </div>
    </li>
  );
}

/**
 * Guide d'activation de l'extension navigateur (Ext-C). Le registre de domaines
 * ci-dessous est la moitié « serveur » ; ces étapes sont la moitié « navigateur »
 * — sans le geste d'octroi de permission (clic « Activer sur ce domaine »),
 * aucune collecte n'a lieu, par conception (jamais de <all_urls> silencieux).
 */
export function ExtensionActivationGuide() {
  return (
    <div className="card mb-8 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon paths={ICON_PATHS.compass} className="h-5 w-5 text-accent" />
        <h2 className="text-sm font-semibold text-ink">Activer l&apos;extension sur un domaine</h2>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-ink-soft">
        Enregistrer un domaine ci-dessous (moitié <strong>serveur</strong>) ne suffit pas :
        l&apos;extension n&apos;observe un site qu&apos;après un <strong>clic d&apos;autorisation
        explicite</strong> dans son popup (moitié <strong>navigateur</strong>). C&apos;est
        volontaire — aucune collecte silencieuse. Voici le parcours complet, identique sur
        Chrome et Edge :
      </p>

      <ol className="flex flex-col gap-3.5">
        <Step n={1} title="Enregistrer le domaine">
          Ajoute le domaine du site (ex. <code className="chip-mono">insight-performance.com</code>{" "}
          et sa variante <code className="chip-mono">www.</code>) dans le registre ci-dessous, et
          rattache-le à la bonne app. Statut <span className="font-medium text-good-ink">actif</span> requis.
          L&apos;enregistrement <strong>autorise aussi automatiquement l&apos;origine à envoyer
          ses mesures</strong> (CORS) — plus de seconde étape manuelle.
        </Step>
        <Step n={2} title="Installer l'extension (durablement)">
          Épingle l&apos;extension MIP RUM dans le navigateur qui doit surveiller le site.{" "}
          <strong>Attention au piège</strong> : chargée en « <em>non empaquetée / Load unpacked</em> »,
          Chrome la <strong>retire au redémarrage</strong> — installe la version empaquetée
          (<code className="chip-mono">.crx</code> / store privé) pour qu&apos;elle persiste.
        </Step>
        <Step n={3} title="Ouvrir le site à surveiller">
          Navigue sur <strong>le site lui-même</strong> (ex. <code className="chip-mono">https://insight-performance.com</code>),
          pas sur cette console. L&apos;extension résout le domaine via le registre à chaque
          navigation.
        </Step>
        <Step n={4} title="Cliquer « Activer sur ce domaine »">
          Ouvre le popup de l&apos;extension : il affiche «&nbsp;<em>Domaine reconnu — autorisation
          requise</em>&nbsp;». Clique le bouton <strong>« Activer sur ce domaine »</strong> — il
          accorde la permission (geste utilisateur obligatoire) puis <strong>recharge
          l&apos;onglet</strong>.
        </Step>
        <Step n={5} title="Générer une mesure & vérifier">
          Au rechargement, le capteur s&apos;injecte et tague la source{" "}
          <code className="chip-mono">extension</code>. Clique/navigue quelques secondes sur le
          site (les Core Web Vitals ont besoin d&apos;un vrai parcours), puis reviens ici : en{" "}
          <strong>fenêtre 24&nbsp;h</strong> et indicateur <strong>LIVE</strong>, les mesures
          apparaissent en quelques secondes.
        </Step>
      </ol>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-panel2/60 px-3 py-2.5 text-xs leading-relaxed text-ink-faint">
        <Icon paths={ICON_PATHS.info} className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />
        <span>
          Tableau vide alors que tout est branché ? Vérifie la <strong>fenêtre</strong> (une
          session de plus de 24&nbsp;h n&apos;apparaît que sous «&nbsp;7&nbsp;j&nbsp;»), et que la
          session vient bien de la source <code className="chip-mono">extension</code> (une session{" "}
          <code className="chip-mono">sdk</code> provient d&apos;un chargement direct du SDK, pas de
          l&apos;extension). Le popup ne propose «&nbsp;Activer&nbsp;» que si le domaine est{" "}
          <strong>reconnu</strong> ici — sinon il indique «&nbsp;domaine non enregistré&nbsp;».
        </span>
      </div>
    </div>
  );
}
