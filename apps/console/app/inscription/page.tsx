// L'INSCRIPTION EN LIBRE-SERVICE (publique, 30/09/2026) : un visiteur de la vitrine
// crée son compte ET son premier site en une fois, puis arrive sur l'installation
// du capteur de ce site, sa clé d'ingestion prête dans le snippet.
//
// Ouverte mais plafonnée, et c'est console-api qui le décide (`INSCRIPTIONS_PAR_JOUR`,
// `GET /v1/auth/methods`) : fermée, la page le dit et renvoie vers la démo ou la
// connexion. La page ne lit rien d'autre, et n'atteint pas la base : tout passe par
// le service (cliquet « Console sans base »).
//
// Un compte connecté n'a rien à faire ici : le MIDDLEWARE le renvoie à la console
// (GET seulement), pas cette page. Le cookie de session posé par l'action fait
// re-rendre la page dans la réponse de l'action (Next le fait pour toute action qui
// écrit un cookie) : si elle redirigeait un compte connecté, ce re-rendu jetterait le
// formulaire — et avec lui la clé d'ingestion, rendue une seule fois — avant qu'il
// ait pu la remettre à la page d'installation.
//
// Les erreurs arrivent par `?erreur=<code>` (l'action redirige) ; aucune valeur saisie
// ne passe dans l'URL, ni le mot de passe, ni l'adresse.
import Link from "next/link";
import { MOT_DE_PASSE_INSCRIPTION } from "@mip/console-contract";
import { BoutonInscription } from "@/components/inscription/BoutonInscription";
import { PasswordField } from "@/components/PasswordField";
import { BrandMark } from "@/components/presentation/Cadre";
import { FormulaireSecret } from "@/components/secret/SecretUnique";
import type { SearchParams } from "@/lib/filters";
import { methodesConnexion } from "@/lib/methodes-connexion";
import { inscrireAction } from "./actions";

export const dynamic = "force-dynamic";

/** Le code d'erreur posé par l'action → ce que la page en dit. */
const ERREURS: Record<string, string> = {
  email: "Adresse e-mail invalide.",
  mot_de_passe: `Mot de passe trop court ou trop long : ${MOT_DE_PASSE_INSCRIPTION.min} caractères au moins, ${MOT_DE_PASSE_INSCRIPTION.maxOctets} octets au plus.`,
  nom_site: "Donnez un nom à votre site (200 caractères au plus).",
  url_site: "Adresse du site invalide : attendez une URL http(s) complète (ex. https://mon-site.fr).",
  conditions: "Acceptez les conditions d'utilisation pour créer votre compte.",
  existe: "Un compte existe déjà avec cette adresse : connectez-vous.",
  plafond: "Trop d'inscriptions pour le moment : réessayez dans une heure.",
  fermee: "L'inscription est fermée pour le moment.",
  indisponible: "Service d'inscription indisponible : réessayez dans un instant.",
};

const LIEN = "font-medium text-accent-ink underline-offset-2 hover:underline";

export default async function Inscription({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const methodes = await methodesConnexion();
  const code = typeof sp.erreur === "string" ? sp.erreur : null;
  const erreur = code ? (ERREURS[code] ?? ERREURS.indisponible) : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="w-full max-w-md">
        <div className="animate-fade-up overflow-hidden rounded-2xl border border-line bg-panel shadow-pop">
          <div className="h-1 bg-gradient-to-r from-accent-deep via-accent to-accent-soft" />
          <div className="p-8">
            <div className="mb-6">
              <BrandMark />
              <h1 className="mt-4 text-lg font-semibold tracking-tight text-ink">Créer un compte</h1>
              <Link href="/presentation" className="mt-1 inline-block text-xs font-medium text-accent-ink underline-offset-2 hover:underline">
                ← Découvrir MIP RUM
              </Link>
            </div>
            {methodes.inscription ? <Formulaire erreur={erreur} /> : <Fermee demo={methodes.demo} />}
          </div>
        </div>
        <p className="mt-4 text-center text-[11px] tracking-wide text-ink-soft">
          Données hébergées en Union européenne, chez des hébergeurs de droit américain.
        </p>
      </div>
    </main>
  );
}

function Formulaire({ erreur }: { erreur: string | null }) {
  return (
    <>
      <p className="mb-5 rounded-lg border border-line bg-panel2 px-3 py-2.5 text-xs leading-relaxed text-ink-soft" data-testid="inscription-essai">
        Un essai : <strong className="text-ink">un site</strong>, que vous consultez en lecture, avec une collecte
        plafonnée. Le snippet du capteur vous attend à l&apos;étape suivante ; sa clé, ses origines et ses domaines
        restent gérés par MIP.
      </p>
      {/* La clé d'ingestion du site, rendue une fois, passe du formulaire à la page
          d'installation (C9c) : jamais par l'URL. */}
      <FormulaireSecret action={inscrireAction} testid="inscription-form" className="flex flex-col gap-4">
        <label className="text-sm font-medium text-ink-soft">
          Adresse e-mail
          <input name="email" type="email" required maxLength={200} autoComplete="email" autoFocus className="field mt-1 w-full" />
        </label>
        <PasswordField
          name="mot_de_passe"
          autoComplete="new-password"
          minLength={MOT_DE_PASSE_INSCRIPTION.min}
          aide={`${MOT_DE_PASSE_INSCRIPTION.min} caractères au moins.`}
        />
        <label className="text-sm font-medium text-ink-soft">
          Nom du site
          <input name="nom_site" required maxLength={200} placeholder="Ma boutique" autoComplete="off" className="field mt-1 w-full" />
        </label>
        <label className="text-sm font-medium text-ink-soft">
          Adresse du site
          <input name="url_site" type="url" required maxLength={2048} placeholder="https://…" autoComplete="url" className="field mt-1 w-full" />
        </label>
        <label className="flex items-start gap-2 text-sm text-ink-soft">
          <input name="conditions" type="checkbox" required className="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
          <span>
            J&apos;accepte les{" "}
            <Link href="/legal/cgu" target="_blank" className={LIEN}>
              conditions d&apos;utilisation
            </Link>{" "}
            et la{" "}
            <Link href="/legal/confidentialite" target="_blank" className={LIEN}>
              politique de confidentialité
            </Link>
            .
          </span>
        </label>
        {erreur && (
          <p role="alert" data-testid="inscription-erreur" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad-ink">
            {erreur}
          </p>
        )}
        <BoutonInscription />
      </FormulaireSecret>
      <p className="mt-5 border-t border-line pt-4 text-sm text-ink-soft">
        Déjà un compte ?{" "}
        <Link href="/login" data-testid="inscription-connexion" className={LIEN}>
          Se connecter
        </Link>
      </p>
    </>
  );
}

function Fermee({ demo }: { demo: boolean }) {
  return (
    <div data-testid="inscription-fermee">
      <p className="text-sm leading-relaxed text-ink-soft">
        L&apos;inscription est fermée pour le moment. Vous pouvez parcourir le compte de démonstration, ou vous connecter
        si un administrateur vous a déjà ouvert un compte.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {demo && (
          // Navigation document : /demo ouvre elle-même une session (comme depuis la vitrine).
          <a href="/demo" className="btn-accent px-4 py-2 text-sm" data-testid="inscription-demo">
            Voir le compte démo
          </a>
        )}
        <Link href="/login" className={demo ? `${LIEN} text-sm` : "btn-accent px-4 py-2 text-sm"}>
          Se connecter
        </Link>
      </div>
    </div>
  );
}
