-- migration-v08.sql — fiabilité de la livraison d'alertes (revue R5). MIP RUM v0.7.
--
-- Problème corrigé : une livraison passée en 'failed' (webhook momentanément
-- indisponible) n'était JAMAIS rejouée -> alerte définitivement perdue. On
-- ajoute un compteur de tentatives pour permettre au dispatcher un rejeu borné
-- à backoff exponentiel, avec un état terminal 'dead' quand le plafond est atteint.

-- compteur de tentatives (0 = jamais tenté). Les lignes existantes : 0.
alter table alert_delivery add column if not exists attempts int not null default 0;

-- statuts désormais possibles : queued | sent | failed (transitoire) | dead (épuisé).
-- Pas de contrainte CHECK pour rester compatible avec l'existant.

-- index de sélection du dispatcher (statut + ancienneté de la dernière tentative)
create index if not exists alert_delivery_pending_idx
  on alert_delivery (status, attempted_at);
