import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import { ErroApi, api } from "./api";
import type { RespostaRapida } from "./api";
import { GRUPOS_EMOJI, emojisRecentes, lembrarEmoji } from "./emojis";
import { useGravador } from "./gravador";
import {
  IconeClipe,
  IconeDocumento,
  IconeEmoji,
  IconeEnviar,
  IconeFechar,
  IconeImagem,
  IconeLixeira,
  IconeMicrofone,
  IconeParar,
  IconeRaio,
} from "./icones";
import { PlayerAudio, tamanhoDeArquivo } from "./midia";
import { atalhoDigitado, preencherResposta } from "./respostas";
import {
  GerenciarRespostas,
  MenuRespostas,
  filtrarRespostas,
} from "./respostas-rapidas";

/**
 * A barra de escrever da caixa de entrada, no desenho do WhatsApp: emoji e anexo à
 * esquerda, o texto no meio, e à direita um botão que muda sozinho — microfone com a
 * caixa vazia, enviar quando há o que mandar. Quem já usa WhatsApp não precisa
 * aprender nada.
 */

/** Mesmo teto do servidor (src/lib/midia.ts). */
const LIMITE_BYTES = 16 * 1024 * 1024;
const MAX_ANEXOS = 10;

export interface ControleCompositor {
  adicionarArquivos: (arquivos: File[]) => void;
}

interface Props {
  conversaId: string | null;
  /** Para o {nome} das respostas rápidas. */
  nomeContato: string | null;
  dica: string;
  aoEnviado: () => Promise<void>;
  aoErro: (mensagem: string | null) => void;
}

