# Fixtures des tests

Données d'entrée des tests. La fixture qui suit est extraite d'une base tierce : sa licence
demande qu'on cite la source à côté d'elle.

## `dbip-country-lite-2026-09.csv`

- **Source** : DB-IP, base « IP to Country Lite » de septembre 2026
  (<https://db-ip.com/db/download/ip-to-country-lite>).
- **Licence** : Creative Commons Attribution 4.0 International (CC BY 4.0,
  <https://creativecommons.org/licenses/by/4.0/>).
- **Attribution** : IP Geolocation by DB-IP (<https://db-ip.com>).
- **Modification** : c'est un extrait, pas la base complète. On a gardé 27 plages, au format
  exact du fichier livré, pour les cas que testent `tests/unit/geoip.test.ts` et
  `tests/unit/geoip-db.test.ts` (plages réservées, IPv4 et IPv6, `ZZ`).

La base complète n'est pas versionnée. `packages/backend/data/LICENCE-DB-IP.txt` dit sous
quelle licence elle est lue et où son attribution s'affiche dans la console.
