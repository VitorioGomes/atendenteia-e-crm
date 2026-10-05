import { useCallback, useEffect, useRef, useState } from "react";
import { ErroApi, api } from "../api";
import { useConfirmar } from "../confirmar";
import type { ContatoResumo, ResultadoImportacao } from "../api";
import { Avatar } from "../avatar";
import { IconeBaixar, IconeBusca, IconeLixeira, IconeMais, IconeSubir } from "../icones";
import { Etiqueta } from "../etiquetas";
import { IconeDoEstagio, PainelLead, estagiosParaJanela, type EstagioDaJanela } from "./PainelLead";

/**
 * Agenda de contatos.
 *
 * Diferente do funil: aqui está todo mundo que já apareceu, virou oportunidade
 * ou não. É também de onde o comprador leva a lista embora — saber que os
 * contatos são dele, e não ficam presos no sistema, importa.
 */

const ATRASO_BUSCA_MS = 350;

export function Contatos({
  etiquetas,
  rotulosDeCampos,
  nomeDaIa,
  nomeDaPessoa,
  aoIrParaConversa,
}: {
  etiquetas: string[];
  rotulosDeCampos?: Record<string, string>;
  nomeDaIa: string;
  nomeDaPessoa: string;
  aoIrParaConversa: (conversaId: string, telefone: string) => void;
}) {
  // Estagios do funil, para a janela do lead e para a pilula da coluna Estagio.
  const [estagios, setEstagios] = useState<EstagioDaJanela[]>([]);
  const [leadAberto, setLeadAberto] = useState<ContatoResumo | null>(null);

  useEffect(() => {
    api
      .funil()
      .then((f) => setEstagios(estagiosParaJanela(f.estagios)))
      .catch(() => setEstagios([]));
  }, []);

  // Uma pessoa, um lugar para ver e editar (26/09/2026): quem tem card no funil abre
  // a mesma janela do Funil. Contato importado de planilha ainda nao tem card, entao
  // abre o formulario.
  const abrir = (contato: ContatoResumo) => {
    if (contato.dealId) setLeadAberto(contato);
    else setEditando(contato);
  };

  const [dados, setDados] = useState<{ contatos: ContatoResumo[]; total: number } | null>(null);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<ContatoResumo | null>(null);
  const [importacao, setImportacao] = useState<ResultadoImportacao | null>(null);
  const entradaArquivo = useRef<HTMLInputElement>(null);

  const carregar = useCallback(
    async (termo: string, qualPagina: number) => {
      try {
        const resposta = await api.contatos(termo, qualPagina);
        setDados({ contatos: resposta.contatos, total: resposta.total });
        setErro(null);
      } catch (e) {
        setErro(e instanceof ErroApi ? e.message : "A lista não carregou. Recarregue a página.");
      } finally {
        setCarregando(false);
      }
    },
    [],
  );

  // Espera a pessoa parar de digitar antes de consultar o servidor.
  useEffect(() => {
    const relogio = setTimeout(() => void carregar(busca, pagina), ATRASO_BUSCA_MS);
    return () => clearTimeout(relogio);
  }, [busca, pagina, carregar]);

  const recarregar = () => void carregar(busca, pagina);

  const confirmar = useConfirmar();

  const apagar = async (contato: ContatoResumo) => {
    const nome = contato.nome ?? contato.telefoneFormatado;
    const r = await confirmar({
      titulo: `Apagar ${nome}?`,
      mensagem: (
        <>
          Apaga <strong>também</strong> a conversa, o histórico e os agendamentos dessa pessoa, e
          não dá para desfazer. O backup diário guarda uma cópia, caso precise recuperar.
        </>
      ),
      acao: "Apagar contato",
      perigoso: true,
    });
    if (!r.ok) return;

    try {
      await api.apagarContato(contato.id);
      setRecado(`${nome} foi apagado.`);
      recarregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "O contato não foi apagado. Tente de novo.");
    }
  };

  const exportar = async () => {
    try {
      const csv = await api.exportarContatos();
      const endereco = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = endereco;
      link.download = `contatos-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(endereco);
      setRecado("Arquivo baixado. Ele abre direto no Excel.");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "O arquivo não foi gerado. Tente de novo.");
    }
  };

  const importar = async (arquivo: File) => {
    setErro(null);
    setImportacao(null);
    try {
      const conteudo = await arquivo.text();
      const resultado = await api.importarContatos(conteudo);
      setImportacao(resultado);
      recarregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "O arquivo não foi importado. Confira se é um .csv.");
    } finally {
      if (entradaArquivo.current) entradaArquivo.current.value = "";
    }
  };

  const total = dados?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / 50));

  return (
    <>
      <div className="cabecalho">
        <h1>
          Contatos
          {!carregando && <span className="contagem-titulo">{total}</span>}
        </h1>
        <div className="acoes">
          <button type="button" className="botao" onClick={() => setCriando(true)}>
            <IconeMais tamanho={16} className="icone" />
            Novo contato
          </button>
          <button type="button" className="botao secundario" onClick={() => void exportar()}>
            <IconeBaixar tamanho={16} className="icone" />
            Exportar
          </button>
          <button
            type="button"
            className="botao secundario"
            title="Planilha .csv com uma coluna de telefone. Quem já existe é atualizado, não duplicado."
            onClick={() => entradaArquivo.current?.click()}
          >
            <IconeSubir tamanho={16} className="icone" />
            Importar
          </button>
          <input
            ref={entradaArquivo}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) void importar(arquivo);
            }}
          />
        </div>
      </div>

      {erro && <div className="aviso erro">{erro}</div>}
      {recado && (
        <div className="aviso ok">
          {recado}{" "}
          <button type="button" className="botao discreto" onClick={() => setRecado(null)}>
            ok
          </button>
        </div>
      )}

      {importacao && (
        <div className={`aviso ${importacao.problemas.length ? "atencao" : "ok"}`}>
          <strong>Importação concluída.</strong> {importacao.lidas} linha(s) lida(s):{" "}
          {importacao.criados} contato(s) novo(s), {importacao.atualizados} atualizado(s).
          {importacao.problemas.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {importacao.problemas.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              className="botao discreto"
              onClick={() => setImportacao(null)}
            >
              fechar
            </button>
          </div>
        </div>
      )}

      <div className="barra-busca">
        <IconeBusca tamanho={17} className="icone" />
        <input
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPagina(1);
          }}
          placeholder="Buscar por nome, telefone ou e-mail"
        />
      </div>

      {!carregando && total === 0 && (
        <div className="aviso atencao">
          {busca ? (
            <>
              <strong>Nenhum contato encontrado</strong> para "{busca}".
            </>
          ) : (
            <>
              <strong>Nenhum contato ainda.</strong> Todo mundo que mandar mensagem no WhatsApp
              entra aqui automaticamente. Você também pode adicionar na mão ou importar uma
              planilha que já tenha.
            </>
          )}
        </div>
      )}

      {total > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela tabela-contatos">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Telefone</th>
                <th>E-mail</th>
                <th>Etiquetas</th>
                <th>Estágio</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {dados?.contatos.map((contato) => (
                <tr
                  key={contato.id}
                  className="linha-clicavel"
                  onClick={() => abrir(contato)}
                  title={contato.dealId ? "Abrir o lead" : "Editar o contato"}
                >
                  <td>
                    <div className="pessoa-celula">
                      <Avatar nome={contato.nome} telefone={contato.telefone} tamanho={32} />
                      <div>
                        <div className="nome">{contato.nome ?? "Sem nome"}</div>
                        {/* No celular a tabela vira lista: telefone e e-mail descem para
                            baixo do nome, e as colunas deles somem. */}
                        <div className="so-celular telefone-celular">{contato.telefoneFormatado}</div>
                        {contato.email && <div className="so-celular secundario">{contato.email}</div>}
                        {contato.agendamentos > 0 && (
                          <div className="secundario">
                            {contato.agendamentos}{" "}
                            {contato.agendamentos === 1 ? "agendamento" : "agendamentos"}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="numero coluna-telefone">{contato.telefoneFormatado}</td>
                  <td className="coluna-email">{contato.email ?? "—"}</td>
                  <td className={`coluna-etiquetas${contato.tags.length === 0 ? " vazia" : ""}`}>
                    {contato.tags.length === 0 ? (
                      "—"
                    ) : (
                      <div className="tags">
                        {contato.tags.map((tag) => (
                          <Etiqueta key={tag} nome={tag} />
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="coluna-estagio">
                    {contato.estagio ? (
                      <EstagioDoContato
                        nome={contato.estagio}
                        estagio={estagios.find((e) => e.nome === contato.estagio)}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  {/* Acoes so aparecem com o ponteiro na linha: repetidas em toda linha,
                      pesavam mais que os dados. O clique aqui nao abre a janela. */}
                  <td
                    className="acoes-linha"
                    style={{ textAlign: "right", whiteSpace: "nowrap" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <a
                      className="botao discreto whatsapp-linha"
                      href={`https://wa.me/${contato.telefone}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: "none" }}
                    >
                      WhatsApp
                    </a>
                    <button
                      type="button"
                      className="botao discreto editar-linha"
                      onClick={() => setEditando(contato)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="botao-icone apagar-linha"
                      onClick={() => void apagar(contato)}
                      aria-label={`Apagar ${contato.nome ?? contato.telefoneFormatado}`}
                      title="Apagar contato"
                    >
                      <IconeLixeira tamanho={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPaginas > 1 && (
        <div className="paginacao">
          <button
            type="button"
            className="botao secundario"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => p - 1)}
          >
            Anterior
          </button>
          <span>
            página {pagina} de {totalPaginas}
          </span>
          <button
            type="button"
            className="botao secundario"
            disabled={pagina >= totalPaginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      )}

      {criando && (
        <FormularioContato
          aoFechar={() => setCriando(false)}
          aoSalvar={async (dados) => {
            try {
              await api.criarContato(dados);
              setCriando(false);
              setRecado("Contato salvo.");
              recarregar();
            } catch (e) {
              throw e instanceof ErroApi ? e : new Error("Os dados não foram salvos. Confira os campos e tente de novo.");
            }
          }}
        />
      )}

      {editando && (
        <FormularioContato
          contato={editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={async (dados) => {
            await api.atualizarContato(editando.id, {
              nome: dados.nome ?? null,
              email: dados.email ?? null,
              tags: dados.tags,
            });
            setEditando(null);
            setRecado("Contato atualizado.");
            recarregar();
          }}
        />
      )}

      {leadAberto?.dealId && (
        <PainelLead
          id={leadAberto.dealId}
          estagios={estagios}
          etiquetas={etiquetas}
          rotulosDeCampos={rotulosDeCampos}
          nomeDaIa={nomeDaIa}
          nomeDaPessoa={nomeDaPessoa}
          aoFechar={() => {
            setLeadAberto(null);
            recarregar();
          }}
          aoMudar={async () => recarregar()}
          aoIrParaConversa={(conversaId) => aoIrParaConversa(conversaId, leadAberto.telefone)}
        />
      )}
    </>
  );
}

/** Estagio na tabela: a mesma pilula da janela do lead, so para ler. */
function EstagioDoContato({ nome, estagio }: { nome: string; estagio?: EstagioDaJanela }) {
  const classe = estagio?.ganho
    ? " ganho"
    : estagio?.perdido
      ? " perdido"
      : estagio?.fracao === 0
        ? " inicio"
        : "";
  return (
    <span className={`pilula-estagio somente-leitura${classe}`}>
      <IconeDoEstagio estagio={estagio} />
      {nome}
    </span>
  );
}

function FormularioContato({
  contato,
  aoFechar,
  aoSalvar,
}: {
  contato?: ContatoResumo;
  aoFechar: () => void;
  aoSalvar: (dados: {
    telefone: string;
    nome?: string;
    email?: string;
    tags?: string[];
  }) => Promise<void>;
}) {
  const [telefone, setTelefone] = useState(contato?.telefoneFormatado ?? "");
  const [nome, setNome] = useState(contato?.nome ?? "");
  const [email, setEmail] = useState(contato?.email ?? "");
  const [tags, setTags] = useState((contato?.tags ?? []).join(", "));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      await aoSalvar({
        telefone,
        nome: nome || undefined,
        email: email || undefined,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Os dados não foram salvos. Confira os campos e tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div
      className="cortina centralizada"
      onClick={(e) => e.target === e.currentTarget && aoFechar()}
    >
      <div className="janela">
        <header className="topo">
          <h2>{contato ? "Editar contato" : "Novo contato"}</h2>
          <button type="button" className="botao discreto" onClick={aoFechar}>
            fechar
          </button>
        </header>

        <div className="corpo">
          <form className="formulario" onSubmit={enviar}>
            {erro && <div className="aviso erro">{erro}</div>}

            <label>
              Telefone com DDD
              <input
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(11) 98765-4321"
                required
                disabled={Boolean(contato)}
                autoFocus={!contato}
              />
              {contato && <small>O telefone identifica o contato e não pode ser trocado.</small>}
            </label>

            <label>
              Nome
              <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus={Boolean(contato)} />
            </label>

            <label>
              E-mail
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
            </label>

            <label>
              Etiquetas
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="convênio, urgente"
              />
              <small>Separe por vírgula.</small>
            </label>

            <div className="acoes">
              <button type="submit" className="botao" disabled={salvando}>
                {salvando ? "Salvando…" : "Salvar"}
              </button>
              <button type="button" className="botao secundario" onClick={aoFechar}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
