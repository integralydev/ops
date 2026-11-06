// Portal del cliente: tipos de lo que devuelve portal_home() y los textos en
// los dos idiomas (castellano y catalán, según el cliente).

export type PortalLang = "es" | "ca";

export interface PortalPerson {
  id: string;
  name: string | null;
  color: string | null;
  /** Responsable del proyecto */
  lead: boolean;
}

export interface PortalFile {
  id: string;
  name: string;
  type: string | null;
  size: number | null;
  at: string;
}

export interface PortalProject {
  id: string;
  name: string;
  status: string;
  next_step: string | null;
  updated_at: string;
  team: PortalPerson[];
  files: PortalFile[];
}

export interface PortalHome {
  preview: boolean;
  me: string | null;
  client: { id: string; name: string; referral_code: string | null; lang: PortalLang };
  projects: PortalProject[];
}

/** Fases en las que el cliente ve el proyecto (igual que portal_visible_status en SQL). */
export const PORTAL_STATUSES = ["propuesta", "presupuesto", "desarrollo", "testing", "mantenimiento"];
/** Ya es cliente de verdad (ha firmado): se le enseña "Recomiéndanos". */
export const SIGNED_STATUSES = ["desarrollo", "testing", "mantenimiento"];

export const CONTACT_EMAIL = "hello@integralyaisolutions.com";

export function referralLink(code: string) {
  return `https://integralyaisolutions.com/contacto/?ref=${encodeURIComponent(code)}`;
}

// Recorrido que ve el cliente (sin la jerga interna)
export const PORTAL_PATH: { value: string; es: string; ca: string }[] = [
  { value: "propuesta", es: "Propuesta", ca: "Proposta" },
  { value: "desarrollo", es: "Desarrollo", ca: "Desenvolupament" },
  { value: "testing", es: "Pruebas", ca: "Proves" },
  { value: "mantenimiento", es: "En marcha", ca: "En marxa" },
];

/** Posición en PORTAL_PATH ("presupuesto" cuenta como propuesta). */
export function portalStep(status: string) {
  return PORTAL_PATH.findIndex((p) => p.value === (status === "presupuesto" ? "propuesta" : status));
}

export const T = {
  es: {
    hello: (n: string) => `Hola, ${n}`,
    helloNoName: "Hola",
    intro: "Aquí tienes cómo va tu proyecto con Integraly.",
    introMany: "Aquí tienes cómo van tus proyectos con Integraly.",
    phase: "Dónde estamos",
    next: "Siguiente paso",
    nextEmpty: "Te iremos contando aquí los siguientes pasos.",
    team: "Tu equipo",
    lead: "Responsable del proyecto",
    contact: "Dirección",
    docs: "Documentos",
    docsEmpty: "Aquí aparecerán los documentos que compartamos contigo.",
    open: "Abrir",
    opening: "Abriendo…",
    questions: "¿Alguna duda? Escríbenos a",
    referTitle: "Recomiéndanos",
    referText:
      "Si conoces a una empresa a la que le pueda ir bien lo que hacemos, compártele este enlace. Por cada empresa que empiece a trabajar con nosotros, te descontamos una parte de tu mantenimiento mientras siga activa.",
    copy: "Copiar enlace",
    copied: "Enlace copiado",
    logout: "Salir",
    empty: "Todavía no hay nada que enseñarte aquí. Te avisaremos cuando lo haya.",
    preview: "Vista previa: así lo ve el cliente",
    back: "Volver al OPS",
    updated: "Actualizado",
  },
  ca: {
    hello: (n: string) => `Hola, ${n}`,
    helloNoName: "Hola",
    intro: "Aquí tens com va el teu projecte amb Integraly.",
    introMany: "Aquí tens com van els teus projectes amb Integraly.",
    phase: "On som",
    next: "Següent pas",
    nextEmpty: "T'anirem explicant aquí els següents passos.",
    team: "El teu equip",
    lead: "Responsable del projecte",
    contact: "Direcció",
    docs: "Documents",
    docsEmpty: "Aquí apareixeran els documents que compartim amb tu.",
    open: "Obrir",
    opening: "Obrint…",
    questions: "Algun dubte? Escriu-nos a",
    referTitle: "Recomana'ns",
    referText:
      "Si coneixes una empresa a qui li pugui anar bé el que fem, comparteix-li aquest enllaç. Per cada empresa que comenci a treballar amb nosaltres, et descomptem una part del manteniment mentre segueixi activa.",
    copy: "Copiar enllaç",
    copied: "Enllaç copiat",
    logout: "Sortir",
    empty: "Encara no hi ha res a ensenyar-te aquí. T'avisarem quan n'hi hagi.",
    preview: "Vista prèvia: així ho veu el client",
    back: "Tornar a l'OPS",
    updated: "Actualitzat",
  },
} as const;
