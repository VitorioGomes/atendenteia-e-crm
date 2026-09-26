/**
 * Aparência do CRM: claro, escuro, ou igual ao computador.
 *
 * A escolha mora no perfil do usuário (servidor), para valer em qualquer navegador.
 * Uma cópia fica no navegador só para a página já abrir no tema certo — o index.html
 * lê essa cópia antes do React carregar, senão a tela piscaria branca no escuro.
 */

export type Tema = "claro" | "escuro" | "sistema";

const CHAVE = "crm.tema";
const consulta = () => window.matchMedia?.("(prefers-color-scheme: dark)");

let atual: Tema = "sistema";
let ouvindo = false;

function resolver(tema: Tema): "claro" | "escuro" {
  if (tema !== "sistema") return tema;
  return consulta()?.matches ? "escuro" : "claro";
}

function pintar() {
  const final = resolver(atual);
  document.documentElement.dataset.tema = final;
  document.documentElement.style.colorScheme = final === "escuro" ? "dark" : "light";
}

export function aplicarTema(tema: Tema) {
  atual = tema;
  pintar();
  try {
    localStorage.setItem(CHAVE, tema);
  } catch {
    /* sem armazenamento: o servidor ainda lembra */
  }
  // "Igual ao computador" acompanha a troca do sistema sem recarregar a página.
  if (!ouvindo) {
    consulta()?.addEventListener?.("change", () => atual === "sistema" && pintar());
    ouvindo = true;
  }
}
