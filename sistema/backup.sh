#!/usr/bin/env bash
#
# Copia de seguranca do sistema.
#
#   bash backup.sh                 -> salva em ./backups
#   bash backup.sh /mnt/backup     -> salva em outro lugar
#   MANTER=14 bash backup.sh       -> guarda 14 copias em vez de 7
#
# Guarda TUDO que e insubstituivel:
#   - a pasta dados/ (o banco do CRM e a sessao do WhatsApp);
#   - o arquivo .env (sem ele o backup nao serve para restaurar);
#   - a pasta negocio/ (a personalizacao do atendimento).
#
# O instalar.sh agenda isso todo dia as 03:00.
#
# ATENCAO: o arquivo gerado contem senhas. Ele nasce com permissao 600 (so o
# dono le), mas se voce copiar para outro lugar, trate como senha.

set -euo pipefail

VERDE=$'\033[0;32m'; VERMELHO=$'\033[0;31m'; AMARELO=$'\033[0;33m'; FIM=$'\033[0m'
ok()    { echo "${VERDE}[ok]${FIM} $*"; }
aviso() { echo "${AMARELO}[atencao]${FIM} $*"; }
morrer() { echo "${VERMELHO}[erro]${FIM} $1" >&2; [ $# -gt 1 ] && echo "       $2" >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DESTINO="${1:-./backups}"
MANTER="${MANTER:-7}"
CARIMBO="$(date +%Y%m%d-%H%M)"
ARQUIVO="$DESTINO/atendente-$CARIMBO.tar.gz"

[ -f .env ] || morrer "Nao encontrei o arquivo .env nesta pasta." \
  "Rode o backup de dentro da pasta 'sistema', onde esta o docker-compose.yml."

mkdir -p "$DESTINO"

TEMP="$(mktemp -d)"
limpar() { rm -rf "$TEMP"; }
trap limpar EXIT

echo "Copiando o banco de dados..."

# O CRM agora e um arquivo SQLite em dados/. Copiar arquivo de banco com o sistema
# escrevendo nele pode gerar copia pela metade, entao o app para por alguns segundos.
# Roda as 03:00; ninguem perde atendimento por isso, e backup quebrado seria pior.
docker compose stop app >/dev/null 2>&1 || true
cp -r dados "$TEMP/dados" 2>/dev/null || true
docker compose start app >/dev/null 2>&1 || true

# Falha silenciosa e o pior tipo de falha de backup: o comando "funciona",
# o arquivo fica vazio, e ninguem descobre ate precisar restaurar.
TAMANHO_DB=$(wc -c < "$TEMP/dados/crm.db" 2>/dev/null || echo 0)
if [ "$TAMANHO_DB" -lt 1024 ]; then
  morrer "A copia do banco saiu vazia ($TAMANHO_DB bytes) — isso nao e um backup valido." \
    "Confira se o arquivo dados/crm.db existe e rode 'docker compose logs app'."
fi

cp .env "$TEMP/.env"
[ -d negocio ] && cp -r negocio "$TEMP/negocio"

tar -czf "$ARQUIVO" -C "$TEMP" .
chmod 600 "$ARQUIVO"

ok "Backup salvo: $ARQUIVO ($(du -h "$ARQUIVO" | cut -f1))"

# ---------------------------------------------------------------------------
# Rotacao: guarda so as N copias mais recentes
# ---------------------------------------------------------------------------
QUANTIDADE=$(find "$DESTINO" -maxdepth 1 -name 'atendente-*.tar.gz' | wc -l)
if [ "$QUANTIDADE" -gt "$MANTER" ]; then
  find "$DESTINO" -maxdepth 1 -name 'atendente-*.tar.gz' -printf '%T@ %p\n' \
    | sort -rn | tail -n +$((MANTER + 1)) | cut -d' ' -f2- \
    | while read -r antigo; do rm -f "$antigo"; done
  ok "Copias antigas removidas (mantendo as $MANTER mais recentes)"
fi

echo
aviso "O backup esta na MESMA maquina. Se a VPS morrer, ele morre junto."
aviso "Baixe uma copia de vez em quando para o seu computador:"
echo "   scp usuario@ip-da-vps:$(pwd)/$ARQUIVO ."
echo
echo "Para restaurar:  bash restaurar.sh $ARQUIVO"
