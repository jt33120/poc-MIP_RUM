import type { Config } from "tailwindcss";

// Design system « MIP RUM » — tokens sémantiques branchés sur les variables CSS
// de globals.css (clair/sombre). Couleurs de marque MIP (insight-performance.com) :
// navy #003399, orange #f89101.
export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "rgb(var(--c-app) / <alpha-value>)",
        panel: "rgb(var(--c-panel) / <alpha-value>)",
        panel2: "rgb(var(--c-panel2) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--c-ink) / <alpha-value>)",
          soft: "rgb(var(--c-ink-soft) / <alpha-value>)",
          faint: "rgb(var(--c-ink-faint) / <alpha-value>)",
        },
        brand: {
          DEFAULT: "rgb(var(--c-brand) / <alpha-value>)",
          strong: "rgb(var(--c-brand-strong) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "#f89101",
          soft: "#fbbc64",
          deep: "#d97b00",
        },
        // ---- Couleurs sémantiques (sens CONSTANT dans toute l'app) ----------
        // Domaine « Performance utilisateur » (RUM). Bleu.
        perf: { DEFAULT: "#2563eb", soft: "#dbeafe", ink: "#1d4ed8" },
        // Domaine « Intelligence artificielle » (usage LLM). Violet.
        ai: { DEFAULT: "#7c3aed", soft: "#ede9fe", ink: "#6d28d9" },
        // État d'une mesure : bon / à surveiller / mauvais (F01).
        //   DEFAULT → remplissages, bordures, teintes (bg-bad/10), suit le mode sombre ;
        //   ink     → TEXTE, 4,5:1 sur sa propre teinte, suit le mode sombre ;
        //   fond    → aplat sous du texte blanc (bouton « Supprimer »), constant.
        good: { DEFAULT: "rgb(var(--c-good) / <alpha-value>)", ink: "rgb(var(--c-good-ink) / <alpha-value>)", fond: "#047857" },
        warn: { DEFAULT: "rgb(var(--c-warn) / <alpha-value>)", ink: "rgb(var(--c-warn-ink) / <alpha-value>)", fond: "#b45309" },
        bad: { DEFAULT: "rgb(var(--c-bad) / <alpha-value>)", ink: "rgb(var(--c-bad-ink) / <alpha-value>)", fond: "#b91c1c" },
        // navy MIP fixe (texte sur boutons orange) — identique dans les deux modes
        navy: {
          700: "#16275c",
          800: "#0e1b45",
          900: "#0a1430",
          950: "#060c20",
        },
      },
      borderColor: {
        DEFAULT: "rgb(var(--c-line) / 1)",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "JetBrains Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgb(6 12 32 / 0.04), 0 2px 8px rgb(6 12 32 / 0.04)",
        pop: "0 4px 12px rgb(6 12 32 / 0.08), 0 12px 32px rgb(6 12 32 / 0.10)",
        glow: "0 0 20px rgb(248 145 1 / 0.35)",
      },
      minWidth: {
        // Largeur sémantique des tableaux denses à neuf colonnes. Au-dessous,
        // le conteneur défile sans élargir le document.
        table: "70rem",
      },
      keyframes: {
        "pulse-dot": {
          "0%": { boxShadow: "0 0 0 0 rgb(16 185 129 / 0.5)" },
          "70%": { boxShadow: "0 0 0 6px rgb(16 185 129 / 0)" },
          "100%": { boxShadow: "0 0 0 0 rgb(16 185 129 / 0)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-up": "fade-up 0.3s ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
