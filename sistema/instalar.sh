#!/usr/bin/env bash
#
# Instalador do Atendente IA + CRM numa VPS Ubuntu/Debian.
#
#   bash instalar.sh
#   bash instalar.sh mudanca-202609201530.tar.gz   -> trazendo o sistema do PC
#
# Pode rodar de novo quantas vezes quiser: ele nao refaz o que ja esta pronto.
#
# Regra deste arquivo: toda mensagem e em portugues e toda falha diz o que fazer.
# Quem le isso aqui pode ser alguem que nunca abriu um terminal na vida.

set -euo pipefail

# ---------------------------------------------------------------------------
# Aparencia
# ---------------------------------------------------------------------------
VERDE=$'\033[0;32m'; VERMELHO=$'\033[0;31m'; AMARELO=$'\033[0;33m'; NEGRITO=$'\033[1m'; FIM=$'\033[0m'

titulo()  { echo; echo "${NEGRITO}==> $*${FIM}"; }
ok()      { echo "${VERDE}  [ok]${FIM} $*"; }
aviso()   { echo "${AMARELO}  [atencao]${FIM} $*"; }
erro()    { echo "${VERMELHO}  [erro]${FIM} $*" >&2; }

morrer() {
  echo
  erro "$1"
  [ $# -gt 1 ] && echo "         ${NEGRITO}O que fazer:${FIM} $2"
  echo
  exit 1
}

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$AQUI"

echo
echo "${NEGRITO}======================================================================${FIM}"
echo "${NEGRITO}  INSTALADOR — Atendente IA + CRM para WhatsApp${FIM}"
echo "${NEGRITO}======================================================================${FIM}"

# ---------------------------------------------------------------------------
# 0. Pacote vindo do computador (opcional)
#
# O caminho do curso e testar no PC e so depois comprar a VPS, entao a instalacao
# precisa aceitar o que veio de la. Isso acontece ANTES de tudo porque o passo
# "Dados do negocio" exige negocio/negocio.json, que numa copia nova do
# repositorio nao existe: quem traz esse arquivo e o pacote.
#
# O .env do pacote nao vira arquivo aqui: ele vira variavel de ambiente. Assim o
# passo "Configuracao" mais abaixo aproveita o que ja existe (chave da IA, login
# do CRM) e so pergunta o que falta, que e justamente o que nao existe no PC:
# o endereco do CRM na internet.
# ---------------------------------------------------------------------------
PACOTE="${1:-}"

if [ -n "$PACOTE" ]; then
  titulo "Trazendo o sistema do computador"

  [ -f "$PACOTE" ] || morrer "Nao achei o arquivo $PACOTE."     "Confira o nome. Ele foi criado no seu computador pelo comando: npm run mudar"

  TEMP_PACOTE="$(mktemp -d)"
  trap 'rm -rf "$TEMP_PACOTE"' EXIT

  tar -xzf "$PACOTE" -C "$TEMP_PACOTE" 2>/dev/null     || morrer "Nao consegui abrir $PACOTE." "Envie o arquivo de novo: ele pode ter vindo pela metade."

  [ -f "$TEMP_PACOTE/dados/crm.db" ] || morrer     "Esse arquivo nao parece um pacote do sistema (nao tem o banco dentro)."     "Use o arquivo mudanca-*.tar.gz que o comando 'npm run mudar' criou no seu computador."

  mkdir -p dados negocio
  cp -r "$TEMP_PACOTE/dados/." dados/
  ok "Banco, conversas e conexao do WhatsApp no lugar"

  if [ -d "$TEMP_PACOTE/negocio" ]; then
    cp -r "$TEMP_PACOTE/negocio/." negocio/
    ok "Configuracao do negocio no lugar (a entrevista nao precisa ser refeita)"
  fi

  # Le o .env do pacote e exporta so o que tem valor. Valor vazio nao vira
  # variavel, senao o passo de Configuracao acharia que ja foi respondido.
  if [ -f "$TEMP_PACOTE/.env" ]; then
    while IFS= read -r LINHA; do
      case "$LINHA" in
        \#*|"") continue ;;
        *=*) ;;
        *) continue ;;
      esac
      CHAVE="${LINHA%%=*}"
      VALOR="${LINHA#*=}"
      [ -z "$VALOR" ] && continue
      export "$CHAVE=$VALOR"
    done < "$TEMP_PACOTE/.env"
    ok "Chave da IA e login do CRM aproveitados do computador"
  fi
