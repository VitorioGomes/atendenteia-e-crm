# A entrevista

Dois blocos, nesta ordem. O **bloco A** (1 a 10) descobre como o negócio funciona; o **bloco B**
(11 e 12) descobre o que o atendente precisa saber responder para o cliente. Cada pergunta tem: o
que perguntar, o que fazer com a resposta e o que preencher sozinho quando a pessoa não souber.

**Não anuncie um número de perguntas.** Diga que são perguntas sobre como o negócio funciona e
depois sobre o que o atendente precisa responder. Prometer "dez" e fazer treze faz a conversa
parecer sem fim.

**O que você já descobriu no Passo 1 não se pergunta de novo — se confirma.** "Vi no seu site que
vocês atendem sábado de manhã, confere?" vale por uma pergunta e mostra que você prestou atenção.

**Nunca mostre nome de campo para a pessoa.** `objetivo.principal` é assunto entre você e o
arquivo.

**Quando ela não souber responder, não devolva a pergunta.** Quem abriu há três semanas não
pensou em nome de atendente nem em política de preço, e "o que você acha?" é a resposta mais
comum que você vai ouvir. Ofereça **duas ou três opções curtas, recomende uma e diga o porquê**,
em uma linha. Decidir por ela sem avisar é pior; deixá-la travada também.

**O que você decidir sozinho, você declara no fim** (Passo 3), numa lista curta de "decidi isto
por você, me corrija se não gostar". Nunca deixe uma escolha sua passar escondida.

---

## 1. O negócio

> Me conta o que é o seu negócio, em uma frase. Tipo "clínica de odontologia estética em
> Pinheiros" ou "barbearia no centro de Campinas".

Preenche `negocio.nome`, `negocio.segmento`, `negocio.descricaoCurta`, `negocio.cidade`.

Se ela responder só o nome, pergunte o que o negócio faz. Sem isso a IA não sabe do que está
falando.

---

## 2. Onde fica

> Vocês atendem num lugar físico? Se sim, qual o endereço?

Preenche `negocio.endereco`, `negocio.comoChegar`.

**Se o atendimento é na casa do cliente** (higienização, chaveiro, técnico, personal,
veterinário), a pergunta do endereço não existe: a pergunta certa é **"até onde você vai?"** e
**"cobra a mais para lugar mais longe? quanto?"**. Insista no *quanto* uma vez: "cobro a gasolina"
vira um atendente que não sabe responder "quanto?" e devolve a conversa para o dono, que é
exatamente o que ele está tentando evitar. Se mesmo assim ele não souber, aí sim vira caso de
chamar gente.

Negócio nessa situação também precisa de um **campo extra para o endereço do cliente** (veja
`camposExtras` em [negocio-json.md](negocio-json.md)): sem isso o dono recebe agendamento sem
saber para onde dirigir.

Negócio só online ou só entrega: endereço vazio, e **anote isso**, porque muda a pergunta da
agenda. Se houver ponto de referência ou estacionamento, pergunte — é o que mais aparece na
conversa real com cliente.

---

## 3. O que vocês vendem

> Quais são os serviços (ou produtos) que as pessoas mais procuram? Pode listar os principais,
> não precisa ser tudo.

Preenche `servicos[]`: `nome`, `descricao`, `preco`, `duracaoMin`, `observacao`.

- **Preço**: pergunte separado, e só depois de ela listar. Aceite "a partir de", "depende do
  caso" e "não quero falar de preço". Escreva exatamente como ela falar, e **nunca arredonde**.
- **Duração**: só importa se houver agenda. Se ela não souber, não invente: deixe o padrão.
- Serviço que exige avaliação antes (implante, lentes, projeto) merece uma `observacao`, porque é
  onde o atendente costuma prometer o que não pode.
- **`agendavel`**: se o que se marca pelo WhatsApp é sempre um serviço só (a avaliação da clínica,
  o orçamento na casa do cliente) e os outros nunca são marcados direto, ponha `"agendavel": true`
  só nele. O atendente passa a marcar apenas os marcados. Sem nenhum marcado, ele marca qualquer
  serviço da lista. Não é pergunta nova: sai da resposta do bloco 4.

---

## 4. O que você quer que o atendente consiga

> Quando alguém manda mensagem, o que seria um atendimento perfeito para você? Marcar um horário?
> Passar um orçamento? Tirar dúvida e mandar o link de pagamento?

