import { IconePessoa } from "./icones";

/**
 * Avatar de iniciais.
 *
 * Numa lista de 60 pessoas parecidas, a cor e as duas letras são o que o olho
 * usa para achar de novo a pessoa que ele já viu — mais rápido que ler o nome.
 *
 * A cor sai do telefone, não do nome: nome muda quando a IA descobre o nome
 * completo, telefone não. Se a cor mudasse junto, o reconhecimento se perderia
 * justamente no momento em que o card ganhou informação.
 */

const TONS = [
  { fundo: "#dbeae9", texto: "#0f5460" },
  { fundo: "#e3e6df", texto: "#4a5a2f" },
  { fundo: "#f0e3d5", texto: "#8a5a20" },
  { fundo: "#e6e1ee", texto: "#54487a" },
  { fundo: "#dde8e0", texto: "#1c6b47" },
  { fundo: "#f0dede", texto: "#8f3b34" },
  { fundo: "#dee6f0", texto: "#2c527d" },
  { fundo: "#efe7d8", texto: "#7a5c14" },
];

function iniciais(nome: string | null, _telefone: string): string {
  const limpo = (nome ?? "").trim();
  if (!limpo) return "";

  const partes = limpo.split(/\s+/).filter(Boolean);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  return (primeira + ultima).toUpperCase();
}

function tom(chave: string) {
  let soma = 0;
  for (let i = 0; i < chave.length; i++) soma = (soma * 31 + chave.charCodeAt(i)) % 100_000;
  return TONS[soma % TONS.length]!;
}

export function Avatar({
  nome,
  telefone,
  tamanho = 34,
}: {
  nome: string | null;
  telefone: string;
  tamanho?: number;
}) {
  const cores = tom(telefone || nome || "");
  const letras = iniciais(nome, telefone);

  return (
    <span
      className="avatar"
      style={{
        width: tamanho,
        height: tamanho,
        background: cores.fundo,
        color: cores.texto,
        fontSize: Math.round(tamanho * 0.4),
      }}
      aria-hidden="true"
    >
      {/* Sem nome, as iniciais viravam dois digitos do telefone ("72"), que nao
          identificam ninguem e ainda parecem um numero com significado. */}
      {letras || <IconePessoa tamanho={Math.round(tamanho * 0.55)} />}
    </span>
  );
}
