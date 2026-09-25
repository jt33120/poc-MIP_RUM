#!/usr/bin/env bash
# MIROIR FILTRÉ DU DÉPÔT (P6b) — ce qu'on remet à une DSI, sans les documents
# commerciaux ni ceux du client.
#
#   scripts/ops/miroir-filtre.sh <source> [<dossier de sortie>]
#     <source>  : l'URL du dépôt, ou son chemin local
#     sortie    : un dépôt nu (bare) filtré ; par défaut, un dossier temporaire
#
# POURQUOI. Les documents commerciaux et client ont été retirés du SUIVI le
# 23/09 (docs/DOCUMENTS-HORS-DEPOT.md), et l'outillage IA avec eux. Mais le dépôt
# est public et son HISTORIQUE les contient encore : un simple clone les remettrait.
# Ce script réécrit l'historique d'un CLONE MIROIR, jamais celui du dépôt source,
# ne pousse RIEN, et refuse de conclure si l'un des chemins retirés subsiste dans
# un seul commit, sur une seule branche ou un seul tag.
#
# Requis : git-filter-repo (`pip install git-filter-repo`).
# Ensuite (geste humain, vers un dépôt NEUF — jamais vers celui-ci) :
#   git -C <sortie> push --mirror <url du dépôt de remise>
set -euo pipefail

SOURCE=${1:?usage : miroir-filtre.sh <source (URL ou chemin du dépôt)> [<dossier de sortie>]}
SORTIE=${2:-"$(mktemp -d)/depot-miroir.git"}

command -v git-filter-repo >/dev/null 2>&1 || {
  echo "git-filter-repo introuvable : pip install git-filter-repo" >&2
  exit 2
}
if [ -e "$SORTIE" ]; then
  echo "la sortie existe déjà : $SORTIE — choisir un dossier neuf" >&2
  exit 2
fi

# Les chemins retirés : un par ligne, au format de `--paths-from-file` (un dossier
# se termine par /). La liste est celle de docs/DOCUMENTS-HORS-DEPOT.md et de
# l'hygiène P0 ; la tenir à jour en même temps.
RETIRES=$(mktemp)
trap 'rm -f "$RETIRES"' EXIT
cat > "$RETIRES" <<'LISTE'
docs/OFFRE.md
docs/DEMO_SCRIPT.md
docs/MARKET_SCAN_BMAD.md
docs/PRODUCT_REVIEW_BMAD.md
docs/RAPPORT_CLIENT.md
docs/SNIPPET_UTI.md
docs/HANDOVER_UTI.md
docs/CONSENT_UTI.md
docs/AI_UTI.md
docs/AI_MAPPING_UTI.md
docs/AI_SESSION_BACKGROUND_UTI.md
docs/AI_PII_FIX_UTI.md
.claude/
.agents/
.codex/
_bmad/
_bmad-output/
.mcp.json
LISTE

echo "clone miroir de $SOURCE → $SORTIE"
git clone --quiet --mirror --no-local "$SOURCE" "$SORTIE"

echo "réécriture de l'historique (chemins retirés : $(wc -l < "$RETIRES" | tr -d ' '))"
git -C "$SORTIE" filter-repo --force --quiet --invert-paths --paths-from-file "$RETIRES"

# LA PREUVE : aucun chemin retiré dans aucun commit de toutes les références.
MOTIF=$(sed -e 's/[.[\*^$]/\\&/g' -e 's#/$#/.*#' "$RETIRES" | paste -sd '|' -)
if git -C "$SORTIE" log --all --name-only --format= | sort -u | grep -E "^(${MOTIF})$"; then
  echo "ÉCHEC : ces chemins subsistent dans l'historique filtré" >&2
  exit 1
fi
COMMITS=$(git -C "$SORTIE" rev-list --all | wc -l | tr -d ' ')
echo "miroir filtré prêt : $SORTIE ($COMMITS commits, aucun chemin retiré dans l'historique)"
echo "à pousser vers un dépôt NEUF : git -C \"$SORTIE\" push --mirror <url>"
