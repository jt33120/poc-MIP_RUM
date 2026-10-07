// Partie 1 du dossier technique — « Ce qu'il contient » (plan § 8.2, PS2 à PS6 ; lot P**.3).
//
// Ce qui est livré et ce qui tourne, pièce par pièce, dans cet ordre : les capteurs
// (Capteurs.tsx, PS2), le chemin de la mesure (Topologie.tsx, PS3), les écrans de la
// console (EcransConsole.tsx, PS5), puis, pour un connecté seulement, « Brancher une
// application », et enfin les accès programmatiques et l'état de la chaîne (PS6, ici).
// L'hébergement et son droit (PS4) ne sont plus ici : ils ont une seule place, le
// tableau de la présentation (Hebergement.tsx), auquel le chemin de la mesure renvoie.
//
// RÈGLE DE LA PARTIE : rien ici n'est présenté
// comme une capacité (c'est la partie 2) ; chaque chiffre vient du document de
// couverture (lib/couverture.ts, lib/presentation-contient.ts) ou d'un fichier du
// dépôt qui le mesure (lib/sdk-poids.ts), avec sa date. Aucun n'est tapé ici.
//
// `user` ne change que deux choses : les écrans deviennent des liens, et le
// carrousel « Brancher une application » apparaît. Le dossier le transmet ; la partie
// ne relit pas la session.
import { AddClientCarousel } from "@/components/AddClientCarousel";
import { Capteurs } from "@/components/presentation/Capteurs";
import { EcransConsole } from "@/components/presentation/EcransConsole";
import { Partie } from "@/components/presentation/Partie";
import { SousPartie } from "@/components/presentation/SousPartie";
import { Topologie } from "@/components/presentation/Topologie";
import type { SessionUser } from "@/lib/auth";
import { RELEVE, TESTS_SQL, TESTS_SQL_VERTS, TESTS_UNITAIRES } from "@/lib/couverture";
import {
  BANC_CLICKHOUSE,
  FAMILLES_API_V1,
  OUTILS_MCP,
  RESERVES_CHAINE,
} from "@/lib/presentation-contient";
import { REPLAY_GZIP_KO, SDK_POIDS_TEXTE, koTexte } from "@/lib/sdk-poids";

const CODE = "rounded bg-app/70 px-1 py-0.5 font-mono text-[12.5px] text-ink";
const TITRE_CARTE = "text-sm font-semibold text-ink";

/** Un nombre écrit à la française : 3815 → « 3 815 ». */
const nombre = (n: number) => n.toLocaleString("fr-FR");

/**
 * PS6 — Autour de la console, et l'état de la chaîne. Deux colonnes, une seule
 * sous `md`.
 *
 * Accès programmatiques : E1, E2 (relevé de couverture) ; les deux nombres
 * sont lus dans leurs cellules « Preuve », et tus s'ils n'y sont plus.
 * État de la chaîne : décomptes du relevé (§ 2 du document, lib/couverture.ts),
 * poids mesurés (lib/sdk-poids.ts), et réserves de F2 et F3, relues dans la CI le
 * 26/09/2026 — chacune gardée par le verdict qu'elle suppose (lib/presentation-contient.ts).
 * Accès programmatiques : l'exception d'écriture est l'ancien chemin de
 * `POST /api/v1/deploys` (app/api/v1/deploys/route.ts, FIN_JETONS_HISTORIQUES).
 * Stockage : banc ClickHouse local (lib/presentation-contient.ts, BANC_CLICKHOUSE).
 */
function Chaine() {
  return (
    <SousPartie id="contient-chaine" titre="Autour de la console, et l'état de la chaîne">
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <div className="card p-5" data-testid="acces-programmatiques">
            <h4 className={TITRE_CARTE}>Accès programmatiques</h4>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Une API publique en lecture (
              {FAMILLES_API_V1 != null && <>{FAMILLES_API_V1} familles de routes, </>}
              description OpenAPI servie sur <code className={CODE}>/api-docs</code>) et un serveur MCP
              en lecture seule{OUTILS_MCP != null && <> ({OUTILS_MCP} outils)</>}. Les jetons
              d&apos;API ne donnent aucun droit d&apos;écriture, sauf celui de poser un marqueur de
              déploiement, jusqu&apos;au 31/12/2026.
            </p>
          </div>
          <div className="card p-5" data-testid="stockage">
            <h4 className={TITRE_CARTE}>Stockage</h4>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Pour les gros volumes, un chemin ClickHouse a été mesuré en local le {BANC_CLICKHOUSE.le} :
              mêmes p75 à la milliseconde près, stockage {BANC_CLICKHOUSE.compacite} fois plus compact à
              données identiques. Ce banc n&apos;a pas été rejoué depuis la migration vers Neon.
            </p>
          </div>
        </div>

        <div className="card min-w-0 p-5" data-testid="etat-chaine">
          <h4 className={TITRE_CARTE}>L&apos;état de la chaîne, relevé le {RELEVE}</h4>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
            {/* Verts ET ignorés, tous deux lus dans le document (lib/couverture.ts) : le total
                SQL présenté comme « verts » comptait les deux bancs, que la suite saute. */}
            <li>
              Sur un poste de développement : {nombre(TESTS_UNITAIRES.tests)} tests unitaires verts
              ({nombre(TESTS_UNITAIRES.fichiers)} fichiers) ; {nombre(TESTS_SQL.tests)} tests SQL
              ({nombre(TESTS_SQL.fichiers)} fichiers), dont {nombre(TESTS_SQL_VERTS)} verts et{" "}
              {nombre(TESTS_SQL.ignores.tests)} ignorés (les deux bancs de mesure, qui lisent une
              base préparée à part).
            </li>
            <li>
              SDK cœur : {SDK_POIDS_TEXTE} ; le module de rejeu ({koTexte(REPLAY_GZIP_KO)} ko gzip)
              n&apos;est chargé que si le rejeu est activé.
            </li>
            <li data-testid="etat-chaine-reserves">
              Ce que ces chiffres ne disent pas : {RESERVES_CHAINE.map((r) => r.texte).join(" ; ")}.
              Tester sur un poste ne dit rien du comportement sur du trafic réel.
            </li>
          </ul>
        </div>
      </div>
    </SousPartie>
  );
}

export function Contient({ user, demoOuverte = false }: { user: SessionUser | null; demoOuverte?: boolean }) {
  return (
    <Partie
      id="contient"
      chapeau={
        <>
          Ce qui est livré et ce qui tourne aujourd&apos;hui, pièce par pièce. Ce que chaque pièce sait
          faire, et ses limites, est dans la partie suivante.
        </>
      }
    >
      <div className="mt-12 space-y-16">
        <Capteurs />
        <Topologie />
        <EcransConsole user={user} demoOuverte={demoOuverte} />
        {user && (
          // Connecté seulement (plan § 8.2, PS5) : le tutoriel pas-à-pas. Le bouton
          // vers l'écran Clients n'est rendu qu'à un administrateur ; la session
          // démo est un viewer (app/demo/route.ts).
          <SousPartie id="contient-brancher" titre="Brancher une application">
            <div className="mt-6">
              <AddClientCarousel isAdmin={user.role === "admin"} />
            </div>
          </SousPartie>
        )}
        <Chaine />
      </div>
    </Partie>
  );
}
