import { useCallback, useEffect, useRef, useState } from "react";
import { ErroApi, api } from "../api";
import type { StatusWhatsapp } from "../api";
import { Avatar } from "../avatar";
import { useConfirmar } from "../confirmar";
import { desde } from "../formato";

/**
 * Tela de conexão do WhatsApp.
 *
 * Para quem: o comprador na instalação, e o dono depois, quando desconfia que "o robô
 * parou". Ação principal: conectado, ver QUAL número está ligado e se está vivo;
 * desconectado, ler o QR Code. É a tela mais importante da instalação: se a pessoa
 * não passa daqui, ela não tem produto nenhum. Por isso o passo a passo fica na tela.
 */

const QR_A_CADA_MS = 4_000;

export function Conexao({ aoMudarConexao }: { aoMudarConexao: (conectado: boolean) => void }) {
  const [status, setStatus] = useState<StatusWhatsapp | null>(null);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [esperandoQr, setEsperandoQr] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const confirmar = useConfirmar();
  const avisou = useRef<boolean | null>(null);

  const conferir = useCallback(async () => {
    try {
      const atual = await api.statusWhatsapp();
      setStatus(atual);
      if (avisou.current !== atual.conectado) {
        avisou.current = atual.conectado;
        aoMudarConexao(atual.conectado);
      }
      // Conectou: o QR Code não serve mais para nada e some da tela.
      if (atual.conectado) {
        setQrcode(null);
        setEsperandoQr(false);
      }
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não deu para verificar a conexão. Recarregue a página.");
    }
  }, [aoMudarConexao]);

  useEffect(() => {
    void conferir();
    const relogio = setInterval(() => void conferir(), 5000);
    return () => clearInterval(relogio);
  }, [conferir]);

  // O WhatsApp troca o QR Code a cada ~20 segundos. Enquanto a pessoa não lê, a tela
  // busca o código novo sozinha — antes ele expirava e exigia outro clique.
  const buscarQr = useCallback(async () => {
    try {
      const resposta = await api.conectarWhatsapp();
      setQrcode(resposta.qrcode);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "O QR Code não foi gerado. Tente de novo em alguns segundos.");
      setEsperandoQr(false);
    }
  }, []);

  useEffect(() => {
    if (!esperandoQr) return;
    void buscarQr();
    const relogio = setInterval(() => void buscarQr(), QR_A_CADA_MS);
    return () => clearInterval(relogio);
  }, [esperandoQr, buscarQr]);

  const desconectarNumero = async () => {
    const numero = status?.conta?.telefoneFormatado ?? "este número";
    const r = await confirmar({
      titulo: `Desconectar ${numero}?`,
      mensagem:
        "A IA para de responder até alguém ler o QR Code de novo. Use para trocar o número do atendimento. As conversas e o CRM continuam aqui.",
      acao: "Desconectar",
      perigoso: true,
    });
    if (!r.ok) return;
    try {
      await api.desconectarWhatsapp();
      await conferir();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não deu para desconectar. Tente de novo.");
    }
  };

  if (!status) {
    return (
      <>
        <div className="cabecalho">
          <h1>Conexão com o WhatsApp</h1>
        </div>
        <div className="esqueleto" style={{ height: 220, borderRadius: 14 }} />
      </>
    );
  }

  return (
    <>
      <div className="cabecalho">
        <h1>Conexão com o WhatsApp</h1>
      </div>

      {erro && <div className="aviso erro">{erro}</div>}

      {status.conectado ? (
        <Conectado status={status} aoDesconectar={() => void desconectarNumero()} />
      ) : (
        <div className="conexao">
          <div className={`qrcode${qrcode ? " com-codigo" : ""}`}>
            {qrcode ? (
              <>
                <img src={qrcode} alt="QR Code para conectar o WhatsApp" />
                <p className="qr-legenda">O código se renova sozinho. Pode apontar o celular.</p>
              </>
            ) : esperandoQr ? (
              <div className="qr-vazio">
                <div className="esqueleto qr-esqueleto" />
                <p>Gerando o código</p>
              </div>
            ) : (
              <div className="qr-vazio">
                <p>O código aparece aqui e se renova sozinho até você ler.</p>
                <button className="botao" type="button" onClick={() => setEsperandoQr(true)}>
                  Gerar QR Code
                </button>
              </div>
            )}
          </div>

          <div className="conexao-instrucoes">
            <h2>Conecte o número do atendimento</h2>
            <ol className="passos">
              <li>Pegue o celular com o WhatsApp do negócio.</li>
              <li>
                Abra o WhatsApp e toque em <strong>Configurações</strong>, depois{" "}
                <strong>Dispositivos conectados</strong> e <strong>Conectar dispositivo</strong>.
              </li>
              <li>Aponte a câmera para o código ao lado.</li>
              <li>Pronto. Esta tela muda sozinha quando conectar.</li>
            </ol>

            <div className="aviso atencao">
              <strong>Use um número separado, não o seu pessoal.</strong> Esta conexão usa o
              WhatsApp comum (não é a API oficial), e um número que dispara muita mensagem pode
              ser bloqueado pelo WhatsApp. Um chip só para o atendimento evita dor de cabeça.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Conectado({ status, aoDesconectar }: { status: StatusWhatsapp; aoDesconectar: () => void }) {
  const conta = status.conta;
  const atividade = status.atividade;

  return (
    <div className="conexao-ativa">
      <section className="cartao-numero">
        <div className="numero-foto">
          {conta?.foto ? (
            <img src={conta.foto} alt="" />
          ) : (
            <Avatar nome={conta?.nome ?? null} telefone={conta?.telefone ?? ""} tamanho={72} />
          )}
          <span className="ponto-vivo" aria-hidden="true" />
        </div>

        <div className="numero-dados">
          <span className="selo-conectado">Conectado</span>
          <strong className="numero-telefone">
            {conta ? `+55 ${conta.telefoneFormatado}` : "Número conectado"}
          </strong>
          {conta?.nome && <span className="numero-nome">{conta.nome}</span>}
          {conta?.desde && (
            <span className="numero-desde">Conectado {desde(conta.desde)}</span>
          )}
        </div>

        <button type="button" className="botao discreto perigoso" onClick={aoDesconectar}>
          Desconectar
        </button>
      </section>

      {atividade && (
        <section className="atividade-conexao" aria-label="Atividade de hoje">
          <div>
            <span className="rotulo-atividade">Mensagens recebidas hoje</span>
            <strong>{atividade.recebidasHoje}</strong>
          </div>
          <div>
            <span className="rotulo-atividade">Respostas da IA hoje</span>
            <strong>{atividade.respondidasHoje}</strong>
          </div>
          <div>
            <span className="rotulo-atividade">Última mensagem recebida</span>
            <strong className="texto">
              {atividade.ultimaRecebidaEm ? desde(atividade.ultimaRecebidaEm) : "nenhuma ainda"}
            </strong>
          </div>
        </section>
      )}
    </div>
  );
}
