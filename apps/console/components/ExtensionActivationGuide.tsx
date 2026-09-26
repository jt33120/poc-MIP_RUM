import { Icon, ICON_PATHS } from "@/components/icons";

/** Une étape numérotée du parcours d'activation (séquence réelle → marqueurs 1..n). */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold tabular-nums text-accent-ink"
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
 * est la moitié « serveur » ; ces étapes sont la moitié « navigateur » — sans le
 * geste d'octroi de permission (clic « Activer sur ce domaine »), aucune collecte
 * n'a lieu, par conception (jamais de <all_urls> silencieux).
 *
 * REPLIÉ, SOUS LE FORMULAIRE (recette du 26/09/2026) : ouvert en tête, le tutoriel
 * remplissait l'écran et repoussait l'action principale — enregistrer un domaine —
 * sous la ligne de flottaison. Il reste à un clic.
 */
export function ExtensionActivationGuide() {
  return (
    <details className="card group mb-8 p-5" data-testid="guide-activation-extension">
      {/* Un seul titre dans le résumé : c'est le modèle de contenu de <summary>. */}
      <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon paths={ICON_PATHS.compass} className="h-5 w-5 shrink-0 text-accent-ink" />
          Activer l&apos;extension sur un domaine : le parcours en 5 étapes
          <span aria-hidden className="ml-auto text-xs text-ink-soft transition group-open:rotate-180">
            ▾
          </span>
        </h2>
      </summary>

      <p className="mb-4 mt-4 text-sm leading-relaxed text-ink-soft">
        Enregistrer un domaine (moitié <strong>serveur</strong>) ne suffit pas : l&apos;extension n&apos;observe un
        site qu&apos;après un <strong>clic d&apos;autorisation explicite</strong> dans sa fenêtre (moitié{" "}
        <strong>navigateur</strong>). C&apos;est volontaire : aucune collecte silencieuse. Le parcours est le même
        sur Chrome et Edge.
      </p>

      <ol className="flex flex-col gap-3.5">
        <Step n={1} title="Enregistrer le domaine">
          Ajoutez le domaine du site (par exemple <code className="chip-mono">app.exemple.fr</code>, et sa variante{" "}
          <code className="chip-mono">www.</code> s&apos;il en a une) dans le registre, et rattachez-le à la bonne
          application. Statut <span className="font-medium text-good-ink">actif</span> requis. L&apos;enregistrement{" "}
          <strong>autorise aussi le site à envoyer ses mesures</strong> : aucune seconde étape manuelle.
        </Step>
        <Step n={2} title="Installer l'extension durablement">
          Épinglez l&apos;extension MIP RUM dans le navigateur qui doit observer le site.{" "}
          <strong>Attention</strong> : chargée « non empaquetée » (mode développeur), Chrome la{" "}
          <strong>retire au redémarrage</strong>. Installez la version empaquetée (fichier{" "}
          <code className="chip-mono">.crx</code> ou magasin privé) pour qu&apos;elle reste.
        </Step>
        <Step n={3} title="Ouvrir le site à observer">
          Naviguez sur <strong>le site lui-même</strong> (par exemple{" "}
          <code className="chip-mono">https://app.exemple.fr</code>), pas sur cette console. L&apos;extension vérifie
          le domaine auprès du registre à chaque navigation.
        </Step>
        <Step n={4} title="Cliquer « Activer sur ce domaine »">
          Ouvrez la fenêtre de l&apos;extension : elle affiche «&nbsp;<em>Domaine reconnu — autorisation
          requise</em>&nbsp;». Cliquez <strong>« Activer sur ce domaine »</strong> : l&apos;autorisation est accordée
          (le geste de l&apos;utilisateur est obligatoire), puis <strong>l&apos;onglet se recharge</strong>.
        </Step>
        <Step n={5} title="Produire une mesure et vérifier">
          Au rechargement, le capteur s&apos;installe et marque ses données de la source{" "}
          <code className="chip-mono">extension</code>. Cliquez et naviguez quelques secondes sur le site (les Core
          Web Vitals ont besoin d&apos;un vrai parcours), puis revenez dans la console : sur la{" "}
          <strong>fenêtre 24&nbsp;h</strong>, les mesures apparaissent en quelques secondes.
        </Step>
      </ol>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-panel2/60 px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
        <Icon paths={ICON_PATHS.info} className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />
        <span>
          Tableau vide alors que tout est branché ? Vérifiez la <strong>fenêtre</strong> (une session de plus de
          24&nbsp;h n&apos;apparaît que sous «&nbsp;7&nbsp;j&nbsp;»), et que la session vient bien de la source{" "}
          <code className="chip-mono">extension</code> (une session <code className="chip-mono">sdk</code> vient
          d&apos;un code de suivi posé directement sur le site, pas de l&apos;extension). La fenêtre de
          l&apos;extension ne propose «&nbsp;Activer&nbsp;» que si le domaine est <strong>reconnu</strong> ici ;
          sinon, elle indique «&nbsp;domaine non enregistré&nbsp;».
        </span>
      </div>
    </details>
  );
}
