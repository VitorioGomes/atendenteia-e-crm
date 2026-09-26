/**
 * Numero de telefone e a chave do contato. Se a normalizacao falhar, o CRM cria
 * contatos duplicados e o dono perde a confianca no sistema - entao vale um arquivo so pra isso.
 *
 * Formato interno: so digitos, com DDI. Ex.: 5511987654321
 */

/** "5511987654321@s.whatsapp.net" -> "5511987654321" */
export function jidParaTelefone(jid: string): string {
  const semSufixo = jid.split("@")[0] ?? jid;
  // Grupos vem como "1234567890-1234567890"; pegamos so a primeira parte.
  const semGrupo = semSufixo.split("-")[0] ?? semSufixo;
  // Numeros de dispositivo vem como "5511999999999:12"
  const semDispositivo = semGrupo.split(":")[0] ?? semGrupo;
  return normalizarTelefone(semDispositivo);
}

export function ehGrupo(jid: string): boolean {
  return jid.endsWith("@g.us");
}

/**
 * Normaliza para DDI+DDD+numero. Assume Brasil quando o DDI nao vem.
 *
 * Cuidado historico: o WhatsApp entrega numeros de celular brasileiros SEM o nono digito
 * em varios casos (DDD <= 30, contas antigas). Guardamos exatamente como o WhatsApp entrega,
 * porque e assim que precisamos responder; a busca no CRM e que tolera as duas formas.
 */
export function normalizarTelefone(entrada: string): string {
  const digitos = entrada.replace(/\D/g, "");
  if (!digitos) return "";
  if (digitos.startsWith("55")) return digitos;
  // 10 ou 11 digitos = numero brasileiro sem DDI
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

/** Variantes com e sem o nono digito, para nao duplicar contato. */
export function variantesTelefone(telefone: string): string[] {
  const t = normalizarTelefone(telefone);
  if (!t.startsWith("55")) return [t];

  const ddd = t.slice(2, 4);
  const resto = t.slice(4);
  const variantes = new Set<string>([t]);

  if (resto.length === 9 && resto.startsWith("9")) variantes.add(`55${ddd}${resto.slice(1)}`);
  if (resto.length === 8) variantes.add(`55${ddd}9${resto}`);

  return [...variantes];
}

/** "5511987654321" -> "(11) 98765-4321" — usado na tela do CRM. */
export function formatarTelefone(telefone: string): string {
  const t = normalizarTelefone(telefone);
  if (!t.startsWith("55")) return t;

  const ddd = t.slice(2, 4);
  const resto = t.slice(4);
  if (resto.length === 9) return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`;
  if (resto.length === 8) return `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`;
  return t;
}

export function telefoneParaJid(telefone: string): string {
  return `${normalizarTelefone(telefone)}@s.whatsapp.net`;
}
