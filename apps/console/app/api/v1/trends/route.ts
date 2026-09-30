// GET /api/v1/trends — tendances des Core Web Vitals sur 14 jours complets, rupture
// datée. Servie par le service `api` SEUL : la console transmet la lecture au jeton
// et ne lit rien elle-même (`lib/api/service-seul.ts`). L'implémentation, compilée
// dans le service : `lib/api/service/trends.ts`.
import { preflight } from "@/lib/api/respond";
import { transmettreAuService } from "@/lib/api/service-seul";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = transmettreAuService;
