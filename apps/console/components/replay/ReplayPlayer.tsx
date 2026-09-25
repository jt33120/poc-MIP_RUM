"use client";
// Lecteur de session replay : le Replayer de @rrweb/replay, monté sur les events
// reconstruits par /api/replay/[sessionId] (gunzip + concat côté serveur). Import
// dynamique côté client uniquement : le Replayer manipule window/document dès sa
// construction.
//
// POURQUOI PAS rrweb-player. Le build installé de rrweb-player@2.0.1 n'instancie
// jamais de Replayer (aucun `new Replayer` dans son dist ; `getMetaData` et `goto`
// indéfinis à l'exécution) : l'onglet affichait un contrôleur qui ne rejouait rien.
// On pilote donc le Replayer directement — lecture, pause, positionnement sur
// l'instant d'une erreur (P5.1) et mise à l'échelle.
//
// F47 (plan § 4.1, § 5.12.4) — ce que le lecteur ajoute :
//   · un en-tête de COUVERTURE dans tous ses états (`TEXTE_COUVERTURE`) : ce qui
//     est masqué, combien de temps c'est gardé, ce que l'enregistrement couvre ;
//   · vitesses 1× / 2× / 4× et « Sauter l'inactivité » : `setConfig({ speed })` et
//     `setConfig({ skipInactive })` du Replayer de @rrweb/replay 2.0.1 — le « non
//     établi » du plan est levé en lisant le code livré (machine `speed`, saut au-delà
//     de 10 s sans interaction) ;
//   · une barre de progression porteuse de repères : un clic place la tête ;
//   · « Réessayer » quand le chargement échoue ;
//   · `ignores` (B36) : des segments illisibles sont DITS, jamais tus ;
//   · `tronques` (C3) : les segments au-delà du plafond d'une session, dits aussi ;
//   · `onTemps` et la commande `allerA`, pour l'îlot `ReplaySynchro`.
// LE MASQUAGE N'EST PAS TOUCHÉ : le lecteur ne rejoue que ce qui a été enregistré
// (masqué à la source, `packages/rum-sdk/src/replay.ts`), et aucun réglage passé au
// Replayer ne rend quoi que ce soit visible (ni canvas rejoué, ni style injecté).
import type { Replayer } from "@rrweb/replay";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import "@rrweb/replay/dist/style.css";
import { EtatSurface } from "@/components/states/EtatSurface";
import { formater } from "@/lib/fmt-ids";
import {
  TEXTE_COUVERTURE,
  VITESSES,
  lireIgnores,
  messagePosition,
  positionSurBarre,
  reperesHorsBarre,
  texteIgnores,
  texteTronques,
  textesReperesHorsBarre,
  type Marqueur,
  type SourcePosition,
  type TonMarqueur,
  type Vitesse,
} from "@/lib/replay-synchro";

type State = "loading" | "empty" | "error" | "ready";
/** none : aucun instant demandé ; positioned : calé dessus ; unavailable : hors enregistrement. */
type OffsetState = "none" | "positioned" | "unavailable";
interface Viewport {
  width: number;
  height: number;
}

const INDISPONIBLE = "Replay indisponible à cet instant";

/** Commande de la tête de lecture, tenue par l'îlot `ReplaySynchro`. */
export interface CommandeLecteur {
  /** Place la tête à `t` (epoch ms), en pause ; hors de l'enregistrement, l'annonce sans bouger. */
  allerA(t: number, source: SourcePosition): void;
}

/** Couleur d'un repère (jetons de F01) : jamais seule, le libellé et la légende la doublent. */
const TON_REPERE: Record<TonMarqueur, string> = {
  erreur: "bg-bad",
  frustration: "bg-warn",
  vue: "bg-ink-soft",
  action: "bg-brand",
};
const NOM_TON: Record<TonMarqueur, string> = {
  erreur: "Erreurs",
  frustration: "Frustration",
  vue: "Pages vues",
  action: "Actions",
};
const TONS = Object.keys(TON_REPERE) as TonMarqueur[];

