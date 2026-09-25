"use client";
// C9c — UN SECRET À USAGE UNIQUE, DE LA COMMANDE À L'ÉCRAN.
//
// Un mot de passe, une clé d'ingestion, un jeton de lecture : la commande le génère,
// n'en garde que le haché et le rend UNE fois dans sa décision. La server action le
// rend à son formulaire (`useActionState`), qui le REMET à l'écran — sur la même
// page, ou sur celle où il navigue ensuite (la fiche de l'application qu'on vient de
// créer). L'écran le RETIRE en le lisant : recharger la page ne le montre plus.
//
// La remise est un registre de ce module, dans l'onglet : une navigation côté client
// le garde, un rechargement l'efface. Le secret ne repasse jamais par le serveur, ni
// par l'URL, ni par un stockage du navigateur — ni par le stash en mémoire du
// processus qu'il remplace, qui supposait que la même instance serve l'action puis la
// page : Vercel ne le promet pas, et console-api ne sert pas les pages.
import { createContext, useActionState, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Bookmarklet } from "@/components/onboarding/Bookmarklet";
import { CopyBlock } from "@/components/CopyBlock";
import type { SecretRemis } from "@/lib/secret-remis";

type Remis = { valeur: string; pour: string };

const registre = new Map<string, Remis>();
const EVENEMENT = "mip:secret-unique";

function remettre(s: NonNullable<SecretRemis>) {
  registre.set(s.nom, { valeur: s.valeur, pour: s.pour });
  window.dispatchEvent(new CustomEvent(EVENEMENT, { detail: s.nom }));
}

/** Retire le secret remis sous `nom` à sa première lecture ; `null` s'il n'y en a pas (ou plus). */
function useRetrait(nom: string): Remis | null {
  const [remis, setRemis] = useState<Remis | null>(null);
  useEffect(() => {
    const lire = () => {
      const s = registre.get(nom);
      if (!s) return; // déjà lu (ou jamais remis) : on garde ce qui est affiché
      registre.delete(nom);
      setRemis(s);
    };
    lire();
    const surRemise = (e: Event) => {
      if ((e as CustomEvent<string>).detail === nom) lire();
    };
    window.addEventListener(EVENEMENT, surRemise);
    return () => window.removeEventListener(EVENEMENT, surRemise);
  }, [nom]);
  return remis;
}

/**
 * Le formulaire d'une commande qui rend un secret. Ses champs sont rendus par la
 * page (serveur) ; il soumet à l'action, remet le secret qu'elle rend et, si
 * l'action le demande, navigue vers la page qui l'affiche.
 */
export function FormulaireSecret({
  action,
  children,
  className,
  testid,
}: {
  action: (precedent: SecretRemis, fd: FormData) => Promise<SecretRemis>;
  children: ReactNode;
  className?: string;
  testid?: string;
}) {
  const [etat, soumettre] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => {
    if (!etat) return;
    remettre(etat);
    if (etat.aller) router.push(etat.aller);
  }, [etat, router]);
  return (
    <form action={soumettre} className={className} data-testid={testid}>
      {children}
    </form>
  );
}

/** Un secret lu une fois par plusieurs éléments d'un écran (la clé d'un site : bandeau, bookmarklet, agent). */
const Fourni = createContext<{ nom: string; remis: Remis | null } | null>(null);

export function SecretFourni({ nom, children }: { nom: string; children: ReactNode }) {
  const remis = useRetrait(nom);
  return <Fourni.Provider value={{ nom, remis }}>{children}</Fourni.Provider>;
}

function useSecret(nom: string): Remis | null {
  const fourni = useContext(Fourni);
  const propre = useRetrait(fourni?.nom === nom ? "" : nom);
  return fourni?.nom === nom ? fourni.remis : propre;
}

/** Le bandeau du secret : rien s'il n'a pas été remis (ou s'il a déjà été lu). */
export function SecretAffiche({
  nom,
  prefixe,
  suffixe,
  note,
  className,
  codeClassName,
  testid = "one-time-secret",
  testidValeur = "generated-secret",
}: {
  nom: string;
  prefixe: ReactNode;
  suffixe: ReactNode;
  note?: ReactNode;
  className?: string;
  codeClassName?: string;
  testid?: string;
  testidValeur?: string;
}) {
  const remis = useSecret(nom);
  if (!remis) return null;
  return (
    <div data-testid={testid} className={className}>
      {prefixe} <strong>{remis.pour}</strong> {suffixe}{" "}
      <code data-testid={testidValeur} className={codeClassName}>
        {remis.valeur}
      </code>
      {note}
    </div>
  );
}

/** Un code qui porte le secret à la place d'un repère (`COLLE_ICI_LA_CLE_API`) quand il a été remis. */
export function CodeAvecSecret({
  nom,
  code,
  repere,
  rendu,
  label,
}: {
  nom: string;
  code: string;
  repere: string;
  rendu: "copie" | "bookmarklet";
  label?: string;
}) {
  const remis = useSecret(nom);
  const complet = remis ? code.split(JSON.stringify(repere)).join(JSON.stringify(remis.valeur)) : code;
  return rendu === "bookmarklet" ? <Bookmarklet code={complet} label={label ?? ""} /> : <CopyBlock code={complet} />;
}
