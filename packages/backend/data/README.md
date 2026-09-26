# Base IP → pays (GeoIP optionnel, P8.7)

Ce dossier accueille **une** livraison de **DB-IP IP to Country Lite**. Elle
n'est pas dans le dépôt : voir `.gitignore`, qui explique pourquoi, et
[`LICENCE-DB-IP.txt`](LICENCE-DB-IP.txt) pour l'attribution que la licence
CC BY 4.0 exige.

**GeoIP est optionnel.** Sans base ici, l'ingestion fonctionne exactement comme
avant : le pays reste estimé d'après le fuseau horaire du terminal. Rien n'est
bloqué, rien n'est retardé, rien n'échoue.

**En production, il ne sert pas** (26/09/2026) : la collecte passe par la console
sur Vercel, qui n'embarque pas la base, et le service `collector` qui la porte
n'est pas encore créé ; son IaC pose `GEOIP_IP_SOURCE=none` jusqu'à la collecte
directe (P6b.G). La base sert l'auto-hébergement ([infra/docker/](../../../infra/docker/README.md)).

## Déposer la base

```sh
node scripts/fetch-geoip-db.mjs            # dépose la version du manifeste
node scripts/fetch-geoip-db.mjs --verify   # vérifie la base déposée, sans réseau
node scripts/fetch-geoip-db.mjs --update 2026-10   # nouvelle livraison + manifeste
```

Le fichier attendu s'appelle **`dbip-country-lite-AAAA-MM.csv.gz`**. Le nom porte
la version, et c'est cela qui permet d'en connaître l'âge : la date de
modification d'un fichier est remise à zéro par toute construction d'image.

## Ce que le service en fait

| Étape | Où |
|---|---|
| Choix du fichier (`GEOIP_DB_PATH`, sinon la livraison la plus récente d'ici) | `packages/backend/lib/geoip-db.mjs` |
| Chargement en mémoire, une seule fois, sans bloquer le démarrage | `packages/backend/lib/geoip-db.mjs` |
| Analyse du CSV, dichotomie IPv4/IPv6, plages réservées | `packages/backend/shared/geoip.mjs` |
| D'où vient l'adresse du client (`GEOIP_IP_SOURCE`) | `packages/backend/shared/client-ip.mjs` |
| Écriture du pays et de sa provenance | `packages/backend/lib/pg-ingest.mjs`, migration v85 |

## Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `GEOIP_IP_SOURCE` | *(vide)* = `none` | D'où lire l'adresse : `none`, `socket`, `railway`, `xff:<n>`. **Sans elle, GeoIP est éteint** — un déploiement dont personne n'a décrit la façade ne doit pas deviner. |
| `GEOIP_DB_PATH` | *(vide)* | Chemin explicite d'une livraison (volume monté). Sinon, la plus récente de ce dossier. |
| `GEOIP_MAX_AGE_DAYS` | `180` | Au-delà, la base est **refusée** : un pays périmé n'est pas une information, un pays inconnu en est une. |

`GET /health` du `collector` rend l'état réel : `geoip.etat`
(`actif` / `chargement` / `eteint`), `geoip.version`, `geoip.raison`.

## Format

CSV sans en-tête, trois colonnes, bornes **incluses**, IPv4 et IPv6 mêlées :

```
1.0.0.0,1.0.0.255,AU
2001::,2001:0:ffff:ffff:ffff:ffff:ffff:ffff,US
```

`ZZ` n'est pas un pays : DB-IP s'en sert pour les plages réservées ou non
attribuées. Il est chargé comme « inconnu » et ne peut jamais être persisté.

**Attention à une particularité de la base réelle** : elle attribue un pays à
certaines plages qui n'en ont pas — `fec0::/10` y est rangé sous « CH ». Le code
écarte donc les plages privées, de documentation et non routables **avant**
d'interroger la base. Une adresse de réseau interne est toujours « inconnu ».

## Ce que cette mesure vaut

Une base **pays** ne localise pas une personne. Elle situe une **adresse**, qui
est le plus souvent celle d'un opérateur, d'un relais d'entreprise ou d'un VPN.
Un télétravailleur derrière le VPN de son employeur est classé au pays de la
sortie du VPN, pas au sien. C'est écrit ainsi à l'écran, dans la documentation et
dans les commentaires de la colonne en base — le dépôt ne vend jamais une donnée
pour plus qu'elle n'est.