export default function ReplayPlayer({
  sessionId,
  atMs,
  marqueurs,
  onTemps,
  ref,
}: {
  sessionId: string;
  /** `?at=` (epoch ms) : l'instant demandé par le lien, jamais deviné. */
  atMs: number | null;
  /** Repères de la barre (erreurs, signaux, vues, actions), epoch ms. */
  marqueurs: Marqueur[];
  /** Temps courant (epoch ms), passé par l'îlot `ReplaySynchro` seulement. */
  onTemps?: (ms: number) => void;
  /** React 19 : `ref` est une prop — la commande `allerA` de l'îlot. */
  ref?: Ref<CommandeLecteur>;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const replayer = useRef<Replayer | null>(null);
  /** Demande arrivée avant la fin du chargement : appliquée dès que le Replayer existe. */
  const enAttente = useRef<{ t: number; source: SourcePosition } | null>(null);
  const reglages = useRef<{ vitesse: Vitesse; sauter: boolean }>({ vitesse: 1, sauter: false });
  const derniers = useRef({ atMs, marqueurs, onTemps });
  derniers.current = { atMs, marqueurs, onTemps };
  const [state, setState] = useState<State>("loading");
  const [tentative, setTentative] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [ignores, setIgnores] = useState(0);
  const [tronques, setTronques] = useState(0);
  const [offset, setOffset] = useState<{ etat: OffsetState; source: SourcePosition | null; message: string }>({
    etat: "none",
    source: null,
    message: "",
  });
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [available, setAvailable] = useState(0);
  const [bornes, setBornes] = useState<{ debut: number; fin: number } | null>(null);
  const [courant, setCourant] = useState(0);
  const [enLecture, setEnLecture] = useState(false);
  const [vitesse, setVitesse] = useState<Vitesse>(1);
  const [sauter, setSauter] = useState(false);
  const [saut, setSaut] = useState(false);

  const allerA = useCallback((t: number, source: SourcePosition) => {
    const r = replayer.current;
    if (!r) {
      enAttente.current = { t, source };
      return;
    }
    // Borné au contenu : un instant hors de l'enregistrement n'est pas « à peu près »
    // rejouable. On l'annonce ; un lien reste au début, une ligne ne bouge pas la tête.
    const { startTime, endTime } = r.getMetaData();
    const dedans = t >= startTime && t <= endTime;
    if (dedans) r.pause(t - startTime);
    else if (source === "url") r.pause(0);
    setOffset({
      etat: dedans ? "positioned" : "unavailable",
      source,
      message: dedans ? messagePosition(source, t, derniers.current.marqueurs, startTime) : INDISPONIBLE,
    });
    const ici = dedans ? t - startTime : r.getCurrentTime();
    setCourant(ici);
    derniers.current.onTemps?.(startTime + ici);
  }, []);

  useImperativeHandle(ref, () => ({ allerA }), [allerA]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");

    (async () => {
      try {
        const res = await fetch(`/api/replay/${encodeURIComponent(sessionId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { events?: unknown[]; ignores?: unknown; tronques?: unknown };
        const events = Array.isArray(data.events) ? data.events : [];
        if (cancelled) return;
        setIgnores(lireIgnores(data.ignores));
        setTronques(lireIgnores(data.tronques));
        if (events.length < 2) {
          // rrweb exige ≥ 2 events (meta + full snapshot) pour rejouer
          setState("empty");
          return;
        }
        const rrweb = await import("@rrweb/replay");
        if (cancelled || !host.current) return;
        const r = new rrweb.Replayer(events as ConstructorParameters<typeof rrweb.Replayer>[0], {
          root: host.current,
          speed: reglages.current.vitesse,
          skipInactive: reglages.current.sauter,
        });
        replayer.current = r;
        // Dimensions de la page enregistrée (event Meta, puis chaque redimensionnement) :
        // la base de la mise à l'échelle.
        r.on("resize", (dimension) => setViewport(dimension as Viewport));
        r.on("start", () => setEnLecture(true));
        r.on("resume", () => setEnLecture(true));
        r.on("pause", () => setEnLecture(false));
        r.on("finish", () => setEnLecture(false));
        r.on("skip-start", () => setSaut(true));
        r.on("skip-end", () => setSaut(false));
        const { startTime, endTime } = r.getMetaData();
        setBornes({ debut: startTime, fin: endTime });
        setEventCount(events.length);
        setState("ready");
        // La demande en attente (ligne focalisée pendant le chargement), sinon `?at=`,
        // sinon la première image : ce que le visiteur voyait à l'ouverture.
        const { atMs: at } = derniers.current;
        const demande = enAttente.current ?? (at !== null ? { t: at, source: "url" as const } : null);
        enAttente.current = null;
        if (demande) allerA(demande.t, demande.source);
        else r.pause(0);
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
      replayer.current?.destroy();
      replayer.current = null;
    };
  }, [sessionId, tentative, allerA]);

  // `?at=` qui change (lien suivi sans rechargement) : la tête suit, sans relire les segments.
  useEffect(() => {
    if (atMs !== null && replayer.current) allerA(atMs, "url");
  }, [atMs, allerA]);

  // Pendant la lecture : la barre avance et l'îlot reçoit le temps courant, 4 fois par seconde.
  useEffect(() => {
    if (!enLecture) return;
    const id = window.setInterval(() => {
      const r = replayer.current;
      if (!r) return;
      const ici = r.getCurrentTime();
      setCourant(ici);
      derniers.current.onTemps?.(r.getMetaData().startTime + ici);
    }, 250);
    return () => window.clearInterval(id);
  }, [enLecture]);

  // Largeur réellement disponible, suivie : elle change avec la fenêtre et le menu.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function play() {
    const r = replayer.current;
    if (!r) return;
    // Reprend là où le lecteur s'est arrêté ; au bout de l'enregistrement, repart du début.
    const current = r.getCurrentTime();
    r.play(current >= r.getMetaData().totalTime ? 0 : current);
  }

  function choisirVitesse(v: Vitesse) {
    reglages.current.vitesse = v;
    setVitesse(v);
    replayer.current?.setConfig({ speed: v });
  }

  function basculerSaut() {
    const s = !reglages.current.sauter;
    reglages.current.sauter = s;
    setSauter(s);
    replayer.current?.setConfig({ skipInactive: s });
  }

  function glisser(v: number) {
    const r = replayer.current;
    if (!r || !bornes) return;
    r.pause(v);
    setCourant(v);
    setOffset({ etat: "none", source: null, message: "" });
    derniers.current.onTemps?.(bornes.debut + v);
  }

  // Jamais agrandie au-delà de sa taille enregistrée, réduite pour tenir dans la carte.
  const scale = viewport && available > 0 ? Math.min(1, available / viewport.width) : 1;
  const total = bornes ? Math.max(0, bornes.fin - bornes.debut) : 0;
  const reperes = bornes
    ? marqueurs.flatMap((m) => {
        const p = positionSurBarre(m.t, bornes.debut, bornes.fin);
        return p === null ? [] : [{ m, p }];
      })
    : [];
  // Hors de la barre, AVANT et APRÈS se disent à part : une vue initiale émise avant
  // le chargement du module de rejeu n'est pas une coupure à 2 minutes ou 1 Mo.
  const horsBarre = bornes ? textesReperesHorsBarre(reperesHorsBarre(marqueurs, bornes.debut, bornes.fin)) : [];

  return (
    <div
      className="card min-w-0 p-4 sm:p-6"
      data-testid="replay-player"
      data-state={state}
      data-events={eventCount}
      data-ignores={ignores}
      data-tronques={tronques}
    >
      <p className="mb-3 text-xs leading-relaxed text-ink-soft" data-testid="replay-couverture">
        {TEXTE_COUVERTURE}
      </p>
      {ignores > 0 && state === "ready" && (
        <div className="mb-3">
          <EtatSurface compact etat={{ kind: "partiel", raison: `${texteIgnores(ignores)} : le rejeu peut sauter des passages` }} />
        </div>
      )}
      {tronques > 0 && state === "ready" && (
        <div className="mb-3" data-testid="replay-tronque">
          <EtatSurface compact etat={{ kind: "partiel", raison: texteTronques(tronques) }} />
        </div>
      )}
      {state === "loading" && (
        <p className="py-8 text-center text-sm text-ink-soft">Chargement du replay…</p>
      )}
      {state === "empty" && ignores > 0 && (
        <div className="py-2" data-testid="replay-empty">
          <h3 className="text-sm font-bold tracking-tight">Rejeu incomplet</h3>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            {texteIgnores(ignores)} : ce qui reste ne suffit pas à reconstruire la page (il faut au moins
            l&apos;instantané initial).
          </p>
        </div>
      )}
      {state === "empty" && ignores === 0 && (
        <div className="py-2" data-testid="replay-empty">
          <h3 className="text-sm font-bold tracking-tight">Aucun rejeu pour cette session</h3>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            Le session replay est <strong>activé</strong>, mais aucun enregistrement n&apos;a été
            capturé pour cette session — le plus souvent une session trop courte, un signal{" "}
            <strong>DNT/GPC</strong> ou un consentement refusé, ou un navigateur sans{" "}
            <code className="rounded bg-panel2 px-1">CompressionStream</code>.
          </p>
          <p className="mt-3 max-w-2xl text-sm text-ink-soft">
            Quand un rejeu existe, les saisies sont <strong>masquées à l&apos;enregistrement</strong>{" "}
            (<code className="rounded bg-panel2 px-1">maskAllInputs</code>) et les blocs{" "}
            <code className="rounded bg-panel2 px-1">mip-rum-block</code> exclus ; chunks gzip stockés
            avec TTL 30 j (RGPD).
          </p>
        </div>
      )}
      {state === "error" && (
        <div className="py-6 text-center" data-testid="replay-erreur">
          <p className="text-sm text-bad-ink">Replay indisponible : le chargement des segments a échoué.</p>
          <button type="button" className="btn-accent mt-3" onClick={() => setTentative((n) => n + 1)}>
            Réessayer
          </button>
        </div>
      )}
      {state === "ready" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-accent" onClick={play}>
            Lecture
          </button>
          <button type="button" className="btn-ghost" onClick={() => replayer.current?.pause()}>
            Pause
          </button>
          <div role="group" aria-label="Vitesse de lecture" className="flex overflow-hidden rounded-md border border-line" data-testid="replay-vitesses">
            {VITESSES.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={vitesse === v}
                onClick={() => choisirVitesse(v)}
                className={`px-2 py-1 text-xs font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-perf ${
                  vitesse === v ? "bg-brand/10 text-brand" : "text-ink-soft hover:text-ink"
                }`}
              >
                {v}×
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={sauter}
            onClick={basculerSaut}
            className={`btn-ghost text-xs ${sauter ? "text-brand" : ""}`}
            data-testid="replay-saut"
          >
            Sauter l&apos;inactivité
          </button>
          <p className="text-xs text-ink-soft">{formater("count", eventCount)} événements rrweb</p>
        </div>
      )}
      {state === "ready" && saut && (
        <p role="status" className="mb-2 text-xs text-ink-soft">
          Inactivité : avance rapide jusqu&apos;à la prochaine interaction.
        </p>
      )}
      {state === "ready" && bornes && (
        <div className="mb-3 min-w-0" data-testid="replay-progression">
          {reperes.length > 0 && (
            // Repères posés au-dessus du curseur ; `mx-2` suit la demi-largeur du bouton
            // du curseur natif, pour qu'un repère tombe au bon endroit de la piste.
            <ol aria-label="Repères de la session dans l'enregistrement" className="relative mx-2 h-3">
              {reperes.map(({ m, p }, i) => (
                <li key={i} className="absolute top-0 -translate-x-1/2" style={{ left: `${p}%` }}>
                  <button
                    type="button"
                    onClick={() => allerA(m.t, "marqueur")}
                    aria-label={`${NOM_TON[m.ton]} — ${m.libelle}, à +${formater("s-auto", m.t - bornes.debut)}`}
                    title={`${m.libelle} (+${formater("s-auto", m.t - bornes.debut)})`}
                    className={`block h-3 w-1.5 rounded-sm ${TON_REPERE[m.ton]} hover:ring-2 hover:ring-perf focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf`}
                    data-testid="replay-repere"
                    data-ton={m.ton}
                  />
                </li>
              ))}
            </ol>
          )}
          <input
            type="range"
            min={0}
            max={total}
            step={100}
            value={Math.min(courant, total)}
            onChange={(e) => glisser(Number(e.target.value))}
            aria-label="Position dans l'enregistrement"
            aria-valuetext={`${formater("s-auto", Math.min(courant, total))} sur ${formater("s-auto", total)}`}
            className="w-full accent-brand"
            data-testid="replay-curseur"
          />
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-soft">
            {TONS.map((ton) => {
              const n = reperes.filter((r) => r.m.ton === ton).length;
              return n > 0 ? (
                <span key={ton} className="inline-flex items-center gap-1">
                  <span aria-hidden="true" className={`inline-block h-2 w-1.5 rounded-sm ${TON_REPERE[ton]}`} />
                  {NOM_TON[ton]} ({n})
                </span>
              ) : null;
            })}
            {horsBarre.map((texte) => (
              <span key={texte} data-testid="replay-reperes-hors-barre">
                {texte}
              </span>
            ))}
          </p>
        </div>
      )}
      {/* Région live présente dès le montage : une annonce n'est lue que si la
          région existait avant que son texte change. */}
      <p
        role="status"
        data-testid="replay-offset"
        data-offset-state={offset.etat}
        data-offset-source={offset.source ?? undefined}
        className="mb-3 text-sm font-medium text-ink empty:mb-0"
      >
        {offset.etat === "none" ? "" : offset.message}
      </p>
      {/* Le conteneur du Replayer reste monté en permanence : son iframe exige une
          racine attachée au document dès la construction, pendant que state vaut
          encore "loading". Vide et sans hauteur tant que la page enregistrée n'a pas
          annoncé ses dimensions ; ensuite réduit à la largeur de la carte (la page
          enregistrée garde sa mise en page, seule l'image est mise à l'échelle). */}
      <div ref={frame} className="overflow-x-auto">
        <div
          className="mx-auto overflow-hidden"
          style={viewport ? { width: viewport.width * scale, height: viewport.height * scale } : undefined}
        >
          <div
            ref={host}
            style={
              viewport
                ? { width: viewport.width, height: viewport.height, transform: `scale(${scale})`, transformOrigin: "0 0" }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
