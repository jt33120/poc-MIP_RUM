import { NextResponse, type NextRequest } from "next/server";
import { principalDeJeton, SESSION_COOKIE, verifyJwt, type SessionUser } from "@/lib/auth";
import { estCheminPublic } from "@/lib/chemins-publics";
import { authorizedAppsOf } from "@/lib/query-contract";
import { algorithmeDuJeton, verifierJetonConsoleApi } from "@/lib/session-console";

// Auth v0.3 (B3) : JWT cookie httpOnly signé AUTH_SECRET — remplace le basic auth v0.2.
// PUBLICS sans auth (matcher) : /login, /mip-rum.js, /mip-rum-replay.js, /_next/*, /favicon*.
// Le SDK reste TOUJOURS public (snippet chargé par les sites clients).
/**
 * L'identifiant de la requête (piste C) : repris par chaque appel à console-api
 * (`lib/backend.ts`), inscrit dans son journal et, en C0c, dans `audit_log` ; c'est
 * la « réf. » qu'affichera un écran d'erreur. Un identifiant entrant bien formé
 * est gardé (un proxy devant la console peut l'avoir posé), sinon on en tire un.
 */
function avecIdentifiantDeRequete(req: NextRequest): Headers {
  const h = new Headers(req.headers);
  const recu = h.get("x-request-id");
  if (!recu || !/^[A-Za-z0-9._-]{8,64}$/.test(recu)) h.set("x-request-id", crypto.randomUUID());
  return h;
}

/** Une page de console (GET), soumise à la porte « projet courant » plus bas. */
function estPageDeConsole(req: NextRequest): boolean {
  const p = req.nextUrl.pathname;
  return (
    req.method === "GET" &&
    !p.startsWith("/api/") &&
    !p.startsWith("/admin") &&
    p !== "/select" &&
    !p.startsWith("/select/") &&
    !estCheminPublic(p)
  );
}

/**
 * C1 — le principal d'une session de console-api (jeton ES256), au plus juste :
 *   · la signature, vérifiée ici avec la clé PUBLIQUE ; un jeton forgé ne coûte
 *     aucun appel ;
 *   · une page de console a besoin du PÉRIMÈTRE (la porte « projet courant ») :
 *     `GET /v1/me`, qui relit le compte en base ;
 *   · toute autre requête n'a besoin que de savoir s'il s'agit d'une DÉMO — et le
 *     jeton le dit (`demo`, immuable, vérifié par le service contre la ligne) :
 *     aucun appel. La page ou l'action qui suit relit le principal elle-même
 *     (`getUser`), et une session révoquée y est refusée.
 * `"indisponible"` : console-api ne répond pas ; ce n'est pas une déconnexion.
 */
async function principalEs256(req: NextRequest, jeton: string): Promise<SessionUser | null | "indisponible"> {
  const local = await verifierJetonConsoleApi(jeton);
  if (!local) return null;
  if (!estPageDeConsole(req)) return { email: "", role: "viewer", apps: [], demo: local.demo };
  try {
    return await principalDeJeton(jeton, req.headers.get("x-request-id") ?? undefined);
  } catch {
    return "indisponible";
  }
}

