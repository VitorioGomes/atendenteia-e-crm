import { useCallback, useEffect, useState } from "react";
import { ErroApi, api } from "./api";
import type { Resumo, Sessao } from "./api";
import {
  IconeAgenda,
  IconeContatos,
  IconeConversa,
  IconeConexao,
  IconeFunil,
  IconeLateral,
  IconePainel,
  IconeSair,
  IconeSeta,
} from "./icones";
import { Login } from "./telas/Login";
import { Painel } from "./telas/Painel";
import { Conversas } from "./telas/Conversas";
import { Funil } from "./telas/Funil";
import { Contatos } from "./telas/Contatos";
import { Conexao } from "./telas/Conexao";
import { Agenda } from "./telas/Agenda";
import { Perfil } from "./telas/Perfil";
import { Avatar } from "./avatar";
import { aplicarTema } from "./tema";

type Tela = "painel" | "conversas" | "funil" | "contatos" | "agenda" | "conexao" | "perfil";

export function App() {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [tela, setTela] = useState<Tela>("painel");
  const [filtroConversas, setFiltroConversas] = useState<"todas" | "voce">("todas");
  const [conversaAlvo, setConversaAlvo] = useState<{ id: string; telefone: string } | undefined>();
  const [whatsappConectado, setWhatsappConectado] = useState<boolean | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  // Barra lateral recolhida (so icones) ou aberta. Preferencia de quem usa este
  // navegador, entao mora no localStorage; sem ele, abre aberta.
  const [recolhida, setRecolhida] = useState(() => {
    try {
      return localStorage.getItem("crm.lateral") === "recolhida";
    } catch {
      return false;
    }
  });

  const alternarLateral = () => {
    setRecolhida((atual) => {
      try {
        localStorage.setItem("crm.lateral", atual ? "aberta" : "recolhida");
      } catch {
        // Sem localStorage a escolha vale so ate recarregar.
      }
      return !atual;
    });
  };

  const conferirSessao = useCallback(async () => {
    try {
      setSessao(await api.eu());
    } catch {
      setSessao(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void conferirSessao();
  }, [conferirSessao]);

  // O tema salvo no perfil vale em qualquer navegador: ao entrar, ele manda.
  useEffect(() => {
    if (sessao?.usuario.tema) aplicarTema(sessao.usuario.tema);
  }, [sessao?.usuario.tema]);

  // A conexão do WhatsApp e quem está esperando são estado de sistema: valem em
  // qualquer tela, então vivem na lateral e não na área de trabalho.
  useEffect(() => {
    if (!sessao) return;

    let ativo = true;
    const verificar = async () => {
      const [status, contagens] = await Promise.allSettled([api.statusWhatsapp(), api.resumo()]);
      if (!ativo) return;
      setWhatsappConectado(status.status === "fulfilled" ? status.value.conectado : false);
      if (contagens.status === "fulfilled") setResumo(contagens.value);
    };

    void verificar();
    const relogio = setInterval(verificar, 30_000);
    return () => {
      ativo = false;
      clearInterval(relogio);
    };
  }, [sessao]);

  if (carregando) return <div className="login"><div className="esqueleto" style={{ width: 380, height: 300, borderRadius: 18 }} /></div>;
  if (!sessao) return <Login aoEntrar={conferirSessao} />;

  const sair = async () => {
    try {
      await api.sair();
    } catch (e) {
      if (!(e instanceof ErroApi)) throw e;
    }
    setSessao(null);
  };

  const textoConexao =
    whatsappConectado === null
      ? "Verificando WhatsApp"
      : whatsappConectado
        ? "WhatsApp conectado"
        : "WhatsApp desconectado";

  const item = (
    chave: Tela,
    rotulo: string,
    Icone: (props: { tamanho?: number; className?: string }) => JSX.Element,
    contagem?: { valor: number; urgente?: boolean },
  ) => (
    <button
      type="button"
      aria-current={tela === chave}
      title={recolhida ? rotulo : undefined}
      onClick={() => {
        if (chave === "conversas") setFiltroConversas("todas");
        // Clicar em Conversas na lateral e pedir a lista, nao voltar para a conversa
        // que o funil abriu da ultima vez.
        setConversaAlvo(undefined);
        setTela(chave);
      }}
    >
      <span className="com-icone">
        <Icone tamanho={17} className="icone" />
        <span className="rotulo">{rotulo}</span>
      </span>
      {contagem && contagem.valor > 0 && (
        <span className={`contagem${contagem.urgente ? " urgente" : ""}`}>{contagem.valor}</span>
      )}
    </button>
  );

  return (
    <div className={`app${recolhida ? " lateral-recolhida" : ""}`}>
      <nav className="lateral">
        <div className="marca" title={recolhida ? sessao.negocio.nome : undefined}>
          <span className="marca-inicial" aria-hidden="true">
            {iniciaisDoNegocio(sessao.negocio.nome)}
          </span>
          <span className="marca-textos">
            {sessao.negocio.nome}
            <small>Atendente {sessao.negocio.atendente}</small>
          </span>
        </div>

        {item("painel", "Painel", IconePainel)}
        {/* O numero laranja mora aqui, e nao no funil: e nas conversas que se age. */}
        {item("conversas", "Conversas", IconeConversa, {
          valor: resumo?.precisamDeVoce ?? 0,
          urgente: true,
        })}
        {item("funil", "Funil", IconeFunil)}
        {item("contatos", "Contatos", IconeContatos)}
        {item("agenda", "Agenda", IconeAgenda, { valor: resumo?.agendadosHoje ?? 0 })}
        {item("conexao", "Conexão", IconeConexao)}

        <div className="rodape">
          <button
            type="button"
            className={`estado-conexao${
              whatsappConectado === null ? "" : whatsappConectado ? " ligado" : " desligado"
            }`}
            onClick={() => setTela("conexao")}
            title={recolhida ? textoConexao : undefined}
          >
            <span className="sinal" />
            <span className="rotulo">{textoConexao}</span>
          </button>

          {/* Identidade fica por último: estado do sistema em cima, quem é você embaixo. */}
          <div className="divisor-lateral" />

          <button
            type="button"
            className="usuario-lateral"
            aria-current={tela === "perfil"}
            onClick={() => setTela("perfil")}
            title={recolhida ? (sessao.usuario.nome ?? sessao.usuario.email) : "Perfil e aparência"}
          >
            <span className="com-icone">
              <Avatar
                nome={sessao.usuario.nome ?? sessao.usuario.email}
                telefone={sessao.usuario.email}
                tamanho={26}
              />
              <span className="usuario-textos rotulo">
                <span className="usuario-nome">{sessao.usuario.nome ?? "Perfil"}</span>
                <span className="usuario-email">{sessao.usuario.email}</span>
              </span>
            </span>
            <IconeSeta tamanho={15} className="icone rotulo" />
          </button>

          <button type="button" onClick={() => void sair()} title={recolhida ? "Sair" : undefined}>
            <span className="com-icone">
              <IconeSair tamanho={16} className="icone" />
              <span className="rotulo">Sair</span>
            </span>
          </button>

          <button
            type="button"
            className="alternar-lateral"
            onClick={alternarLateral}
            title={recolhida ? "Abrir a barra lateral" : "Recolher a barra lateral"}
            aria-label={recolhida ? "Abrir a barra lateral" : "Recolher a barra lateral"}
            aria-expanded={!recolhida}
          >
            <span className="com-icone">
              <IconeLateral tamanho={16} className="icone" />
              <span className="rotulo">Recolher</span>
            </span>
          </button>
        </div>
      </nav>

      <main className="conteudo">
        {whatsappConectado === false && tela !== "conexao" && (
          <div className="aviso erro">
            <strong>O WhatsApp está desconectado.</strong> Nenhuma mensagem está sendo recebida
            nem respondida.{" "}
            <button type="button" className="botao discreto" onClick={() => setTela("conexao")}>
              Reconectar
            </button>
          </div>
        )}

        {tela === "painel" && (
          <Painel
            aoIrParaConversas={() => {
              setFiltroConversas("voce");
              setTela("conversas");
            }}
          />
        )}
        {tela === "conversas" && (
          <Conversas
            key={`${filtroConversas}-${conversaAlvo?.id ?? ""}`}
            filtroInicial={filtroConversas}
            abrirConversa={conversaAlvo}
            nomeDaIa={sessao.negocio.atendente}
            nomeDaPessoa={sessao.usuario.nome ?? "Você"}
          />
        )}
        {tela === "funil" && (
          <Funil
            etiquetas={sessao.negocio.etiquetas}
            rotulosDeCampos={sessao.negocio.rotulosDeCampos}
            nomeDaIa={sessao.negocio.atendente}
            nomeDaPessoa={sessao.usuario.nome ?? "Você"}
            aoIrParaConversa={(id, telefone) => {
              setFiltroConversas("todas");
              setConversaAlvo({ id, telefone });
              setTela("conversas");
            }}
          />
        )}
        {tela === "perfil" && (
          <Perfil sessao={sessao} aoMudar={(usuario) => setSessao({ ...sessao, usuario })} />
        )}
        {tela === "contatos" && (
          <Contatos
            etiquetas={sessao.negocio.etiquetas}
            rotulosDeCampos={sessao.negocio.rotulosDeCampos}
            nomeDaIa={sessao.negocio.atendente}
            nomeDaPessoa={sessao.usuario.nome ?? "Você"}
            aoIrParaConversa={(id, telefone) => {
              setFiltroConversas("todas");
              setConversaAlvo({ id, telefone });
              setTela("conversas");
            }}
          />
        )}
        {tela === "agenda" && (
          <Agenda servicos={sessao.negocio.servicos} horarios={sessao.negocio.horarios} />
        )}
        {tela === "conexao" && (
          <Conexao aoMudarConexao={(conectado) => setWhatsappConectado(conectado)} />
        )}
      </main>
    </div>
  );
}

/** "Patinha Feliz" vira "PF": a marca da barra lateral quando ela esta recolhida. */
function iniciaisDoNegocio(nome: string): string {
  const palavras = nome
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-ZÀ-Ý]/.test(p));
  const letras = (palavras.length ? palavras : [nome]).slice(0, 2).map((p) => p.charAt(0));
  return letras.join("").toUpperCase();
}