Preenche `objetivo.principal` e `objetivo.explicacao`.

É a pergunta mais importante da entrevista: é ela que decide o funil, a agenda e para onde toda
conversa caminha. Se a resposta vier vaga ("vender mais"), insista uma vez: *"vender mais como?
O que a pessoa precisa fazer para você considerar que deu certo?"*

---

## 5. Horários

> Em que dias e horários vocês atendem? Pode falar do jeito que você falaria para um cliente.

Preenche `horarios.atendimento`.

Traduza para o formato do arquivo (veja [negocio-json.md](negocio-json.md)). "De segunda a sexta,
das 9 às 18, e sábado até meio-dia" vira cinco dias iguais, sábado curto e domingo vazio.

**Almoço**: se ela mencionar, são duas faixas no mesmo dia, não uma.

Confirme repetindo em voz alta: *"então seria segunda a sexta das 9h às 18h, sábado das 9h ao
meio-dia, domingo fechado?"*. Horário errado faz o atendente marcar cliente em dia fechado.

---

## 6. Quem atende

> O atendente vai ter um nome. Como você quer chamar? E ele fala de um jeito mais formal ou mais
> próximo?

Preenche `atendente.nome`, `atendente.genero`, `atendente.cargo`, `atendente.tom`.

Se ela não tiver ideia, sugira dois nomes e siga. Não gaste cinco minutos aqui.

**Importante dizer**: o atendente sempre se apresenta como assistente virtual. Não é opção de
personalidade, é o que evita que o cliente dela se sinta enganado.

---

## 7. Preço na conversa

> Quando o cliente perguntar de preço, o que você prefere: o atendente responde na hora, ou ele
> leva a pessoa para uma conversa e o valor fica para depois?

Preenche `atendente.falarDePreco`:

| Resposta dela | Valor |
|---|---|
| "responde na hora" | `pode_falar` |
| "só se perguntarem" ou dúvida | `so_se_perguntarem` (padrão) |
| "prefiro que não fale de valor" | `nunca` |

Na dúvida, fique no padrão. Valor solto antes de a pessoa dizer o que quer transforma a conversa
numa negociação antes de existir interesse.

---

## 8. Quando chamar gente

> Tem alguma situação em que você prefere que o atendente pare e chame você ou alguém da equipe?

Preenche `handoff.gatilhos`.

Já comece com os quatro que valem para qualquer negócio, e some o que ela disser:

- a pessoa pedir para falar com um humano;
- reclamação, insatisfação ou tom agressivo;
- assunto financeiro fora do previsto (parcelamento diferente, reembolso, cobrança);
- qualquer coisa que o atendente não souber responder com segurança.

Depois da resposta, na pergunta seguinte:

> Quando o atendente chamar alguém, ele manda um aviso no WhatsApp com o nome do cliente e o
> motivo. Para qual número eu mando esse aviso?

Preenche `handoff.avisarNoWhatsapp`. Sem esse número, "chamar" só marca a conversa no CRM, e
com o CRM fechado ninguém fica sabendo que tem cliente esperando. Então **insista uma vez** se a
pessoa pular, explicando isso em uma frase.

Duas regras para o número:

- **Não pode ser o chip do atendimento.** O aviso sai dele; mandar para ele mesmo não avisa
  ninguém. Normalmente é o celular pessoal do dono ou de quem atende.
- **Mensagem desse número nunca vira cliente**: o atendente ignora tudo que chega dele, para
  não responder ao próprio dono. Diga isso à pessoa, porque afeta o teste do Passo 7: ela não
  pode testar o atendente escrevendo desse número. Se ela só tiver esse celular para testar,
  deixe o campo vazio agora e combine de preencher depois do teste.

---

## 9. O que ele nunca pode fazer

> Tem alguma coisa que o atendente não pode dizer ou prometer de jeito nenhum?

Preenche `atendente.naoFaz`.

Em saúde e estética, sempre inclua: **não dar diagnóstico nem opinião clínica** e **não prometer
resultado**. Em qualquer negócio: **não dar desconto nem condição de pagamento** que não esteja
escrita.

---

## 10. Agenda

> O atendente pode marcar horário sozinho na agenda de vocês, ou você prefere que ele só qualifique
> e depois alguém confirme?

Preenche `agenda.ativo` e, se ligada, `duracaoPadraoMin`, `intervaloSlotsMin`,
`antecedenciaMinimaHoras`, `janelaDias`, `atendimentosSimultaneos`, `lembrete`.

