// GET /api/v1/page-weight — poids des vues par route : ressources et octets transférés par vue (SDK web ≥ 0.6).
// Servie par le service `api` SEUL : la console transmet la lecture au jeton et ne lit
// rien elle-même (`lib/api/service-seul.ts`). L'implémentation, compilée dans le
// service : `lib/api/service/page-weight.ts`.
import { preflight } from "@/lib/api/respond";
import { transmettreAuService } from "@/lib/api/service-seul";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = transmettreAuService;
