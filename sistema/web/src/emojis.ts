/**
 * Emojis do seletor da caixa de entrada.
 *
 * Uma seleção, não a lista inteira do Unicode (são mais de 3.600). Quem responde
 * cliente usa sempre os mesmos poucos: rosto, joinha, coração, e os objetos do
 * atendimento — agenda, relógio, dinheiro, localização. Uma biblioteca de emoji
 * completa pesaria mais que o CRM inteiro. Quem quiser outro tem o teclado do
 * sistema (Windows + ponto, no Windows).
 */

export interface GrupoEmoji {
  nome: string;
  emojis: string[];
}

const separar = (texto: string): string[] => texto.trim().split(/\s+/);

export const GRUPOS_EMOJI: GrupoEmoji[] = [
  {
    nome: "Rostos",
    emojis: separar(`
      😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😌 😍 🥰 😘 😗 😋 😛 😜 🤪 😝
      🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😴 😪 🤤 😷 🤒 🤕
      🥵 🥶 😵 🤯 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢
      😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 🤡 🙈 🙉 🙊
    `),
  },
  {
    nome: "Gestos",
    emojis: separar(`
      👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏
      👏 🙌 👐 🤲 💪 ✍️ 💅 🫶 👀 🧠 🦷 👄 🙋 🙋‍♀️ 🙋‍♂️ 🤷 🤷‍♀️ 🤷‍♂️ 🙆‍♀️ 🙅‍♀️
      💁‍♀️ 🧏‍♀️ 👩‍⚕️ 👨‍⚕️ 👩‍💼 👨‍💼
    `),
  },
  {
    nome: "Corações e símbolos",
    emojis: separar(`
      ❤️ 🧡 💛 💚 💙 💜 🤍 🖤 🤎 💕 💞 💓 💗 💖 💘 💝 ❣️ 💔 ✨ ⭐ 🌟 💫
      🔥 💯 ✅ ☑️ ✔️ ❌ ⚠️ ❗ ❓ ‼️ ⁉️ 🆗 🆕 🆓 🔝 ➡️ ⬅️ ⬆️ ⬇️ 🔴 🟢 🟡 🔵
    `),
  },
  {
    nome: "Atendimento",
    emojis: separar(`
      📅 🗓️ ⏰ ⏳ ⌛ 🕐 📍 🗺️ 🏥 🏢 🏠 🚗 🅿️ 📞 📱 💬 📩 📧 📎 📄 📋 📝
      📌 🔗 💳 💰 💵 🧾 🏷️ 🎁 🎉 🎊 🎂 🩺 💉 💊 🩹 🦴 🧴 🧼 💆‍♀️ 💇‍♀️ 💄
      💍 👗 ☕ 🍰 🌸 🌹 🌷 🌻 ☀️ 🌙 🌧️ ⚡
    `),
  },
];

const CHAVE_RECENTES = "crm.emojis-recentes";
const MAX_RECENTES = 24;

/** Os últimos usados. Só conveniência deste navegador: se o armazenamento falhar, some. */
export function emojisRecentes(): string[] {
  try {
    const lidos = JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? "[]");
    return Array.isArray(lidos) ? lidos.filter((e) => typeof e === "string").slice(0, MAX_RECENTES) : [];
  } catch {
    return [];
  }
}

export function lembrarEmoji(emoji: string): void {
  try {
    const lista = [emoji, ...emojisRecentes().filter((e) => e !== emoji)].slice(0, MAX_RECENTES);
    localStorage.setItem(CHAVE_RECENTES, JSON.stringify(lista));
  } catch {
    /* sem armazenamento: o seletor funciona igual, só não lembra */
  }
}
