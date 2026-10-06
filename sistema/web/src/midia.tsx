import { useEffect, useRef, useState } from "react";
import type { Midia } from "./api";
import { IconeBaixar, IconeDocumento, IconePausa, IconePlay } from "./icones";

/**
 * O que veio junto com a mensagem: foto, áudio, vídeo ou documento.
 *
 * Tudo abre dentro da conversa, como no WhatsApp. O dono não deveria precisar pegar
 * o celular para ver a foto que o paciente mandou do dente.
 */

export function MidiaDaMensagem({ midia, tipo }: { midia: Midia; tipo: string }) {
  if (tipo === "AUDIO") return <PlayerAudio url={midia.url} segundos={midia.segundos ?? null} />;
  if (tipo === "IMAGE" || tipo === "STICKER") {
    return <Foto url={midia.url} figurinha={tipo === "STICKER"} />;
  }
  if (tipo === "VIDEO") {
    return <video className="midia-video" src={midia.url} controls preload="metadata" />;
  }
  return <Documento midia={midia} />;
}

function Foto({ url, figurinha }: { url: string; figurinha: boolean }) {
  const [falhou, setFalhou] = useState(false);

  if (falhou) {
    return <span className="midia-ausente">A foto não está mais neste computador. Veja no celular.</span>;
  }

  const imagem = (
    <img
      className={figurinha ? "midia-figurinha" : "midia-foto"}
      src={url}
      alt={figurinha ? "Figurinha" : "Foto da conversa"}
      loading="lazy"
      onError={() => setFalhou(true)}
    />
  );

  // Figurinha não tem o que ampliar.
  if (figurinha) return imagem;
  return (
    <a href={url} target="_blank" rel="noopener" title="Abrir a foto em tamanho real">
      {imagem}
    </a>
  );
}

const VELOCIDADES = [1, 1.5, 2];

/**
 * Player de mensagem de voz. O controle nativo do navegador tem uma cara diferente
 * em cada sistema e não cabe num balão; este segue o desenho do CRM.
 */
export function PlayerAudio({ url, segundos }: { url: string; segundos: number | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [tocando, setTocando] = useState(false);
  const [atual, setAtual] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [velocidade, setVelocidade] = useState(1);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = velocidade;
  }, [velocidade]);

  const alternar = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) {
      // Um áudio por vez, como no WhatsApp.
      document.querySelectorAll("audio").forEach((outro) => outro !== a && outro.pause());
      void a.play().catch(() => setFalhou(true));
    } else {
      a.pause();
    }
  };

  // Gravação do Chrome (WebM) chega sem duração no arquivo: vale a que veio junto.
  const total = Number.isFinite(duracao) && duracao > 0 ? duracao : (segundos ?? 0);
  const conhecida = total > 0;
  const progresso = conhecida ? Math.min(100, (atual / total) * 100) : 0;

  if (falhou) {
    return <span className="midia-ausente">O áudio não está mais neste computador. Ouça no celular.</span>;
  }

  return (
    <div className={`player-audio${tocando ? " tocando" : ""}`}>
      <button
        type="button"
        className="tocar"
        onClick={alternar}
        aria-label={tocando ? "Pausar áudio" : "Ouvir áudio"}
      >
        {tocando ? <IconePausa tamanho={16} /> : <IconePlay tamanho={16} />}
      </button>

      {/* Trilha desenhada (sem degradê) com o controle nativo invisível por cima: ele
          continua cuidando do teclado e do leitor de tela. */}
      <span className="trilha">
        <span className="preenchido" style={{ transform: `scaleX(${progresso / 100})` }} />
        <span className="cabeca" style={{ left: `${progresso}%` }} />
        <input
          type="range"
          min={0}
          max={conhecida ? total : 1}
          step={0.05}
          value={conhecida ? atual : 0}
          disabled={!conhecida}
          onChange={(e) => {
            if (audio.current) audio.current.currentTime = Number(e.target.value);
          }}
          aria-label="Posição no áudio"
        />
      </span>

      <span className="tempo">{tempo(tocando || atual > 0 ? atual : total)}</span>

      {(tocando || velocidade !== 1) && (
        <button
          type="button"
          className="velocidade"
          onClick={() =>
            setVelocidade(VELOCIDADES[(VELOCIDADES.indexOf(velocidade) + 1) % VELOCIDADES.length]!)
          }
          aria-label={`Velocidade ${velocidade}x. Clique para mudar.`}
        >
          {String(velocidade).replace(".", ",")}×
        </button>
      )}

      <audio
        ref={audio}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => setDuracao(e.currentTarget.duration)}
        onDurationChange={(e) => setDuracao(e.currentTarget.duration)}
        onTimeUpdate={(e) => setAtual(e.currentTarget.currentTime)}
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => {
          setTocando(false);
          setAtual(0);
        }}
        onError={() => setFalhou(true)}
      />
    </div>
  );
}

function tempo(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos <= 0) return "0:00";
  const s = Math.round(segundos);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function tamanhoDeArquivo(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

function Documento({ midia }: { midia: Midia }) {
  const nome = midia.nome ?? "Documento";
  const extensao = nome.includes(".") ? nome.split(".").pop()!.toUpperCase() : null;
  // No modo demonstração o arquivo é do próprio navegador (blob:), sem servidor.
  const local = midia.url.startsWith("blob:");
  const baixar = local ? midia.url : `${midia.url}?baixar=1`;

  return (
    <div className="midia-documento">
      <a className="abrir" href={midia.url} target="_blank" rel="noopener" title="Abrir o documento">
        <IconeDocumento tamanho={26} className="icone" />
        <span className="textos">
          <span className="nome">{nome}</span>
          <span className="detalhe">
            {extensao && <span>{extensao}</span>}
            {midia.tamanho ? <span>{tamanhoDeArquivo(midia.tamanho)}</span> : null}
          </span>
        </span>
      </a>
      <a
        className="baixar"
        href={baixar}
        download={local ? nome : undefined}
        aria-label={`Baixar ${nome}`}
        title="Baixar"
      >
        <IconeBaixar tamanho={18} />
      </a>
    </div>
  );
}
