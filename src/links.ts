/**
 * Action buttons shown under an answer ("Book online", "Call", "Get directions").
 * The LLM never writes these: they come from this fixed list of verified clinic links, chosen by topic,
 * so a link can never be invented. To change a link, edit CLINIC_LINKS only.
 */
import type { Lang } from "./prompt";
import type { SmallTalkKind } from "./smalltalk";

export type LinkKind = "book" | "call" | "directions";

export interface ActionLink {
  kind: LinkKind;
  label: string;
  url: string;
}

const SITE = "https://www.cosmodentalusa.com";

export const CLINIC_LINKS: Record<LinkKind, { url: Record<Lang, string>; label: Record<Lang, string> }> = {
  book: {
    // Appointment request form (from the clinic FAQ: "Request an appointment online at .../contact/")
    url: { en: `${SITE}/contact/`, es: `${SITE}/es/contact/` },
    label: { en: "Book online", es: "Pedir cita en línea" },
  },
  call: {
    url: { en: "tel:+17083456313", es: "tel:+17083456313" },
    label: { en: "Call (708) 345-6313", es: "Llamar al (708) 345-6313" },
  },
  directions: {
    url: {
      en: "https://www.google.com/maps/search/?api=1&query=Cosmo+Dental+159+E+North+Ave+Northlake+IL+60164",
      es: "https://www.google.com/maps/search/?api=1&query=Cosmo+Dental+159+E+North+Ave+Northlake+IL+60164",
    },
    label: { en: "Get directions", es: "Cómo llegar" },
  },
};

const TOPICS: [LinkKind, RegExp][] = [
  ["book", /\b(book|booking|appointment|appt|schedule|reschedul\w*|cancel\w*|new patients?|first visit|consultation|consult|check ?up|cleaning|visit|cita|citas|agendar|reservar|programar|pacientes? nuevos?|nuevos? pacientes?|consulta|limpieza|primera visita)\b/],
  ["directions", /\b(where|address|location|located|directions?|parking|park|map|find you|get there|donde|direccion|ubicad\w*|ubicacion|como llegar|estacionamiento|mapa)\b/],
  ["call", /\b(emergenc\w*|pain|hurts?|toothache|swell\w*|bleed\w*|broken|chipped|urgent|insurance|cost|price|prices|pay|payment|financing|walk ?ins?|same day|dolor|duele|emergencia|urgente|hinchazon|sangrado|seguro|precio|costo|pago)\b/],
];

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function make(kind: LinkKind, lang: Lang): ActionLink {
  return { kind, label: CLINIC_LINKS[kind].label[lang], url: CLINIC_LINKS[kind].url[lang] };
}

/** Pick up to 2 buttons for an answer, based on what the question and answer are about. */
export function suggestLinks(question: string, answer: string, answered: boolean, lang: Lang): ActionLink[] {
  if (!answered) return [make("call", lang)]; // "please call the clinic" → give them the button
  const text = strip(`${question} ${answer}`);
  const kinds = TOPICS.filter(([, re]) => re.test(text)).map(([k]) => k);
  return kinds.slice(0, 2).map((k) => make(k, lang));
}

/** Buttons for small-talk replies: greetings get the two most useful actions. */
export function smallTalkLinks(kind: SmallTalkKind, lang: Lang): ActionLink[] {
  return kind === "greeting" || kind === "howareyou" ? [make("book", lang), make("call", lang)] : [];
}
