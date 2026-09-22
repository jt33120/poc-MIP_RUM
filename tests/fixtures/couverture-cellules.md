# Document de couverture — fixture de l'extracteur

Relevé le **3 mars 2026**, sur `master` à **`abc1234`** (fixture).

Tests : **12 fichiers, 1 234 tests verts, 0 ignoré** ; **3 fichiers** et **45 tests** au total.

## 4. Les capacités

### 4.1 Cellules piégées

| # | Capacité | Verdict | Preuve | Limite |
|---|---|---|---|---|
| A1 | Un code qui contient un tube | `deploye_non_eprouve` | `grep -E "a|b" fichier.ts` ; tests `x.test.ts` | Un tube échappé \| ne sépare rien ; `c|d` non plus. |
| A2 | Une ligne ordinaire | `non_commence` | — | Rien n'est livré. |

## 5. Après les capacités

| Ligne | hors § 4, ignorée |
|---|---|
