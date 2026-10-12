# Colocar o atendente na VPS, e cuidar dele depois

Este roteiro é para quando o atendente **já funciona no computador** da pessoa e ela quer ele no ar
24 horas, com o CRM abrindo no celular. Quem lê é você, a IA de terminal. A instalação no
computador está em [INSTALAR.md](INSTALAR.md); se ela ainda não foi feita, comece por lá.

A ideia: você cria **uma chave de acesso** do computador para a VPS uma vez só. Daí em diante você
entra na VPS sozinho, sem senha, e consegue mudar o sistema para lá, atualizar e ajustar o
atendimento sempre que ela pedir.

Antes de começar, ela precisa ter **uma VPS com Ubuntu 24.04 já comprada**, com o **IP** e a
**senha do root** que o provedor mandou. Comprar é assunto da aula, não deste roteiro.

## Regras deste roteiro

1. **A senha do root nunca passa pela conversa.** Ela é digitada pela pessoa, no terminal, uma vez
   só. Se ela colar a senha aqui mesmo assim, siga sem sermão.
2. **Nunca mostre o conteúdo do `.env`**, nem daqui nem da VPS. Tem a chave da IA e a senha do CRM.
3. **A pasta `sistema/negocio/` deste computador é a original.** Ajuste do atendimento se faz aqui
   e se envia para a VPS. Nunca edite direto na VPS: a próxima mudança feita aqui apagaria a de lá.
4. Comando que demora (instalar, atualizar) pode levar uns 5 minutos. Avise antes e espere; não
   rode de novo achando que travou.
5. Se a sua ferramenta bloquear um comando por permissão, entregue o comando pronto para a pessoa
   colar no terminal e diga o que ele faz em uma frase.

---

## Passo 1 — A chave de acesso (uma vez só)

### 1a. Criar a chave neste computador

Veja se `~/.ssh/atendente` já existe. Se não existir, crie (a pasta `.ssh` antes, se faltar):

- PowerShell: `New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null`, depois
  `ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\atendente" -N '""' -C atendente`
- Bash, Mac ou Linux: `ssh-keygen -t ed25519 -f ~/.ssh/atendente -N "" -C atendente`

### 1b. Levar a chave para a VPS

Esse é o **único** comando que a pessoa roda, porque pede a senha do root. Peça para ela colar no
terminal (no VS Code: **Terminal → Novo terminal**), trocando `IP` pelo IP da VPS:

- Windows (PowerShell):
  `type $env:USERPROFILE\.ssh\atendente.pub | ssh root@IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"`
- Mac ou Linux:
  `cat ~/.ssh/atendente.pub | ssh root@IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"`

Diga o que vai aparecer, antes que ela se assuste:

> Na primeira vez ele pergunta se você confia nesse servidor: digite `yes` e Enter. Depois pede a
> senha do root. Enquanto você digita, nada aparece na tela, nem asterisco. É normal: digite e dê
> Enter.

Se o provedor deixou colar uma chave pública na hora de criar o servidor e ela colou o conteúdo
de `atendente.pub` lá, este passo já está feito.

### 1c. Dar um nome para o acesso

Acrescente ao arquivo `~/.ssh/config` deste computador (crie se não existir):

```
Host atendente-vps
  HostName IP
  User root
  IdentityFile ~/.ssh/atendente
  IdentitiesOnly yes
```

Se já existir um `atendente-vps` apontando para outro IP (quem revende tem vários clientes), use
outro nome, como `atendente-<nome curto do negócio>`, e use esse nome em todo comando daqui em
diante.

### 1d. Conferir

`ssh -o BatchMode=yes atendente-vps echo ok` precisa responder `ok` **sem pedir senha**. Se pedir
senha ou recusar, o 1b não pegou: confira o IP e peça para ela rodar de novo.

---

## Passo 2 — Mudar o sistema para a VPS

Tudo que está neste computador vai junto: a configuração do negócio, os leads, as conversas, o
login do CRM e **a conexão do WhatsApp**, que não pede QR Code de novo.

1. Peça para ela **parar o sistema** neste computador: Ctrl+C na janela onde ele está rodando.
   Com o sistema ligado, a cópia sai pela metade, e o próprio comando recusa.
2. `npm run mudar`. Ele cria um pacote `sistema/mudanca-AAAAMMDDHHMM.tar.gz` e diz o nome.
3. Envie: `scp sistema/<pacote> atendente-vps:/root/`
4. Baixe o sistema na VPS:
   `ssh atendente-vps "git clone https://github.com/VitorioGomes/atendenteia-e-crm.git /root/atendenteia-e-crm"`
   (se responder que o `git` não existe: `ssh atendente-vps "apt-get update && apt-get install -y git"` e repita).
