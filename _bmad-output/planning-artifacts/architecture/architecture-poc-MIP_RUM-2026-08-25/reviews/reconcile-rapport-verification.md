# Réconciliation — rapport de vérification bmad-review → ARCHITECTURE-SPINE

**Entrée réconciliée :** rapport de vérification bmad-review du 25/08/2026 — 30 findings
(13 verification-gap, 17 adversarial) confrontés au code réel du monorepo.
**Cible :** `ARCHITECTURE-SPINE.md` (14 AD, conventions, seed structurel, Deferred, questions ouvertes)
+ `.memlog.md` du même dossier.
**Objet :** vérifier que chaque finding a atterri quelque part — pas juger la qualité du spine.
**Date :** 2026-08-25

> **Convention de lecture.** Les deux documents utilisent le préfixe `AD`. Dans tout ce rapport :
> **AD-n (spine)** = décision d'architecture du spine (AD-1 à AD-14) ;
> **AD-nn (finding)** = finding adversarial du rapport de vérification (AD-01 à AD-17), tel que
> numéroté dans le bloc JSON. Le corps HTML du rapport renumérote certains findings adversariaux
> dans sa section 04 — le JSON fait foi.

---

## Décompte

| Verdict | Nombre |
| --- | --- |
| **PORTÉ** | **22** — dont 11 complets et 11 partiels |
| **DÉFÉRÉ SCIEMMENT** | **3** |
| **PERDU** | **5** |
| *Fragments perdus à l'intérieur de findings portés ou déférés* | *2* |

Rien n'a été perdu par négligence sur les défauts techniques : les 13 verification-gaps sont tous
tracés. Les cinq pertes et les deux fragments sont, sans exception, des **exigences discrètes** —
une réserve de méthode, une collision de nommage, une contrainte de ton commercial, un mode de
déploiement, un droit RGPD — c'est-à-dire précisément la classe que la structure en AD laisse tomber.

---

## Tableau des 30 findings

### Lentille verification-gap

