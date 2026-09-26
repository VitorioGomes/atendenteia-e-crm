import { useEffect, useRef, useState } from "react";

/** Respeita quem pediu ao sistema para reduzir movimento. */
export function movimentoReduzido(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * Valor da contagem depois de `decorrido` ms, com saida exponencial (rapido no
 * comeco, assenta no fim). Sempre entre `inicio` e `alvo`.
 *
 * O horario que o navegador passa para o quadro pode vir um pouco ANTES do
 * `performance.now()` do inicio (e o comeco do quadro). Sem o piso em zero, o
 * progresso saia negativo e o numero contava para tras: o Painel mostrou "-3%" no
 * lugar de 86%, e ficava assim com a aba em segundo plano (achado de 26/09/2026).
 */
export function valorDaContagem(
  inicio: number,
  alvo: number,
  decorrido: number,
  duracao: number,
): number {
  const progresso = Math.min(1, Math.max(0, decorrido / duracao));
  const suavizado = 1 - Math.pow(1 - progresso, 3);
  return Math.round(inicio + (alvo - inicio) * suavizado);
}

/**
 * Conta até o número em vez de trocar de valor num piscar.
 *
 * Não é enfeite: o painel atualiza sozinho a cada minuto, e um número que salta
 * de 3 para 7 sem aviso passa despercebido. A contagem é o que faz o olho
 * perceber que algo mudou.
 *
 * Só anima o que vale a pena: variação de 1 é escrita direto.
 */
export function useContagem(alvo: number, duracao = 700): number {
  const [valor, setValor] = useState(alvo);
  const anterior = useRef(alvo);

  useEffect(() => {
    const inicio = anterior.current;
    anterior.current = alvo;

    if (movimentoReduzido() || Math.abs(alvo - inicio) <= 1) {
      setValor(alvo);
      return;
    }

    let quadro = 0;
    const comecouEm = performance.now();

    const passo = (agora: number) => {
      setValor(valorDaContagem(inicio, alvo, agora - comecouEm, duracao));
      if (agora - comecouEm < duracao) quadro = requestAnimationFrame(passo);
    };

    quadro = requestAnimationFrame(passo);
    // Garantia: se o navegador nao rodar os quadros (aba em segundo plano), o numero
    // chega ao valor certo mesmo assim. Sem isto ele ficava parado no inicio, e o
    // Painel mostrava "0%" com a barra em 86%.
    const garantia = setTimeout(() => setValor(alvo), duracao + 50);
    return () => {
      cancelAnimationFrame(quadro);
      clearTimeout(garantia);
    };
  }, [alvo, duracao]);

  return valor;
}

/**
 * Marca quais itens o usuário já viu, para eles não reanimarem a cada
 * atualização automática da tela. Só o que chega de novo entra animando.
 */
export function useJaVistos(ids: string[]): (id: string) => boolean {
  const vistos = useRef<Set<string>>(new Set());
  const conhecidosAgora = useRef<Set<string>>(new Set());

  conhecidosAgora.current = new Set(vistos.current);

  useEffect(() => {
    for (const id of ids) vistos.current.add(id);
  });

  return (id: string) => conhecidosAgora.current.has(id);
}
