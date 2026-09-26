# Atendente IA + CRM para WhatsApp

Um atendente de inteligência artificial que responde no WhatsApp do seu negócio, qualifica quem
chega, marca horário na agenda e mantém um CRM atualizado sozinho.

Roda **no seu computador**, sem mensalidade de plataforma. Quando quiser deixar no ar 24 horas,
o mesmo sistema sobe para um servidor.

---

## Como instalar

Você não vai digitar comandos nem editar arquivo de configuração. Quem faz isso é uma IA de
terminal, que te entrevista sobre o seu negócio e configura tudo.

**1. Instale o Node.js** — <https://nodejs.org>, a opção **LTS**. Depois feche o terminal e abra
de novo.

**2. Instale uma IA de terminal**, qualquer uma das três:

| Ferramenta | Custo |
|---|---|
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | gratuita |
| [Codex](https://developers.openai.com/codex/cli/) | incluída em planos da OpenAI |
| [Claude Code](https://claude.com/claude-code) | assinatura paga |

**3. Baixe este projeto e abra a IA dentro da pasta:**

```bash
git clone https://github.com/VitorioGomes/atendenteia-e-crm.git
cd atendenteia-e-crm
```

**4. Peça para ela instalar.** Abra a IA de terminal nessa pasta e diga:

> Instale o atendente seguindo o roteiro.

Ela lê o roteiro em [`skill/INSTALAR.md`](skill/INSTALAR.md), te faz algumas perguntas sobre o
negócio e coloca o sistema no ar. Leva algo entre 15 e 30 minutos, quase tudo respondendo
pergunta.

---

## O que você vai precisar ter em mãos

- **Um chip de WhatsApp separado**, não o seu número pessoal (o motivo está mais abaixo).
- **Uma chave de API da Anthropic** — <https://console.anthropic.com>, menu "API Keys". É o único
  custo do sistema, cobrado pelo uso, direto no seu cartão. Começar com 5 dólares de crédito é
  o suficiente para testar.
- Meia hora sem pressa.

---

## O que ele faz

- **Responde no WhatsApp** como uma recepcionista: uma pergunta por vez, mensagens curtas.
- **Qualifica** quem chega e anota tudo no CRM, sem ninguém digitar.
- **Marca horário** na agenda de verdade, respeitando funcionamento, duração e vagas.
- **Manda lembrete** antes do compromisso, que é o que mais reduz falta.
- **Chama você no seu WhatsApp pessoal** quando a conversa precisa de gente, e para de responder
  por cima.
- **Retoma quem sumiu**, com follow-up automático — e nunca cutuca quem já marcou.
- **Entende áudio**, se você colocar uma chave da OpenAI (opcional).
- **CRM completo**: funil arrastável, caixa de entrada com foto, áudio e arquivo, agenda em
  dia/semana/mês, contatos com importação de planilha, painel com as contas do mês.

---

## O que ele não faz, e é melhor você saber agora

- **Enquanto o computador estiver desligado, o atendente não responde.** Lembrete e follow-up só
  saem com a máquina ligada. Para ficar 24 horas no ar existe o caminho do servidor, e o sistema
  é o mesmo.
- **O CRM abre só naquele computador**, não no celular. No servidor, abre de qualquer lugar.
- **Existe risco de banimento do número.** É um WhatsApp não oficial, como toda ferramenta desse
  tipo. Use um chip separado. O risco não some.
- **A IA não vê imagem.** Ela sabe que chegou uma foto, mas não o que tem nela.
- **Se a chave da IA ficar sem crédito, o atendente para de responder e o CRM não avisa.** Confira
  o saldo de vez em quando no site da Anthropic.

---

## Depois de instalado

Para ligar de novo, abra o terminal e entre na pasta do projeto, a `atendenteia-e-crm`
(não a pasta onde você a baixou):

```bash
cd atendenteia-e-crm
npm run pc
```

A IA de terminal te diz o caminho completo no fim da instalação. Se aparecer
`Could not read package.json`, o terminal está na pasta errada: é só fazer o `cd` acima.

Enquanto essa janela estiver aberta, o atendente responde. Fechou, parou.

Para mudar qualquer coisa — preço, horário, jeito de falar — abra a IA de terminal na pasta e
peça. Ela sabe onde mexer.

---

## Licença

MIT. Use no seu negócio, modifique, revenda para clientes. Veja [LICENSE](LICENSE).
