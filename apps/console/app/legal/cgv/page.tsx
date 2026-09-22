import { LegalShell, LegalSection } from "@/components/legal/LegalShell";
import { ORG } from "@/lib/legal";

export const dynamic = "force-static";
export const metadata = { title: "MIP RUM — Conditions générales de vente" };

export default function CGV() {
  return (
    <LegalShell
      title="Conditions générales de vente"
      intro={
        <p>
          Les présentes conditions (CGV) régissent la souscription au service {ORG.produit} entre {ORG.raisonSociale}{" "}
          (« l'Éditeur ») et le client professionnel (« le Client »).
        </p>
      }
    >
      <LegalSection n="1" title="Objet et champ d'application">
        <p>
          Les CGV s'appliquent à toute souscription au service {ORG.produit}. Elles prévalent sur tout document du
          Client, sauf conditions particulières signées entre les parties.
        </p>
      </LegalSection>

      <LegalSection n="2" title="Souscription">
        <p>
          La souscription résulte d'un bon de commande, d'un devis accepté ou d'une inscription en ligne. Elle
          emporte acceptation des présentes CGV et de l'
          accord de traitement (DPA).
        </p>
      </LegalSection>

      <LegalSection n="3" title="Prix, facturation, paiement">
        <p>
          Les prix figurent dans l'offre commerciale en vigueur ({"["}grille tarifaire / devis{"]"}). Sauf mention
          contraire, ils sont exprimés hors taxes. La facturation intervient selon la périodicité convenue&nbsp;;
          les factures sont payables à {"["}délai de paiement{"]"} jours. Tout retard peut donner lieu aux
          pénalités légales et à l'indemnité forfaitaire de recouvrement.
        </p>
      </LegalSection>

      <LegalSection n="4" title="Durée, reconduction, résiliation">
        <p>
          Le contrat est conclu pour la durée indiquée dans l'offre. Il peut être reconduit et résilié dans les
          conditions qui y sont prévues, moyennant un préavis de {"["}durée du préavis{"]"}. La résiliation pour
          manquement grave non réparé peut intervenir de plein droit après mise en demeure restée sans effet.
        </p>
      </LegalSection>

      <LegalSection n="5" title="Niveaux de service (SLA)">
        <p>
          Les engagements de disponibilité et de support éventuels sont définis dans l'offre ou une annexe SLA
          ({"["}taux de disponibilité, fenêtres de maintenance, délais de support{"]"}). En l'absence d'annexe, le
          service est fourni selon une obligation de moyens.
        </p>
      </LegalSection>

      <LegalSection n="6" title="Données personnelles et sous-traitance">
        <p>
          Pour les données traitées pour le compte du Client, l'Éditeur agit en qualité de sous-traitant au sens du
          RGPD&nbsp;; les rôles et obligations sont régis par l'
          accord de traitement, partie
          intégrante du contrat.
        </p>
      </LegalSection>

      <LegalSection n="7" title="Réversibilité et restitution des données">
        <p>
          À l'expiration ou à la résiliation du contrat, le Client peut demander l'export de ses données dans un
          format ouvert et documenté, pendant une période de {"["}durée, ex. 30 jours{"]"}. Passé ce délai, les
          données sont supprimées conformément à la politique de conservation. L'Éditeur apporte une assistance
          raisonnable à la réversibilité.
        </p>
      </LegalSection>

      <LegalSection n="8" title="Responsabilité">
        <p>
          La responsabilité de l'Éditeur au titre du contrat est limitée aux dommages directs et prévisibles, et
          plafonnée à {"["}montant / durée, ex. les sommes versées sur les 12 derniers mois{"]"}. Sont exclus les
          dommages indirects (perte d'exploitation, de données non imputable à l'Éditeur, de chiffre d'affaires).
        </p>
      </LegalSection>

      <LegalSection n="9" title="Confidentialité">
        <p>
          Chaque partie s'engage à préserver la confidentialité des informations non publiques échangées dans le
          cadre du contrat, pendant sa durée et {"["}durée après la fin, ex. 3 ans{"]"} après son terme.
        </p>
      </LegalSection>

      <LegalSection n="10" title="Force majeure">
        <p>
          Aucune partie n'est responsable d'un manquement dû à un cas de force majeure au sens de l'article 1218 du
          Code civil et de la jurisprudence applicable.
        </p>
      </LegalSection>

      <LegalSection n="11" title="Droit applicable et juridiction">
        <p>
          Les CGV sont régies par le droit français. Tout litige, à défaut d'accord amiable, relève de la
          compétence exclusive des tribunaux du ressort du siège de l'Éditeur.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
