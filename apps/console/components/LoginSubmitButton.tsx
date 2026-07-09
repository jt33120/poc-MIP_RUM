"use client";
// Bouton de connexion avec état de chargement — le hash bcrypt côté serveur
// prend un court instant sans retour visuel autrement, donnant l'impression
// d'un bug (clic silencieux).
import { useFormStatus } from "react-dom";

export function LoginSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-accent flex items-center justify-center gap-2 py-2 text-center disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending && (
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      )}
      {pending ? "Connexion…" : "Se connecter"}
    </button>
  );
}
