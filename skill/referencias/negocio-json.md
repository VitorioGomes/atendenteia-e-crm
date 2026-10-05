# Escrevendo os dois arquivos

Leia isto antes de escrever. As armadilhas aqui são as que fazem o sistema recusar subir ou,
pior, subir errado e só dar problema com cliente de verdade na linha.

Comece copiando `sistema/negocio/negocio.molde.json` para `negocio.json`. Ele tem todos os campos
e nenhum conteúdo: preencha com o que a pessoa disse e deixe vazio o que ela não disse.

---

## O que é obrigatório

Só quatro coisas. Todo o resto tem padrão e pode ficar de fora se você não souber:

- `negocio.nome`
- `atendente.nome`
- `objetivo.principal`
- `funil.estagios` com **pelo menos dois**

Um arquivo enxuto com isso funciona. Na dúvida entre inventar um campo e deixá-lo de fora, deixe
de fora: o padrão do sistema é melhor que um chute.

---

## Armadilhas que fazem o sistema recusar subir

### Horário é `HH:MM`, sempre com dois dígitos

```json
"atendimento": {
  "seg": [["09:00", "18:00"]],
  "sab": [["09:00", "13:00"]],
  "dom": []
}
```

`"9h"`, `"9:00"` e `"18h30"` são recusados. Dia fechado é lista vazia, nunca a chave ausente.
Almoço são duas faixas no mesmo dia: `[["09:00","12:00"],["14:00","18:00"]]`.

As chaves são exatamente `seg`, `ter`, `qua`, `qui`, `sex`, `sab`, `dom` — sem acento.

### Chave de estágio: minúscula, sem espaço e sem acento

Só `a-z`, `0-9` e `_`. `"novo_lead"` vale; `"Novo Lead"` e `"avaliação"` não.

O `nome` ao lado é o que aparece na tela, e esse **pode** ter acento e espaço:

```json
{ "chave": "agendado", "nome": "Avaliação agendada" }
```

### Acento

Vale acento normal em tudo que alguém lê: nomes, descrições, `conhecimento.md`. Só as **chaves**
(de estágio, de dia, de campo) são sem acento.

---

## Armadilhas que não dão erro, e é por isso que são piores

### `intervaloSlotsMin` igual a `duracaoPadraoMin`

```json
"duracaoPadraoMin": 40,
"intervaloSlotsMin": 40
```

Se a duração for 40 e a grade for de 30 em 30, cada atendimento de 40 minutos come 60 e a agenda
perde uma vaga a cada duas. Ninguém percebe até faltar horário no fim do mês.

### O estágio de "agendado" leva `aoAgendar: true`

```json
{ "chave": "agendado", "nome": "Avaliação agendada", "aoAgendar": true }
```

Quem move o card para lá é **o sistema**, quando um agendamento é criado de verdade. Marcando
isso, a opção some da lista que a IA enxerga — e ela não consegue dizer que agendou sem ter
agendado. Sem a marca, ela move o card por conta própria e o dono vê "agendado" sem horário
nenhum na agenda. Já aconteceu num teste real.

Do mesmo jeito: o estágio de "a pessoa veio" leva `aoComparecer: true` e `somenteEquipe: true`.

### Estágio de fim de linha precisa dizer que é fim

`"ganho": true` no estágio que virou dinheiro, `"perdido": true` no que morreu. É o que faz o
sistema parar de cutucar quem já foi descartado, e o que faz as contas do painel baterem.

### Etiquetas são lista fechada

A IA só pode usar as que estiverem em `etiquetas`. Sem essa lista ela inventa variações da mesma
coisa ("convenio", "convênio", "tem convenio") e a etiqueta deixa de servir para filtrar.

Lista vazia é resposta válida: desliga as etiquetas por completo.

### `regras` e `naoFaz`: só o que é deste negócio

O jeito de conversar que vale para todo negócio **já está no sistema** e é atualizado quando a
pessoa roda `git pull`: uma pergunta por vez, mensagens curtas, chamar pelo nome, não inventar
preço nem prazo, avisar a equipe quando não souber, não discutir com quem provoca. **Não escreva
nada disso aqui.** O que está no `negocio.json` fica congelado na máquina da pessoa: quando o
sistema muda, a frase velha continua lá e briga com a nova. Foi o que aconteceu no teste de
04/10/2026: "se não souber, transfira" e "não dê desconto que não esteja no conhecimento" vieram de
um exemplo copiado e fizeram o atendente responder o desconto sozinho.

Entram só regras que nascem do negócio, ditas por ela: "não prometer faturamento, o resultado
depende do aluno", "não dar diagnóstico, isso é na avaliação", "não inventar data de turma".
Lista vazia é resposta válida.

### `falarDePreco`

Três valores, escritos exatamente assim: `"so_se_perguntarem"` (padrão), `"pode_falar"`,
`"nunca"`.

---

## `conhecimento.md` — onde mora a qualidade do atendente

O `negocio.json` diz **como** o atendente se comporta. O `conhecimento.md` diz **o que ele sabe**.
É o arquivo que separa um bot que serve de um bot que irrita, e é o que a pessoa vai querer
editar depois sozinha.

Escreva como se estivesse explicando o negócio para uma recepcionista no primeiro dia. Pode ser
informal. Use `##` para separar assuntos — o atendente lê tudo, mas quem vai reler e corrigir
depois é a dona do negócio.

Assuntos que sempre valem a pena, porque são os que o cliente pergunta:

- o que o negócio é e há quanto tempo existe;
- **formas de pagamento** (parcelamento, PIX, desconto à vista se existir e não for assunto da
  equipe);
- convênios, planos ou parcerias, e o que eles **não** cobrem;
- como chegar, estacionamento, ponto de referência;
- as cinco dúvidas que mais aparecem no WhatsApp hoje — pergunte isso diretamente, é ouro;
- o que **não** fazem, para o atendente não prometer.

Três regras:

1. **Só entra o que é verdade agora.** O atendente não inventa nada fora deste arquivo: ele diz
   que vai confirmar com a equipe e avisa o time da pergunta. Isso é proposital. Um arquivo curto
   e certo é muito melhor que um longo e desatualizado.
2. **Preço aqui é preço que o cliente vai cobrar.** Se houver dúvida, escreva "a partir de" ou
   deixe fora e confie no `servicos`.
3. **Assunto que é motivo de chamar a equipe não ganha resposta aqui.** Se desconto,
   parcelamento diferente ou compra para empresa estão em `handoff.gatilhos`, não escreva "não
   tem desconto" no conhecimento. No teste de 27/09/2026 o arquivo dizia "desconto: não existe
   aqui, chame o time", o atendente leu a resposta pronta, respondeu sozinho e não chamou
   ninguém. Escreva só que esse assunto é tratado pela equipe.

---

## Antes de ligar

Confira, nesta ordem:

1. O JSON abre? Se tiver vírgula sobrando ou aspas faltando, o sistema recusa subir e a mensagem
   de erro diz onde.
2. Alguma frase em `regras`, `naoFaz` ou `gatilhos` que a pessoa não disse? Tire.
3. Os horários batem com o que ela falou, repetidos em voz alta?
4. O estágio de agendado tem `aoAgendar: true`?
5. Algum preço entrou sem ela ter confirmado em palavras? Tire.
