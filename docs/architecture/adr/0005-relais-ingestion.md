# ADR-0005 — La console relaie la collecte au collector, pour une durée datée

- **Statut** : acceptée ; relais livré éteint (P3), montée à venir
- **Date** : 2026-09-24
- **Portée** : routes d'ingestion de la console, service `collector`, `platform_flag`

## Contexte

Un client réel et une extension publiée envoient leurs mesures à `mip-rum-console.vercel.app/api/ingest/v1/*`. Changer cette adresse chez eux prend des semaines ; certains sites ont une CSP qui fige `connect-src`. Or la collecte doit quitter Vercel : elle y réimplémente la couche HTTP du receveur (deux copies qui divergent), et c'est là que se trouve l'identité à hacher.

## Décision

1. **La console reçoit toujours, et relaie** au collector une part tirée au sort de chaque requête : corps **octet pour octet**, en-têtes par **liste exacte**, et deux en-têtes du bord de confiance — le secret partagé (`x-mip-edge-auth`, deux valeurs admises pour la rotation) et **le pays seul**, jamais l'adresse IP.
2. **La part relayée vit en base** (`platform_flag.ingest_relay_pct`, migration v87, cache 30 s) : c'est le coupe-circuit, effectif en 30 s sans déploiement. Montée : 0 → 10 % (2 h) → 50 % (une nuit) → 100 %.
3. **Le collector signe toutes ses réponses** (`x-mip-collector: 1`) : une réponse signée est rendue telle quelle, sans repli ; seule une réponse non signée du routeur Railway (404, 405, 502, 504) ou une erreur réseau déclenche le repli local. Au-delà de 8 s, 503 sans repli : le collector a peut-être écrit.
4. **Les délais s'emboîtent** : collector 4 s (échéance dure, COMMIT jamais envoyé après) < relais 8 s < fonction Vercel 30 s.
5. **La date de fin** : après au moins 7 jours à 100 % sans repli, les routes deviennent des relais purs (`CONSOLE_INGEST_RELAY_STRICT=1`, livré en C11), puis le chemin d'écriture local disparaît (C12) ; puis la collecte directe au collector pour les sites sans CSP figée (P6b.G), qui seule permet la géolocalisation par adresse.

## Conséquences

- Tant que le relais porte le trafic, le pays vient de Vercel (`x-vercel-ip-country`) et le GeoIP local du collector reste éteint (`GEOIP_IP_SOURCE=none`).
- Le texte de conformité doit changer AVANT la première montée du drapeau (Vercel reçoit et relaie, Railway pseudonymise et écrit) : garde humaine, PR #296 (ouverte au 26/09/2026 ; elle remplace #285, fermée), prérequis n° 6 du [mode d'emploi](../../operations/relais-ingestion.md).
- Un COMMIT dont la réponse se perd laisse une issue inconnue (503 « outcome unknown ») : doublon possible pour les logs, les seuls sans clé naturelle.

## Écarté

- **Basculer les clients directement** sur le domaine du collector : des semaines de coordination, et impossible pour les sites à CSP figée.
- **Un rewrite Vercel** vers le collector : pas de repli, pas de coupe-circuit, et l'adresse du visiteur partirait avec la requête.