export const Compositor = forwardRef<ControleCompositor, Props>(
  function Compositor(
    { conversaId, nomeContato, dica, aoEnviado, aoErro },
    ref,
  ) {
    const [texto, setTexto] = useState("");
    const [anexos, setAnexos] = useState<File[]>([]);
    const [enviando, setEnviando] = useState(false);
    const [aberto, setAberto] = useState<
      "emoji" | "anexo" | "respostas" | null
    >(null);
    const [respostas, setRespostas] = useState<RespostaRapida[] | null>(null);
    const [destaque, setDestaque] = useState(0);
    const [barraDispensada, setBarraDispensada] = useState(false);
    const [gerenciando, setGerenciando] = useState(false);
    const campo = useRef<HTMLTextAreaElement>(null);
    const entradaFotos = useRef<HTMLInputElement>(null);
    const entradaDocumento = useRef<HTMLInputElement>(null);
    const raiz = useRef<HTMLFormElement>(null);

    const gravador = useGravador(aoErro);

    // Endereco local da gravacao parada, para ouvir antes de enviar.
    const [urlGravacao, setUrlGravacao] = useState<string | null>(null);
    useEffect(() => {
      if (!gravador.pronta) return setUrlGravacao(null);
      const url = URL.createObjectURL(gravador.pronta.audio);
      setUrlGravacao(url);
      return () => URL.revokeObjectURL(url);
    }, [gravador.pronta]);

    useEffect(() => {
      api
        .respostasRapidas()
        .then(setRespostas)
        .catch(() => setRespostas([]));
    }, []);

    // "/" no começo abre as respostas; o botão de raio abre a lista inteira.
    const consulta = atalhoDigitado(texto);
    const pelaBarra = consulta !== null && !barraDispensada;
    const menuRespostas = pelaBarra || aberto === "respostas";
    const filtradas = respostas
      ? filtrarRespostas(respostas, pelaBarra ? consulta : "")
      : null;

    useEffect(() => setDestaque(0), [consulta]);
    useEffect(() => {
      if (consulta === null) setBarraDispensada(false);
    }, [consulta]);

    const usarResposta = (r: RespostaRapida) => {
      const preenchida = preencherResposta(r.texto, nomeContato);
      const el = campo.current;
      if (pelaBarra) {
        setTexto(preenchida);
        requestAnimationFrame(() => {
          el?.focus();
          el?.setSelectionRange(preenchida.length, preenchida.length);
        });
      } else {
        const inicio = el?.selectionStart ?? texto.length;
        const fim = el?.selectionEnd ?? texto.length;
        setTexto(texto.slice(0, inicio) + preenchida + texto.slice(fim));
        requestAnimationFrame(() => {
          el?.focus();
          el?.setSelectionRange(
            inicio + preenchida.length,
            inicio + preenchida.length,
          );
        });
      }
      setAberto(null);
    };
    const gravando = gravador.estado !== "parado";
    const desligado = !conversaId;

    const adicionarArquivos = useCallback(
      (novos: File[]) => {
        if (novos.length === 0) return;
        const grandes = novos.filter((f) => f.size > LIMITE_BYTES);
        const aceitos = novos.filter(
          (f) => f.size > 0 && f.size <= LIMITE_BYTES,
        );

        if (grandes.length) {
          aoErro(
            `${grandes.length === 1 ? `"${grandes[0]!.name}" passa` : "Alguns arquivos passam"} de 16 MB, o limite do WhatsApp para envio por aqui. Mande por um link (Google Drive, por exemplo).`,
          );
        } else {
          aoErro(null);
        }

        setAnexos((antes) => [...antes, ...aceitos].slice(0, MAX_ANEXOS));
        setAberto(null);
        campo.current?.focus();
      },
      [aoErro],
    );

    useImperativeHandle(ref, () => ({ adicionarArquivos }), [
      adicionarArquivos,
    ]);

    // A caixa cresce com o texto até um teto, como no WhatsApp.
    useEffect(() => {
      const el = campo.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }, [texto]);

    // Fecha o seletor aberto com clique fora ou Esc.
    useEffect(() => {
      if (!aberto) return;
      const fora = (e: MouseEvent) => {
        if (!raiz.current?.contains(e.target as Node)) setAberto(null);
      };
      const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAberto(null);
      document.addEventListener("mousedown", fora);
      document.addEventListener("keydown", tecla);
      return () => {
        document.removeEventListener("mousedown", fora);
        document.removeEventListener("keydown", tecla);
      };
    }, [aberto]);

    const falhou = (e: unknown, padrao: string) =>
      aoErro(e instanceof ErroApi ? e.message : padrao);

    const enviar = async () => {
      if (!conversaId || enviando) return;
      const legenda = texto.trim();
      if (!legenda && anexos.length === 0) return;

      setEnviando(true);
      aoErro(null);
      let enviados = 0;
      try {
        if (anexos.length) {
          // Um arquivo por mensagem, como no WhatsApp. A legenda vai no primeiro.
          for (const [i, arquivo] of anexos.entries()) {
            await api.enviarArquivo(conversaId, arquivo, {
              nome: arquivo.name,
              tipo: arquivo.type || "application/octet-stream",
              legenda: i === 0 && legenda ? legenda : undefined,
            });
            enviados++;
          }
          setAnexos([]);
        } else {
          await api.enviarMensagem(conversaId, legenda);
        }
        setTexto("");
        await aoEnviado();
      } catch (e) {
        // O que já saiu não volta para a fila: mandar de novo duplicaria no WhatsApp.
        if (enviados > 0) {
          setAnexos((antes) => antes.slice(enviados));
          setTexto("");
          await aoEnviado();
        }
        falhou(e, "A mensagem não foi enviada. Confira a conexão do WhatsApp.");
      } finally {
        setEnviando(false);
        campo.current?.focus();
      }
    };

    const enviarGravacao = async () => {
      const gravacao = await gravador.terminar();
      if (!gravacao || !conversaId) return;

      setEnviando(true);
      aoErro(null);
      try {
        await api.enviarArquivo(conversaId, gravacao.audio, {
          nome: "mensagem-de-voz",
          tipo: gravacao.tipo,
          voz: { segundos: gravacao.segundos, onda: gravacao.onda },
        });
        await aoEnviado();
      } catch (e) {
        falhou(
          e,
          "O áudio não foi enviado. Confira a conexão do WhatsApp e grave de novo.",
        );
      } finally {
        setEnviando(false);
      }
    };

    const inserirEmoji = (emoji: string) => {
      const el = campo.current;
      const inicio = el?.selectionStart ?? texto.length;
      const fim = el?.selectionEnd ?? texto.length;
      const novo = texto.slice(0, inicio) + emoji + texto.slice(fim);
      setTexto(novo);
      lembrarEmoji(emoji);
      // Devolve o cursor para logo depois do emoji, e o seletor continua aberto para o próximo.
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(inicio + emoji.length, inicio + emoji.length);
      });
    };

    const temConteudo = texto.trim().length > 0 || anexos.length > 0;

    return (
      <>
        {/* Fora do formulário da conversa: o "Salvar" dela não pode enviar a mensagem. */}
        {gerenciando && (
          <GerenciarRespostas
            aoFechar={() => {
              setGerenciando(false);
              campo.current?.focus();
            }}
            aoMudar={setRespostas}
          />
        )}
        <form
          ref={raiz}
          className={`compositor${gravando ? " gravando" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
        >
          {anexos.length > 0 && !gravando && (
            <ul className="anexos" aria-label="Arquivos para enviar">
              {anexos.map((arquivo, i) => (
                <Anexo
                  key={`${arquivo.name}-${arquivo.size}-${i}`}
                  arquivo={arquivo}
                  aoRemover={() =>
                    setAnexos((antes) => antes.filter((_, j) => j !== i))
                  }
                />
              ))}
            </ul>
          )}

          {aberto === "emoji" && <SeletorEmoji aoEscolher={inserirEmoji} />}

          {menuRespostas && !gravando && (
            <MenuRespostas
              respostas={filtradas}
              destaque={destaque}
              nomeContato={nomeContato}
              aoEscolher={usarResposta}
              aoDestacar={setDestaque}
              aoEditar={() => {
                // O "/" que abriu a lista não é mensagem: não pode sobrar na caixa.
                if (pelaBarra) setTexto("");
                setAberto(null);
                setBarraDispensada(true);
                setGerenciando(true);
              }}
            />
          )}

          {aberto === "anexo" && (
            <div className="menu-anexo" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => entradaFotos.current?.click()}
              >
                <IconeImagem tamanho={18} />
                Fotos e vídeos
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => entradaDocumento.current?.click()}
              >
                <IconeDocumento tamanho={18} />
                Documento
              </button>
            </div>
          )}

          <input
            ref={entradaFotos}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              adicionarArquivos([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <input
            ref={entradaDocumento}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              adicionarArquivos([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />

          <div className="linha-compositor">
            {gravando ? (
              <>
                <button
                  type="button"
                  className="botao-icone perigoso"
                  onClick={gravador.cancelar}
                  aria-label="Apagar gravação"
                  title="Apagar gravação"
                >
                  <IconeLixeira tamanho={20} />
                </button>

                {/* Parada: ouvir antes de decidir. Gravando: o tempo e as barras. */}
                {gravador.estado === "revisando" && urlGravacao ? (
                  <div className="gravacao revisando">
                    <PlayerAudio
                      url={urlGravacao}
                      segundos={gravador.pronta?.segundos ?? null}
                    />
                  </div>
                ) : (
                  <div className="gravacao" role="status" aria-live="polite">
                    <span className="ponto-gravando" aria-hidden="true" />
                    <span className="tempo-gravacao">
                      {gravador.estado === "pedindo"
                        ? "Liberando o microfone"
                        : tempo(gravador.segundos)}
                    </span>
                    <span className="barras-ao-vivo" aria-hidden="true">
                      {gravador.niveis.map((n, i) => (
                        <span
                          key={i}
                          style={{ transform: `scaleY(${Math.max(0.12, n)})` }}
                        />
                      ))}
                    </span>
                  </div>
                )}

                {/* Parar sem enviar: o que faltava (pedido do dono, 05/10/2026). */}
                {gravador.estado !== "revisando" && (
                  <button
                    type="button"
                    className="botao-icone parar-gravacao"
                    onClick={() => void gravador.parar()}
                    disabled={gravador.estado !== "gravando"}
                    aria-label="Parar de gravar"
                    title="Parar de gravar e ouvir antes de enviar"
                  >
                    <IconeParar tamanho={20} />
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`botao-icone${aberto === "emoji" ? " ativo" : ""}`}
                  onClick={() => setAberto(aberto === "emoji" ? null : "emoji")}
                  disabled={desligado}
                  aria-label="Emojis"
                  aria-expanded={aberto === "emoji"}
                  title="Emojis"
                >
                  <IconeEmoji tamanho={21} />
                </button>
                <button
                  type="button"
                  className={`botao-icone${aberto === "anexo" ? " ativo" : ""}`}
                  onClick={() => setAberto(aberto === "anexo" ? null : "anexo")}
                  disabled={desligado}
                  aria-label="Anexar arquivo"
                  aria-expanded={aberto === "anexo"}
                  title="Anexar foto, vídeo ou documento"
                >
                  <IconeClipe tamanho={21} />
                </button>
                <button
                  type="button"
                  className={`botao-icone${aberto === "respostas" ? " ativo" : ""}`}
                  onClick={() =>
                    setAberto(aberto === "respostas" ? null : "respostas")
                  }
                  disabled={desligado}
                  aria-label="Respostas rápidas"
                  aria-expanded={aberto === "respostas"}
                  title="Respostas rápidas (ou digite / na mensagem)"
                >
                  <IconeRaio tamanho={20} />
                </button>

                <textarea
                  ref={campo}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    // Com a lista de respostas aberta, as setas e o Enter são dela.
                    if (menuRespostas && filtradas && filtradas.length > 0) {
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const passo = e.key === "ArrowDown" ? 1 : -1;
                        setDestaque(
                          (d) =>
                            (d + passo + filtradas.length) % filtradas.length,
                        );
                        return;
                      }
                      if (
                        (e.key === "Enter" && !e.shiftKey) ||
                        e.key === "Tab"
                      ) {
                        e.preventDefault();
                        usarResposta(
                          filtradas[Math.min(destaque, filtradas.length - 1)]!,
                        );
                        return;
                      }
                    }
                    if (menuRespostas && e.key === "Escape") {
                      e.preventDefault();
                      setBarraDispensada(true);
                      setAberto(null);
                      return;
                    }
                    // Enter envia, como no WhatsApp. Shift+Enter quebra a linha.
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void enviar();
                    }
                  }}
                  onPaste={(e) => {
                    // Print colado (Ctrl+V) vira anexo, como no WhatsApp Web.
                    const arquivos = [...e.clipboardData.files];
                    if (arquivos.length) {
                      e.preventDefault();
                      adicionarArquivos(arquivos);
                    }
                  }}
                  rows={1}
                  placeholder={anexos.length ? "Adicione uma legenda" : dica}
                  disabled={desligado}
                  aria-label="Mensagem"
                />
              </>
            )}

            {gravando ? (
              <button
                type="button"
                className="botao-redondo"
                onClick={() => void enviarGravacao()}
                disabled={
                  enviando ||
                  (gravador.estado !== "gravando" && gravador.estado !== "revisando")
                }
                aria-label="Enviar áudio"
                title="Enviar áudio"
              >
                <IconeEnviar tamanho={20} />
              </button>
            ) : temConteudo || enviando ? (
              <button
                type="submit"
                className="botao-redondo"
                disabled={enviando || desligado}
                aria-label={enviando ? "Enviando" : "Enviar"}
                title="Enviar (Enter)"
              >
                <IconeEnviar tamanho={20} />
              </button>
            ) : (
              <button
                type="button"
                className="botao-redondo"
                onClick={() => void gravador.iniciar()}
                disabled={desligado}
                aria-label="Gravar áudio"
                title="Gravar mensagem de voz"
              >
                <IconeMicrofone tamanho={20} />
              </button>
            )}
          </div>
        </form>
      </>
    );
  },
);

function tempo(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Anexo({
  arquivo,
  aoRemover,
}: {
  arquivo: File;
  aoRemover: () => void;
}) {
  const ehImagem =
    arquivo.type.startsWith("image/") && arquivo.type !== "image/svg+xml";
  const [previa, setPrevia] = useState<string | null>(null);

  useEffect(() => {
    if (!ehImagem) return;
    const url = URL.createObjectURL(arquivo);
    setPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo, ehImagem]);

  return (
    <li className="anexo">
      {previa ? (
        <img src={previa} alt="" />
      ) : (
        <span className="anexo-icone">
          {arquivo.type.startsWith("video/") ? (
            <IconeImagem tamanho={20} />
          ) : (
            <IconeDocumento tamanho={20} />
          )}
        </span>
      )}
      <span className="anexo-textos">
        <span className="nome">{arquivo.name}</span>
        <span className="detalhe">{tamanhoDeArquivo(arquivo.size)}</span>
      </span>
      <button
        type="button"
        className="remover"
        onClick={aoRemover}
        aria-label={`Tirar ${arquivo.name}`}
      >
        <IconeFechar tamanho={14} />
      </button>
    </li>
  );
}

function SeletorEmoji({ aoEscolher }: { aoEscolher: (emoji: string) => void }) {
  const [recentes] = useState(emojisRecentes);
  const grupos = recentes.length
    ? [{ nome: "Usados recentemente", emojis: recentes }, ...GRUPOS_EMOJI]
    : GRUPOS_EMOJI;

  return (
    <div className="seletor-emoji" role="dialog" aria-label="Emojis">
      {grupos.map((g) => (
        <section key={g.nome}>
          <h3>{g.nome}</h3>
          <div className="grade-emoji">
            {g.emojis.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => aoEscolher(e)}
                aria-label={e}
              >
                {e}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
