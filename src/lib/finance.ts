// Finanzas: cálculos del panel de la agencia (integraly/panel.html, bloque
// "CÁLCULO Y RENDER"), copiados tal cual para que los números cuadren.
// Funciones puras: no leen de la base de datos ni del DOM.
//
// Convenio de la casa: la economía de proyecto va sobre el PRECIO ACORDADO en
// €. La facturación total es la suma de lo acordado por proyecto, no de las
// facturas (las facturas guardan el USD real emitido).

export type FinProject = {
  id: string;
  name: string;
  status: "activo" | "cerrado";
  project_id: string | null;
  agreed_eur: number;
  collected_eur: number;
  impl_note: string;
  dev_usd: number | null;
  dev_eur: number | null;
  dev_who: string;
  dev_paid: boolean;
  dev_note: string;
  position: number;
};

export type FinRecurrence = {
  id: string;
  fin_project_id: string;
  slot: 1 | 2;
  title: string;
  client_eur_month: number;
  dev_usd_month: number;
  dev_txt: string;
  infra_eur_month: number;
  active: boolean;
};

export type FinInvoice = {
  id: string;
  number: string;
  client: string;
  concept: string;
  date: string; // YYYY-MM-DD
  eur: number;
  usd: number | null;
  usd_received: number | null;
  aprox: string | null;
  kind: "implementacion" | "mensualidad";
  status: "cobrada" | "pendiente" | "parcial" | "abono";
  date_txt: string | null;
};

export type FinReceivable = {
  id: string;
  project: string;
  concept: string;
  eur: number;
  invoiced: boolean;
  in_kpi: boolean;
  position: number;
};

// Supabase devuelve los numeric como texto: se pasan a número al leer
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function parseProject(r: Record<string, unknown>): FinProject {
  return {
    ...(r as unknown as FinProject),
    agreed_eur: num(r.agreed_eur),
    collected_eur: num(r.collected_eur),
    dev_usd: numOrNull(r.dev_usd),
    dev_eur: numOrNull(r.dev_eur),
  };
}
export function parseRecurrence(r: Record<string, unknown>): FinRecurrence {
  return {
    ...(r as unknown as FinRecurrence),
    client_eur_month: num(r.client_eur_month),
    dev_usd_month: num(r.dev_usd_month),
    infra_eur_month: num(r.infra_eur_month),
  };
}
export function parseInvoice(r: Record<string, unknown>): FinInvoice {
  return {
    ...(r as unknown as FinInvoice),
    eur: num(r.eur),
    usd: numOrNull(r.usd),
    usd_received: numOrNull(r.usd_received),
  };
}
export function parseReceivable(r: Record<string, unknown>): FinReceivable {
  return { ...(r as unknown as FinReceivable), eur: num(r.eur) };
}

// ---------------------------------------------------------------------------
// Formato (igual que el panel)
// ---------------------------------------------------------------------------
export const eur0 = (n: number) => Math.round(n).toLocaleString("de-DE") + "€";
export const usd0 = (n: number) => "$" + n.toLocaleString("de-DE");
export const usd2 = (n: number) =>
  "$" + n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pctS = (n: number) => Math.round(n) + "%";
/** Color del margen: teal si ≥ 50 %, amarillo si no. */
export const marginTone = (pct: number) => (pct >= 50 ? "teal" : "yellow");

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const fFecha = (f: string) => {
  const p = f.split("-");
  return `${+p[2]} ${MESES[+p[1] - 1]} ${p[0]}`;
};
export const monthLabel = (m: string) => `${cap(MESES[+m.slice(5, 7) - 1])} ${m.slice(0, 4)}`;

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------
/** Coste dev en €: el importe en € si lo hay; si no, USD × tipo de cambio. */
export const devE = (p: FinProject, fx: number) => (p.dev_eur != null ? p.dev_eur : (p.dev_usd || 0) * fx);
export const pendDe = (p: FinProject) => p.agreed_eur - p.collected_eur;

export function recurrencesOf(p: FinProject, recs: FinRecurrence[]) {
  return recs.filter((r) => r.fin_project_id === p.id).sort((a, b) => a.slot - b.slot);
}

/** Primer tramo de recurrencia (el que cuenta para el MRR, como `rec` en el panel). */
const rec1 = (p: FinProject, recs: FinRecurrence[]) => recurrencesOf(p, recs).find((r) => r.slot === 1) || null;

