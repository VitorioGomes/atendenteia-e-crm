# Instalar o Atendente IA + CRM no WhatsApp

Este é o roteiro. Quem lê é você, a IA de terminal. Quem está do outro lado é o dono de um
negócio, que pode nunca ter aberto um terminal na vida.

Funciona igual no Claude Code, no Gemini CLI e no Codex. Se alguma coisa aqui não existir na
ferramenta em que você está rodando, siga o caminho alternativo que o próprio passo indica.

---

## Antes de tudo: onde você está

O jeito recomendado de começar é a pessoa abrir você numa pasta qualquer (Documentos, por exemplo)
e mandar: *"Clone o repositório https://github.com/VitorioGomes/atendenteia-e-crm e instale o
atendente seguindo o roteiro em skill/INSTALAR.md"*. Então você pode estar **fora** do projeto.

- **Já existe uma pasta `atendenteia-e-crm` aqui?** Não clone de novo: entre nela e siga. Pode ser
  uma instalação anterior (veja a seção seguinte).
- **Não existe:** clone com `git clone https://github.com/VitorioGomes/atendenteia-e-crm.git`.
- **O `git` não existe no computador** (erro "git não é reconhecido"): peça para a pessoa instalar
  em <https://git-scm.com>, aceitando tudo como vier, fechar o terminal, abrir de novo e chamar
  você. Não baixe o projeto como zip para contornar: sem o `git`, ela não recebe atualização.
- **A partir daqui, todo comando roda dentro de `atendenteia-e-crm`.** Se a sua ferramenta não
  guarda a pasta entre um comando e outro, entre nela em cada comando. Rodar `npm run pc` na pasta
  de cima dá o erro `Could not read package.json`.

## Isto já foi instalado?

Se `sistema/negocio/negocio.json` **já existe**, a pessoa não está instalando: está voltando para
ajustar alguma coisa.

Nesse caso, **não refaça a entrevista.** Leia o arquivo, entenda o negócio por ele, pergunte o que
ela quer mudar e mexa só naquilo. Refazer do zero geraria chaves de funil diferentes das que o
banco de dados já usa, e o CRM dela quebraria.

Vá direto ao ponto: *"vi que o atendente já está configurado para a Clínica Sorriso Vivo. O que
você quer ajustar?"*. Depois de mudar, avise que ela precisa parar o sistema com Ctrl+C e rodar
`npm run pc` de novo, porque a configuração é lida ao ligar.

---

## O que você vai entregar

Um atendente de IA respondendo no WhatsApp do negócio, com CRM aberto no navegador da pessoa.
Ela conversa com você, responde sobre o negócio dela, e no fim tem um bot funcionando.

**Você não escreve o sistema.** Ele já existe, pronto e testado, na pasta `sistema/`. Seu
trabalho é descobrir como o negócio funciona e escrever dois arquivos:

| Arquivo | O que é |
|---|---|
| `sistema/negocio/negocio.json` | Como o atendimento funciona: serviços, horários, funil, tom |
| `sistema/negocio/conhecimento.md` | O que a IA sabe responder: preços, convênios, endereço, dúvidas |

Depois você liga o sistema e confere que ele responde.

---

## Regras que não se quebram

1. **Nunca mexa em nada fora de `sistema/negocio/`.** O resto do sistema é fixo e testado. Se
   algo parecer faltar no sistema, isso é assunto para o suporte, não para você consertar.
2. **Nunca invente dado do negócio.** Preço, horário, endereço, convênio: ou a pessoa disse, ou
   está num material que ela te deu e **ela confirmou**, ou não entra. Um preço errado no
   `conhecimento.md` faz o atendente mentir para o cliente dela todo dia.
3. **Uma pergunta por vez**, com uma exceção: **lista do mesmo tipo**. Perguntar oito preços um
   a um enlouquece qualquer um; nesse caso mande a lista inteira para ela preencher de uma vez.
   O que não pode é misturar assuntos diferentes na mesma mensagem.
4. **Fale como gente.** Nada de "vou parametrizar o schema". É "vou anotar os horários que você
   atende". Nome de arquivo e de comando só quando for preciso digitar.
