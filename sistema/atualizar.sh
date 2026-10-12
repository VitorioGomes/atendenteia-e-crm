#!/usr/bin/env bash
#
# Atualiza o sistema na VPS direto do repositorio oficial e remonta.
#
#   bash atualizar.sh
#
# So serve para quem nunca mudou o sistema pelo computador. Quem mudou (cor, tela nova)
# atualiza pelo computador, que junta a versao nova com as mudancas e envia para ca
# (skill/VPS.md, "Atualizar o sistema"). Nesse caso este script recusa, em vez de baixar por
# cima.

set -euo pipefail

VERDE=$'\033[0;32m'; VERMELHO=$'\033[0;31m'; FIM=$'\033[0m'
ok()     { echo "${VERDE}[ok]${FIM} $*"; }
morrer() { echo "${VERMELHO}[erro]${FIM} $1" >&2; [ $# -gt 1 ] && echo "       $2" >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ANTES="$(git rev-parse --short HEAD)"
git pull --ff-only --quiet \
  || morrer "Este sistema tem mudancas feitas pelo computador, e a versao nova precisa ser juntada com elas." \
            "Atualize pelo computador: peca a IA, na pasta do projeto, para atualizar o sistema."
DEPOIS="$(git rev-parse --short HEAD)"

if [ "$ANTES" = "$DEPOIS" ]; then
  ok "Ja estava na versao mais nova ($DEPOIS)"
  exit 0
fi
ok "Versao nova baixada ($ANTES -> $DEPOIS)"

exec bash aplicar.sh
