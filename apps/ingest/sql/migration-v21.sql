-- v21 : dogfooding auditable — la console (`mip-rum-console`) s'auto-instrumente
-- depuis le navigateur, donc SANS secret côté serveur. Une clé d'API embarquée
-- dans du JS front est publique (aucune valeur de sécurité) ; on repasse donc ce
-- projet first-party en « legacy sans clé » (api_key_hash NULL) pour que son
-- ingestion ne soit plus rejetée par l'enforcement REQUIRE_API_KEY. L'enforcement
-- reste actif pour les apps réellement exposées (ex. gip-plateforme).
-- Idempotent.

update app_registry set api_key_hash = null where app_id = 'mip-rum-console';
