import { useState } from "react";
import { ErroApi, api } from "../api";

export function Login({ aoEntrar }: { aoEntrar: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      await api.entrar(email, senha);
      await aoEntrar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "O login não foi concluído. Tente de novo.");
      setEnviando(false);
    }
  };

  return (
    <div className="login">
      <form onSubmit={enviar}>
        <h1>Entrar no CRM</h1>

        {erro && <div className="aviso erro">{erro}</div>}

        <label>
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label>
          Senha
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button className="botao" type="submit" disabled={enviando}>
          {enviando ? "Entrando..." : "Entrar"}
        </button>

        <p style={{ margin: 0, fontSize: "var(--texto-menor)", color: "var(--tinta-fraca)" }}>
          É o e-mail e a senha que você definiu na instalação.
        </p>
      </form>
    </div>
  );
}
