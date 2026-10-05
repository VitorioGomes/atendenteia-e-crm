#!/usr/bin/env bash
#
# Atualiza o sistema na VPS para a versao mais nova do repositorio.
#
#   bash atualizar.sh
#
# Faz uma copia de seguranca antes, baixa a versao nova, remonta e confere.
# A pasta negocio/, o .env e os dados nao sao tocados: o git nao versiona nenhum deles.

set -euo pipefail

VERDE=$'\033[0;32m'; VERMELHO=$'\033[0;31m'; FIM=$'\033[0m'
ok()     { echo "${VERDE}[ok]${FIM} $*"; }
morrer() { echo "${VERMELHO}[erro]${FIM} $1" >&2; [ $# -gt 1 ] && echo "       $2" >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f .env ] || morrer "Este sistema ainda nao foi instalado aqui." "Rode bash instalar.sh primeiro."

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

bash backup.sh >/dev/null && ok "Copia de seguranca feita (pasta backups/)"

ANTES="$(git rev-parse --short HEAD)"
git pull --ff-only --quiet \
  || morrer "Nao consegui baixar a versao nova." \
            "Alguem mexeu nos arquivos do sistema nesta VPS. Rode 'git status' para ver o que foi."
DEPOIS="$(git rev-parse --short HEAD)"

if [ "$ANTES" = "$DEPOIS" ]; then
  ok "Ja estava na versao mais nova ($DEPOIS)"
  exit 0
fi
ok "Versao nova baixada ($ANTES -> $DEPOIS)"

$SUDO docker compose build 2>&1 | tail -3
$SUDO docker compose up -d
$SUDO docker image prune -f >/dev/null 2>&1 || true

for i in $(seq 1 60); do
  if $SUDO docker compose exec -T app node -e "fetch('http://localhost:3000/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ok "Sistema no ar com a versao nova"
    $SUDO docker compose exec -T app npm run doctor || true
    exit 0
  fi
  sleep 2
done

morrer "O sistema nao voltou depois de atualizar." \
       "Veja o erro com: docker compose logs --tail=60 app. Para voltar, restaure a copia de backups/ com bash restaurar.sh."
