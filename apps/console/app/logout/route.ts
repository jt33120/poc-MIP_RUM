// POST /logout — fermer la session. Une VRAIE route, et non une Server Action.
//
// POURQUOI CE CHANGEMENT. La déconnexion était une Server Action. Or Next ne
// poste pas une action vers la route qui la définit : il la poste vers l'URL
// COURANTE, avec un en-tête `Next-Action`. Le bouton de la sidebar produisait
// donc `POST /`, `POST /sessions`, `POST /api-docs`… jamais `POST /logout`.
//
// Le middleware, lui, interdit toute écriture à une session de démonstration —
// avec une exception explicite pour `/logout`, « sortir de la démo ». Cette
// exception ne pouvait JAMAIS matcher. Résultat, constaté en production le
// 09/09/2026 puis reproduit à l'identique en local :
//
//   HTTP 403 <- POST /
//   Application error: a client-side exception has occurred
//
// et le cookie survivant, donc un visiteur enfermé dans la démo : la racine le
// ramenait indéfiniment dans la console, sans porte de sortie. Le seul endroit
// d'où il pouvait se déconnecter était /select, l'autre chemin exempté — par
// accident, pas par intention.
//
// Une route rend l'exception du middleware VRAIE : le navigateur poste
// réellement sur /logout, ce que le chemin comparé exprime. Aucune connaissance
// des mécanismes internes de Next n'est requise pour que ça tienne.
import { NextResponse } from "next/server";
import { SESSION_COOKIE, getUser } from "@/lib/auth";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Redirection vers /login, en 303 et en RELATIF.
 *
 * 303 et non 307 : après un POST, seul « See Other » dit au navigateur de
 * repartir en GET. Un 307 conserverait la méthode et re-posterait sur /login.
 *
 * Relatif et non absolu : reconstruire l'origine (`host` + protocole) est
 * exactement ce qui a cassé la vérification de ce correctif — la redirection
 * partait sur `localhost` alors que le navigateur était sur `127.0.0.1`, et le
 * cookie, lié à l'hôte, n'était plus envoyé. Derrière un proxy, la même
 * reconstruction produit l'hôte interne. Une cible relative n'a pas ce problème :
 * le navigateur la résout contre l'origine où il se trouve déjà.
 */
function versLogin(): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: "/login" } });
}

export async function POST(): Promise<NextResponse> {
  const user = await getUser();
  if (user) {
    // Best-effort : une panne du journal ne doit pas empêcher de sortir. Avant,
    // une erreur ici faisait échouer l'action entière et laissait la session
    // ouverte — le journal décidait de l'accès, ce qui est l'inverse du but.
    await q(`insert into audit_log (user_email, action, detail) values ($1, 'logout', null)`, [
      user.email,
    ]).catch(() => {});
  }
  const res = versLogin();
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

/**
 * Un GET sur /logout ne déconnecte pas : il renvoie vers /login sans toucher au
 * cookie. Sinon un simple `<img src="…/logout">` sur la page d'un tiers
 * déconnecterait le visiteur à son insu. La déconnexion est une écriture, et une
 * écriture se fait en POST.
 */
export function GET(): NextResponse {
  return versLogin();
}