Se ligar, pergunte três coisas e só três:

1. **Quanto tempo dura um atendimento?** Vira `duracaoPadraoMin` **e** `intervaloSlotsMin`, os
   dois com o mesmo valor (veja o porquê em [negocio-json.md](negocio-json.md)).
   **Se o atendimento é na casa do cliente, pergunte contando o deslocamento**, porque a agenda
   reserva o bloco inteiro e não sabe o que é trânsito. E **faça a conta na frente dela**: "das 8h
   às 18h são 10 horas; com 2h30 por cliente cabem 4 por dia, com 3h cabem 3 — qual você
   prefere?". Transcrever "duas horas" quando o dono faz 3 ou 4 por dia enche a agenda de horário
   que ele não consegue cumprir.
2. **Quantas pessoas conseguem atender ao mesmo tempo?** Vira `atendimentosSimultaneos`.
3. **Quer que o sistema mande um lembrete antes?** Vira `lembrete`, com 24 horas de padrão. Diga
   que isso é o que mais reduz falta — é o argumento que costuma convencer.

Negócio sem atendimento marcado (loja, delivery, online): deixe `agenda.ativo` em `false` e não
pergunte nada disso.

---

# Bloco B — o que o atendente precisa saber responder

Estas duas não estavam na entrevista até 20/09/2026, e o resultado foi o esperado: no teste com o
Roni a IA **não perguntou e escreveu as respostas por conta própria** no `conhecimento.md`. Uma
delas era uma promessa ao cliente ("não precisa tirar o sofá do lugar") que o dono nunca disse.
Acertou por sorte. Da próxima pode não acertar, e quem paga o vexame é o cliente dele.

## 11. Como recebe

> Como você recebe? PIX, dinheiro, cartão, parcela? E é na hora ou antes?

Vai para o `conhecimento.md`. É a segunda coisa que o cliente mais pergunta, depois de preço, e
descobrir na porta que não tem maquininha estraga o serviço que já foi feito.

## 12. As dúvidas que mais chegam

> Quais são as perguntas que mais aparecem no seu WhatsApp hoje, tirando preço?

**Esta é a pergunta mais valiosa da entrevista inteira**, e a mais fácil de pular. É ela que traz
o que nenhum site tem: "precisa tirar o móvel do lugar?", "tem cheiro?", "pode molhar?", "meu
filho tem alergia". Cada uma dessas vira uma resposta pronta no `conhecimento.md`, e cada uma é
uma conversa que o dono não precisa mais atender.

Se ela travar, ajude com exemplos **do ramo dela**, não genéricos: "tipo, te perguntam quanto
tempo demora? se precisa fazer alguma coisa antes?".

**Nunca escreva uma dúvida frequente que você inventou.** Se você achar que falta uma resposta
óbvia, pergunte: *"e se o cliente perguntar X, o que eu respondo?"*. A regra é a mesma do preço:
o que vai para o `conhecimento.md` é o que ela disse, não o que você supôs.

---

## O que você preenche sem perguntar

Não gaste pergunta com isto. Monte, mostre pronto e deixe ela corrigir se quiser.

| Campo | Como montar |
|---|---|
| `funil.estagios` | Derive do objetivo. O padrão de quem agenda: novo lead → qualificando → qualificado → agendado (`aoAgendar`) → compareceu (`aoComparecer`, `somenteEquipe`) → perdido. Quem não agenda: novo lead → qualificando → proposta → fechado → perdido |
| `objetivo.perguntasQualificacao` | O que o atendente precisa descobrir para cumprir o objetivo. Comece pelo assunto da pessoa, **nunca pelo nome** |
| `etiquetas` | Três a seis, do vocabulário do negócio dela ("convênio", "particular", "urgência"). Lista vazia também é resposta válida |
| `respostasRapidas` | Duas ou três que a equipe usaria no dia a dia (endereço, formas de pagamento) |
| `followup` | Ligado, com duas tentativas, se o objetivo for agendar ou vender |
| `conformidade.avisarQueEhIA` | Sempre `true` |

Depois de montar, mostre só o que importa para ela:

> Montei o funil assim: novo lead, qualificando, qualificado, avaliação agendada, compareceu,
> perdido. É como o seu quadro de clientes vai ficar organizado. Serve?
