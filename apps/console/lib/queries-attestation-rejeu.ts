// La dernière attestation de la base légale du rejeu d'une application (« À faire »
// X10), relue dans le journal d'audit où `attesterRejeu` l'inscrit.
import { lireDetailAttestation, motifAttestation, type AttestationRejeu } from "./attestation-rejeu";
import { q } from "./db";

export async function derniereAttestationRejeu(app: string): Promise<AttestationRejeu | null> {
  const [ligne] = await q<{ user_email: string | null; ts: Date | string; detail: string | null }>(
    `select user_email, ts, detail from audit_log
      where action = 'app.attest_replay' and detail like $1
      order by id desc limit 1`,
    [motifAttestation(app)],
  );
  if (!ligne) return null;
  const detail = lireDetailAttestation(ligne.detail);
  return { par: ligne.user_email, le: ligne.ts, base: null, taux: null, masquage: null, note: null, ...detail };
}
