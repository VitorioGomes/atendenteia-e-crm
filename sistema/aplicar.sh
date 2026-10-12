#!/usr/bin/env bash
#
# Remonta o sistema na VPS com o codigo que esta nesta pasta, e confere se voltou.
#
#   bash aplicar.sh
#
# Quem chama e o computador da pessoa, depois de enviar o codigo para ca (git push): e assim
# que chegam as mudancas que ela pediu (cor, tela nova). Faz uma copia de seguranca antes. A pasta negocio/, o .env e os dados
# nao sao tocados.

set -euo pipefail

VERDE=$'\033[0;32m'; VERMELHO=$'\033[0;31m'; FIM=$'\033[0m'
ok()     { echo "${VERDE}[ok]${FIM} $*"; }
morrer() { echo "${VERMELHO}[erro]${FIM} $1" >&2; [ $# -gt 1 ] && echo "       $2" >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f .env ] || morrer "Este sistema ainda nao foi instalado aqui." "Rode bash instalar.sh primeiro."

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

bash backup.sh >/dev/null && ok "Copia de seguranca feita (pasta backups/)"

$SUDO docker compose build 2>&1 | tail -3
$SUDO docker compose up -d
$SUDO docker image prune -f >/dev/null 2>&1 || true

for i in $(seq 1 60); do
  if $SUDO docker compose exec -T app node -e "fetch('http://localhost:3000/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ok "Sistema no ar com a versao $(git rev-parse --short HEAD)"
    $SUDO docker compose exec -T app npm run doctor || true
    exit 0
  fi
  sleep 2
done

morrer "O sistema nao voltou depois de remontar." \
       "Veja o erro com: docker compose logs --tail=60 app. Para voltar, restaure a copia de backups/ com bash restaurar.sh."