fi

# ---------------------------------------------------------------------------
# 1. Conferencias antes de mexer em qualquer coisa
# ---------------------------------------------------------------------------
titulo "Conferindo o servidor"

if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || morrer \
    "Este script precisa ser executado como administrador." \
    "Entre como root ou instale o sudo."
  SUDO="sudo"
else
  SUDO=""
fi

if [ ! -f /etc/os-release ]; then
  morrer "Nao consegui identificar o sistema desta VPS." \
         "Use uma VPS com Ubuntu 22.04 ou 24.04, que e o testado."
fi
. /etc/os-release

case "${ID:-}${ID_LIKE:-}" in
  *debian*|*ubuntu*) ok "Sistema: ${PRETTY_NAME:-desconhecido}" ;;
  *) aviso "Sistema ${PRETTY_NAME:-desconhecido} nao foi testado. O recomendado e Ubuntu 22.04 ou 24.04." ;;
esac

MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if [ "$MEM_MB" -lt 1800 ]; then
  aviso "Esta VPS tem ${MEM_MB} MB de memoria. O recomendado e 2 GB."
  aviso "Com menos que isso o sistema pode ficar lento ou reiniciar sozinho."
else
  ok "Memoria: ${MEM_MB} MB"
fi

LIVRE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
if [ "${LIVRE_GB:-0}" -lt 8 ]; then
  aviso "Espaco livre em disco: ${LIVRE_GB} GB. O recomendado e pelo menos 10 GB."
else
  ok "Espaco livre: ${LIVRE_GB} GB"
fi

# ---------------------------------------------------------------------------
# 1b. Memoria virtual (swap)
#
# O pico de memoria da instalacao nao e o sistema rodando, e o build: dois
# "npm install" e o build do front dentro do Docker. Numa VPS de 4 GB isso cabe,
# mas com pouca folga — e
# estourar ali e a pior falha possivel, porque quebra no passo mais demorado
# com uma mensagem que ninguem interpreta.
#
# Swap nao deixa nada mais rapido; so impede o processo de ser morto. Como o
# disco e NVMe e isso e usado por poucos minutos durante o build, o custo e
# irrelevante perto do risco.
# ---------------------------------------------------------------------------
titulo "Memoria virtual"

SWAP_MB=$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)

if [ "${SWAP_MB:-0}" -ge 1000 ]; then
  ok "Ja existe swap: ${SWAP_MB} MB"
elif [ "$MEM_MB" -ge 7000 ]; then
  ok "Memoria suficiente, swap dispensavel"
elif [ "${LIVRE_GB:-0}" -lt 12 ]; then
  aviso "Sem espaco em disco sobrando para criar swap. Seguindo sem ele."
elif [ -f /swapfile ]; then
  aviso "Existe /swapfile mas ele nao esta ativo. Seguindo sem mexer nele."
else
  echo "  Criando 2 GB de swap para o build nao ficar sem memoria."
  if $SUDO fallocate -l 2G /swapfile 2>/dev/null \
     || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none 2>/dev/null; then
    $SUDO chmod 600 /swapfile
    if $SUDO mkswap /swapfile >/dev/null 2>&1 && $SUDO swapon /swapfile 2>/dev/null; then
      # Sobrevive ao reboot. Se a linha ja existir, nao duplica.
      grep -q '^/swapfile ' /etc/fstab 2>/dev/null \
        || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
      ok "Swap de 2 GB ativo"
    else
      $SUDO rm -f /swapfile
      aviso "Nao consegui ativar o swap. Seguindo sem ele."
    fi
  else
    aviso "Nao consegui criar o arquivo de swap. Seguindo sem ele."
  fi
fi

# ---------------------------------------------------------------------------
# 2. Docker
# ---------------------------------------------------------------------------
titulo "Docker"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "Ja instalado ($(docker --version | cut -d, -f1))"
else
  echo "  Instalando o Docker. Isso leva uns 2 minutos."
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh \
    || morrer "Nao consegui baixar o instalador do Docker." \
              "Verifique se a VPS tem acesso a internet: ping -c2 8.8.8.8"
  $SUDO sh /tmp/get-docker.sh >/dev/null 2>&1 \
    || morrer "A instalacao do Docker falhou." \
              "Rode manualmente e leia o erro: sudo sh /tmp/get-docker.sh"
  rm -f /tmp/get-docker.sh
  $SUDO systemctl enable --now docker >/dev/null 2>&1 || true
  ok "Docker instalado"