export async function middleware(req: NextRequest) {
  // Flux SSO/OIDC : login + callback doivent s'exécuter SANS session (sinon
  // redirection /login en boucle). L'auth se fait dans le handler de callback.
  if (req.nextUrl.pathname.startsWith("/api/auth/")) return NextResponse.next();

  // /api/metrics : scrape Prometheus (sans cookie de session) — auth par token dans
  // le handler. Bypass de la redirection /login (sinon 302 au lieu des métriques).
  if (req.nextUrl.pathname === "/api/metrics") return NextResponse.next();
  // API publique v1 (LOT C option B) : authentifiée par jeton (Authorization: Bearer)
  // OU cookie, DANS le handler — le middleware ne doit pas la rediriger vers /login
  // (le front Angular MIP appelle sans cookie de session).
  if (req.nextUrl.pathname.startsWith("/api/v1")) return NextResponse.next();
  // API de lecture propriétaire (livrable UTI) : auth par token en base dans le
  // handler (Authorization: Bearer) — appel serveur-à-serveur sans cookie.
  if (req.nextUrl.pathname.startsWith("/api/rum")) return NextResponse.next();
  // Résolution domaine -> app_id pour l'extension navigateur (Ext-B) : appelée par
  // le service worker de l'extension (sans cookie), lecture seule, sans PII.
  if (req.nextUrl.pathname.startsWith("/api/extension")) return NextResponse.next();
  // /api/ingest/* : beacons OTLP des sites clients (navigateurs anonymes, aucun
  // cookie de session — par construction, ce sont des visiteurs du site du
  // client, pas des utilisateurs de la console). L'auth d'ingestion est la clé
  // d'API vérifiée DANS le handler (REQUIRE_API_KEY), plus le rate limit et la
  // whitelist CORS. Sans ce bypass, chaque beacon reçoit un 302 vers /login et
  // TOUTE l'ingestion tombe en silence — le SDK ne suit pas les redirections.
  if (req.nextUrl.pathname.startsWith("/api/ingest")) return NextResponse.next();
  // /demo : ouvre elle-même la session démo, donc s'exécute sans cookie.
  if (req.nextUrl.pathname === "/demo") return NextResponse.next();
  // Source maps (P5.4) : la CI poste avec un jeton dédié, sans cookie, et la
  // route répond 401/403 en JSON plutôt qu'une redirection. Sa garde
  // (lib/api/admin.ts) exige une session admin non démo et l'Origin de la
  // console pour toute mutation — la borne démo ci-dessous y est donc incluse.
  // (Les jetons de CI et les connecteurs de tickets s'administrent depuis leurs
  // écrans depuis C9 : leurs routes `/api/admin/*` ont été retirées.)
  if (req.nextUrl.pathname === "/api/sourcemaps") return NextResponse.next();
  // /api/webhooks/* : livraisons entrantes d'un fournisseur de tickets (P8.6).
  // Aucun cookie, aucune session : l'autorité est la SIGNATURE vérifiée dans le
  // handler. Sans ce contournement, chaque livraison recevrait un 302 vers
  // /login — que GitHub compterait comme une livraison réussie, et la
  // synchronisation tomberait en silence. La route refuse elle-même toute
  // requête portant le cookie de session.
  if (req.nextUrl.pathname.startsWith("/api/webhooks/")) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const resolu = !token ? null : algorithmeDuJeton(token) === "ES256" ? await principalEs256(req, token) : await verifyJwt(token);
  if (resolu === "indisponible") {
    return new NextResponse("Service momentanément indisponible : réessayer dans un instant.", {
      status: 503,
      headers: { "retry-after": "5", "cache-control": "no-store" },
    });
  }
  const user = resolu;
  if (!user) {
    // /presentation = vitrine PUBLIQUE (avant login) : un visiteur comprend l'outil
    // avant de se connecter. La racine "/" sert de porte d'entrée -> présentation ;
    // tout autre lien profond -> login (bookmarks des utilisateurs connus).
    const p = req.nextUrl.pathname;
    // /presentation = vitrine ; /extension-privacy = politique de confidentialité
    // PUBLIQUE de l'extension (URL exigée par le Chrome Web Store) ; /legal/* =
    // documents légaux publics (CGU, CGV, confidentialité).
    if (estCheminPublic(p)) return NextResponse.next({ request: { headers: avecIdentifiantDeRequete(req) } });
    if (p === "/") return NextResponse.redirect(new URL("/presentation", req.url), 302);
    return NextResponse.redirect(new URL("/login", req.url), 302);
  }

  // Session démo (ouverte par /demo sans mot de passe, accessible à l'internet
  // entier) : LECTURE SEULE. On refuse toute requête qui n'est pas une lecture,
  // ce qui couvre les Server Actions — elles passent en POST. La borne est ici,
  // en un seul point, plutôt que répétée dans chaque action : une action ajoutée
  // demain est couverte sans que personne ait à y penser.
  //
  // Deux exceptions, et deux seulement, parce qu'elles n'écrivent qu'un cookie
  // et qu'un visiteur bloqué dessus n'a plus de démo du tout :
  //   /logout — sortir de la démo ;
  //   /select — choisir le projet courant. Chaque carte du sélecteur est un
  //     formulaire (POST), et un compte démo scopé sur PLUSIEURS apps atterrit
  //     précisément là : sans cette exception il ne pourrait entrer dans aucune.
  //     L'action vérifie déjà que le projet demandé est dans le scope de
  //     l'utilisateur (select/actions.ts, garde anti-forgery).
  if (
    user.demo &&
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    req.nextUrl.pathname !== "/logout" &&
    req.nextUrl.pathname !== "/select"
  ) {
    return new NextResponse("Compte de démonstration : lecture seule.", { status: 403 });
  }

  // Porte « projet courant » : RUM et IA sont propres à UNE app, il n'y a pas de
  // vue « toutes les apps ». On réconcilie cookie de projet et paramètre ?app sur
  // les GET de pages (jamais les POST de server actions ni les routes API) :
  //   - ?app présent et dans le scope         -> on laisse passer ;
  //   - ?app nommé hors du scope               -> /select, refus annoncé ;
  //   - absent (ou « all » pour un viewer)     -> cookie, redirect en injectant ?app ;
  //   - aucun projet résoluble, scope vide     -> redirect vers /select (picker).
  // /admin/* est trans-projet (gestion clients/users/audit) : pas de scope app,
  // donc pas de porte projet. /select est la porte elle-même.
  const { pathname } = req.nextUrl;
  // Le layout serveur ne reçoit pas le pathname : on le lui passe par en-tête pour
  // qu'il rende /select en plein écran (sans la coquille sidebar).
  const pass = () => {
    const h = avecIdentifiantDeRequete(req);
    h.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: h } });
  };

  // Les pages PUBLIQUES ne sont pas des écrans de console : elles n'ont pas de
  // projet courant. Sans cette exclusion, un utilisateur connecté était
  // redirigé vers /presentation?app=… — et, s'il n'avait aucun projet
  // résoluble, vers /select : des mentions légales devenues illisibles pour
  // qui n'a pas encore choisi de projet.
  const gated = estPageDeConsole(req);
  if (gated) {
    const requested = req.nextUrl.searchParams.get("app");
    const cookieApp = req.cookies.get("mip-project")?.value ?? null; // cf. lib/project.ts
    // Périmètre signé (lib/query-contract.ts) : null = toutes les apps, [] = AUCUNE.
    const scope = authorizedAppsOf(user);
    // Aucune app autorisée : aucun écran de console ; le sélecteur le dit.
    if (scope !== null && scope.length === 0) return NextResponse.redirect(new URL("/select", req.url), 302);
    // App nommée hors périmètre : refus annoncé sur le sélecteur, jamais un repli
    // silencieux sur une autre app sous une URL partagée.
    if (requested && requested !== "all" && scope !== null && !scope.includes(requested)) {
      const url = new URL("/select", req.url);
      url.searchParams.set("hors_perimetre", requested);
      return NextResponse.redirect(url, 302);
    }

    let eff = requested;
    if (scope && (!eff || !scope.includes(eff))) eff = null;
    if (!eff) {
      if (cookieApp && (!scope || scope.includes(cookieApp))) eff = cookieApp;
      else if (scope && scope.length === 1) eff = scope[0]; // viewer mono-app : pas de picker
    }

    if (!eff) return NextResponse.redirect(new URL("/select", req.url), 302);
    if (requested !== eff) {
      const url = req.nextUrl.clone();
      url.searchParams.set("app", eff);
      return NextResponse.redirect(url, 302);
    }
    // ?app résolu et dans le scope : on laisse passer, en gardant le cookie de
    // projet aligné sur l'URL (deep-link partagé sans cookie -> on le pose).
    if (cookieApp !== eff) {
      const res = pass();
      res.cookies.set("mip-project", eff, { path: "/", sameSite: "lax", maxAge: 180 * 24 * 3600 });
      return res;
    }
  }
  return pass();
}

export const config = {
  // RUNTIME NODE (Next 15.5, stable) et non Edge : une session de console-api se
  // relit par `GET /v1/me`, derrière la poignée de main signée de `lib/backend.ts`,
  // qui tient son état (hôte vérifié) dans le processus.
  runtime: "nodejs",
  // `vendor` = assets tiers auto-hébergés (Swagger UI) ; `downloads` = artefacts
  // téléchargeables (le .zip de l'extension) ; `portail` = captures de la console
  // affichées par la vitrine publique — sans cette exclusion le visiteur anonyme
  // reçoit un 302 vers /login à la place de l'image, et l'optimiseur next/image,
  // qui refetch l'URL à travers le middleware, ne voit qu'une redirection.
  // Servis depuis public/, exclus de la porte d'auth comme _next et le SDK public
  // (sinon un GET de fichier statique serait traité comme une page et redirigé
  // vers /select).
  matcher: ["/((?!login|mip-rum|_next/|favicon|vendor|downloads|portail).*)"],
};
