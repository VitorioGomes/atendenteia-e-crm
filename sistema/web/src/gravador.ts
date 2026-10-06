import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Gravação de mensagem de voz pelo microfone do computador (ou do celular).
 *
 * O navegador grava em WebM (Chrome, Edge), OGG (Firefox) ou MP4 (Safari). O servidor
 * troca o WebM por OGG, que é o que o WhatsApp mostra como mensagem de voz — ver
 * src/whatsapp/audio-ogg.ts. O MP4 do Safari chega como arquivo de áudio.
 *
 * Enquanto grava, mede o volume para desenhar as barrinhas ao vivo; as mesmas medidas
 * viram a forma de onda que aparece na mensagem de voz no celular de quem recebe.
 */

export interface Gravacao {
  audio: Blob;
  tipo: string;
  segundos: number;
  /** 64 valores de 0 a 100, o formato que o WhatsApp usa para desenhar a onda. */
  onda: number[] | null;
}

/** "revisando": parou de gravar e a pessoa ainda decide se ouve, envia ou apaga. */
type Estado = "parado" | "pedindo" | "gravando" | "revisando";

const TIPOS = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
/** Mensagem de voz longa demais vira palestra; o WhatsApp também corta. */
export const MAX_SEGUNDOS = 10 * 60;
const BARRAS_AO_VIVO = 36;

function mensagemDeErro(e: unknown): string {
  const nome = (e as { name?: string })?.name;
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    return "O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço, permita o microfone e tente de novo.";
  }
  if (nome === "NotFoundError" || nome === "OverconstrainedError") {
    return "Nenhum microfone encontrado. Conecte um e tente de novo.";
  }
  if (nome === "NotReadableError") {
    return "O microfone está sendo usado por outro programa. Feche o outro programa e tente de novo.";
  }
  return "Não deu para gravar. Recarregue a página e tente de novo.";
}

