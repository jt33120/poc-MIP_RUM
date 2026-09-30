// GET /api/v1/errors/{fingerprint}/overrepresentation — valeurs de session
// sur-représentées parmi les sessions touchées par un groupe d'erreurs (Fisher,
// Benjamini-Hochberg). Servie par le service `api` SEUL : la console transmet la
// lecture au jeton et ne lit rien elle-même (`lib/api/service-seul.ts`).
// L'implémentation, compilée dans le service : `lib/api/service/surrepresentation.ts`.
import { preflight } from "@/lib/api/respond";
import { transmettreAuService } from "@/lib/api/service-seul";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = transmettreAuService;