| # | Objet | Verdict | Où ça atterrit / ce qui manque |
| --- | --- | --- | --- |
| VG-01 | Garde 403/429 de l'ingestion de prod sans aucun test | PORTÉ (partiel) | AD-11 (spine) « une propriété vendue est testée dans la configuration expédiée » + convention *Preuve* + AD-5/AD-6 (spine). **Manque :** AD-11 se déclenche sur les propriétés *citées* en rendez-vous ; rien n'exige que le *handler déployé lui-même* soit sous test. |
| VG-02 | Bypass d'auth `/api/ingest` dans le middleware, sans test | PORTÉ (partiel) | AD-9 (spine) — le battement de cœur externe « beacon émis → ressort en lecture » détecte le 302 en production ; AD-11 (spine) pour le test. **Manque :** aucun invariant ne dit que les ports entrants échappent *par construction* à l'authentification de session de la console. Le couplage « l'ingestion vit dans l'app console et hérite de son middleware » est visible dans le seed structurel mais jamais nommé comme un risque gouverné. |
| VG-03 | `requireApiKey ?? false` : la posture expédiée n'est assertée nulle part | PORTÉ | AD-6 (spine), littéral : « toute exception à cette règle est un mode POC nommé, activé explicitement, et jamais le défaut ». Complété par AD-11 (spine). Couverture complète. |
| VG-04 | `withTenant()` a zéro appelant | PORTÉ | AD-3 (spine), couverture complète et renforcée (l'oubli devient une erreur de compilation). |
| VG-05 | Le test d'isolation fait `set role console_ro`, la prod est `neondb_owner` | PORTÉ | AD-11 (spine), littéral dans son *Prevents* : « le test d'isolation fixe lui-même son rôle de connexion ». Couverture complète. |
| VG-06 | Aucune assertion structurelle « table à `app_id` ⇒ RLS + policy » | PORTÉ (partiel) | AD-3 (spine) possède le filet RLS ; convention *Nommage* (« tables tenant portant systématiquement `app_id` »). **Manque :** la règle énumérable et prospective. AD-3 parle du chemin d'accès applicatif et du basculement de rôle, pas de la couverture de *chaque table présente ou future*. Les six tables SVI de la v51 ne sont mentionnées nulle part. Texte de renfort proposé en annexe A. |
| VG-07 | Couche cron entière sans test (auth, agrégation d'échecs) | PORTÉ (partiel) | AD-6 (spine) *Binds* nomme explicitement « authentification des tâches planifiées » ; AD-8 (spine) pour la preuve d'exécution ; AD-11 (spine) pour le test. **Manque :** l'agrégation d'échecs partiels (207 vs 200, les autres étapes s'exécutent malgré l'échec d'une), et le fait que `assertCronAuth` est l'**unique** contrôle d'accès de routes que le middleware bypasse. |
| VG-08 | Rien ne vérifie que la purge RGPD a tourné | PORTÉ | AD-8 (spine), littéral, y compris la formule « l'absence d'exécution est une alerte, pas un silence ». Couverture complète. |
| VG-09 | Branche 429 de la read-API OEM non couverte | PORTÉ (partiel) | AD-6 (spine) « échec du contrôle de débit → refus » ; AD-11 (spine) ; AD-2 (spine) pour le rang de l'API. **Manque :** la **durabilité** du compteur. Le rapport note que l'implémentation est un `Map` de module — donc non partagé entre instances serverless. Le spine tranche le comportement en cas d'échec, jamais la nature du stockage du compteur, alors que c'est la seule protection anti-abus du livrable OEM. |
| VG-10 | Trois replis d'endpoint, deux vers un host mort | PORTÉ | AD-4 (spine), littéral. Couverture complète. |
| VG-11 | `legal.ts` déclare Supabase / Paris, les données sont à Francfort | PORTÉ | AD-7 (spine), littéral, jusqu'à la mécanique « un changement d'hébergeur casse le build tant que la déclaration légale n'est pas mise à jour ». **Nuance :** l'urgence du rapport (« aujourd'hui, 10 lignes, seul item à exposition légale, publique et immédiate ») est un fait de séquencement que le spine n'a pas vocation à porter — à faire passer explicitement dans le découpage en chantiers, sinon elle se dissout dans un chantier AD-7 de plusieurs jours. |
| VG-12 | `DSAR_TABLES` non ancré au schéma ; v44 dans `pending/`, hors glob CI | **PERDU** | Voir annexe A.1. Ni « DSAR », ni l'art. 15, ni l'art. 17, ni `pending/` n'apparaissent dans le spine ou le memlog. AD-8 (spine) prouve qu'on **efface à temps** ; rien ne prouve qu'on **sait effacer sur demande**. |
| VG-13 | Items de la revue périmés, document non horodaté | PORTÉ (partiel) | Front-matter `sources` : « docs/PRODUCT_REVIEW_BMAD.md (24/07/2026) — **rectifié par le rapport de vérification bmad-review du 25/08/2026** ». La rectification est donc consignée à la racine du spine. **Manque :** la liste nominative des **7 items déjà refermés — à ne pas replanifier** (docker-smoke, jumeau replay + probeUptime, pool déjà réglé, rate-limit durable à l'ingestion, auth v1-logs, test `/rum/summary`, comptage de tests) n'est reprise nulle part. C'est l'entrée directe du découpage en épics, livrable déjà retenu au memlog. |

### Lentille adversarial

| # | Objet | Verdict | Où ça atterrit / ce qui manque |
| --- | --- | --- | --- |
| AD-01 | Le document photographie un dépôt qui a bougé un mois | PORTÉ (partiel) | `sources` (rectification), memlog (migration Neon, `apps/ingest/supabase/functions/` = code mort), et convention *Frontières* : « le code d'un adaptateur décommissionné est supprimé du dépôt, pas laissé en place » — qui règle la moitié « code mort ». **Manque :** identique à VG-13, la réconciliation du plan lui-même. |
| AD-02 | Deux docs BMAD réordonnent les mêmes étiquettes E1–E7 ; un E0 conformité absent | **PERDU** | Voir annexe A.2. Zéro occurrence de `E0`, `E1`…`E7` dans le spine et le memlog. La substance de l'E0 conformité atterrit *partiellement* dans AD-12 (spine) ; la collision d'étiquettes, non — et elle piège le prochain livrable. |
| AD-03 | Erreur d'unité sur le plafond de scale (stock ≠ débit) | PORTÉ | Questions ouvertes, littéral : « ~10⁶–10⁷ events sont un **stock**, pas un débit, et la seule mesure de débit (~4 000 events/s) est locale ». Couverture complète sur le fait. **Divergence assumée à consigner :** le spine conclut « non bloquant pour le build », le finding conclut l'inverse (« E3 n'est pas le 3ᵉ épic, il est sur le chemin critique du premier client payant »). Voir section *Divergences*. |
| AD-04 | La clé publique ne peut pas authentifier + réserve du reviewer | PORTÉ (partiel) | AD-5 (spine) couvre intégralement, et mieux que le finding ne le demandait (quatre couches cumulatives, allowlist d'origines obligatoire, critère de recette invalidé nommément). **Fragment PERDU :** la `note_du_reviewer` — la lentille adversariale s'était trompée en affirmant un dépôt public. Voir annexe A.6. |
| AD-05 | Deux chemins fail-open (registre non chargé, échec de `rate_check`) | PORTÉ | AD-6 (spine), littéral sur les deux cas : « registre non chargé → 503, jamais 200 ; échec du contrôle de débit → refus, jamais passage ». Couverture complète. |
| AD-06 | E1-S3 mergée puis neutralisée ; la console se vidait | PORTÉ | AD-3 (spine), y compris la mémoire de l'échec : « c'est la bascule prématurée qui a vidé la console en juillet 2026 », et l'ordre imposé (adoption 100 % **puis** bascule de rôle). Le « comment migrer » (drapeau, retour arrière, re-test page par page) relève du découpage — et croise la perte A.4. |
| AD-07 | Le quick win n°5 créerait une fuite inter-tenants par cache CDN | **PERDU** | Voir annexe A.3. Zéro occurrence de « cache », « Vary », « CDN » dans le spine. Vérifié ce jour dans le code : `?app=` est bien optionnel et retombe sur l'app du jeton (`route.ts:29`), et `cache-control: no-store` est posé délibérément (`route.ts:17,42`) — un invariant que rien ne protège aujourd'hui contre une « optimisation à risque nul ». |
| AD-08 | Quick win n°1 caduc (pool déjà `PGPOOL_MAX ?? 10`, rôle obsolète) | PORTÉ (partiel) | Questions ouvertes (capacité cloud jamais mesurée) + rectification des `sources` + AD-3 (spine) qui règle le sort de `console_ro`. **Manque :** la vraie question que le finding substitue à l'item caduc — *quel `PGPOOL_MAX` derrière le pooler Neon, mesuré sous charge* — n'est pas dans la question ouverte, qui ne parle que du débit d'ingestion. Renfort d'une ligne proposé en annexe A.5. |
| AD-09 | Le différenciateur commercial (corrélation synthétique ↔ RUM) effacé ; démo sur seed | DÉFÉRÉ SCIEMMENT | Deferred : « **Corrélation synthétique ↔ RUM** — Positionnement écarté par Julian au profit du moteur générique. `apps/sync-synthetic/` reste un utilitaire hors cœur. Condition de révision consignée au memlog. » Le memlog porte la raison complète et un risque explicitement assumé (Dash0, 155 M$, recommandation contraire du scan) **avec sa condition de révision** (« premier rendez-vous OEM perdu sur un comparatif frontal »). Déferrement exemplaire. **Fragment PERDU :** la démo commerciale tourne sur du seed, pas sur l'API DEM réelle. Voir annexe A.7. |
| AD-10 | Verts faux du scorecard : traceId/spanId aléatoires, seuils LCP hors barème | PORTÉ (partiel) | AD-12 (spine), littéral sur les deux volets : le *Prevents* cite « un export OTLP produisant autant de traces que de spans alors que la ligne était notée conforme », et la *Rule* impose la source unique des seuils et barèmes. **Manque :** rien n'exige que le barème soit **celui du standard public** (Web Vitals). Un seuil LCP faux dérivé d'une source unique reste faux aux trois endroits à la fois — la source unique règle la divergence, pas l'exactitude. |
| AD-11 | Méthode : aucun constat adossé au système en marche | PORTÉ | AD-9 (spine) — battement de cœur externe de bout en bout, hors Vercel et hors Neon — et AD-11 (spine) pour la porte de validation. Couverture complète, et l'enveloppe du seed structurel matérialise l'exigence (bloc `EXT`). |
| AD-12 | Le packaging SDK ignore le parc déjà déployé | PORTÉ | AD-10 (spine), littéral sur les **deux** défaillances distinctes : correctif indéployable chez les clients qui ont collé un snippet, et comparaisons statistiques franchissant une césure de sémantique. Couverture complète. |
| AD-13 | E1-S1 est une migration de parc, pas un changement de défaut | **PERDU** | Voir annexe A.4. Zéro occurrence de « observation », « dry-run », « rollback », « inventaire » dans le spine et le memlog. AD-5 (spine) **aggrave** le risque du finding en ajoutant quatre couches de refus obligatoires sans dire comment elles atteignent un parc déjà instrumenté. |
| AD-14 | Le modèle économique d'E4 contredit la recherche du dépôt | DÉFÉRÉ SCIEMMENT | Deferred : « **SaaS multi-tenant, signup, billing** — Hors de l'objectif OEM déclaré. Le scan marché le classe d'ailleurs en forte baisse de priorité. » La moitié porteuse du finding — *retirer « avant tout tenant payant » de D1, l'isolation est une condition d'existence* — est **portée** par AD-3 (spine), qui est un invariant inconditionnel sans aucun palier. **Résidu non traité :** le corollaire du scan « sécurité, isolation, SSO, RBAC, audit : toujours dans le socle, jamais en palier » — SSO, RBAC et journal d'audit n'existent nulle part dans le spine, et ce sont trois questions d'acheteur OEM. À verser au découpage, pas nécessairement au spine. |
| AD-15 | Aucun fichier LICENSE, aucune frontière open-core, pour une vente OEM | DÉFÉRÉ SCIEMMENT | Deferred, avec la raison **et** le caractère bloquant : « Décision juridique et commerciale, pas architecturale — mais **bloquante pour toute vente OEM**, et aujourd'hui non posée : le dépôt n'a aucun fichier LICENSE. À trancher avant le premier contrat, pas avant le premier sprint. » Vérifié ce jour : aucun `LICENSE*` ni `LICENCE*` à la racine. Les autres volets du finding sont répartis et non perdus : versions supportées et fin de vie → AD-10 (spine) ; réversibilité et export sans frais de sortie → AD-14 (spine) + AD-1 (spine) ; support/SLA et cadence annoncée → AD-13 (spine) ; frontière Engine/Console → AD-2 (spine). |
| AD-16 | Aucun chiffre du verdict n'a de méthode (« 65-70 % ») | **PERDU** | Voir annexe A.5. AD-11 (spine) borde les *propriétés* citées en rendez-vous, jamais les *chiffres* : un pourcentage d'avancement et une estimation en sprints ne sont pas des propriétés couvrables par un test. La question ouverte borde la seule capacité. La substitution demandée par le finding — des **conditions de sortie vérifiables** à la place du pourcentage — n'existe nulle part, alors que le spine contient déjà tous ses ingrédients. |
| AD-17 | Sauvegarde-restauration, socle d'exécution et coût, auto-supervision | PORTÉ (partiel) | Trois pour trois : AD-14 (spine) restauration testée et chronométrée avec RPO/RTO ; AD-13 (spine) socle d'exécution, cadence comme caractéristique produit, plan d'hébergement ; AD-9 (spine) heartbeat externe et dogfooding qui « complète, ne remplace pas ». **Manque :** le **coût par tenant chiffré**. AD-13 (spine) traite la latence annoncée face au plan d'hébergement, jamais l'économie unitaire — or c'est ce qui décide d'une souscription par instance (cf. AD-14 finding). |

---

## Annexe A — les PERDUS, avec le texte qui les rattraperait

Les numéros d'AD proposés continuent la série du spine (qui s'arrête à AD-14). L'architecte
renumérotera à sa convenance ; ce qui compte est le texte de la règle.

### A.1 — VG-12 : les droits des personnes ne sont exerçables nulle part dans le spine

**Ce qui a été perdu.** Le spine prouve qu'on **efface à temps** (AD-8) et qu'on n'accumule pas
d'IP (convention *Données & formats*). Il ne dit rien de la capacité à **répondre à une personne**.
Or `apps/console/lib/dsar.ts:30` interpole des noms de tables dans un `select count(*)`, un
`select *` et un `delete` ; l'un de ces noms (`rum_ai`) est supprimé par une migration qui vit dans
`pending/`, hors du glob appliqué par la CI. Le jour où quelqu'un applique v44 à la main, l'export
d'accès et l'effacement art. 17 lèvent une exception — un refus de droit RGPD — et le test actuel
reste vert parce qu'il compare la constante à elle-même. Le second angle mort est plus large que le
DSAR : **une migration qui n'est jouée par aucune CI n'a aucun filet**, et le spine se contente
d'exiger qu'elles soient numérotées, ordonnées et idempotentes.

**Texte proposé — nouvel AD :**

> ### AD-15 — Les droits des personnes sont exerçables, et prouvés contre le schéma réel
>
> - **Binds :** `apps/console/lib/dsar.ts`, `queries-dsar.ts`, le schéma et l'ensemble de ses
>   migrations, l'engagement du DPA et de `/legal/confidentialite`.
> - **Prevents :** le refus d'un droit d'accès ou d'effacement parce qu'une constante du code nomme
>   une table que le schéma n'a plus — un manquement art. 15 / art. 17 opposable, produit par une
>   suite de tests verte qui ne compare la liste qu'à elle-même.
> - **Rule :** toute liste de tables interpolée dans une requête d'export ou d'effacement est
>   vérifiée contre le schéma réel, au démarrage et en intégration continue. **Aucune migration ne
>   vit hors du chemin appliqué par la CI :** un fichier de migration que l'intégration continue ne
>   joue pas n'existe pas, et `pending/` est un état de rédaction, pas un répertoire de
>   déploiement. AD-8 prouve qu'on efface à temps ; celui-ci prouve qu'on sait effacer sur demande.

**Variante minimale**, si l'architecte préfère ne pas ajouter d'AD : une ligne dans les conventions —

> | Migrations & droits | Aucune migration hors du glob appliqué par la CI. Tout nom de table interpolé dans une requête d'export ou d'effacement est assertée existante contre le schéma réel. |

---

### A.2 — AD-02 : deux plans BMAD numérotent des chantiers différents sous les mêmes étiquettes

**Ce qui a été perdu.** `docs/PRODUCT_REVIEW_BMAD.md` (24/07) et `docs/MARKET_SCAN_BMAD.md` (28/07)
réordonnent tous deux E1–E7 de façon incompatible, avec des horizons incompatibles (« ~2-3 sprints »
contre cinq vagues sur 26 semaines), et le scan ajoute un « E0 conformité aux standards » qualifié de
**plus haut ROI du plan**, totalement absent de la revue. Le spine cite les deux documents dans
`sources` sans jamais dire lequel prime. Conséquence immédiate et concrète : le livrable suivant
retenu au memlog est *le découpage en épics/chantiers*. S'il réutilise l'espace de noms E1–E7,
« on attaque E2 » désignera deux chantiers différents selon le document que le lecteur a ouvert.

C'est une perte de **cohérence de nommage**, pas de contenu technique — exactement le genre que la
structure en AD ne sait pas accrocher. Elle n'a pourtant qu'un seul endroit possible : ici.

**Texte proposé — entrée sous « Questions ouvertes » :**

> - **Deux plans BMAD réordonnent les mêmes étiquettes E1–E7.** `docs/PRODUCT_REVIEW_BMAD.md`
>   (24/07/2026) et `docs/MARKET_SCAN_BMAD.md` (28/07/2026) numérotent des chantiers différents sous
>   les mêmes noms, avec des horizons incompatibles, et le scan ajoute un « E0 — conformité aux
>   standards » qu'il qualifie de plus haut ROI du plan et que la revue ignore. **Tant que ce conflit
>   n'est pas tranché, aucune étiquette `E<n>` héritée n'est réutilisée :** le découpage issu de ce
>   spine numérote ses chantiers dans un espace de noms neuf, et marque explicitement l'un des deux
>   documents comme remplacé par l'autre. La substance de l'« E0 conformité » n'est pas perdue — elle
>   est portée par AD-12, qui exige la preuve de conformité OTel de bout en bout. **Bloquant pour le
>   découpage en épics ; non bloquant pour le build.**

---

### A.3 — AD-07 : le scope tenant vit dans l'en-tête, pas dans l'URL

**Ce qui a été perdu.** Le finding le plus dangereux du lot, parce qu'il se présente comme une
optimisation « risque nul » en tête d'une liste de quick wins. `GET /api/rum/summary` est authentifiée
par un jeton porteur scopé à un tenant ; le paramètre `?app=` est **optionnel** et retombe sur l'app
du jeton (vérifié ce jour, `route.ts:29`). Deux tenants différents produisent donc la **même URL**
pour des charges utiles différentes. Un cache partagé se clé sur l'URL, pas sur `Authorization` :
la mise en cache de cette route sert la réponse du tenant A au tenant B — sur la seule API vendue
en OEM, et en contradiction frontale avec AD-3 (spine).

Le spine ne prononce jamais les mots cache, CDN ni `Vary`. Le `cache-control: no-store` des routes
de lecture est aujourd'hui une propriété du code que **rien** ne protège : le premier profil de
performance la signalera comme un gaspillage.

**Texte proposé — nouvel AD :**

> ### AD-16 — Le tenant est porté par la requête authentifiée, jamais par l'URL seule
>
> - **Binds :** le contrat de lecture (`/api/rum/summary` et toute route OEM future), les en-têtes de
>   cache, tout intermédiaire de cache — CDN, proxy, navigateur.
> - **Prevents :** la fuite inter-tenants la plus silencieuse qui soit. Le scope vit dans
>   `Authorization`, l'URL ne l'identifie pas — `?app=` est optionnel — et un cache partagé se clé sur
>   l'URL. Aucune erreur n'est levée, aucun test ne rougit, et le tenant B lit les agrégats du
>   tenant A. L'optimisation qui la crée se présente comme « sûre, risque nul ».
> - **Rule :** toute réponse scopée tenant est servie `no-store`. Ce n'est pas un réglage de
>   performance, c'est un invariant : sa suppression est un défaut de sécurité, pas un gain. Si un
>   cache devient un jour nécessaire, il est strictement privé et clé par jeton
>   (`Cache-Control: private` + `Vary: Authorization`), et il est accompagné d'un test « un jeton A ne
>   reçoit jamais la réponse d'un jeton B » exécuté dans la configuration expédiée (AD-11).

---

### A.4 — AD-13 : un durcissement de l'ingestion est une migration de parc

**Ce qui a été perdu.** Le finding disait : E1-S1 est écrite comme une bascule de valeur alors que
c'est une migration coordonnée de tous les tenants, sans inventaire, sans mode observation, sans
fenêtre de coexistence, sans retour arrière — et le jour de la bascule, tout tenant dont la clé n'est
pas à jour cesse d'émettre en 403, **à commencer par la plateforme de démonstration qui sert de preuve
commerciale**, sans alerte puisqu'aucune surveillance externe n'existe.

Le spine a répondu à la question de *quoi* durcir (AD-5, quatre couches, allowlist d'origines
**obligatoire**) sans jamais répondre à celle de *comment le durcissement atteint un parc déjà
instrumenté*. Le risque n'a pas été traité : il a été **multiplié**. Une allowlist d'origines
rejette bien davantage de trafic légitime non déclaré qu'un simple `REQUIRE_API_KEY=true`, et le
parc réel s'intègre par copier-coller de snippet (AD-10 spine le reconnaît).

C'est un invariant, pas un détail de planification : il impose que le code porte deux modes et une
métrique, et que le mode soit une propriété par app.

**Texte proposé — nouvel AD :**

> ### AD-17 — Tout durcissement d'un contrôle d'entrée est déployé en observation avant d'être appliquant
>
> - **Binds :** AD-5 (allowlist d'origines, clés, jetons courts), AD-6 (fail-closed), le registre
>   d'apps, le parc de sites clients déjà instrumentés, la plateforme de démonstration.
> - **Prevents :** la perte de télémétrie silencieuse et irrécupérable au jour de la bascule. Tout
>   tenant dont l'origine n'est pas déclarée ou la clé pas à jour cesse d'émettre en 403 — sans
>   erreur exploitable côté client, sans alerte côté produit, et la donnée non émise ne se rattrape
>   pas. AD-5 rend ce risque plus aigu, pas moins.
> - **Rule :** un contrôle d'entrée nouveau se déploie d'abord en **mode observation** : il compte ce
>   qu'il rejetterait, et ne rejette rien. Le passage en mode appliquant exige que cette métrique soit
>   à zéro sur une fenêtre déclarée, et un retour arrière par configuration, sans redéploiement. Le
>   mode est une caractéristique **par app**, jamais un drapeau global. Corollaire : l'inventaire et
>   le provisionnement du parc précèdent le durcissement, ils n'en sont pas la conséquence.

---

### A.5 — AD-16 : aucun chiffre n'a de méthode, et rien ne remplace le pourcentage

**Ce qui a été perdu.** Deux choses distinctes.

1. **Une réserve de ton.** « 65-70 % » n'a ni dénominateur, ni méthode, ni incertitude ; les
   estimations en sprints ne reposent sur aucune capacité déclarée alors que le dépôt est
   mono-contributeur ; et le seul chiffre traçable du scorecard s'est révélé être une erreur d'unité
   (AD-03). Le finding avertit que ce pourcentage « se transforme en engagement de délai auprès d'un
   client ». Avec un deck OEM au nombre des livrables retenus, c'est une contrainte de communication
   directement exploitable — et elle n'est nulle part.
2. **Une substitution.** Le finding ne demande pas seulement de retirer le chiffre : il demande de le
   remplacer par des **conditions de sortie vérifiables**. Le spine possède déjà chacun de ces
   ingrédients, dispersés dans quatorze AD, une liste Deferred et une question ouverte. Personne ne
   les a rassemblés en une définition de « vendable en OEM ».

AD-11 (spine) n'y suffit pas : il conditionne les *propriétés* citées en rendez-vous à un test en
configuration expédiée. Un pourcentage d'avancement et une estimation de délai ne sont pas des
propriétés testables — ils échappent à la règle par construction.

**Texte proposé — extension de la ligne « Preuve » des conventions :**

> | Preuve | *(texte existant)* … Et : aucun chiffre d'avancement, de capacité ou de délai n'est publié sans sa méthode, son dénominateur et son incertitude. Un pourcentage d'avancement n'est pas une mesure — l'état du produit s'exprime en conditions de sortie vérifiables. Toute estimation porte la capacité qu'elle suppose. |

**Texte proposé — nouvelle section, à placer avant « Deferred » :**

> ## Conditions de sortie — ce que « vendable en OEM » veut dire
>
> Ces conditions remplacent le « 65-70 % » du plan précédent. Chacune est vraie ou fausse ; aucune
> n'est une fraction du chemin.
>
> - L'ingestion refuse un POST depuis une origine non déclarée, y compris avec une clé valide,
>   prouvé par un test s'exécutant en configuration expédiée — AD-5, AD-11.
> - Toute lecture ou écriture tenant passe par la voie unique, adoption à 100 %, et l'isolation est
>   vérifiée dans le rôle de connexion réellement déployé — AD-3, AD-11.
> - La licence et la frontière open-core sont posées — *Deferred*, bloquant contractuel.
> - Une restauration a été exécutée et chronométrée, RPO et RTO déclarés — AD-14.
> - La capacité est mesurée en cloud, en events/s, et la valeur est écrite quelque part —
>   *Question ouverte*.
> - Un beacon émis ressort en lecture, vérifié en continu depuis l'extérieur de la plateforme — AD-9.
> - Les faits légaux publiés dérivent de l'infrastructure réelle — AD-7.

**Texte proposé — renfort de la question ouverte sur la capacité** *(rattrape aussi le résidu d'AD-08)* :

> … **Deux inconnues distinctes, souvent confondues :** le débit d'ingestion soutenable en cloud
> (jamais mesuré), et le dimensionnement du pool de connexions derrière le pooler Neon sous charge
> réelle — `PGPOOL_MAX ?? 10` aujourd'hui, valeur jamais éprouvée. Le quick win « passer le pool de
> 5 à 20 » du plan précédent était caduc sur les deux plans : la valeur est déjà configurable, et le
> rôle qu'il nommait n'est plus celui de la production.

---

### A.6 — Fragment perdu de AD-04 : la réserve sur le dépôt privé

**Ce qui a été perdu.** Le rapport de vérification consacre une section entière (§5, « Réserve — une
erreur de la lentille adversariale ») à corriger l'une de ses propres lentilles : elle avait affirmé
que la clé `mip_live_gip_…` était « committée en clair dans un dépôt **public** » et en avait tiré une
conclusion de fuite. **C'est faux — le dépôt est privé, vérifié via l'API GitHub. Il n'y a pas
d'urgence de rotation.** La clé est bien committée dans `docs/SNIPPET_UTI.md` et `docs/CONSENT_UTI.md`
— hygiène à traiter, pas incident.

Le spine a retenu la conclusion (AD-5) et laissé tomber la réserve. Cela coûte des deux côtés : soit
quelqu'un rejoue plus tard une rotation d'urgence inutile, soit le deck OEM répète une affirmation
fausse sur l'exposition d'un secret. Et la leçon de méthode que le rapport en tire — *les lentilles
produisent des affirmations vérifiables, pas des vérités* — est exactement la garde qui manquait à la
revue de juillet.

**Texte proposé — annotation de la ligne `sources` du front-matter :**

> ```yaml
> sources:
>   - 'Rapport de vérification bmad-review du 25/08/2026 — 30 findings confrontés au code réel.
>      Réserve consignée par le rapport lui-même : la lentille adversariale avait affirmé que la clé
>      mip_live_* était committée dans un dépôt PUBLIC. C''est faux — le dépôt est privé (vérifié via
>      l''API GitHub) et aucune rotation d''urgence n''est requise. Ce qui tient, et qui fonde AD-5 :
>      la clé est publique par construction, parce qu''injectée dans le HTML du site client.'
> ```

**Texte proposé — ligne à ajouter aux conventions, ou note sous « Questions ouvertes » :**

> **Réserve de méthode.** Les lentilles de revue produisent des affirmations vérifiables, pas des
> vérités. Tout constat issu d'une revue qui déclencherait un travail coûteux, une rotation de secret
> ou une communication externe est re-vérifié à la main avant d'être agi — c'est cette re-vérification
> qui a évité une rotation inutile en août 2026, et son absence qui avait produit trois verts faux en
> juillet.

---

### A.7 — Fragment perdu de AD-09 : la démonstration commerciale tourne sur du seed

**Ce qui a été perdu.** La mise à l'écart du positionnement « corrélation synthétique ↔ RUM » est
un déferrement propre et documenté. Mais elle emporte avec elle une réserve qu'elle ne lève pas :
`docs/LIMITES.md:89` précise que la source synthétique est alimentée par du **seed**, pas par l'API
DEM réelle. Autrement dit, **la démonstration qui vend tourne sur des données fabriquées**.

Écarter le positionnement ne fait pas disparaître les écrans : `apps/sync-synthetic/` reste au dépôt
et le deck OEM est un livrable retenu. Un prospect technique qui demande « c'est une mesure réelle,
ça ? » en rendez-vous obtient aujourd'hui une réponse que personne n'a préparée. C'est une contrainte
d'intégrité commerciale, et elle survit intacte au choix du moteur générique.

**Texte proposé — amendement de la ligne Deferred existante :**

> | **Corrélation synthétique ↔ RUM** | Positionnement écarté par Julian au profit du moteur générique. `apps/sync-synthetic/` reste un utilitaire hors cœur. Condition de révision consignée au memlog. **Réserve non levée par cette mise à l'écart :** la source synthétique est alimentée par du seed, pas par l'API DEM réelle (`docs/LIMITES.md:89`) — toute démonstration qui s'en sert montre des données fabriquées. |

**Texte proposé — ligne à ajouter aux conventions :**

> | Démonstration | Toute donnée affichée dans une démonstration commerciale est soit réellement mesurée, soit visiblement étiquetée comme fabriquée. Aucun écran présenté à un prospect ne fait passer du seed pour une mesure. |

---

## Divergences assumées à consigner

Ce ne sont pas des pertes : le spine tranche sciemment autrement, ou avec d'autres chiffres. Elles
méritent d'être écrites quelque part avant que quelqu'un ne les découvre en cours de chantier.

1. **Séquencement de la capacité (AD-03).** Le finding conclut que la capacité est « sur le chemin
   critique du premier client payant » ; la question ouverte du spine conclut « bloquant pour toute
   promesse chiffrée ; **non bloquant pour le build** ». Les deux peuvent être vrais — la mesure ne
   bloque pas le code, elle bloque la vente — mais la formulation actuelle du spine peut se lire comme
   un déclassement du sujet. Une demi-phrase suffirait : « non bloquant pour le build, bloquant pour
   le premier contrat ».

2. **Taille du chantier AD-3.** Le spine et le memlog écrivent « les **49** sites d'appel de `q()` » ;
   le rapport de vérification écrit « ~138 appels `q()` » (VG-04) et « ~53 sites d'appel » (AD-06).
   Mesuré ce jour au grep : **117 sites d'appel dans `apps/console/lib/queries-*.ts`, 169 dans
   `apps/console` entière, sur 47 fichiers**. Les 49 de graft comptent vraisemblablement les
   **fonctions appelantes**, pas les appels. L'écart est d'un facteur 2 à 3 sur le chantier
   d'architecture le plus lourd du spine — à réconcilier avant tout chiffrage.

3. **Résidu d'AD-14 (finding).** Le corollaire du scan marché — « sécurité, isolation, SSO, RBAC,
   audit : toujours dans le socle, jamais en palier » — n'est porté que pour l'isolation (AD-3 spine).
   SSO, RBAC et journal d'audit n'apparaissent nulle part, et ce sont trois questions systématiques
   d'un acheteur OEM. À verser au découpage plutôt qu'au spine, mais à ne pas laisser tomber.
