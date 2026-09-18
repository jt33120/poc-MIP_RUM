import { LegalShell, LegalSection } from "@/components/legal/LegalShell";
import { ORG, HOSTS, DATA_SOURCES } from "@/lib/legal";

export const dynamic = "force-static";
export const metadata = { title: "MIP RUM — Mentions légales" };

export default function Mentions() {
  return (
    <LegalShell title="Mentions légales">
      <LegalSection n="1" title="Éditeur du service">
        <p>
          Le service {ORG.produit} est édité par {ORG.raisonSociale}, {ORG.formeJuridique} au capital de{" "}
          {ORG.capital}, immatriculée au {ORG.rcs} sous le numéro SIREN {ORG.siren}, dont le siège social est
          situé {ORG.adresse}.
        </p>
        <p>
          N° de TVA intracommunautaire : {ORG.tva}. Contact : {ORG.email} — {ORG.telephone}.
        </p>
        <p>Directeur / directrice de la publication : {ORG.directeurPublication}.</p>
      </LegalSection>

      <LegalSection n="2" title="Hébergement">
        <p>Données (RUM et comptes) : {HOSTS.data}.</p>
        <p>Application console : {HOSTS.app}.</p>
        <p>Services backend : {HOSTS.backend}.</p>
        <p>
          Les données de mesure sont hébergées et traitées au sein de l'Union européenne. Le détail des
          sous-traitants figure dans la <a href="/legal/confidentialite" className="text-accent-deep underline-offset-2 hover:underline dark:text-accent">politique de confidentialité</a>.
        </p>
      </LegalSection>

      <LegalSection n="3" title="Propriété intellectuelle">
        <p>
          L'ensemble des éléments du service {ORG.produit} (marque, logo, interface, code, documentation) est
          protégé par le droit de la propriété intellectuelle et demeure la propriété de {ORG.raisonSociale} ou de
          ses concédants. Toute reproduction ou représentation non autorisée est interdite.
        </p>
        <p>
          Les composants sous licence libre utilisés par le service restent régis par leurs licences respectives.
        </p>
        {DATA_SOURCES.map((s) => (
          <p key={s.name}>
            {s.use}, à partir de {s.name} — <a href={s.url} className="text-accent-deep underline-offset-2 hover:underline dark:text-accent">{s.attribution} ({new URL(s.url).host})</a>, sous licence {s.licence}.
          </p>
        ))}
      </LegalSection>

      <LegalSection n="4" title="Contact">
        <p>
          Pour toute question relative au service ou à ces mentions : {ORG.email}. Pour l'exercice des droits
          relatifs aux données personnelles : {ORG.dpo}.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