export function useGravador(aoErro: (mensagem: string) => void) {
  const [estado, setEstado] = useState<Estado>("parado");
  const [segundos, setSegundos] = useState(0);
  const [niveis, setNiveis] = useState<number[]>([]);
  const [pronta, setPronta] = useState<Gravacao | null>(null);

  const gravador = useRef<MediaRecorder | null>(null);
  const fluxo = useRef<MediaStream | null>(null);
  const contexto = useRef<AudioContext | null>(null);
  const partes = useRef<Blob[]>([]);
  const medidas = useRef<number[]>([]);
  const inicio = useRef(0);
  const quadro = useRef(0);
  const relogio = useRef(0);
  const aoParar = useRef<((g: Gravacao | null) => void) | null>(null);
  // Apagar enquanto o navegador ainda pede o microfone: quando a permissao chegar,
  // o microfone e solto na hora, em vez de comecar a gravar sozinho.
  const cancelado = useRef(false);

  const soltarRecursos = useCallback(() => {
    cancelAnimationFrame(quadro.current);
    clearInterval(relogio.current);
    fluxo.current?.getTracks().forEach((t) => t.stop());
    fluxo.current = null;
    void contexto.current?.close().catch(() => undefined);
    contexto.current = null;
  }, []);

  // Sair da conversa no meio da gravação não pode deixar o microfone ligado.
  useEffect(
    () => () => {
      aoParar.current = null;
      if (gravador.current?.state === "recording") gravador.current.stop();
      soltarRecursos();
    },
    [soltarRecursos],
  );

  const iniciar = useCallback(async () => {
    if (estado !== "parado") return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      aoErro(
        "Este navegador não grava áudio aqui. Use o Chrome ou o Edge; se o CRM estiver na internet, o endereço precisa começar com https.",
      );
      return;
    }

    cancelado.current = false;
    setPronta(null);
    setEstado("pedindo");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      fluxo.current = stream;
      if (cancelado.current) {
        soltarRecursos();
        return;
      }

      const tipo = TIPOS.find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      partes.current = [];
      medidas.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) partes.current.push(e.data);
      };
      rec.onstop = () => {
        // Gravacao apagada e outra ja comecada: este aviso atrasado nao mexe na nova.
        if (gravador.current !== rec) return;
        gravador.current = null;
        const duracao = (Date.now() - inicio.current) / 1000;
        soltarRecursos();
        setEstado("parado");
        setSegundos(0);
        setNiveis([]);

        const entregar = aoParar.current;
        aoParar.current = null;
        if (!entregar) return;
        if (partes.current.length === 0) return entregar(null);

        const tipoFinal = (rec.mimeType || tipo || "audio/webm").split(";")[0]!;
        entregar({
          audio: new Blob(partes.current, { type: tipoFinal }),
          tipo: tipoFinal,
          segundos: Math.max(1, Math.round(duracao)),
          onda: ondaDoWhatsapp(medidas.current),
        });
      };

      medirVolume(stream);

      gravador.current = rec;
      rec.start(250);
      inicio.current = Date.now();
      setSegundos(0);
      setEstado("gravando");

      relogio.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - inicio.current) / 1000);
        setSegundos(s);
        // No limite, para sozinho e espera a pessoa decidir, como no botao de parar.
        if (s >= MAX_SEGUNDOS && rec.state === "recording") {
          aoParar.current = (g) => {
            if (!g) return;
            setPronta(g);
            setEstado("revisando");
          };
          rec.stop();
        }
      }, 250);
    } catch (e) {
      soltarRecursos();
      setEstado("parado");
      if (!cancelado.current) aoErro(mensagemDeErro(e));
    }
  }, [estado, aoErro, soltarRecursos]);

  function medirVolume(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      contexto.current = ctx;
      const analisador = ctx.createAnalyser();
      analisador.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analisador);
      const amostras = new Float32Array(analisador.fftSize);
      let ultimo = 0;

      const passo = (agora: number) => {
        quadro.current = requestAnimationFrame(passo);
        if (agora - ultimo < 80) return;
        ultimo = agora;

        analisador.getFloatTimeDomainData(amostras);
        let soma = 0;
        for (const v of amostras) soma += v * v;
        // Raiz da média, esticada: voz normal fica no meio da escala, não no pé.
        const nivel = Math.min(1, Math.sqrt(soma / amostras.length) * 4);

        medidas.current.push(nivel);
        setNiveis((antes) => [...antes, nivel].slice(-BARRAS_AO_VIVO));
      };
      quadro.current = requestAnimationFrame(passo);
    } catch {
      // Sem medidor, grava igual: só não desenha as barrinhas.
    }
  }

  /** Para o microfone e devolve o que foi gravado. */
  const pararGravador = useCallback(
    () =>
      new Promise<Gravacao | null>((resolver) => {
        const rec = gravador.current;
        if (!rec || rec.state !== "recording") return resolver(null);
        aoParar.current = resolver;
        rec.stop();
      }),
    [],
  );

  /** Para de gravar e deixa a gravação esperando: ouvir, enviar ou apagar. */
  const parar = useCallback(async () => {
    const gravacao = await pararGravador();
    if (!gravacao) return;
    setPronta(gravacao);
    setEstado("revisando");
  }, [pararGravador]);

  /** Entrega a gravação para enviar: a que está esperando, ou para de gravar agora. */
  const terminar = useCallback(async () => {
    if (pronta) {
      setPronta(null);
      setEstado("parado");
      return pronta;
    }
    return pararGravador();
  }, [pronta, pararGravador]);

  /**
   * Joga fora, em qualquer etapa: pedindo o microfone, gravando ou ouvindo. A tela
   * volta na hora, sem esperar o navegador avisar que parou (no iPhone isso demora).
   */
  const cancelar = useCallback(() => {
    cancelado.current = true;
    aoParar.current = null;
    const rec = gravador.current;
    gravador.current = null;
    if (rec?.state === "recording") rec.stop();
    soltarRecursos();
    setPronta(null);
    setEstado("parado");
    setSegundos(0);
    setNiveis([]);
  }, [soltarRecursos]);

  return { estado, segundos, niveis, pronta, iniciar, parar, terminar, cancelar };
}

/** Reduz as medidas da gravação inteira a 64 barras de 0 a 100. */
export function ondaDoWhatsapp(medidas: number[]): number[] | null {
  if (medidas.length < 4) return null;
  const barras: number[] = [];
  for (let i = 0; i < 64; i++) {
    const de = Math.floor((i * medidas.length) / 64);
    const ate = Math.max(de + 1, Math.floor(((i + 1) * medidas.length) / 64));
    const trecho = medidas.slice(de, ate);
    barras.push(trecho.reduce((a, b) => a + b, 0) / trecho.length);
  }
  const maior = Math.max(...barras);
  if (maior <= 0) return barras.map(() => 0);
  return barras.map((b) => Math.round((b / maior) * 100));
}