5. **Não prometa mensagem pronta.** Você pode dizer o que o atendente faz ("responde o preço
   quando perguntarem", "oferece horários livres"), mas **não escreva um exemplo de mensagem
   dele**. O jeito exato de falar é decidido pelo sistema, não por você, e uma pessoa que vê a
   sua mensagem de exemplo e depois recebe outra diferente acha que está quebrado.
6. **Quando travar, pare e explique.** Nunca siga adiante com um passo falhado torcendo para dar
   certo depois. Diga o que aconteceu, o que você vai tentar, e pergunte.
7. **Pergunta feita é pergunta esperada.** Não faça uma pergunta e saia rodando comando: quem
   está do outro lado responde e fica sem saber se foi lido. Ou você pergunta e espera, ou você
   avisa que vai instalar e pergunta depois que terminar.
8. **Nunca repita uma pergunta já respondida**, nem devolva como exemplo uma coisa que a pessoa
   acabou de negar. Quem disse "não tenho Instagram" não pode ouvir "tipo o que você usa no
   Instagram" duas mensagens depois. Antes de perguntar, releia o que ela já falou.

---

## Passo 0 — Conferir a máquina

Precisa de **Node 20 ou mais novo**. Rode:

```
node --version
```

Se der erro ou vier abaixo de 20, mande a pessoa instalar em <https://nodejs.org> (a opção LTS),
fechar o terminal, abrir de novo e chamar você. Não tente instalar o Node por ela: no Windows isso
costuma exigir clicar num instalador.

Confirme também que você está dentro da pasta do projeto: tem que existir a pasta `sistema/`.

---

## Passo 1 — Recolher o que já existe escrito

Antes de qualquer pergunta, peça o material. Isso transforma a entrevista de formulário em
conferência, e é o que faz o atendente saber responder de verdade.

Diga algo assim, com suas palavras:

> Antes de eu te perguntar as coisas, me passe o que já existe escrito sobre o seu negócio: o
> site, o Instagram, uma tabela de preços, um PDF, o que você manda hoje para cliente no
> WhatsApp. Pode jogar links aqui ou colocar os arquivos nesta pasta. Se não tiver nada, tudo
> bem, a gente faz só na conversa.

Depois:

- **Links:** abra e leia. Se a sua ferramenta não conseguir abrir páginas, diga isso com
  honestidade ("não consigo abrir links aqui") e peça para a pessoa colar o texto.
- **Arquivos na pasta:** leia PDF, texto, imagem, o que der.
- **Não encontrou nada de útil:** não insista e não invente. Siga para o Passo 2.

Depois de ler, **mostre o que entendeu, em lista curta, e peça confirmação**:

> Do seu site eu entendi isto:
> - Vocês fazem clareamento, lentes e implante
> - Ficam na Rua X, 120, em Pinheiros
> - Atendem de segunda a sexta, 9h às 19h
>
> Está certo? O que estiver errado, me corrija.

**Preço e horário nunca passam sem a pessoa confirmar em palavras.** Material publicado
envelhece, e esses dois são os que o cliente dela cobra na hora.

---

## Passo 2 — A entrevista

As perguntas estão em [referencias/entrevista.md](referencias/entrevista.md), na ordem. São dois
blocos, e **é assim que você anuncia**, sem prometer número:

> Vou te fazer umas perguntas sobre como o seu negócio funciona, e depois sobre o que o atendente
> precisa saber responder para o cliente. Uma de cada vez.

**Nunca diga "são dez perguntas"** e depois continue perguntando. Prometer um número e estourar
faz a conversa parecer que não acaba nunca, e é onde a pessoa desiste.

Você já deve ter a resposta de várias pelo Passo 1 — nesse caso **não pergunte de novo**:
confirme. "Vi que vocês atendem sábado até 13h, confere?" vale por uma pergunta.

Quando terminar os dois blocos, ofereça o aprofundamento, uma vez só:

> Com isso já dá para colocar o atendente no ar. Quer ajustar mais alguma coisa agora (etapas do
> funil, respostas prontas, lembrete antes da consulta), ou prefere ver funcionando primeiro e
> ajustar depois?

Se ela quiser ver funcionando, siga. É quase sempre a melhor resposta, e o resto se ajusta depois
com o sistema no ar.

---

## Passo 3 — Escrever os dois arquivos

Como preencher cada campo está em [referencias/negocio-json.md](referencias/negocio-json.md).
Leia antes de escrever: tem armadilha ali que quebra o sistema na hora de ligar.

1. Copie `sistema/negocio/negocio.exemplo.json` para `sistema/negocio/negocio.json` e vá
   substituindo. O exemplo é de uma clínica: **troque tudo**, não deixe sobra de dentista num
   petshop.
2. Escreva `sistema/negocio/conhecimento.md` com o que a pessoa contou e com o que veio do
   material dela. É aqui que mora a diferença entre um bot que serve e um que irrita.
3. **Leia os dois em voz alta para ela**, resumidos. É a última chance de pegar um preço errado
   antes de um cliente de verdade ver.

---

## Passo 4 — A chave da IA

O atendente precisa de uma chave da Anthropic, cobrada direto no cartão da pessoa.

> Agora preciso da chave que faz a IA pensar. Você cria em console.anthropic.com, no menu "API
> Keys". Vai pedir um cartão e um crédito inicial: recomendo começar com **5 dólares**, que duram
> bastante, dependendo de quantas conversas chegarem.

**Recomende os 5 dólares e pare aí.** Nada de "custa tanto por conversa", "com 5 dólares dá para
tantos atendimentos" ou qualquer conta. O detalhe do custo é assunto das aulas, e uma conta sua
que não bata com a realidade vira reclamação. Se ela perguntar quanto vai gastar, responda que
depende do movimento e que o consumo aparece no site da Anthropic, no mesmo lugar onde ela criou
a chave.

Ela cola a chave. Você **não escreve a chave em lugar nenhum além do `.env`**, e nunca a repete
na tela.

Se ela travar aqui, não force: **sem a chave o sistema não liga** (o `npm run pc` para e pede a
chave). Deixe os dois arquivos do negócio escritos e combine de terminar depois: com a chave em
mãos, é colar no `.env` e rodar `npm run pc`.

### O acesso dela ao CRM

O sistema não liga sem um e-mail e uma senha de entrada. **Pergunte os dois, nesta ordem, um de
cada vez:**

1. **O e-mail dela.** Ele é só o nome de usuário, não recebe nada, mas é o que ela vai lembrar.
   Nunca deixe o `dono@negocio.com` que vem de fábrica: não é o e-mail de ninguém.
2. **A senha**, com **pelo menos 8 caracteres**, que é o mesmo mínimo da tela de Perfil. Se ela
   não quiser inventar, ofereça gerar uma (palavras e números, legível, tipo
   `Patinha-Banho-4718`), e peça para ela anotar antes de seguir.

Recuse senha curta ou óbvia (`12345678`, o nome do negócio, a data de hoje) e diga o motivo em
uma frase: **essa senha vai junto se um dia o sistema for para o servidor**, onde o CRM fica
aberto na internet. Não repita a senha na tela depois de gravada.

Grave os dois no `.env`, em `CRM_EMAIL` e `CRM_PASSWORD`. Depois ela troca a senha quando quiser,
pela tela de Perfil.

---

## Passo 5 — Ligar

```
npm run pc
```

Esse comando instala as bibliotecas, prepara o banco, monta a tela e liga o atendente. **A
primeira vez demora alguns minutos.** Ele pede o que faltar e diz o que fazer quando algo dá
errado.

Ao terminar, ele mostra o endereço do CRM (`http://localhost:3000`) e o login.

Enquanto o sistema roda, essa janela do terminal fica ocupada. **Não feche.** Se precisar de
terminal para outra coisa, abra outra janela.

---

## Passo 6 — Conectar o WhatsApp

Na tela do CRM, menu **Conexão**. Aparece um QR Code.

No celular: WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho → aponta.

Diga estas três coisas, **uma vez cada, sem dramatizar**:

- **Use um chip separado, não o seu número pessoal.**
- **O celular continua funcionando normalmente.** O sistema não toma conta do WhatsApp dela.
- **Enquanto o computador estiver desligado, o atendente não responde.** Para ficar 24 horas no
  ar existe o caminho do servidor, que é outro momento.

**Não explique risco de banimento, não descreva o que ela perderia, e não repita o aviso.** O
motivo é ensinado nas aulas, por quem vendeu. Repetir isso no meio da instalação assusta sem
acrescentar nada: ela já está instalando, a decisão já foi tomada. Se ela perguntar por que um
chip separado, responda em uma frase — é conexão não oficial, e número dedicado é o padrão do
mercado — e siga.

---

## Passo 7 — Provar que funciona

Não diga "está pronto". Prove:

1. Peça para ela mandar uma mensagem de outro celular para o número conectado. **Não pode ser o
   número que recebe o aviso da equipe** (`handoff.avisarNoWhatsapp`): o atendente ignora tudo
   que chega dele, de propósito, e ela ficaria esperando uma resposta que nunca vem.
2. Espere a resposta chegar.
3. Abra o CRM e mostre o contato que apareceu no funil, e a conversa na caixa de entrada.

Se a resposta não vier, vá para [referencias/problemas.md](referencias/problemas.md). Não invente
diagnóstico: lá estão as causas que já aconteceram de verdade e o que fazer em cada uma.

---

## Passo 8 — Entregar

Feche dizendo, em poucas linhas:

- como abrir o CRM de novo: **o caminho completo da pasta do projeto**, escrito por extenso
  (descubra com `pwd` ou `cd`, nunca de memória), e os dois comandos prontos para copiar:
  `cd "<caminho completo>"` e `npm run pc`. Diga também o endereço do CRM. "Rode `npm run pc`
  na pasta" não basta: o `git clone` cria uma pasta nova dentro de outra, e quem abre o
  terminal depois cai na pasta de cima, onde o comando não existe e o erro é ilegível. **Peça
  para ela guardar esses dois comandos junto com o login do CRM**: o README do projeto diz que
  é assim que se liga de novo;
- que enquanto a janela do terminal estiver fechada, o atendente não responde;
- que para mudar qualquer coisa do atendimento (preço, horário, jeito de falar), é só chamar você
  de novo nesta pasta e pedir;
- onde fica o CRM no celular: **não fica** — é nesse computador, e a VPS é o caminho de quem
  quer no celular e 24 horas no ar.
