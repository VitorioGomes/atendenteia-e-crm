/**
 * CSV para planilha brasileira.
 *
 * Dois detalhes que quebram na vida real e sao tratados aqui:
 *
 * 1. O Excel em portugues usa PONTO E VIRGULA como separador, nao virgula.
 *    Exportar com virgula joga a planilha inteira numa coluna so.
 * 2. O Excel so entende UTF-8 se o arquivo comecar com BOM. Sem ele,
 *    "Joao Gonalves" vira "JoÃ£o GonÃ§alves" e o comprador acha que o sistema
 *    esta quebrado.
 */

const BOM = "﻿";

function escapar(valor: string, separador: string): string {
  const texto = valor ?? "";
  const precisaAspas =
    texto.includes(separador) || texto.includes('"') || texto.includes("\n") || texto.includes("\r");
  return precisaAspas ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function paraCsv(
  cabecalho: string[],
  linhas: (string | number | null | undefined)[][],
  separador = ";",
): string {
  const formatar = (celulas: (string | number | null | undefined)[]) =>
    celulas.map((c) => escapar(String(c ?? ""), separador)).join(separador);

  return BOM + [formatar(cabecalho), ...linhas.map(formatar)].join("\r\n") + "\r\n";
}

/** Descobre se o arquivo veio com ponto e virgula ou virgula. */
function detectarSeparador(primeiraLinha: string): string {
  const pontoEVirgula = (primeiraLinha.match(/;/g) ?? []).length;
  const virgula = (primeiraLinha.match(/,/g) ?? []).length;
  return pontoEVirgula >= virgula ? ";" : ",";
}

/**
 * Le um CSV e devolve uma lista de objetos com as chaves do cabecalho,
 * normalizadas para minusculas sem acento (entao "Telefone" e "telefone"
 * viram a mesma coisa).
 */
export function deCsv(texto: string): Record<string, string>[] {
  const limpo = texto.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!limpo.trim()) return [];

  const separador = detectarSeparador(limpo.split("\n")[0] ?? "");
  const celulas = dividir(limpo, separador);
  if (celulas.length === 0) return [];

  const cabecalho = (celulas[0] ?? []).map(normalizarChave);
  const registros: Record<string, string>[] = [];

  for (const linha of celulas.slice(1)) {
    if (linha.every((c) => c.trim() === "")) continue;
    const registro: Record<string, string> = {};
    cabecalho.forEach((chave, indice) => {
      if (chave) registro[chave] = (linha[indice] ?? "").trim();
    });
    registros.push(registro);
  }

  return registros;
}

export function normalizarChave(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Divide respeitando aspas: um campo entre aspas pode conter o separador. */
function dividir(texto: string, separador: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let dentroDeAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const caractere = texto[i];

    if (dentroDeAspas) {
      if (caractere === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroDeAspas = false;
        }
      } else {
        campo += caractere;
      }
      continue;
    }

    if (caractere === '"') {
      dentroDeAspas = true;
    } else if (caractere === separador) {
      linha.push(campo);
      campo = "";
    } else if (caractere === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else {
      campo += caractere;
    }
  }

  if (campo !== "" || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }

  return linhas;
}
