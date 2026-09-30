"use client";
// Le bouton de l'inscription, avec son état d'attente : le service hache le mot de
// passe (bcrypt) et crée le compte et le site d'une traite — une seconde ou deux
// sans retour visuel ressembleraient à un clic perdu, et un second clic compterait
// une deuxième tentative dans les trois de l'heure.
import { useFormStatus } from "react-dom";

export function BoutonInscription() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="inscription-envoyer"
      className="btn-accent flex items-center justify-center gap-2 py-2 text-center disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending && (
        <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      )}
      {pending ? "Création du compte…" : "Créer mon compte"}
    </button>
  );
}
