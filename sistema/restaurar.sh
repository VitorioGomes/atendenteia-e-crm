#!/usr/bin/env bash
#
# Restaura uma copia de seguranca feita pelo backup.sh.
#
#   bash restaurar.sh backups/atendente-20260905-0300.tar.gz
#
# ISSO APAGA OS DADOS ATUAIS e coloca os do backup no lugar. Pede confirmacao
# escrita antes de fazer qualquer coisa.
#
# Depois de restaurar, o WhatsApp costuma voltar conectado (a sessao esta no
# backup). Se nao voltar, e so ler o QR Code de novo na tela de Conexao.

set -euo pipefail

VERDE=$'\033[0;32m'; VERMELHO=$'\033[0;31m'; AMARELO=$'\033[0;33m'; NEGRITO=$'\033[1m'; FIM=$'\033[0m'
ok()    { echo "${VERDE}[ok]${FIM} $*"; }
aviso() { echo "${AMARELO}[atencao]${FIM} $*"; }
morrer() { echo "${VERMELHO}[erro]${FIM} $1" >&2; [ $# -gt 1 ] && echo "       $2" >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ARQUIVO="${1:-}"
[ -n "$ARQUIVO" ] || morrer "Diga qual backup restaurar." \
  "Exemplo: bash restaurar.sh backups/atendente-20260905-0300.tar.gz"
[ -f "$ARQUIVO" ] || morrer "Arquivo nao encontrado: $ARQUIVO" \
  "Veja os backups disponiveis com: ls -lh backups/"

TEMP="$(mktemp -d)"
limpar() { rm -rf "$TEMP"; }
trap limpar EXIT

tar -xzf "$ARQUIVO" -C "$TEMP" || morrer "O arquivo esta corrompido e nao pode ser aberto."
[ -f "$TEMP/banco.sql" ] || morrer "Este arquivo nao parece um backup do sistema (falta banco.sql)."

echo
echo "${NEGRITO}======================================================================${FIM}"
echo "${NEGRITO}  RESTAURAR BACKUP${FIM}"
echo "${NEGRITO}======================================================================${FIM}"
echo
echo "  Backup:  $ARQUIVO"
echo "  Data:    $(date -r "$ARQUIVO" '+%d/%m/%Y as %H:%M')"
echo
aviso "Todos os contatos, conversas e cards de AGORA serao APAGADOS"
aviso "e substituidos pelos do backup. Nao da pra desfazer."
echo
printf "  Para confirmar, escreva RESTAURAR e tecle enter: "
read -r confirmacao </dev/tty || confirmacao=""

if [ "$confirmacao" != "RESTAURAR" ]; then
  echo
  echo "  Cancelado. Nada foi alterado."
  exit 0
fi

echo
echo "Parando o sistema..."
docker compose stop app >/dev/null 2>&1 || true

echo "Restaurando os dados..."

# O CRM e um arquivo SQLite: restaurar e' trocar o arquivo, com o app parado.
if [ ! -f "$TEMP/dados/crm.db" ]; then
  morrer "Este backup nao tem o banco do CRM (dados/crm.db)." \
    "Se ele foi feito antes de 16/09/2026, use a versao antiga do restaurar.sh."
fi

mkdir -p dados
cp -r "$TEMP/dados/." dados/
ok "Banco do CRM restaurado"

# A sessao do WhatsApp fica em dados/whatsapp e volta junto com o banco. Se o
# backup veio de outra maquina, o WhatsApp pode pedir o QR Code de novo.

# O .env do pacote MANDA, menos onde ele esta vazio.
#
# Isso existe por causa da mudanca do computador para a VPS: no PC nao existe
# DOMINIO nem EMAIL_CERTIFICADO, e copiar o arquivo inteiro apagaria justamente o
# que o Caddy precisa para o HTTPS funcionar. Restaurar um backup da propria VPS
# nao muda nada, porque la o pacote tem todos os valores preenchidos.
if [ -f "$TEMP/.env" ]; then
  [ -f .env ] && cp .env ".env.antes-de-restaurar"

  if [ -f .env ]; then
    NOVO_ENV="$TEMP/.env.final"
    cp .env "$NOVO_ENV"

    MANTIDAS=""
    while IFS= read -r LINHA; do
      case "$LINHA" in
        \#*|"") continue ;;
        *=*) ;;
        *) continue ;;
      esac
      CHAVE="${LINHA%%=*}"
      VALOR="${LINHA#*=}"

      if [ -z "$VALOR" ]; then
        # Vazio no pacote: se a VPS ja tem valor, ele fica.
        ATUAL="$(grep -E "^${CHAVE}=" .env 2>/dev/null | head -1 || true)"
        if [ -n "${ATUAL#*=}" ]; then
          MANTIDAS="$MANTIDAS $CHAVE"
          continue
        fi
      fi

      if grep -qE "^${CHAVE}=" "$NOVO_ENV" 2>/dev/null; then
        # Reescreve a linha inteira sem interpretar o valor como expressao.
        TMP_ENV="$TEMP/.env.tmp"
        CHAVE="$CHAVE" VALOR="$VALOR" awk -F= '
          BEGIN { chave = ENVIRON["CHAVE"]; valor = ENVIRON["VALOR"] }
          $1 == chave && !feito { print chave "=" valor; feito = 1; next }
          { print }
        ' "$NOVO_ENV" > "$TMP_ENV"
        mv "$TMP_ENV" "$NOVO_ENV"
      else
        printf '%s=%s
' "$CHAVE" "$VALOR" >> "$NOVO_ENV"
      fi
    done < "$TEMP/.env"

    cp "$NOVO_ENV" .env
    [ -n "$MANTIDAS" ] && ok "Configuracao desta maquina mantida:$MANTIDAS"
  else
    cp "$TEMP/.env" .env
  fi

  chmod 600 .env
  ok "Arquivo .env restaurado (o anterior virou .env.antes-de-restaurar)"
fi

if [ -d "$TEMP/negocio" ]; then
  cp -r "$TEMP/negocio/." negocio/
  ok "Pasta negocio/ restaurada"
fi

echo "Subindo o sistema..."
docker compose up -d >/dev/null

echo
ok "Pronto. Abra o CRM e confira se os leads voltaram."
echo "   Se algo estiver estranho, rode: docker compose exec app npm run doctor"
