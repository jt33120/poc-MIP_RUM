-- migration-v59 — le volume réel des erreurs, quand le SDK cesse de tout envoyer.
--
-- Finding 2.1 de docs/AUDIT_RUM_EXTERNE.md (lot 4), volet base.
--
-- Le SDK plafonne désormais les erreurs par page et les déduplique par empreinte
-- avec une fenêtre de silence de 10 s (packages/rum-sdk/src/errors.ts). Sans la
-- colonne ci-dessous, ce plafond ferait DISPARAÎTRE du volume : une boucle qui
-- produit 4 000 exceptions serait comptée comme 4. On soignerait le symptôme en
-- cassant la mesure — exactement le genre d'échange que ce dépôt refuse.
--
-- Le SDK envoie donc `mip.error_count` : le nombre d'occurrences accumulées
-- depuis sa dernière transmission de cette empreinte. La ligne porte ce compte,
-- et les agrégats le SOMMENT au lieu de compter les lignes.
alter table rum_error add column if not exists occurrences int not null default 1;

comment on column rum_error.occurrences is
  'Occurrences que cette ligne REPRÉSENTE. 1 dans le cas courant. Au-delà, le SDK a vu la '
  'même erreur plusieurs fois pendant sa fenêtre de silence et n''en a transmis qu''une, en '
  'joignant le compte (mip.error_count). Les compteurs de volume somment cette colonne ; '
  'compter les lignes sous-estimerait une boucle d''erreurs — précisément le cas qu''on veut voir.';