export function computeKpis(projects: FinProject[], recs: FinRecurrence[]) {
  const activos = projects.filter((p) => p.status === "activo");
  const facturado = projects.reduce((s, p) => s + p.agreed_eur, 0);
  const cobrado = projects.reduce((s, p) => s + p.collected_eur, 0);
  const pendiente = facturado - cobrado;
  const mrrTotal = activos.reduce((s, p) => s + (rec1(p, recs)?.client_eur_month || 0), 0);
  const mrrActivo = activos.reduce((s, p) => {
    const r = rec1(p, recs);
    return s + (r && r.active ? r.client_eur_month : 0);
  }, 0);
  const pendLista = projects
    .filter((p) => pendDe(p) > 0)
    .sort((a, b) => pendDe(b) - pendDe(a))
    .map((p) => ({ name: p.name, eur: pendDe(p) }));
  const mrrPend = activos
    .map((p) => ({ p, r: rec1(p, recs) }))
    .filter(({ r }) => r && !r.active)
    .map(({ p, r }) => ({ name: p.name, eur: r!.client_eur_month }));
  const mrrAct = activos.filter((p) => rec1(p, recs)?.active).map((p) => p.name);
  return {
    count: projects.length,
    facturado,
    cobrado,
    pendiente,
    cobradoPct: facturado ? (cobrado / facturado) * 100 : 0,
    mrrTotal,
    mrrActivo,
    pendLista,
    mrrPend,
    mrrAct,
  };
}

/** Margen mensual de un tramo de recurrencia. */
export function recurrenceMargin(r: FinRecurrence, fx: number) {
  const coste = r.dev_usd_month * fx + (r.infra_eur_month || 0);
  const margen = r.client_eur_month - coste;
  const pct = r.client_eur_month ? (margen / r.client_eur_month) * 100 : 0;
  const detalle = [
    r.dev_txt ? r.dev_txt : r.dev_usd_month ? `dev ${usd0(r.dev_usd_month)}` : null,
    r.infra_eur_month ? `infra ${r.infra_eur_month}€` : null,
  ]
    .filter(Boolean)
    .join(" + ");
  return { coste, margen, pct, detalle };
}

/** Margen de implementación de un proyecto (acordado − coste dev). */
export function projectMargin(p: FinProject, fx: number) {
  const de = devE(p, fx);
  const margen = p.agreed_eur - de;
  const pct = p.agreed_eur ? (margen / p.agreed_eur) * 100 : 0;
  const bar = p.agreed_eur ? (p.collected_eur / p.agreed_eur) * 100 : 0;
  const devTxt = [
    p.dev_usd ? `${usd0(p.dev_usd)} (≈${eur0(de)})` : eur0(de),
    p.dev_who,
    p.dev_paid ? "pagado ✓" : null,
    p.dev_note,
  ]
    .filter(Boolean)
    .join(" · ");
  return { de, margen, pct, bar, pend: pendDe(p), devTxt };
}

/** Resumen por mes, calculado desde las facturas. */
export function computePeriods(invoices: FinInvoice[], fx: number) {
  const meses = [...new Set(invoices.map((f) => f.date.slice(0, 7)))].sort();
  const suma = (m: string, filtro: (f: FinInvoice) => boolean) =>
    invoices.filter((f) => f.date.slice(0, 7) === m && filtro(f)).reduce((s, f) => s + f.eur, 0);
  // Cobrado = Implementación + Mensualidades (lo que no es mensualidad cuenta como implementación)
  const cobradaMens = (f: FinInvoice) => f.status === "cobrada" && f.kind === "mensualidad";
  const cobradaImpl = (f: FinInvoice) => f.status === "cobrada" && f.kind !== "mensualidad";
  // Comisiones bancarias = USD emitido − USD recibido (sobre todo wires), en €
  const comisiones = (m: string) =>
    invoices
      .filter((f) => f.date.slice(0, 7) === m && f.status === "cobrada" && f.usd_received != null)
      .reduce((s, f) => s + Math.max(0, (f.usd || 0) - (f.usd_received || 0)) * fx, 0);
  return meses.map((m) => ({
    month: m,
    label: monthLabel(m),
    facturado: suma(m, () => true),
    cobrado: suma(m, (f) => f.status === "cobrada"),
    cobradoImpl: suma(m, cobradaImpl),
    cobradoMens: suma(m, cobradaMens),
    comisiones: comisiones(m),
    // Vacías, como en el panel (fase posterior: tabla de pagos al dev)
    gastosDev: null as number | null,
    beneficioNeto: null as number | null,
  }));
}

/** Chequeo de integridad: los cobros pendientes (en KPI) deben sumar lo pendiente por proyecto. */
export function integrityCheck(projects: FinProject[], receivables: FinReceivable[]) {
  const pendiente = projects.reduce((s, p) => s + p.agreed_eur - p.collected_eur, 0);
  const cobrosKpi = receivables.filter((c) => c.in_kpi).reduce((s, c) => s + c.eur, 0);
  const diff = Math.abs(cobrosKpi - pendiente);
  return { ok: diff <= 1, cobrosKpi, pendiente, diff };
}

/** Facturas de la más reciente a la más antigua. */
export const sortInvoices = (invoices: FinInvoice[]) => [...invoices].sort((a, b) => b.date.localeCompare(a.date));

/** Importe tal como lo muestra el panel. */
export function invoiceAmount(f: FinInvoice) {
  if (f.status === "abono") return { main: "—", sub: "" };
  if (f.usd) return { main: usd2(f.usd), sub: `(${eur0(f.eur)})` };
  if (f.aprox) return { main: `~${eur0(f.eur)}`, sub: `(${f.aprox})` };
  return { main: eur0(f.eur), sub: "" };
}