5. **Ligue o caminho do código do computador até a VPS**, que é por onde vão as mudanças e as
   atualizações daqui em diante (seção "Enviar o código para a VPS", abaixo). Se este computador
   tem mudanças no sistema, elas vão agora, antes de instalar.
6. Instale trazendo o pacote (demora uns 5 minutos):
   `ssh atendente-vps "cd /root/atendenteia-e-crm/sistema && bash instalar.sh /root/<pacote>"`
   O instalador tira do pacote a chave da IA e o login; o endereço do CRM fica `<IP>.sslip.io`.
   Se ele parar dizendo que falta algum campo, o recado diz como passar o valor.
7. Apague o pacote dos dois lados, porque ele tem a chave e a senha dentro:
   `ssh atendente-vps "rm /root/<pacote>"` e apague `sistema/<pacote>` aqui.
8. Anote o acesso no fim de `sistema/mudou-para-vps.txt` (o `npm run mudar` criou esse arquivo):
   `Acesso: ssh atendente-vps` (ou o nome que você usou). É por ele que você vai saber, numa
   próxima conversa, que o atendente mora na VPS e como entrar nela.

### Conferir com ela

- O CRM abre em `https://<IP>.sslip.io`, com o **mesmo e-mail e a mesma senha** de antes. Pode
  levar um minuto para o certificado sair na primeira vez.
- Na tela de **Conexão**, o WhatsApp aparece conectado.
- Uma mensagem de outro celular para o número do atendimento recebe resposta.

Se o WhatsApp pedir QR Code, ela lê pelo celular, igual à primeira vez.

## Passo 3 — Fechar a porta da senha

Com a chave funcionando, a senha do root só serve para robôs, que tentam adivinhar senhas de
servidor o dia inteiro. Desligue o acesso por senha:

```
ssh atendente-vps "printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/00-atendente.conf && sshd -t && systemctl reload ssh"
```

Confira de novo com `ssh -o BatchMode=yes atendente-vps echo ok`. Se responder `ok`, está certo.

Diga a ela em uma frase: a chave mora **neste computador**. Se um dia precisar entrar de outro, o
painel do provedor tem um console de emergência que abre direto na VPS.

## Passo 4 — Entregar

- O endereço do CRM, para salvar no celular junto com o login.
- Que **o computador não precisa mais ficar ligado**, e que ela **não deve ligar o sistema nele de
  novo** (os dois brigariam pelo mesmo WhatsApp; o `npm run pc` recusa sozinho).
- Que para atualizar ou mudar qualquer coisa do atendimento, é só abrir você **nesta mesma pasta**
  e pedir. Você entra na VPS sozinho.

---

## Depois: atualizar e ajustar

Você sabe que o atendente mora na VPS quando `sistema/mudou-para-vps.txt` existe. A linha
`Acesso:` diz o nome do acesso; os exemplos abaixo usam `atendente-vps`.

### O computador manda, a VPS só recebe

**O código da VPS sai sempre deste computador.** As mudanças que a pessoa pede no sistema (uma cor,
uma tela nova) e as atualizações oficiais se juntam aqui, no git desta pasta, e só então vão para a
VPS. Nunca mexa no código direto na VPS, e não rode o `atualizar.sh` de lá quando o sistema tiver
mudanças: ele recusa, porque baixaria a versão oficial por cima.

### Enviar o código para a VPS

Uma vez só, se ainda não foi feito (`git remote` não lista `vps`):

```
ssh atendente-vps "git -C /root/atendenteia-e-crm config receive.denyCurrentBranch updateInstead"
git remote add vps atendente-vps:/root/atendenteia-e-crm
```

Toda vez, depois de guardar as mudanças com `git commit`:

```
git push vps HEAD:main
ssh atendente-vps "cd /root/atendenteia-e-crm/sistema && bash aplicar.sh"
```

O `aplicar.sh` faz uma cópia de segurança, remonta o sistema com o código que chegou e confere que
ele voltou (uns 5 minutos). A configuração do negócio, o login e as conversas não são tocados.

### Atualizar o sistema

