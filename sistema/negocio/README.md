# A pasta do seu negócio

**Esta é a única pasta que muda de negócio para negócio.** Todo o resto do sistema é igual para
todo mundo — o que faz a IA falar como a sua empresa está aqui dentro.

| Arquivo | O que é |
|---|---|
| `negocio.json` | As regras: quem é a atendente, horários, funil, serviços, follow-up |
| `conhecimento.md` | O que a IA sabe: perguntas frequentes, objeções, detalhes, políticas |

A IA gera os dois a partir da entrevista, partindo de `negocio.molde.json` (todos os campos, nenhum
conteúdo). Você pode editar à mão quando quiser.

## Como editar

1. Abra o arquivo, mude o que quiser, salve.
2. Reinicie: no computador, pare com Ctrl+C e rode `npm run pc`; na VPS, `docker compose restart app`.
3. Mande uma mensagem no WhatsApp para testar.

## Dica que vale por metade do curso

`conhecimento.md` é onde 90% da qualidade do atendimento acontece. Toda vez que a IA responder
algo errado ou disser "não sei informar", **abra este arquivo e escreva a resposta certa**. Em
duas semanas fazendo isso, o atendimento fica melhor que o de muita gente.
