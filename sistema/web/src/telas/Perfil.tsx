import { useEffect, useRef, useState } from "react";
import { ErroApi, api } from "../api";
import type { Sessao } from "../api";
import { IconeOlho, IconeOlhoFechado } from "../icones";
import { aplicarTema, type Tema } from "../tema";
import { TextoEditavel } from "../editavel";
import { nomeExibido } from "../formato";

/**
 * Perfil de quem está usando o CRM.
 *
 * Para quem: o dono ou quem atende, de vez em quando. Ação principal: escolher a
 * aparência; depois, ajustar nome e senha. A aparência salva sozinha (é escolha, não
 * formulário), e avisa que salvou; nome e senha pedem confirmação, porque errar neles
 * tem consequência.
 */

const MINIMO_SENHA = 8;

const TEMAS: { id: Tema; rotulo: string; descricao: string }[] = [
  { id: "claro", rotulo: "Claro", descricao: "Fundo claro, o padrão." },
  { id: "escuro", rotulo: "Escuro", descricao: "Cansa menos a vista à noite." },
  { id: "sistema", rotulo: "Igual ao computador", descricao: "Troca sozinho com o sistema." },
];

export function Perfil({
  sessao,
  aoMudar,
}: {
  sessao: Sessao;
  aoMudar: (usuario: Sessao["usuario"]) => void;
}) {
  const [recado, setRecado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [temaSalvo, setTemaSalvo] = useState(false);
  const relogio = useRef(0);
  const tema = sessao.usuario.tema ?? "sistema";

  useEffect(() => () => clearTimeout(relogio.current), []);

  const avisar = (texto: string) => {
    setErro(null);
    setRecado(texto);
  };
  const falhar = (e: unknown, padrao: string) => {
    setRecado(null);
    setErro(e instanceof ErroApi ? e.message : padrao);
  };

  const escolherTema = async (novo: Tema) => {
    const anterior = tema;
    aplicarTema(novo);
    aoMudar({ ...sessao.usuario, tema: novo });
    try {
      await api.atualizarPerfil({ tema: novo });
      // Sinal de que a escolha ficou gravada: aqui não há botão para confirmar.
      setTemaSalvo(true);
      clearTimeout(relogio.current);
      relogio.current = window.setTimeout(() => setTemaSalvo(false), 2500);
    } catch (e) {
      // Não salvou: volta, para a tela não mentir sobre o que ficou gravado.
      aplicarTema(anterior);
      aoMudar({ ...sessao.usuario, tema: anterior });
      falhar(e, "A aparência não foi salva. Tente de novo.");
    }
  };

  // Nome se edita no clique, como na janela do lead (26/09/2026): sem botao
  // "Salvar nome". Enter ou clicar fora salva; nome em branco nao apaga.
  const salvarNome = async (novo: string) => {
    if (!novo) return;
    try {
      await api.atualizarPerfil({ nome: novo });
      aoMudar({ ...sessao.usuario, nome: novo });
      avisar("Nome salvo.");
    } catch (err) {
      falhar(err, "O nome não foi salvo. Tente de novo.");
    }
  };

  return (
    <>
      <div className="cabecalho">
        <h1>Perfil</h1>
      </div>

      {erro && <div className="aviso erro">{erro}</div>}
      {recado && <div className="aviso ok">{recado}</div>}

      <div className="perfil">
        <div className="perfil-coluna">
          <section className="bloco">
            <div className="titulo-com-sinal">
              <h3>Aparência</h3>
              {temaSalvo && <span className="sinal-salvo">Salvo</span>}
            </div>

            <div className="opcoes-tema" role="radiogroup" aria-label="Aparência do CRM">
              {TEMAS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={tema === t.id}
                  className={`opcao-tema tema-${t.id}`}
                  onClick={() => tema !== t.id && void escolherTema(t.id)}
                >
                  <span className="miniatura" aria-hidden="true">
                    <span className="mini-lateral" />
                    <span className="mini-corpo">
                      <span className="mini-cartao" />
                      <span className="mini-cartao curto" />
                    </span>
                  </span>
                  <span className="opcao-textos">
                    <strong>{t.rotulo}</strong>
                    <span>{t.descricao}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="bloco">
            <h3>Seus dados</h3>
            <dl className="propriedades perfil-dados">
              <div className="propriedade">
                <dt>Nome</dt>
                <dd>
                  <TextoEditavel
                    valor={sessao.usuario.nome ?? ""}
                    vazio="Clique para escrever seu nome"
                    rotulo="Nome"
                    exibir={nomeExibido}
                    editar={nomeExibido}
                    aoSalvar={salvarNome}
                  />
                </dd>
              </div>
              <div className="propriedade">
                <dt>E-mail de acesso</dt>
                <dd>{sessao.usuario.email}</dd>
              </div>
            </dl>
          </section>
        </div>

        <TrocarSenha aoAvisar={avisar} aoFalhar={falhar} />
      </div>
    </>
  );
}

/** Campo de senha com o olho para conferir o que foi digitado. */
function CampoSenha({
  rotulo,
  valor,
  aoMudar,
  autoComplete,
  ajuda,
  erro,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  autoComplete: string;
  ajuda?: string;
  erro?: string;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <label>
      {rotulo}
      <span className="campo-senha">
        <input
          type={aberto ? "text" : "password"}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="botao-icone"
          onClick={() => setAberto((v) => !v)}
          aria-label={aberto ? "Esconder a senha" : "Mostrar a senha"}
          title={aberto ? "Esconder" : "Mostrar"}
        >
          {aberto ? <IconeOlhoFechado tamanho={17} /> : <IconeOlho tamanho={17} />}
        </button>
      </span>
      {erro ? <small className="erro-campo">{erro}</small> : ajuda && <small>{ajuda}</small>}
    </label>
  );
}

function TrocarSenha({
  aoAvisar,
  aoFalhar,
}: {
  aoAvisar: (texto: string) => void;
  aoFalhar: (e: unknown, padrao: string) => void;
}) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [repetida, setRepetida] = useState("");
  const [salvando, setSalvando] = useState(false);

  const curta = nova.length > 0 && nova.length < MINIMO_SENHA;
  const diferentes = repetida.length > 0 && nova !== repetida;
  const pronto = atual.length > 0 && nova.length >= MINIMO_SENHA && nova === repetida;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pronto) return;
    setSalvando(true);
    try {
      await api.trocarSenha(atual, nova);
      setAtual("");
      setNova("");
      setRepetida("");
      aoAvisar("Senha trocada. Outros aparelhos conectados vão pedir a senha nova.");
    } catch (err) {
      aoFalhar(err, "A senha não foi trocada. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="bloco">
      <h3>Senha</h3>
      <form className="formulario" onSubmit={salvar}>
        <CampoSenha
          rotulo="Senha atual"
          valor={atual}
          aoMudar={setAtual}
          autoComplete="current-password"
        />
        <CampoSenha
          rotulo="Nova senha"
          valor={nova}
          aoMudar={setNova}
          autoComplete="new-password"
          ajuda={`Pelo menos ${MINIMO_SENHA} caracteres. O CRM guarda telefone e conversa de cliente.`}
          erro={curta ? `Faltam ${MINIMO_SENHA - nova.length} caracteres.` : undefined}
        />
        <CampoSenha
          rotulo="Repita a nova senha"
          valor={repetida}
          aoMudar={setRepetida}
          autoComplete="new-password"
          erro={diferentes ? "As duas senhas não são iguais." : undefined}
        />
        <div className="acoes">
          <button type="submit" className="botao" disabled={salvando || !pronto}>
            {salvando ? "Trocando" : "Trocar senha"}
          </button>
        </div>
      </form>
    </section>
  );
}
