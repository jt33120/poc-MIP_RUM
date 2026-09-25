// C9c — CE QU'UNE SERVER ACTION REND À SON FORMULAIRE QUAND SA COMMANDE A GÉNÉRÉ UN
// SECRET (mot de passe, clé d'ingestion, jeton de lecture). Le formulaire
// (`components/secret/SecretUnique.tsx`) le remet à l'écran, qui l'affiche une fois.
// Module neutre : l'action (serveur) et le formulaire (client) en partagent le type.

export type SecretRemis = {
  /** Sous quel nom l'écran le lira (`mot-de-passe`, `cle:<app>`, `jeton-lecture`). */
  nom: string;
  valeur: string;
  /** À qui il appartient : l'e-mail d'un compte, l'identifiant d'une application. */
  pour: string;
  /** La page où l'afficher, si ce n'est pas celle du formulaire. */
  aller?: string;
} | null;

/** Le nom sous lequel est remise la clé d'ingestion d'une application. */
export const cleDe = (app: string) => `cle:${app}`;
