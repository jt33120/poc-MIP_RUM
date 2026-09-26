import { LegalShell, LegalSection } from "@/components/legal/LegalShell";
import { DPA, ORG } from "@/lib/legal";

export const dynamic = "force-static";
export const metadata = { title: "MIP RUM — Conditions générales de vente" };

// Chaque clause commerciale encore ouverte (prix, délais, SLA, plafond…) est un
// champ de `ORG` (lib/legal.ts), la liste de ce qu'il reste à fournir : rien n'est
// écrit en dur ici. Le DPA se dit « fourni sur demande » (`DPA`) — il n'est plus en
// ligne depuis le 22/09/2026, un lien serait mort.
export default function CGV() {
  return (
    <LegalShell
      title="Conditions générales de vente"
      printable
      intro={
        <p>
          Les présentes conditions (CGV) régissent la souscription au service {ORG.produit} entre{" "}
          {ORG.raisonSociale} (ci-après «&nbsp;l&apos;Éditeur&nbsp;») et le client professionnel (ci-après
          «&nbsp;le Client&nbsp;»).
        </p>
      }
    >
      <LegalSection n="1" title="Objet et champ d'application">
        <p>
          Les CGV s&apos;appliquent à toute souscription au service {ORG.produit}. Elles prévalent sur tout document
          du Client, sauf conditions particulières signées entre les parties.
        </p>
      </LegalSection>

      <LegalSection n="2" title="Souscription">
        <p>
          La souscription résulte d&apos;un bon de commande, d&apos;un devis accepté ou d&apos;une inscription en
          ligne. Elle emporte acceptation des présentes CGV et de {DPA}.
        </p>
      </LegalSection>

      <LegalSection n="3" title="Prix, facturation, paiement">
        <p>
          Les prix figurent dans l&apos;offre commerciale en vigueur ({ORG.tarifs}). Sauf mention contraire, ils
          sont exprimés hors taxes. La facturation intervient selon la périodicité convenue&nbsp;; les factures sont
          payables à {ORG.delaiPaiement}. Tout retard peut donner lieu aux pénalités légales et à l&apos;indemnité
          forfaitaire de recouvrement.
        </p>
      </LegalSection>

      <LegalSection n="4" title="Durée, reconduction, résiliation">
        <p>
          Le contrat est conclu pour la durée indiquée dans l&apos;offre. Il peut être reconduit et résilié dans les
          conditions qui y sont prévues, moyennant un préavis de {ORG.preavis}. La résiliation pour manquement grave
          non réparé peut intervenir de plein droit après mise en demeure restée sans effet.
        </p>
      </LegalSection>

      <LegalSection n="5" title="Niveaux de service">
        <p>
          Les engagements de disponibilité et de support éventuels sont définis dans l&apos;offre ou dans une annexe
          de niveaux de service ({ORG.sla}). En l&apos;absence d&apos;annexe, le service est fourni selon une
          obligation de moyens.
        </p>
      </LegalSection>

      <LegalSection n="6" title="Données personnelles et sous-traitance">
        <p>
          Pour les données traitées pour le compte du Client, l&apos;Éditeur agit en qualité de sous-traitant au
          sens du RGPD&nbsp;; les rôles et obligations sont régis par {DPA}, partie intégrante du contrat.
        </p>
      </LegalSection>

      <LegalSection n="7" title="Réversibilité et restitution des données">
        <p>
          À l&apos;expiration ou à la résiliation du contrat, le Client peut demander l&apos;export de ses données
          dans un format ouvert et documenté, pendant une période de {ORG.reversibilite}. Passé ce délai, les
          données sont supprimées conformément à la politique de conservation. L&apos;Éditeur apporte une
          assistance raisonnable à la réversibilité.
        </p>
      </LegalSection>

      <LegalSection n="8" title="Responsabilité">
        <p>
          La responsabilité de l&apos;Éditeur au titre du contrat est limitée aux dommages directs et prévisibles,
          et plafonnée à {ORG.plafondResponsabilite}. Sont exclus les dommages indirects (perte d&apos;exploitation,
          de données non imputable à l&apos;Éditeur, de chiffre d&apos;affaires).
        </p>
      </LegalSection>

      <LegalSection n="9" title="Confidentialité">
        <p>
          Chaque partie s&apos;engage à préserver la confidentialité des informations non publiques échangées dans
          le cadre du contrat, pendant sa durée et {ORG.confidentialiteApres} après son terme.
        </p>
      </LegalSection>

      <LegalSection n="10" title="Force majeure">
        <p>
          Aucune partie n&apos;est responsable d&apos;un manquement dû à un cas de force majeure au sens de
          l&apos;article 1218 du Code civil et de la jurisprudence applicable.
        </p>
      </LegalSection>

      <LegalSection n="11" title="Droit applicable et juridiction">
        <p>
          Les CGV sont régies par le droit français. Tout litige, à défaut d&apos;accord amiable, relève de la
          compétence exclusive des tribunaux du ressort du siège de l&apos;Éditeur.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
