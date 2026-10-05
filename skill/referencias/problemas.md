# Quando não funciona

Causas que já aconteceram de verdade, e o que fazer em cada uma. **Não invente diagnóstico.** Se
o sintoma não estiver aqui, leia a mensagem de erro inteira em voz alta para a pessoa e diga com
honestidade que vai precisar olhar mais fundo — isso é melhor que um palpite que gasta meia hora
dela.

Antes de tudo, existe um diagnóstico pronto:

```
npm run doctor
```

Ele confere chave, banco, configuração e conexão, e fala em português. Rode na pasta do projeto,
numa **segunda janela de terminal**, porque a primeira está ocupada com o sistema.

---

## O sistema não liga

### `Could not read package.json` / `ENOENT`

O terminal está na pasta errada, quase sempre **a de cima**, onde o projeto foi clonado. Entre na
pasta do projeto (a que tem `sistema/`, `skill/` e o `package.json`) com `cd` e rode de novo. Não
precisa entrar em `sistema/`. Ao explicar para a pessoa, escreva o caminho completo.

### "Este computador tem o Node X"

Node abaixo de 20. Instale o LTS em <https://nodejs.org>, **feche o terminal e abra de novo**
(sem isso o computador continua enxergando a versão antiga) e rode `npm run pc`.

### Trava em `npm install`, ou erro estranho com `spawn EINVAL`

Acontece no Windows quando o terminal é antigo ou está numa pasta sincronizada (OneDrive,
Dropbox). Tente, nesta ordem:

1. Fechar o terminal e abrir um novo.
2. Rodar de novo: `npm run pc` não refaz o que já está pronto.
3. Se a pasta estiver dentro do OneDrive, mover o projeto para uma pasta simples como
   `C:\atendente` e rodar lá.

### "porta 3000 já está em uso"

Outra coisa no computador ocupou a porta — às vezes o próprio sistema, que ficou aberto numa
janela esquecida. Procure uma janela de terminal antiga e feche com Ctrl+C. Se não achar,
reinicie o computador; é mais rápido que caçar o processo.

### O sistema recusa subir falando do negócio

A mensagem diz o campo. As causas de sempre estão em [negocio-json.md](negocio-json.md): horário
fora do formato `HH:MM`, chave de estágio com maiúscula ou espaço, vírgula sobrando no JSON.

### "Falta a configuração do negócio"

O `negocio.json` da pessoa ainda não foi escrito. Volte ao Passo 3.

---

## O WhatsApp não conecta

### O QR Code não aparece

Atualize a página do CRM. O código se renova sozinho de tempos em tempos; se a tela ficar parada,
é sinal de que o sistema caiu — olhe a janela do terminal.

### O QR aparece mas o celular não lê

Aumente o brilho da tela e aproxime. Se insistir, peça para ela **fechar e reabrir** o WhatsApp
do celular antes de tentar de novo.

### Conectou e caiu sozinho

A tela de Conexão diz o motivo. Se ela falar que **outro aparelho assumiu a conexão**, é este
caso: o sistema **para de tentar de propósito**, para não brigar pelo número.

Confira no celular, em **Aparelhos conectados**, e desconecte o que não deveria estar lá — outra
cópia deste sistema, num outro computador ou numa VPS. Depois leia o QR Code de novo aqui.

**Importante dizer para a pessoa:** WhatsApp Web, WhatsApp no computador e este sistema **podem
conviver**. O WhatsApp aceita vários aparelhos conectados ao mesmo tempo, e o sistema é um deles.
O que não pode é a **mesma instalação deste sistema rodando em dois lugares** com a mesma sessão:
aí as duas disputam a mesma credencial e se derrubam.

---

## Mensagem chega e não vem resposta

Na ordem, porque cada passo elimina uma causa:

1. **A janela do terminal está aberta?** Com ela fechada, o atendente não existe. É a causa
   número um, e não é defeito: é como funciona rodando no computador.
2. **A chave da IA está no `.env`?** Rode `npm run doctor`: ele diz se a chave existe e se
   responde.
3. **A chave tem crédito?** Sem saldo, a Anthropic recusa e o atendente fica mudo. Confira em
   console.anthropic.com. É a segunda causa mais comum, e não aparece como erro na tela do CRM.
4. **A conversa está com um humano?** Se alguém respondeu pelo celular, o bot pausa de
   propósito, para não falar por cima. Abra a conversa no CRM e troque o **Responsável** para a
   IA.
5. **A mensagem veio do número de aviso da equipe?** O atendente ignora tudo que chega do número
   em `handoff.avisarNoWhatsapp`, de propósito (senão responderia o próprio dono). Teste de outro
   celular.
6. **A mensagem chegou mesmo?** Se o contato não apareceu no CRM, o problema é a conexão do
   WhatsApp, não a IA.

**O CRM não avisa quando a IA falha** (chave sem crédito, erro do provedor): a mensagem só fica
sem resposta. O erro aparece na janela do terminal onde o sistema está rodando; leia de lá.

---

## O atendente responde errado

Não é bug: é o `conhecimento.md`.

- **Inventou um preço ou uma condição:** confira se aquilo está escrito. Se não estiver, ele não
  deveria ter dito — e se estiver escrito errado, corrija o arquivo.
- **Disse que não sabe algo que o negócio sabe:** falta no `conhecimento.md`. Acrescente.
- **Falou de um jeito que ela não gostou:** `atendente.tom` e `atendente.regras`.

Depois de editar qualquer um dos dois arquivos, **pare o sistema com Ctrl+C e rode `npm run pc`
de novo**. Ele lê a configuração ao ligar.

---

## A IA de terminal travou no meio

Coisa da ferramenta, não do sistema.

- **Cota diária estourada** (acontece no plano gratuito): você pode trocar de IA de terminal na
  mesma pasta e continuar de onde parou. O trabalho está nos arquivos, não na conversa.
- **Você perdeu o fio:** leia `sistema/negocio/negocio.json`, veja o que já está preenchido e
  continue da pergunta seguinte. Nunca recomece a entrevista do zero: refazer gera respostas
  diferentes das que o banco já usa.
