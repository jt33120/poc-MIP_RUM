"use client";
import { useState } from "react";
import { ICON_PATHS, Icon } from "@/components/icons";

export function PasswordField() {
  const [visible, setVisible] = useState(false);

  return (
    <label className="text-sm font-medium text-ink-soft">
      Mot de passe
      <div className="relative mt-1">
        <input
          name="password"
          type={visible ? "text" : "password"}
          required
          autoComplete="current-password"
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
    </label>
  );
}
