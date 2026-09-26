#!/bin/sh
# Entrada do container do app (revisao de seguranca de 26/09/2026).
#
# O sistema roda como o usuario "node", nao como administrador: se um dia alguem
# achar uma falha no app, ele fica preso a um usuario sem poder sobre o container.
#
# Esta parte roda como administrador so para uma coisa: a pasta dados/ vem do
# disco da VPS, e em instalacoes anteriores a esta mudanca (ou depois de um
# restaurar.sh, que roda como root) ela pertence ao root. Sem acertar o dono, o
# usuario node nao conseguiria gravar no banco e o atendimento pararia.
set -e
mkdir -p /app/dados
chown -R node:node /app/dados
exec su-exec node "$@"