fi

docker compose version >/dev/null 2>&1 \
  || morrer "O Docker foi instalado mas o 'docker compose' nao respondeu." \
            "Rode: sudo apt-get install -y docker-compose-plugin"

# ---------------------------------------------------------------------------
# 3. Firewall — o CRM vai ficar exposto na internet
# ---------------------------------------------------------------------------
titulo "Firewall"

if command -v ufw >/dev/null 2>&1; then
  $SUDO ufw allow OpenSSH >/dev/null 2>&1 || true
  $SUDO ufw allow 80/tcp   >/dev/null 2>&1 || true
  $SUDO ufw allow 443/tcp  >/dev/null 2>&1 || true
  if ! $SUDO ufw status | grep -q "Status: active"; then
    $SUDO ufw --force enable >/dev/null 2>&1 || true
  fi
  ok "Liberadas apenas as portas de acesso remoto (22), site (80) e site seguro (443)"
else
  aviso "O ufw nao esta instalado; nao consegui configurar o firewall."
  aviso "Feche as portas nao usadas pelo painel da sua VPS."
fi

# ---------------------------------------------------------------------------
# 4. Configuracao (.env)
# ---------------------------------------------------------------------------
titulo "Configuracao"

sortear() { openssl rand -hex 24 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

descobrir_ip() {
  local ip
  ip="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  [ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "$ip"
}

perguntar() {
  # perguntar <variavel> <texto> [obrigatorio]
  local var="$1" texto="$2" obrigatorio="${3:-nao}" valor=""
  # Ja veio pronto pelo ambiente (a skill preenche assim, sem perguntar nada).
  valor="$(printf '%s' "${!var:-}")"
  while [ -z "$valor" ]; do
    printf "  %s: " "$texto"
    read -r valor </dev/tty || valor=""
    [ "$obrigatorio" = "nao" ] && break
    [ -z "$valor" ] && echo "     (esse campo e obrigatorio)"
  done
  printf '%s' "$valor"
}

if [ -f .env ]; then
  ok "Arquivo .env ja existe — mantido como esta"
else
  echo "  Vou fazer algumas perguntas. As senhas internas eu sorteio sozinho."
  echo

  IP_VPS="$(descobrir_ip)"
  [ -n "$IP_VPS" ] && ok "IP desta VPS: $IP_VPS"

  echo
  echo "  ENDERECO DO CRM"
  echo "  Se voce tem um dominio, aponte um subdominio para $IP_VPS e informe abaixo."
  echo "  Se nao tem, deixe em branco: eu uso ${IP_VPS}.sslip.io, que funciona igual."
  DOMINIO="$(perguntar DOMINIO "Endereco do CRM (enter para usar o padrao)")"
  [ -z "$DOMINIO" ] && DOMINIO="${IP_VPS}.sslip.io"
  ok "CRM vai responder em https://${DOMINIO}"

  echo
  echo "  CHAVE DA IA (console.anthropic.com -> API Keys)"
  ANTHROPIC_API_KEY="$(perguntar ANTHROPIC_API_KEY "Cole a chave da Anthropic" sim)"

  echo
  echo "  ACESSO AO CRM (voce vai usar isso pra entrar)"
  CRM_EMAIL="$(perguntar CRM_EMAIL "Seu e-mail" sim)"
  CRM_PASSWORD="$(perguntar CRM_PASSWORD "Crie uma senha (longa, nao repita de outro lugar)" sim)"

  echo
  echo "  ENTENDER AUDIOS (opcional — platform.openai.com/api-keys)"
  echo "  Sem isso, a atendente pede pra pessoa escrever em vez de mandar audio."
  OPENAI_API_KEY="$(perguntar OPENAI_API_KEY "Cole a chave da OpenAI (enter para pular)")"

  EMAIL_CERTIFICADO="${EMAIL_CERTIFICADO:-$CRM_EMAIL}"

  cat > .env <<ARQUIVO
DOMINIO=${DOMINIO}
EMAIL_CERTIFICADO=${EMAIL_CERTIFICADO}

ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
LLM_MODEL=${LLM_MODEL:-claude-haiku-4-5}
OPENAI_API_KEY=${OPENAI_API_KEY}

CRM_EMAIL=${CRM_EMAIL}
CRM_PASSWORD=${CRM_PASSWORD}

SESSION_SECRET=$(sortear)

TIMEZONE=${TIMEZONE:-America/Sao_Paulo}
ARQUIVO

  chmod 600 .env
  ok "Arquivo .env criado (contem suas senhas — nao compartilhe)"
fi

# ---------------------------------------------------------------------------
# 5. Configuracao do negocio
# ---------------------------------------------------------------------------
titulo "Dados do negocio"

if [ -f negocio/negocio.json ]; then
  ok "negocio/negocio.json encontrado"
else
  morrer "Nao encontrei o arquivo negocio/negocio.json, que descreve o seu negocio." \
         "Gere com a IA no seu computador (roteiro skill/INSTALAR.md) e traga com npm run mudar, ou rode o roteiro aqui mesmo."
fi

[ -f negocio/conhecimento.md ] || {
  aviso "Nao ha negocio/conhecimento.md. A IA vai saber so o basico."
  aviso "Depois, escreva as perguntas frequentes nesse arquivo — e o que mais melhora o atendimento."
}

# ---------------------------------------------------------------------------
# 6. Subir
# ---------------------------------------------------------------------------
titulo "Montando o sistema"
echo "  A primeira vez demora uns 5 minutos (baixa e monta tudo). Pode ir tomar um cafe."

$SUDO docker compose build 2>&1 | tail -5
$SUDO docker compose up -d

titulo "Esperando o sistema responder"
PRONTO="nao"
for i in $(seq 1 60); do
  if $SUDO docker compose exec -T app node -e "fetch('http://localhost:3000/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    PRONTO="sim"; break
  fi
  sleep 3
done

if [ "$PRONTO" != "sim" ]; then
  erro "O sistema nao respondeu no tempo esperado."
  echo "  Veja o que aconteceu com:  docker compose logs --tail=60 app"
  exit 1
fi
ok "Sistema no ar"

# ---------------------------------------------------------------------------
# 7. Backup automatico
# ---------------------------------------------------------------------------
titulo "Backup automatico"

mkdir -p "$AQUI/backups"
mkdir -p "$AQUI/dados"   # arquivo do banco (SQLite); o container monta esta pasta

if ! command -v crontab >/dev/null 2>&1; then
  aviso "O agendador (cron) nao esta instalado, entao nao consegui agendar o backup."
  aviso "Instale com 'sudo apt-get install -y cron' e rode este script de novo."
  aviso "Enquanto isso, faca o backup na mao: bash backup.sh"
else
  MARCA="# atendente-crm-backup"
  if crontab -l 2>/dev/null | grep -qF "$MARCA"; then
    ok "Backup diario ja estava agendado"
  else
    {
      crontab -l 2>/dev/null || true
      echo "$MARCA"
      echo "0 3 * * * cd $AQUI && bash backup.sh >> $AQUI/backups/backup.log 2>&1"
    } | crontab -
    ok "Backup diario agendado para as 03:00 (guarda as 7 copias mais recentes)"
  fi
fi

echo "  O backup guarda o CRM inteiro, a sessao do WhatsApp e a sua configuracao."
aviso "Ele fica na propria VPS. Baixe uma copia de vez em quando para o seu computador."

# ---------------------------------------------------------------------------
# 8. Diagnostico e instrucoes finais
# ---------------------------------------------------------------------------
titulo "Diagnostico"
$SUDO docker compose exec -T app npm run doctor || true

DOMINIO_FINAL="$(grep -E '^DOMINIO=' .env | cut -d= -f2-)"

echo
echo "${NEGRITO}======================================================================${FIM}"
echo "${NEGRITO}  PRONTO${FIM}"
echo "${NEGRITO}======================================================================${FIM}"
echo
echo "  1. Abra no navegador:  ${NEGRITO}https://${DOMINIO_FINAL}${FIM}"
echo "     (se der erro de seguranca no primeiro minuto, espere e recarregue:"
echo "      o certificado leva um instante pra sair)"
echo
echo "  2. Entre com o e-mail e a senha que voce criou."
echo
echo "  3. Clique em \"Conectar WhatsApp\" e leia o QR Code com o celular:"
echo "     WhatsApp > Configuracoes > Dispositivos conectados > Conectar dispositivo."
echo
echo "  4. Mande uma mensagem para esse numero de outro celular e veja a IA atender."
echo
echo "  Comandos uteis:"
echo "     docker compose logs -f app              ver o que esta acontecendo"
echo "     docker compose exec app npm run doctor  diagnostico"
echo "     docker compose restart app              reiniciar depois de editar negocio/"
echo
