// Brancher le serveur du client avec l'agent OpenTelemetry OFFICIEL de son
// langage : étape 3 de la fiche d'une application (app/admin/customers/[appId])
// et section « Brancher le serveur » de /select/new. Rendu serveur.
//
// Décision du 29/09/2026 : plus aucun capteur maison côté serveur — ni fichier à
// télécharger, ni middleware à poser. Chaque recette (lib/recettes-agents-otel.ts)
// est le socle commun des variables OTEL_*, prérempli, puis l'installation et le
// lancement de l'agent. La clé d'API passe par le secret remis : juste après sa
// création ou sa régénération, elle remplace le repère ; sinon le repère reste.
// La page doit envelopper l'étape d'un `SecretFourni` : plusieurs blocs lisent la
// même clé, et le premier qui la retirerait seul en priverait les autres.
//
// Recette du 26/09/2026 : plus de note interne, plus de nom de client, plus
// d'émoji ; jetons du thème pour suivre le mode sombre.
import { ICON_PATHS, Icon } from "@/components/icons";
import { CodeAvecSecret } from "@/components/secret/SecretUnique";
import { REPERE_CLE_API, type RecettesAgents } from "@/lib/recettes-agents-otel";

const TELECHARGER =
  "inline-flex w-fit items-center gap-1.5 rounded-lg bg-panel2 px-3 py-1.5 text-xs font-medium text-ink ring-1 ring-line transition hover:bg-app";
const BLOC = "min-w-0 rounded-lg border border-line px-3 py-2";
// Les pièges citent des variables d'une seule pièce (OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED,
// 52 caractères) : sans coupure possible, elles élargissaient la fiche client à 492 px sur un
// écran de 390 (E2E tableaux-defilants, 29/09/2026). `anywhere`, et non `break-word`, parce que
// seul `anywhere` réduit aussi la largeur minimale que la grille réserve au bloc.
const RESUME = "cursor-pointer text-xs font-medium text-ink [overflow-wrap:anywhere]";
const TEXTE = "text-xs leading-relaxed text-ink-soft [overflow-wrap:anywhere]";
// Une adresse entière dans le texte : à 390 px, elle doit pouvoir se couper.
const LIEN = "break-all text-brand hover:underline";

/** Les agents OpenTelemetry officiels, par langage (présentationnel). */
export function BackendStep({ recettes, nomSecret }: { recettes: RecettesAgents; nomSecret: string }) {
  // Le repère est nu dans les variables shell (`mip.api_key=COLLE_ICI_LA_CLE_API,…`).
  const code = (texte: string) => (
    <CodeAvecSecret nom={nomSecret} code={texte} repere={REPERE_CLE_API} rendu="copie" guillemets={false} />
  );
  return (
    <>
      <p className="mb-3 text-xs text-ink-soft">
        Côté serveur, rien à télécharger chez MIP : on installe l&apos;agent OpenTelemetry officiel du
        langage du serveur, réglé par quelques variables d&apos;environnement. Chaque appel est alors
        décomposé entre navigateur, réseau et serveur. Sans cette étape, la mesure côté navigateur
        fonctionne déjà.
      </p>
      <div className="grid gap-2" data-testid="recettes-agents">
        {recettes.agents.map((agent, i) => (
          <details key={agent.id} className={BLOC} open={i === 0} data-testid={`recette-${agent.id}`}>
            <summary className={RESUME}>
              {agent.titre} —{" "}
              <span className="text-ink-soft">
                {agent.precision}, {agent.etat}
              </span>
            </summary>
            <div className="mt-2 grid gap-2">
              {code(agent.code)}
              <ul className={`list-disc pl-5 ${TEXTE}`}>
                {agent.pieges.map((piege) => (
                  <li key={piege}>{piege}</li>
                ))}
              </ul>
              <p className={TEXTE}>
                Documentation de l&apos;agent :{" "}
                <a href={agent.documentation} target="_blank" rel="noreferrer" className={LIEN}>
                  {agent.documentation}
                </a>
              </p>
            </div>
          </details>
        ))}
        <details className={BLOC} data-testid="recette-autres">
          <summary className={RESUME}>
            Autre langage ({recettes.autres.map((a) => a.langage).join(", ")}…) —{" "}
            <span className="text-ink-soft">non éprouvé en production</span>
          </summary>
          <div className="mt-2 grid gap-2">
            <p className={TEXTE}>
              Le même socle vaut pour tout agent ou SDK OpenTelemetry : poser ces variables, puis suivre
              la page du langage —{" "}
              {recettes.autres.map((a, i) => (
                <span key={a.langage}>
                  {i > 0 && ", "}
                  <a href={a.documentation} target="_blank" rel="noreferrer" className={LIEN}>
                    {a.langage}
                  </a>
                </span>
              ))}
              . Go n&apos;a pas d&apos;agent sans code : le SDK s&apos;initialise dans <code>main</code> et lit
              les mêmes variables.
            </p>
            {code(recettes.socle)}
          </div>
        </details>
        <details className={BLOC} data-testid="recette-collecteur">
          <summary className={RESUME}>
            Facultatif — passer par un Collector OpenTelemetry (serveur sans accès à Internet, parc de
            processus)
          </summary>
          <p className={`mb-2 mt-2 ${TEXTE}`}>
            Le Collector, open source, reçoit l&apos;export des agents sur le réseau du client, regroupe
            les lots et les réémet vers la collecte MIP ; c&apos;est lui qui porte alors l&apos;identifiant
            et la clé de l&apos;application.
          </p>
          <div className="grid gap-2">
            <a href="/integrations/otel-collector.yaml" download className={TELECHARGER}>
              <Icon paths={ICON_PATHS.download} className="h-3.5 w-3.5" strokeWidth={2.2} />
              otel-collector.yaml (identifiant, clé et adresses de collecte à compléter)
            </a>
            {code(recettes.collecteur)}
          </div>
        </details>
      </div>
      <p className={`mt-3 ${TEXTE}`}>
        Remplacez le repère <code>{REPERE_CLE_API}</code> par la clé d&apos;API de l&apos;application
        (affichée une seule fois, à sa création ou à sa régénération) ; elle reste côté serveur. Les
        agents lisent les en-têtes <code>traceparent</code> et <code>tracestate</code> que pose le code
        de suivi : si l&apos;API est sur une autre origine que le site, elle doit les autoriser en CORS
        (<code>Access-Control-Allow-Headers: traceparent, tracestate</code>), sans quoi le navigateur
        bloque l&apos;appel. Chaque export compte dans la limite de
        débit de l&apos;application : pour un parc de plusieurs processus, allonger{" "}
        <code>OTEL_BLRP_SCHEDULE_DELAY</code> (5000, par exemple) ou passer par le Collector.
      </p>
    </>
  );
}
