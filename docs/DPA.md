# Accord de traitement des données (DPA) — modèle

> **Modèle** d'accord de sous-traitance (RGPD art. 28) entre le **Responsable de
> traitement** (le client grand compte) et le **Sous-traitant** (MIP, éditeur de RUM).
> À faire valider par un juriste avant signature. Les mesures techniques renvoient au
> [dossier de conformité](CONFORMITE.md).

## 1. Parties & objet
- **Responsable de traitement** : le client (l'entité dont les sites/apps sont monitorés).
- **Sous-traitant** : MIP, fournissant le service de Real User Monitoring.
- **Objet** : traitement de données de télémétrie web pour le compte du Responsable,
  aux seules fins de **monitoring de performance et d'erreurs**.

## 2. Nature, finalité, durée
- **Nature** : collecte, stockage, agrégation et restitution de mesures de performance
  (Core Web Vitals), d'erreurs techniques et d'événements définis par le client.
- **Finalité** : exclusivement le monitoring ; **aucune** réutilisation (pas de revente,
  pas de profilage publicitaire, pas d'entraînement de modèle).
- **Durée** : durée du contrat. Données purgées selon la **rétention convenue** (défaut 30 j).

## 3. Catégories de données & de personnes
- **Personnes** : visiteurs des sites/applications du Responsable.
- **Données** : techniques (timings, erreurs, route) ; **pas d'adresse IP** stockée ;
  **pas de PII** intentionnelle (scrub serveur + pseudonymisation) ; géolocalisation au
  **pays** uniquement. Le replay (si activé) masque les saisies par défaut.

## 4. Obligations du Sous-traitant
- Traiter sur **instruction documentée** du Responsable, et uniquement pour la finalité.
- Garantir la **confidentialité** (personnel habilité, RBAC, secrets en coffre).
- Mettre en œuvre les **mesures de sécurité** de [`CONFORMITE.md` §6](CONFORMITE.md)
  (RLS, chiffrement transport, SSO/RBAC, durcissement, journalisation).
- **Localisation UE** : données hébergées en région UE (`eu-west-3`) ; pas de transfert
  hors UE sans clauses contractuelles types et accord du Responsable.

## 5. Sous-traitance ultérieure
- Sous-traitants autorisés listés dans [`CONFORMITE.md` §7](CONFORMITE.md) (Supabase,
  Vercel option, assistant IA optionnel et désactivé par défaut).
- Information préalable du Responsable avant tout **changement** de sous-traitant, avec
  droit d'objection.

## 6. Assistance aux droits des personnes (art. 15–22)
- Le Sous-traitant assiste le Responsable pour répondre aux demandes :
  - **accès / portabilité** : extraction via l'API de lecture / requêtes ciblées ;
  - **effacement** : `erase_session(session_id)` (personne concernée) et
    `erase_app_data(app_id)` (périmètre client), exécutés sur demande.

## 7. Violation de données
- Notification au Responsable **dans les meilleurs délais et au plus tard 72 h** après
  en avoir pris connaissance, avec les éléments de l'art. 33.3.

## 8. Sort des données en fin de contrat
- Au choix du Responsable : **restitution** (export) puis **effacement** via
  `erase_app_data(app_id)`, ou effacement direct. Confirmation écrite de l'effacement.

## 9. Audit
- Le Sous-traitant met à disposition les informations nécessaires pour démontrer le
  respect de l'art. 28 et permet des **audits** (sur préavis raisonnable), y compris la
  documentation de conformité et les fonctions techniques vérifiables.

---
*Annexes : [dossier de conformité](CONFORMITE.md) (mesures techniques, sous-traitants,
résidence, trajectoire de certification).*
