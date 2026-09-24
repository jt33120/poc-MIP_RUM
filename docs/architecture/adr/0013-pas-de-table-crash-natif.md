# ADR-0013 — Pas de table de crash natif tant qu'aucun moteur n'est choisi

- **Statut** : acceptée
- **Date** : 2026-09-24
- **Portée** : schéma, SDK mobile, point R4 de la vitrine

## Contexte

Les crashes natifs iOS et Android (signaux, exceptions Objective-C/Swift, ANR, tombstones) exigent un moteur de capture et une symbolication propres à chaque plateforme (dSYM, fichiers de mapping). Aucun moteur n'est choisi. Le SDK React Native capte les erreurs JavaScript, pas les crashes natifs.

## Décision

**Aucune table, aucune route, aucun écran pour les crashes natifs** tant qu'un moteur n'est pas choisi. Le manque reste affiché publiquement (point R4 de `/presentation`).

## Conséquences

- Un contributeur qui voudrait « préparer le terrain » avec une table vide trouvera cette décision : une table sans producteur ferait croire à une capacité qui n'existe pas, et son schéma serait deviné avant de connaître le format réel des rapports.
- Le choix du moteur (auto-hébergé ou service tiers) décidera du schéma, de la symbolication et du sous-traitant éventuel ; il appartient au responsable du produit.

## Écarté

- **Une table générique `native_crash (payload jsonb)`** : elle ne dit rien de ce que le produit sait faire, et chaque écran devrait deviner la forme du contenu.
