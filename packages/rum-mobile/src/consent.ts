// Gate de consentement et ÉPOQUES de collecte.
//
// Une époque est un intervalle de collecte révocable d'un seul geste. Tout ce
// qui entre en file en porte le numéro : la file mémoire, la file durable, et
// le lot en vol. Une révocation incrémente l'époque, et TOUT ce qui porte
// l'ancienne devient inéligible — y compris la réponse d'une requête partie
// avant le refus. Sans ce numéro, un acquittement tardif réinjecterait dans la
// file des événements que l'utilisateur vient de faire effacer.
//
// L'époque est PERSISTÉE avec l'identité : une file laissée sur le disque par un
// lancement précédent doit pouvoir être reconnue comme périmée au démarrage
// suivant, alors qu'un compteur mémoire serait revenu à sa valeur initiale.

export type EtatConsentement = "pending" | "granted" | "denied";

/**
 * Tampon mémoire autorisé en attente de consentement — même plafond que le
 * contrat P2 du SDK web (`CONSENT_BUFFER_CAP`). En `pending`, aucun octet ne
 * part sur le réseau ni sur le disque : ce tampon est tout ce qui existe, et il
 * doit rester petit pour qu'un consentement jamais donné ne coûte pas de
 * mémoire à l'application hôte.
 */
export const PENDING_MAX_EVENTS = 200;

export class ConsentGate {
  private etat: EtatConsentement;
  private epoque: number;

  constructor(requireConsent: boolean, initial: EtatConsentement | undefined, epoqueInitiale: number) {
    // `initialConsent` prime sur `requireConsent` quand il est fourni :
    // l'application qui a déjà recueilli une réponse la déclare, et n'a pas à
    // rejouer son écran de consentement à chaque lancement.
    this.etat = initial ?? (requireConsent ? "pending" : "granted");
    this.epoque = epoqueInitiale;
  }

  get state(): EtatConsentement {
    return this.etat;
  }

  get epoch(): number {
    return this.epoque;
  }

  /** La collecte peut-elle produire du réseau et du disque ? */
  get granted(): boolean {
    return this.etat === "granted";
  }

  /** Un événement peut-il au moins entrer en mémoire ? */
  get collecte(): boolean {
    return this.etat !== "denied";
  }

  /**
   * Applique une décision. Rend `true` si l'époque a été RÉVOQUÉE — l'appelant
   * doit alors purger, synchronement et avant tout nouvel enqueue.
   *
   * Un `granted` après un refus n'incrémente pas l'époque une seconde fois :
   * l'incrément a déjà eu lieu au refus, et la nouvelle collecte s'y rattache.
   * Incrémenter aux deux transitions abandonnerait sur le disque une file
   * d'époque orpheline que plus rien ne viendrait nettoyer.
   */
  set(granted: boolean): boolean {
    if (!granted) {
      const revoque = this.etat !== "denied";
      this.etat = "denied";
      if (revoque) this.epoque++;
      return revoque;
    }
    this.etat = "granted";
    return false;
  }

  /**
   * Adopte l'époque lue sur le disque, quand elle est PLUS AVANCÉE que celle de
   * ce lancement. Le stockage est asynchrone : la gate démarre donc à l'époque
   * initiale, et la rattrape ici. On ne recule jamais — une époque qui reculerait
   * rendrait à nouveau éligible une file révoquée.
   */
  adopte(epoque: number): void {
    if (Number.isFinite(epoque) && epoque > this.epoque) this.epoque = Math.floor(epoque);
  }
}
