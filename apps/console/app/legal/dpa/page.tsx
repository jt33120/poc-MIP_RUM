import { LegalShell, LegalSection } from "@/components/legal/LegalShell";
import { ORG, SUBPROCESSORS } from "@/lib/legal";

export const dynamic = "force-static";
export const metadata = { title: "MIP RUM — Accord de traitement des données (DPA)" };

export default function DPA() {
  return (
    <LegalShell
      title="Accord de traitement des données (DPA)"
      printable
      intro={
        <p>
          Accord de sous-traitance au sens de l'article 28 du RGPD, conclu entre le Client (« Responsable de
          traitement ») et {ORG.raisonSociale} (« Sous-traitant »), annexé au contrat de service {ORG.produit}.
        </p>
      }
    >
      <LegalSection n="1" title="Parties">
        <p>
          <strong>Responsable de traitement</strong> : {"["}raison sociale, adresse, représentant{"]"} (le
          « Client »).
        </p>
        <p>
          <strong>Sous-traitant</strong> : {ORG.raisonSociale}, {ORG.adresse} (l'« Éditeur »).
        </p>
      </LegalSection>

      <LegalSection n="2" title="Objet et durée">
        <p>
          Le présent accord définit les conditions dans lesquelles le Sous-traitant traite, pour le compte du
          Responsable, les données personnelles nécessaires à la fourniture du service {ORG.produit}. Il s'applique
          pour toute la durée du contrat de service et jusqu'à la restitution ou suppression des données.
        </p>
      </LegalSection>

      <LegalSection n="3" title="Nature, finalité et périmètre du traitement">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Finalité</strong> : mesure de la performance et de la fiabilité des sites (Real User Monitoring).</li>
          <li><strong>Nature des opérations</strong> : collecte, enregistrement, agrégation, consultation, suppression.</li>
          <li>
            <strong>Catégories de données</strong> : indicateurs de performance, erreurs techniques, route/URL,
            type d'appareil, user-agent, identifiant de session anonyme, pays (via fuseau horaire). Aucune donnée
            directement identifiante n'est collectée par conception&nbsp;; aucune adresse IP n'est stockée.
          </li>
          <li><strong>Catégories de personnes</strong> : visiteurs des sites du Client.</li>
        </ul>
      </LegalSection>

      <LegalSection n="4" title="Obligations du Sous-traitant (art. 28.3)">
        <ul className="list-disc space-y-1 pl-5">
          <li>traiter les données uniquement sur instruction documentée du Responsable&nbsp;;</li>
          <li>garantir la confidentialité par les personnes autorisées à traiter les données&nbsp;;</li>
          <li>
            mettre en œuvre les mesures techniques et organisationnelles appropriées (art. 32) — cf. Annexe 2&nbsp;;
          </li>
          <li>
            ne recourir à un sous-traitant ultérieur qu'avec autorisation (cf. Annexe 1) et lui imposer les mêmes
            obligations&nbsp;;
          </li>
          <li>aider le Responsable à répondre aux demandes d'exercice des droits des personnes&nbsp;;</li>
          <li>
            aider le Responsable au regard des articles 32 à 36 (sécurité, notification de violation, analyses
            d'impact)&nbsp;;
          </li>
          <li>
            notifier au Responsable toute violation de données dans les meilleurs délais après en avoir pris
            connaissance&nbsp;;
          </li>
          <li>
            au choix du Responsable, supprimer ou restituer les données au terme de la prestation et détruire les
            copies existantes&nbsp;;
          </li>
          <li>
            mettre à disposition les informations nécessaires pour démontrer le respect de l'article 28 et permettre
            des audits.
          </li>
        </ul>
      </LegalSection>

      <LegalSection n="5" title="Localisation et transferts">
        <p>
          Les données de mesure sont hébergées dans l'Union européenne. Tout transfert hors UE éventuel via un
          sous-traitant ultérieur est encadré par des garanties appropriées (clauses contractuelles types).
        </p>
      </LegalSection>

      <LegalSection n="6" title="Annexe 1 — Sous-traitants ultérieurs autorisés">
        <div className="overflow-x-auto">
          <table className="mt-1 w-full text-left text-xs">
            <thead className="text-ink-faint">
              <tr>
                <th className="py-1 pr-4 font-semibold">Sous-traitant</th>
                <th className="py-1 pr-4 font-semibold">Traitement confié</th>
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

      <LegalSection n="7" title="Annexe 2 — Mesures de sécurité (art. 32)">
        <ul className="list-disc space-y-1 pl-5">
          <li>chiffrement des données en transit (TLS) et au repos côté hébergeur&nbsp;;</li>
          <li>minimisation et pseudonymisation : identifiants de session hachés, pas d'IP stockée, scrub PII à l'ingestion&nbsp;;</li>
          <li>résidence des données dans l'UE&nbsp;;</li>
          <li>contrôle d'accès basé sur les rôles (administrateur / lecteur), authentification, limitation du débit&nbsp;;</li>
          <li>journalisation des actions sensibles (audit)&nbsp;;</li>
          <li>suppression automatique des mesures après 30 jours (TTL).</li>
        </ul>
      </LegalSection>

      <LegalSection n="8" title="Signatures">
        <p className="text-ink-faint">Fait en deux exemplaires. Date et lieu : ______________________________</p>
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="rounded-lg border border-line p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Pour le Responsable</p>
            <p className="mt-6 text-sm">Nom : ____________________________</p>
            <p className="mt-3 text-sm">Fonction : ________________________</p>
            <p className="mt-6 text-xs text-ink-faint">Signature :</p>
            <div className="mt-1 h-16 rounded border border-dashed border-line" />
          </div>
          <div className="rounded-lg border border-line p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Pour le Sous-traitant</p>
            <p className="mt-6 text-sm">Nom : ____________________________</p>
            <p className="mt-3 text-sm">Fonction : ________________________</p>
            <p className="mt-6 text-xs text-ink-faint">Signature :</p>
            <div className="mt-1 h-16 rounded border border-dashed border-line" />
          </div>
        </div>
      </LegalSection>
    </LegalShell>
  );
}