1. Guarde antes o que estiver mudado: `git add -A` e `git commit` com uma frase do que mudou.
2. `git pull`. Se o git acusar conflito, é porque a atualização e uma mudança da pessoa mexeram no
   mesmo lugar: junte as duas, mantendo o que ela pediu e o que a versão nova trouxe, e faça o
   commit.
3. Confira que compila: `npx tsc --noEmit` dentro de `sistema/`, e `npm run build` dentro de
   `sistema/web/` se alguma tela mudou.
4. Envie e aplique ("Enviar o código para a VPS").

### Mudar o sistema (cor, tela, o que a pessoa pedir)

A pessoa pode pedir qualquer mudança no sistema. Faça **aqui**, nunca na VPS:

1. Mude o código, seguindo o jeito que ele já está escrito.
2. **Mostre antes de enviar**, quando a mudança for visual: `npm run demo` dentro de
   `sistema/web/` abre o CRM com dados de exemplo em `http://localhost:5173`, sem WhatsApp e sem
   mexer no atendente da VPS. Feche com Ctrl+C depois que ela aprovar.
3. Confira que compila (passo 3 de "Atualizar o sistema").
4. Guarde com `git commit`, numa frase que diga o que mudou ("Lateral vermelha"). É o commit que
   faz a mudança sobreviver às atualizações.
5. Envie e aplique.

### Ajustar o atendimento

Mude `sistema/negocio/negocio.json` ou `sistema/negocio/conhecimento.md` **aqui**, como no
INSTALAR.md, e envie:

```
scp sistema/negocio/negocio.json sistema/negocio/conhecimento.md atendente-vps:/root/atendenteia-e-crm/sistema/negocio/
ssh atendente-vps "cd /root/atendenteia-e-crm/sistema && docker compose restart app"
```

### Trocar a chave da IA

A chave **não passa pela conversa**, nem na troca. Peça para a pessoa colar a chave nova no
`sistema/.env` **deste computador** (`code sistema/.env` no VS Code), na linha
`ANTHROPIC_API_KEY=`, e salvar. Depois envie sem mostrar o valor, rodando no Bash (no PowerShell
as aspas escapadas quebram):

```
grep '^ANTHROPIC_API_KEY=' sistema/.env | ssh atendente-vps "cd /root/atendenteia-e-crm/sistema && k=\$(cat) && sed -i \"s|^ANTHROPIC_API_KEY=.*|\$k|\" .env && docker compose up -d app"
```

Não sugira trocar a chave por conta própria. Se ela já apareceu numa conversa antiga, a decisão de
trocar é da pessoa.

### Restaurar uma cópia de segurança

A VPS faz uma cópia por noite, às 3h, e guarda as últimas sete. Liste para a pessoa escolher:

```
ssh atendente-vps "ls -1t /root/atendenteia-e-crm/sistema/backups/*.tar.gz"
```

Restaurar volta **tudo** para aquele momento, inclusive as conversas, e o que veio depois se
perde. Por isso **quem confirma é a pessoa**: o `restaurar.sh` pede que ela digite `RESTAURAR`, e
sem terminal (rodando por você) ele cancela sozinho. Entregue o comando para ela colar no terminal
do VS Code:

```
ssh -t atendente-vps "cd /root/atendenteia-e-crm/sistema && bash restaurar.sh backups/<arquivo escolhido>"
```

### O servidor foi reinstalado

Se a pessoa reinstalou o sistema da VPS no painel do provedor, duas coisas mudam, e nenhuma é
defeito:

1. **A identidade do servidor é outra.** O `ssh` para com "REMOTE HOST IDENTIFICATION HAS CHANGED"
   e "Host key verification failed". Confirme com ela que houve reinstalação; se houve, apague a
   identidade antiga deste computador com `ssh-keygen -R <IP>` e siga. **Se ela não reinstalou
   nada, não apague**: pare e diga que esse aviso, sem reinstalação, merece desconfiança.
2. **A chave de acesso sumiu da VPS**, junto com o sistema e o atendente. A chave deste computador
   e o nome de acesso continuam valendo: repita só o Passo 1b (o comando que a pessoa roda com a
   senha do root nova) e depois o Passo 2 inteiro, a partir da pasta deste computador.

### Quando algo não funciona

```
ssh atendente-vps "cd /root/atendenteia-e-crm/sistema && docker compose exec -T app npm run doctor"
ssh atendente-vps "cd /root/atendenteia-e-crm/sistema && docker compose logs --tail=80 app"
```

O diagnóstico diz o que está errado e o que fazer. As causas de sempre estão em
[referencias/problemas.md](referencias/problemas.md).
