# Présenter le backend à une DSI (P6b)

> Pour la personne qui présente MIP RUM à une équipe technique (DSI, architectes), et pour celle qui la prépare. Ce document dit **quoi montrer, dans quel ordre, quoi répéter avant, et comment revenir en arrière** si quelque chose casse pendant la séance. Les gestes d'exploitation détaillés sont dans le [runbook](runbook.md).

## 1. Ce qu'on montre, dans cet ordre

1. **La carte, en une page** : le [README](../../README.md) (diagramme et table des services), puis le canevas Railway — trois groupes, **1 · Collecte**, **2 · Restitution**, **3 · Traitements** — et le fichier qui le décrit, [`.railway/railway.ts`](../../.railway/railway.ts). Le point à faire passer : l'infrastructure est du code, relu comme du code ([ADR-0007](../architecture/adr/0007-iac-railway.md)).
2. **Un service, de près** : `services/collector/` — un point d'entrée de câblage, un `Dockerfile`, un `README.md` au gabarit (rôle, routes, exposition, configuration, sondes, modes de panne, lancement local). Tous les services suivent ce contrat.
3. **Le trajet d'un beacon** ([data-flow](../architecture/data-flow.md)) : le SDK envoie à la console (hôte historique), qui relaie au collector (P3) ; la ligne arrive en base ; `GET /api/v1/overview` la rend par le service `api`, au jeton, en lecture seule ; le serveur MCP la rend à un agent par le réseau privé ; l'écran d'accueil l'affiche.
4. **Le trajet d'une alerte** : une règle déclenche, `alert_event` est écrit par le `scheduler` (seul déclencheur, sous bail — [ADR-0008](../architecture/adr/0008-scheduler-unique.md)), le `notifier` livre un webhook signé HMAC et un e-mail de test.
5. **La console sans base** ([ADR-0002](../architecture/adr/0002-console-interface-sans-base.md)) : un écran = un chargeur, une écriture = une commande, le même code dans la console et dans `console-api` ; la matrice d'autorisations (huit profils, chaque opération) ; les rôles de moindre privilège ([ADR-0012](../architecture/adr/0012-roles-de-la-console.md)). Dire honnêtement où en est la bascule : le code est livré, la mise en service suit la présentation.
6. **Les limites assumées** : [LIMITES.md](../LIMITES.md), la base gratuite en mode dégradé affiché ([ADR-0014](../architecture/adr/0014-base-gratuite.md)), les manques hérités du POC (R1 à R9, affichés par `/presentation`).

## 2. Les exercices, sur staging, avant la séance

Prérequis : l'environnement Railway `staging` sur une branche Neon **nettoyée** (sessions vidées, hachés de mots de passe remplacés, démo coupée), variables partagées créées avant les services. Chaque exercice est chronométré et son résultat noté ici.

| Exercice | Geste | Ce qu'on attend |
|---|---|---|
| Redéploiement sous charge | `node scripts/load-bench.mjs` vers le collector de staging, puis `railway redeploy --service collector` | aucune 5xx vue par le générateur (drainage 15 s, deux répliques), `/ready` à 503 dès SIGTERM |
| Retour arrière de la collecte | `update platform_flag set value = '0' where key = 'ingest_relay_pct'` | la console reprend le chemin local en moins de 30 s (cache du drapeau) |
| Retour arrière de l'API | même geste sur `api_relay_pct` | idem |
| Vrai déploiement du scheduler | `railway redeploy --service scheduler --from-source` | le pré-déploiement journalise « migrations à jour », puis un tick `ok=true` |
| Panne du notifier | Railway → `notifier` → Settings → 0 réplique, puis 1 | les livraisons attendent `queued`, rien ne se perd, `/ready` dit l'arriéré |

## 3. Le jour J

- **Gel** : aucune fusion ni `config apply` dans les 48 h qui précèdent.
- **Une application de démo, un jeton scopé** sur elle seule, créé pour la séance et **révoqué après** (Administration → Tokens de lecture).
- **Neon préchauffé** : une requête quelques minutes avant (la base gratuite s'endort après 5 minutes sans requête ; le premier réveil coûte quelques secondes).
- **Une vidéo enregistrée** du parcours complet, prête si le réseau lâche.
- **La fiche de retour arrière** (section 5) imprimée.
- **Jamais l'onglet Variables** d'un service Railway ni l'écran des variables Vercel à l'écran partagé. Montrer `.railway/railway.ts` à la place : il ne contient que des noms (`ctx.shared.X`, `preserve()`).

## 4. Le dépôt remis : un miroir filtré

Le dépôt est public, et son historique contient encore les documents commerciaux et client retirés du suivi le 23/09 ([DOCUMENTS-HORS-DEPOT](../DOCUMENTS-HORS-DEPOT.md)). Pour remettre le code à un tiers, un **miroir filtré**, jamais un clone :

```
pip install git-filter-repo
scripts/ops/miroir-filtre.sh https://github.com/jt33120/poc-MIP_RUM.git
git -C <sortie annoncée> push --mirror <url d'un dépôt NEUF>
```

Le script réécrit l'historique d'un clone miroir (jamais celui du dépôt source), ne pousse rien, et refuse de conclure si l'un des chemins retirés subsiste dans un seul commit. Essayé le 25/09 sur un clone local : 445 chemins de l'historique retirés, 1 279 commits réécrits, arbre de `master` identique.

## 5. Fiche de retour arrière (à imprimer)

| Symptôme | Geste | Effet en |
|---|---|---|
| La collecte relayée échoue | `update platform_flag set value='0' where key='ingest_relay_pct'` | 30 s |
| L'API relayée échoue | `update platform_flag set value='0' where key='api_relay_pct'` | 30 s |
| Un déploiement Railway casse un service | Railway → le service → Deployments → *Redeploy* du précédent | 1–2 min |
| La console Vercel casse | Vercel → Deployments → *Instant Rollback* | < 1 min |
| Les alertes partent en double ou pas du tout | `SCHEDULER_DELIVERY=on` sur le scheduler, notifier à 0 réplique | au tick suivant |
| La base ne répond plus (quota) | afficher la vitrine : l'état dégradé y est annoncé ([ADR-0014](../architecture/adr/0014-base-gratuite.md)) | — |
