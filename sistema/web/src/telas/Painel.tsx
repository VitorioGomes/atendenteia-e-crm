import { useCallback, useEffect, useState } from "react";
import { ErroApi, api } from "../api";
import type { Painel as DadosPainel } from "../api";
import { IconeAgenda, IconeAlerta, IconeCheck, IconePessoa, IconeTendencia } from "../icones";
import { useContagem } from "../animacao";

/**
 * Painel.
 *
 * Para o dono, olhando de relance. A pergunta que pede acao e "tem alguem com
 * voce, esperando?", por isso o primeiro cartao e o unico sem cor de fundo e o
 * unico que ganha contorno laranja. Os outros tres respondem "esta entrando
 * gente?", "esta virando horario?" e "a IA esta dando conta?", cada um com a cor
 * de dado que usa no resto do sistema. Desenho a partir da referencia do dono
 * (26/09/2026): cartoes tingidos, grafico grande com o dia em destaque.
 *
 * Saiu o consumo da IA (tokens, cache): numero que o dono nao sabe ler nao muda
 * decisao nenhuma. Quem precisa dele e o suporte, e ele continua no doctor.
 */
export function Painel({ aoIrParaConversas }: { aoIrParaConversas: () => void }) {
  const [dados, setDados] = useState<DadosPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dias, setDias] = useState<7 | 14>(14);
  const [diaEmFoco, setDiaEmFoco] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDados(await api.painel());
      setErro(null);
    } catch (e) {
      setErro(
        e instanceof ErroApi
          ? e.message
          : "O painel não carregou. Recarregue a página; se continuar, verifique se o sistema está no ar.",
      );
    }
  }, []);

  useEffect(() => {
    void carregar();
    const relogio = setInterval(() => void carregar(), 60_000);
    return () => clearInterval(relogio);
  }, [carregar]);

  // Hooks antes de qualquer retorno antecipado: contagem precisa existir mesmo
  // enquanto os dados não chegaram.
  const comVoceAnimado = useContagem(dados?.atencao.emAtendimentoHumano ?? 0);
  const autonomiaAnimada = useContagem(dados?.autonomia.percentualResolvidoPelaIa ?? 0);
  const comparecimentoAnimado = useContagem(dados?.agenda.percentualComparecimento ?? 0);

  if (erro) return <div className="aviso erro">{erro}</div>;

  // Enquanto os números não chegam, a tela mostra a forma do que vai chegar.
  if (!dados) {
    return (
      <>
        <div className="cabecalho">
          <h1>Painel</h1>
        </div>
        <div className="metricas">
          {[0, 1, 2, 3].map((i) => (
            <div className="esqueleto esqueleto-metrica" key={i} />
          ))}
        </div>
        <div className="painel-grade">
          <div className="painel-coluna">
            <div className="esqueleto" style={{ height: 300 }} />
            <div className="esqueleto" style={{ height: 130 }} />
          </div>
          <div className="painel-coluna">
            <div className="esqueleto" style={{ height: 250 }} />
            <div className="esqueleto" style={{ height: 180 }} />
          </div>
        </div>
      </>
    );
  }

  const esperando = dados.atencao.aguardandoResposta;
  const comVoce = dados.atencao.emAtendimentoHumano;
  const resolvidas = dados.autonomia.percentualResolvidoPelaIa;
  const serie = dados.serieNovosLeads.slice(-dias);
  const picoDaSerie = Math.max(1, ...serie.map((d) => d.quantidade));
  const totalDaSerie = serie.reduce((soma, d) => soma + d.quantidade, 0);
  const hoje = serie[serie.length - 1]?.dia;
  const emFoco = serie.find((d) => d.dia === diaEmFoco) ?? serie[serie.length - 1];
  const totalNoFunil = dados.funil.reduce((soma, e) => soma + e.total, 0);

  return (
    <>
      <div className="cabecalho">
        <h1>Painel</h1>
      </div>

      <div className="metricas">
        {/* "Com voce" e "Pessoas esperando" eram dois cartoes para a mesma pergunta
            (26/09/2026). Agora e um: quantas conversas estao com voce e, dentro
            delas, quantas tem alguem esperando, que e onde esta o botao. */}
        <div className={`metrica principal${esperando > 0 ? " urgente" : ""}`}>
          <div className="titulo">
            <IconePessoa tamanho={15} className="icone" />
            Com você
          </div>
          <div className="valor">{comVoceAnimado}</div>
          {esperando > 0 ? (
            <div className="rodape-metrica">
              <span className="esperando">
                <IconeAlerta tamanho={14} />
                {esperando === 1 ? "1 pessoa esperando" : `${esperando} pessoas esperando`}
              </span>
              <button type="button" className="botao" onClick={aoIrParaConversas}>
                Atender agora
              </button>
            </div>
          ) : (
            <div className="contexto">
              {comVoce === 0 ? "A IA está cuidando de tudo" : "Ninguém esperando resposta"}
            </div>
          )}
        </div>

        <div className="metrica tingida dado">
          <div className="titulo">
            <IconeTendencia tamanho={15} className="icone" />
            Leads novos hoje
          </div>
          <div className="valor-com-linha">
            <div className="valor">{dados.contatos.hoje}</div>
            <MiniLinha valores={dados.serieNovosLeads.map((d) => d.quantidade)} />
          </div>
          <div className="contexto">
            <span className="selo-numero">{dados.contatos.semana}</span> nos últimos 7 dias
          </div>
        </div>

        <div className="metrica tingida acao">
          <div className="titulo">
            <IconeAgenda tamanho={15} className="icone" />
            Agendados nesta semana
          </div>
          <div className="valor">{dados.agenda.proximos7Dias}</div>
          <div className="contexto">
            <span className="selo-numero">{dados.agenda.marcadosPelaIa30}</span> marcados pela IA
            em 30 dias
          </div>
        </div>

        <div className="metrica tingida progresso">
          <div className="titulo">
            <IconeCheck tamanho={15} className="icone" />
            Resolvidas pela IA
          </div>
          <div className="valor">
            {resolvidas === null ? "–" : autonomiaAnimada}
            {resolvidas !== null && <span className="unidade">%</span>}
          </div>
          <div className="contexto">
            {resolvidas === null ? "Pouca conversa ainda para medir" : "sem precisar chamar você"}
          </div>
        </div>
      </div>

      <div className="painel-grade">
        <div className="painel-coluna">
          <section className="bloco grafico-leads">
            <div className="bloco-topo">
              <h3>Leads novos por dia</h3>
              <div className="alternador pequeno" role="tablist" aria-label="Período">
                {([7, 14] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="tab"
                    aria-selected={dias === n}
                    onClick={() => setDias(n)}
                  >
                    {n} dias
                  </button>
                ))}
              </div>
            </div>

            <div className="total-periodo">
              <span className="valor-grande">{totalDaSerie}</span>
              <span className="legenda">
                {totalDaSerie === 1 ? "lead novo" : "leads novos"} nos últimos {dias} dias
              </span>
            </div>

            <div className="grafico" onMouseLeave={() => setDiaEmFoco(null)}>
              {serie.map((dia) => {
                const foco = dia.dia === emFoco?.dia;
                return (
                  <div
                    className={`barra-coluna${foco ? " em-foco" : ""}`}
                    key={dia.dia}
                    onMouseEnter={() => setDiaEmFoco(dia.dia)}
                    title={`${dia.rotulo}: ${dia.quantidade} ${dia.quantidade === 1 ? "lead" : "leads"}`}
                  >
                    <div className="area-barra">
                      <div
                        className="barra"
                        style={{ height: `${Math.round((dia.quantidade / picoDaSerie) * 100)}%` }}
                      >
                        {foco && <span className="balao-valor">{dia.quantidade}</span>}
                      </div>
                    </div>
                    <div className={`rotulo-dia${dia.dia === hoje ? " hoje" : ""}`}>
                      {dia.dia === hoje ? "Hoje" : dia.rotulo.slice(0, 2)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bloco">
            <h3>Atendimento nos últimos 30 dias</h3>
            <dl className="numeros-lado">
              <div>
                <dt>Conversas</dt>
                <dd>{dados.autonomia.conversas30.toLocaleString("pt-BR")}</dd>
              </div>
              <div>
                <dt>Precisaram de você</dt>
                <dd>{dados.autonomia.precisaramDeHumano.toLocaleString("pt-BR")}</dd>
              </div>
              <div>
                <dt>Respostas da IA</dt>
                <dd>{dados.mensagens.enviadasPelaIa.toLocaleString("pt-BR")}</dd>
              </div>
              <div>
                <dt>Respostas suas</dt>
                <dd>{dados.mensagens.enviadasPorHumano.toLocaleString("pt-BR")}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="painel-coluna">
          <section className="bloco">
            <div className="bloco-topo">
              <h3>Funil agora</h3>
              <span className="contagem-bloco">{totalNoFunil}</span>
            </div>

            {dados.funil.map((estagio) => (
              <div className="linha-funil" key={estagio.chave}>
                <div className="linha-funil-textos">
                  <span className="nome">{estagio.nome}</span>
                  <span className="quantidade">{estagio.total}</span>
                </div>
                <div className="trilho">
                  <div
                    className={`preenchimento${estagio.ganho ? " ganho" : ""}${
                      estagio.perdido ? " perdido" : ""
                    }`}
                    style={{
                      transform: `scaleX(${totalNoFunil > 0 ? estagio.total / totalNoFunil : 0})`,
                    }}
                  />
                </div>
              </div>
            ))}
          </section>

          <section className="bloco tingido-acao">
            <h3>Comparecimento</h3>

            {dados.agenda.percentualComparecimento === null ? (
              <p className="vazio">Nenhum atendimento encerrado nos últimos 30 dias.</p>
            ) : (
              <>
                <div className="valor-grande">
                  {comparecimentoAnimado}
                  <span className="unidade">%</span>
                </div>
                <div className="medidor">
                  <div
                    className="preenchimento"
                    style={{ transform: `scaleX(${dados.agenda.percentualComparecimento / 100})` }}
                  />
                </div>
                <p className="legenda-comparecimento">
                  {dados.agenda.compareceu} compareceram, {dados.agenda.faltou} faltaram nos
                  últimos 30 dias
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

/** A linha dos 14 dias no cartão de leads. SVG simples, sem biblioteca. */
function MiniLinha({ valores }: { valores: number[] }) {
  if (valores.length < 2) return null;
  const pico = Math.max(1, ...valores);
  const pontos = valores
    .map((v, i) => `${(i / (valores.length - 1)) * 100},${28 - (v / pico) * 24 - 2}`)
    .join(" ");
  return (
    <svg className="mini-linha" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pontos} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
