// Tema antes de qualquer desenho: sem isto a tela pisca branca no modo escuro.
// A regra completa mora em src/tema.ts. Fica num arquivo, e nao escrito dentro do
// index.html, porque a politica de conteudo do CRM so deixa rodar script servido
// pelo proprio sistema (src/http/seguranca.ts).
(function () {
  var tema = "sistema";
  try {
    tema = localStorage.getItem("crm.tema") || "sistema";
  } catch (e) {}
  var escuro =
    tema === "escuro" ||
    (tema === "sistema" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.tema = escuro ? "escuro" : "claro";
  document.documentElement.style.colorScheme = escuro ? "dark" : "light";
})();
