// GET /api/v1/user-timings — repères du développeur (performance.mark, performance.measure, addTiming) par nom (SDK web ≥ 0.6).
// Servie par le service `api` SEUL : la console transmet la lecture au jeton et ne lit
// rien elle-même (`lib/api/service-seul.ts`). L'implémentation, compilée dans le
// service : `lib/api/service/user-timings.ts`.
import { preflight } from "@/lib/api/respond";
import { transmettreAuService } from "@/lib/api/service-seul";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = transmettreAuService;
