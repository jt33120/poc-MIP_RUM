"use client";
import { useState } from "react";
import { ICON_PATHS, Icon } from "@/components/icons";

/**
 * Le champ mot de passe, avec son bouton « afficher ». La connexion le prend tel
 * quel ; l'inscription (30/09/2026) le nomme autrement, demande un mot de passe
 * NOUVEAU (le gestionnaire de mots de passe en propose un) et une longueur minimale.
 */
export function PasswordField({
  name = "password",
  autoComplete = "current-password",
  minLength,
  aide,
}: {
  name?: string;
  autoComplete?: "current-password" | "new-password";
  minLength?: number;
  /** Une consigne sous le champ, reliée par `aria-describedby`. */
  aide?: string;
} = {}) {
  const [visible, setVisible] = useState(false);
  const idAide = aide ? `${name}-aide` : undefined;

  return (
    <label className="text-sm font-medium text-ink-soft">
      Mot de passe
      <div className="relative mt-1">
        <input
          name={name}
          type={visible ? "text" : "password"}
          required
          autoComplete={autoComplete}
          minLength={minLength}
          aria-describedby={idAide}
          className="field w-full pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-faint hover:text-ink-soft"
        >
          <Icon paths={visible ? ICON_PATHS.eyeOff : ICON_PATHS.eye} className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
      {aide && (
        <span id={idAide} className="mt-1 block text-xs font-normal text-ink-soft">
          {aide}
        </span>
      )}
    </label>
  );
}
