/**
 * Small talk: greetings, thanks, goodbyes, "who are you?".
 * These are answered instantly with friendly fixed replies: no search, no LLM call, no free-tier quota used,
 * and never "I couldn't find that in our documents" for a simple "hi".
 * Only messages that are *entirely* small talk match. "Hi, what are your hours?" goes to the normal pipeline
 * (the prompt tells the model to greet back first).
 */
import type { Lang } from "./prompt";

export type SmallTalkKind = "greeting" | "howareyou" | "thanks" | "bye" | "who" | "ack";

export interface SmallTalk {
  kind: SmallTalkKind;
  lang: Lang;
  answer: string;
}

/** lowercase, strip accents, punctuation and emoji, collapse spaces */
export function normalizeChat(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const GREET =
  "(hi|hii+|hello|helo|hey|hiya|howdy|greetings|good (morning|afternoon|evening|day)|morning|" +
  "hola|buenas|buenos dias|buen dia|buenas tardes|buenas noches|saludos|" +
  "salam|salaam|assalamu alaikum|asalamu alaikum|salam alaikum|marhaba)";
const TAIL = "( there| everyone| team| cosmo( dental)?| doctor| doc)?";

const PATTERNS: [SmallTalkKind, RegExp][] = [
  ["howareyou", new RegExp(`^(${GREET}${TAIL} )?(how are you( doing| today)?|how r u|how are u|hows it going|how is it going|whats up|sup|como estas|como esta( usted)?|que tal|como le va)$`)],
  ["greeting", new RegExp(`^${GREET}${TAIL}$`)],
  ["thanks", /^((ok|okay|great|perfect|awesome|cool|perfecto|muy bien) )?(thanks|thank you|thankyou|thx|ty|thanks a lot|thank you so much|thank you very much|many thanks|gracias|muchas gracias|mil gracias)( (so|very) much)?( (for|por) (the|your|su|la) (help|info|information|ayuda|informacion))?$/],
  ["bye", /^(bye|bye bye|goodbye|good bye|see you|see ya|see you later|have a (good|nice|great) (day|one)|take care|adios|hasta luego|hasta pronto|chao|chau|nos vemos)$/],
  ["who", /^(who are you|what are you|are you (a |an )?(bot|robot|human|real person|real|ai|machine)|am i talking to (a )?(bot|robot|human|person)|quien eres|quien es usted|que eres|eres (un )?(bot|robot|humano|persona real))$/],
  ["ack", /^(ok|okay|k|cool|great|nice|got it|alright|all right|sounds good|perfect|vale|esta bien|perfecto|entendido|de acuerdo)$/],
];

const SPANISH = /\b(hola|buenas|buenos|buen|saludos|como|que tal|gracias|adios|hasta|chao|chau|nos vemos|quien|eres|usted|vale|esta bien|perfecto|entendido|de acuerdo|le va|mil|muchas|por|ayuda|informacion)\b/;

const REPLIES: Record<SmallTalkKind, Record<Lang, string>> = {
  greeting: {
    en: "Hi there! \u{1F44B} Welcome to Cosmo Dental. How can I help you today? You can ask me about our hours, services, dentists or insurance.",
    es: "¡Hola! \u{1F44B} Bienvenido a Cosmo Dental. ¿En qué le puedo ayudar hoy? Puede preguntarme sobre nuestro horario, servicios, dentistas o seguros.",
  },
  howareyou: {
    en: "I'm doing great, thanks for asking! \u{1F60A} How can I help you today?",
    es: "¡Muy bien, gracias por preguntar! \u{1F60A} ¿En qué le puedo ayudar hoy?",
  },
  thanks: {
    en: "You're very welcome! Is there anything else I can help you with?",
    es: "¡Con mucho gusto! ¿Hay algo más en lo que le pueda ayudar?",
  },
  bye: {
    en: "Thanks for chatting with Cosmo Dental. Have a wonderful day! \u{1F44B}",
    es: "Gracias por escribirnos. ¡Que tenga un excelente día! \u{1F44B}",
  },
  who: {
    en: "I'm Cosmo Dental's virtual assistant, an AI that answers questions using the clinic's own information. For anything personal, our team is happy to help at (708) 345-6313.",
    es: "Soy el asistente virtual de Cosmo Dental, una IA que responde preguntas con la información de la clínica. Para cualquier asunto personal, nuestro equipo le ayuda con gusto al (708) 345-6313.",
  },
  ack: {
    en: "Great! Let me know if there's anything else I can help with.",
    es: "¡Perfecto! Avíseme si hay algo más en lo que le pueda ayudar.",
  },
};

export function smallTalk(question: string, pageLang: Lang): SmallTalk | null {
  const text = normalizeChat(question);
  if (!text || text.length > 60) return null;
  for (const [kind, re] of PATTERNS) {
    if (re.test(text)) {
      // Answer in the language the person wrote in ("hola" on the English page gets Spanish).
      const lang: Lang = SPANISH.test(text) ? "es" : /^(hi|hello|hey|thanks|thank|bye|good|who|how|ok|okay)\b/.test(text) ? "en" : pageLang;
      return { kind, lang, answer: REPLIES[kind][lang] };
    }
  }
  return null;
}
