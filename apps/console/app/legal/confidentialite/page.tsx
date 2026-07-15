import { LegalShell, LegalSection } from "@/components/legal/LegalShell";
import { ORG, SUBPROCESSORS } from "@/lib/legal";

export const dynamic = "force-static";
export const metadata = { title: "MIP RUM — Politique de confidentialité" };

export default function Confidentialite() {
  return (
    <LegalShell
      title="Politique de confidentialité"
      intro={
        <p>
          Cette politique décrit le traitement des données dans le cadre du service {ORG.produit}. Elle complète,
          pour le capteur navigateur, la <a href="/extension-privacy" className="text-accent-deep underline-offset-2 hover:underline dark:text-accent">politique dédiée à l'extension</a>.
        </p>
      }
    >
      <LegalSection n="1" title="Responsable de traitement et sous-traitant">
        <p>
          Pour les données de mesure collectées sur les sites des clients, {ORG.raisonSociale} agit en qualité de{" "}
          <strong>sous-traitant</strong> pour le compte du client (responsable de traitement) — cf.{" "}
          <a href="/legal/dpa" className="text-accent-deep underline-offset-2 hover:underline dark:text-accent">DPA</a>. Pour les
          données des comptes de la console, {ORG.raisonSociale} agit en qualité de{" "}
          <strong>responsable de traitement</strong>.
        </p>
      </LegalSection>

      <LegalSection n="2" title="Données traitées">
        <p>
          <strong>Mesures RUM</strong> : indicateurs de performance (Core Web Vitals), erreurs techniques
          (message, type, pile, source sans chaîne de requête), route/URL, type d'appareil, user-agent, identifiant
          de session anonyme (haché), pays déduit du fuseau horaire — <strong>aucune adresse IP stockée, aucune
          donnée directement identifiante</strong>.
        </p>
        <p>
          <strong>Comptes console</strong> : adresse e-mail, rôle, journaux d'accès (audit). <strong>Assistance IA</strong>{" "}
          (si activée) : uniquement des signaux agrégés, sans donnée personnelle.
        </p>
      </LegalSection>

      <LegalSection n="3" title="Finalités et bases légales">
        <ul className="list-disc space-y-1 pl-5">
          <li>Mesurer et améliorer la performance et la fiabilité des sites (exécution du contrat / intérêt légitime du client).</li>
          <li>Gérer les accès et la sécurité de la console (exécution du contrat, obligation de sécurité).</li>
          <li>Émettre des alertes et rapports (exécution du contrat).</li>
        </ul>
        <p>Les données ne sont ni vendues, ni utilisées à des fins publicitaires.</p>
      </LegalSection>

      <LegalSection n="4" title="Destinataires et sous-traitants ultérieurs">
        <p>Les données peuvent être traitées par les sous-traitants suivants&nbsp;:</p>
        <div className="overflow-x-auto">
          <table className="mt-1 w-full text-left text-xs">
            <thead className="text-ink-faint">
              <tr>
                <th className="py-1 pr-4 font-semibold">Sous-traitant</th>
                <th className="py-1 pr-4 font-semibold">Rôle</th>
                <th className="py-1 font-semibold">Localisation</th>
              </tr>
            </thead>
            <tbody className="text-ink-soft">
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name} className="border-t border-line">
                  <td className="py-1.5 pr-4">{s.name}</td>
                  <td className="py-1.5 pr-4">{s.role}</td>
                  <td className="py-1.5">{s.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection n="5" title="Transferts hors Union européenne">
        <p>
          Les données de mesure sont hébergées dans l'UE. Certains prestataires techniques (ex. hébergement de
          l'application) peuvent relever d'un groupe établi hors UE&nbsp;; les transferts éventuels sont encadrés par
          les garanties appropriées (clauses contractuelles types). {"["}À préciser selon la configuration retenue.{"]"}
        </p>
      </LegalSection>

      <LegalSection n="6" title="Durée de conservation">
        <p>
          Mesures RUM : suppression automatique après <strong>30 jours</strong> (TTL). Comptes et journaux : durée
          de la relation contractuelle, puis archivage/suppression selon les obligations légales.
        </p>
      </LegalSection>

      <LegalSection n="7" title="Vos droits">
        <p>
          Conformément au RGPD, les personnes concernées disposent des droits d'accès, de rectification,
          d'effacement, de limitation et d'opposition. Les mesures RUM étant anonymisées, l'identification directe
          d'une personne n'est en principe pas possible. Les demandes s'exercent auprès du responsable de traitement
          (le client pour les données RUM), avec l'assistance de {ORG.raisonSociale}. Contact : {ORG.dpo}.
        </p>
        <p>Une réclamation peut être introduite auprès de la CNIL.</p>
      </LegalSection>

      <LegalSection n="8" title="Cookies">
        <p>
          La console utilise un cookie strictement nécessaire à l'authentification (cookie de session). Le capteur
          RUM n'utilise pas de cookie publicitaire.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
