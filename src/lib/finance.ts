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

export type RecurrenceStatus = "activa" | "por_activar" | "cancelada";

export type FinRecurrence = {
  id: string;
  fin_project_id: string;
  slot: 1 | 2;
  title: string;
  client_eur_month: number;
  dev_usd_month: number;
  dev_txt: string;
  infra_eur_month: number;
  /** Sincronizado con status (activa ⇔ true). */
  active: boolean;
  /** Calendario: AAAA-MM. Sin start_month = sin calendario (cuenta desde ya). */
  start_month?: string | null;
  end_month?: string | null;
  billing_day?: number | null;
  method?: "stripe" | "transferencia" | "otro" | null;
  status?: RecurrenceStatus;
  /** Stripe: los cobros se vinculan solos por Payment Link, customer o email. */
  stripe_payment_link?: string | null;
  stripe_customer_id?: string | null;
  stripe_email?: string | null;
  /** Días de pago: la entrada se espera en el día de cobro + estos días. */
  payment_terms_days?: number;
};

export type OutKind = "dev" | "comision" | "comercial" | "gasto_fijo" | "infra" | "otro";

export type FinScheduled = {
  id: string;
  direction: "entrada" | "salida";
  concept: string;
  counterparty: string;
  fin_project_id: string | null;
  amount_eur: number | null;
  amount_usd: number | null;
  frequency: "unica" | "mensual" | "trimestral" | "anual";
  date: string;
  end_date: string | null;
  certainty: "confirmado" | "probable";
  probability: number | null;
  note: string;
  closed: boolean;
  kind: OutKind;
  /** Cuotas (fechas) que no se pagaron o se movieron: fuera de la previsión. */
  skipped: string[];
};

export type FinPayment = {
  id: string;
  date: string;
  concept: string;
  counterparty: string;
  amount_eur: number | null;
  amount_usd: number | null;
  fin_project_id: string | null;
  kind: OutKind;
  scheduled_id: string | null;
  period: string | null;
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
  fin_project_id?: string | null;
  scheduled_id?: string | null;
  scheduled_period?: string | null;
  stripe_invoice_id?: string | null;
  /** Fecha de cobro (caja). Si está cobrada y no la tiene, vale `date`. */
  paid_date?: string | null;
};

export type FinStripePending = {
  id: string;
  stripe_invoice_id: string;
  customer_id: string;
  customer_name: string;
  number: string;
  concept: string;
  amount: number;
  currency: string;
  paid_date: string;
  payment_link: string;
  email: string;
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
  const rec = r as unknown as FinRecurrence;
  return {
    ...rec,
    client_eur_month: num(r.client_eur_month),
    dev_usd_month: num(r.dev_usd_month),
    infra_eur_month: num(r.infra_eur_month),
    status: rec.status || (rec.active ? "activa" : "por_activar"),
    payment_terms_days: num(r.payment_terms_days),
  };
}
export function parseScheduled(r: Record<string, unknown>): FinScheduled {
  return {
    ...(r as unknown as FinScheduled),
    amount_eur: numOrNull(r.amount_eur),
    amount_usd: numOrNull(r.amount_usd),
    probability: numOrNull(r.probability),
    kind: (r.kind as OutKind) || "otro",
    skipped: (r.skipped as string[]) || [],
  };
}
export function parseStripePending(r: Record<string, unknown>): FinStripePending {
  return { ...(r as unknown as FinStripePending), amount: num(r.amount) };
}
export function parsePayment(r: Record<string, unknown>): FinPayment {
  return { ...(r as unknown as FinPayment), amount_eur: numOrNull(r.amount_eur), amount_usd: numOrNull(r.amount_usd) };
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

/** Mes actual (local) como AAAA-MM. */
export function monthOf(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
/** ¿El mes cae dentro del calendario del tramo? (sin calendario = siempre). */
export function inCalendar(r: FinRecurrence, month: string) {
  if (!r.start_month) return true;
  return month >= r.start_month && (!r.end_month || month <= r.end_month);
}

/**
 * Tramo en curso de un proyecto (el que cuenta para el MRR): el que tiene
 * calendario y cubre el mes actual; si ninguno lo tiene, el tramo 1 (como en
 * la fase 1 y en el panel).
 */
export function currentRecurrence(p: FinProject, recs: FinRecurrence[], month = monthOf()) {
  const rs = recurrencesOf(p, recs).filter((r) => r.status !== "cancelada");
  const byCalendar = rs.find((r) => r.start_month && inCalendar(r, month));
  if (byCalendar) return byCalendar;
  return rs.find((r) => r.slot === 1 && !r.start_month) || rs.find((r) => r.slot === 1 && inCalendar(r, month)) || null;
}

export function computeKpis(projects: FinProject[], recs: FinRecurrence[], month = monthOf()) {
  const rec1 = (p: FinProject, rs: FinRecurrence[]) => currentRecurrence(p, rs, month);
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

/** Importe en € de un pago o programado (USD × tipo de cambio). */
/** Fecha de caja de una factura cobrada: la de cobro o, si no hay, la de factura. */
export const cashDate = (f: FinInvoice) => f.paid_date || f.date;

export const amountEur = (x: { amount_eur: number | null; amount_usd: number | null }, fx: number) =>
  x.amount_eur != null ? x.amount_eur : (x.amount_usd || 0) * fx;

/**
 * Resumen por mes, calculado desde las facturas (y, desde la fase 2, los
 * pagos hechos: Gastos dev = pagos de tipo dev; Beneficio neto = cobrado −
 * comisiones bancarias − todos los pagos hechos del mes). "Facturado" va por
 * la fecha de factura; lo cobrado y las comisiones, por la de cobro (caja).
 */
export function computePeriods(invoices: FinInvoice[], fx: number, payments?: FinPayment[]) {
  const meses = [
    ...new Set([
      ...invoices.map((f) => f.date.slice(0, 7)),
      ...invoices.filter((f) => f.status === "cobrada").map((f) => cashDate(f).slice(0, 7)),
      ...(payments || []).map((p) => p.date.slice(0, 7)),
    ]),
  ].sort();
  const paid = (m: string, filtro: (p: FinPayment) => boolean = () => true) =>
    (payments || []).filter((p) => p.date.slice(0, 7) === m && filtro(p)).reduce((s, p) => s + amountEur(p, fx), 0);
  const suma = (m: string, filtro: (f: FinInvoice) => boolean) =>
    invoices.filter((f) => f.date.slice(0, 7) === m && filtro(f)).reduce((s, f) => s + f.eur, 0);
  // Lo cobrado, por mes de cobro
  const cobradoEn = (m: string, filtro: (f: FinInvoice) => boolean) =>
    invoices.filter((f) => f.status === "cobrada" && cashDate(f).slice(0, 7) === m && filtro(f)).reduce((s, f) => s + f.eur, 0);
  // Cobrado = Implementación + Mensualidades (lo que no es mensualidad cuenta como implementación)
  const cobradaMens = (f: FinInvoice) => f.status === "cobrada" && f.kind === "mensualidad";
  const cobradaImpl = (f: FinInvoice) => f.status === "cobrada" && f.kind !== "mensualidad";
  // Comisiones bancarias = USD emitido − USD recibido (sobre todo wires), en €
  const comisiones = (m: string) =>
    invoices
      .filter((f) => f.status === "cobrada" && cashDate(f).slice(0, 7) === m && f.usd_received != null)
      .reduce((s, f) => s + Math.max(0, (f.usd || 0) - (f.usd_received || 0)) * fx, 0);
  return meses.map((m) => {
    const cobrado = cobradoEn(m, () => true);
    const com = comisiones(m);
    return {
      month: m,
      label: monthLabel(m),
      facturado: suma(m, () => true),
      cobrado,
      cobradoImpl: cobradoEn(m, cobradaImpl),
      cobradoMens: cobradoEn(m, cobradaMens),
      comisiones: com,
      // Sin pagos cargados quedan vacías, como en el panel
      gastosDev: payments ? paid(m, (p) => p.kind === "dev") : (null as number | null),
      salidas: payments ? paid(m) : (null as number | null),
      beneficioNeto: payments ? cobrado - com - paid(m) : (null as number | null),
    };
  });
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

// ---------------------------------------------------------------------------
// Previsión (fase 2): lo que va a entrar y salir
// ---------------------------------------------------------------------------
// Reglas:
// · Entradas confirmadas de un mes: mensualidades activas dentro de su
//   calendario (salvo que ese mes ya tengan factura de mensualidad: entonces
//   cuenta la factura), facturas pendientes de ese mes y programados de
//   entrada confirmados. Lo pendiente de meses pasados cuenta en el mes actual
//   como "vencido".
// · Salidas: SOLO programados de salida (el coste de dev/infra de los tramos
//   es una media para la rentabilidad y no entra nunca en la previsión).
// · Probable: aparte, nunca mezclado con lo confirmado; ponderado por su
//   probabilidad en el gráfico.
// · Meses pasados: entra = facturas cobradas; sale = pagos hechos.

export type Movement = {
  key: string;
  date: string; // YYYY-MM-DD (fecha prevista)
  direction: "entrada" | "salida";
  concept: string;
  counterparty: string;
  eur: number; // importe completo en €
  usd?: number | null;
  probable: boolean;
  probability: number; // 0-100 (100 si es confirmado)
  overdue: boolean; // de un mes pasado y aún sin cobrar / pagar
  source: "mensualidad" | "factura" | "programado";
  scheduledId?: string;
  period?: string; // fecha de la cuota del programado
  invoiceId?: string;
  recurrenceId?: string;
  finProjectId?: string | null;
  kind?: OutKind; // programados
  /** Mensualidades: fecha de cobro (la prevista lleva sumados los días de pago). */
  billedOn?: string;
  frequency?: FinScheduled["frequency"];
};

const pad = (n: number) => String(n).padStart(2, "0");
export const addMonths = (month: string, k: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + k, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};
/** Fecha del día `day` de un mes, sin pasarse del último día. */
const dayIn = (month: string, day: number) => `${month}-${pad(Math.min(day, lastDay(month)))}`;
/** Fecha ISO + n días. */
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return todayISO(d);
};
/**
 * Fecha de cobro + días de pago. Cada 30 días cuentan como un mes natural
 * (a 30 días, lo facturado el 1 de octubre se espera el 1 de noviembre).
 */
export const addTerms = (iso: string, days: number) => {
  const months = Math.floor(days / 30);
  if (!months) return addDays(iso, days);
  const [y, m, d] = iso.split("-").map(Number);
  const month = addMonths(`${y}-${pad(m)}`, months);
  return addDays(dayIn(month, d), days % 30);
};
export const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Cuotas de un programado entre dos meses (incluidos). */
export function occurrences(s: FinScheduled, fromMonth: string, toMonth: string) {
  if (s.closed) return [];
  const startMonth = s.date.slice(0, 7);
  const day = Number(s.date.slice(8, 10));
  if (s.frequency === "unica") return startMonth >= fromMonth && startMonth <= toMonth ? [s.date] : [];
  const step = s.frequency === "anual" ? 12 : s.frequency === "trimestral" ? 3 : 1;
  const out: string[] = [];
  for (let k = 0, m = startMonth; m <= toMonth && k < 600; k++, m = addMonths(startMonth, k * step)) {
    const date = dayIn(m, day);
    if (s.end_date && date > s.end_date) break;
    if (m >= fromMonth && !s.skipped?.includes(date)) out.push(date);
  }
  return out;
}

type ForecastInput = {
  fx: number;
  projects: FinProject[];
  recs: FinRecurrence[];
  invoices: FinInvoice[];
  scheduled: FinScheduled[];
  payments: FinPayment[];
};

/**
 * Movimientos previstos desde el mes actual hasta `toMonth`, más lo vencido
 * (meses anteriores sin cobrar/pagar, con fecha original y overdue = true).
 */
export function forecastMovements(input: ForecastInput, toMonth: string, today = todayISO()) {
  const { fx, projects, recs, invoices, scheduled, payments } = input;
  const cur = today.slice(0, 7);
  const out: Movement[] = [];
  const projName = (id?: string | null) => projects.find((p) => p.id === id)?.name || "";

  // Cuotas de programados ya saldadas (pago hecho o factura emitida)
  const done = new Set<string>();
  payments.forEach((p) => p.scheduled_id && p.period && done.add(`${p.scheduled_id}|${p.period}`));
  invoices.forEach((f) => f.scheduled_id && f.scheduled_period && done.add(`${f.scheduled_id}|${f.scheduled_period}`));

  // Días de pago del proyecto (los del tramo con más días)
  const terms = (projectId?: string | null) =>
    Math.max(0, ...recs.filter((r) => r.fin_project_id === projectId).map((r) => r.payment_terms_days || 0));

  // 1) Facturas pendientes (o parciales): se esperan en su fecha + los días de
  //    pago de la mensualidad de su proyecto (si la tiene); si ya pasó, vencidas
  for (const f of invoices) {
    if (f.status !== "pendiente" && f.status !== "parcial") continue;
    const expected = addTerms(f.date, terms(f.fin_project_id));
    if (expected.slice(0, 7) > toMonth) continue;
    out.push({
      key: `inv-${f.id}`,
      date: expected,
      direction: "entrada",
      concept: f.concept || `Factura ${f.number}`,
      counterparty: f.client,
      eur: f.eur,
      usd: f.usd,
      probable: false,
      probability: 100,
      overdue: expected.slice(0, 7) < cur,
      source: "factura",
      invoiceId: f.id,
      finProjectId: f.fin_project_id ?? null,
    });
  }

  // 2) Mensualidades activas dentro de su calendario, salvo que ese mes ya
  //    tengan factura de mensualidad del mismo proyecto
  const billedMonths = new Set(
    invoices.filter((f) => f.kind === "mensualidad" && f.fin_project_id).map((f) => `${f.fin_project_id}|${f.date.slice(0, 7)}`),
  );
  for (const r of recs) {
    if (r.status !== "activa") continue;
    const days = r.payment_terms_days || 0;
    // Con días de pago, lo cobrado en meses anteriores puede llegar este mes
    for (let m = addMonths(cur, -Math.ceil(days / 28)); m <= toMonth; m = addMonths(m, 1)) {
      if (!inCalendar(r, m)) continue;
      if (billedMonths.has(`${r.fin_project_id}|${m}`)) continue;
      const billedOn = dayIn(m, r.billing_day || 1);
      const date = addTerms(billedOn, days);
      if (date.slice(0, 7) < cur || date.slice(0, 7) > toMonth) continue;
      out.push({
        key: `rec-${r.id}-${m}`,
        billedOn,
        date,
        direction: "entrada",
        concept: `Mensualidad${r.title ? ` · ${r.title}` : ""}`,
        counterparty: projName(r.fin_project_id),
        eur: r.client_eur_month,
        probable: false,
        probability: 100,
        overdue: false,
        source: "mensualidad",
        recurrenceId: r.id,
        finProjectId: r.fin_project_id,
      });
    }
  }

  // 3) Programados (entradas y salidas, confirmados y probables)
  for (const s of scheduled) {
    // Lo vencido viene de cualquier fecha anterior; lo futuro, hasta toMonth
    for (const date of occurrences(s, s.date.slice(0, 7), toMonth)) {
      if (done.has(`${s.id}|${date}`)) continue;
      const probable = s.certainty === "probable";
      const overdue = date.slice(0, 7) < cur;
      if (overdue && probable) continue; // un probable que no llegó no es "vencido"
      out.push({
        key: `sch-${s.id}-${date}`,
        date,
        direction: s.direction,
        concept: s.concept,
        counterparty: s.counterparty || projName(s.fin_project_id),
        eur: amountEur(s, fx),
        usd: s.amount_usd,
        probable,
        probability: probable ? (s.probability ?? 50) : 100,
        overdue,
        source: "programado",
        scheduledId: s.id,
        period: date,
        finProjectId: s.fin_project_id,
        kind: s.kind,
        frequency: s.frequency,
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.direction === "entrada" ? -1 : 1));
}

export type MonthFlow = {
  month: string;
  label: string;
  isPast: boolean;
  isCurrent: boolean;
  inConfirmed: number; // entradas confirmadas (o reales, en el pasado)
  outConfirmed: number; // salidas comprometidas (o reales)
  inProbable: number; // ponderado
  outProbable: number; // ponderado
  net: number; // solo confirmado
  netWithProbable: number;
  // solo mes actual: ya llegado / ya pagado
  inArrived: number;
  outPaid: number;
};

/** Meses del gráfico: `back` meses reales, el actual y `ahead - 1` siguientes. */
export function monthlyFlows(input: ForecastInput, back = 4, ahead = 6, today = todayISO()) {
  const { fx, invoices, payments } = input;
  const cur = today.slice(0, 7);
  const last = addMonths(cur, ahead - 1);
  const moves = forecastMovements(input, last, today);
  // Caja: lo cobrado cuenta en el mes en que llegó
  const cobradas = (m: string) =>
    invoices.filter((f) => f.status === "cobrada" && cashDate(f).slice(0, 7) === m).reduce((s, f) => s + f.eur, 0);
  const pagados = (m: string) => payments.filter((p) => p.date.slice(0, 7) === m).reduce((s, p) => s + amountEur(p, fx), 0);

  const rows: MonthFlow[] = [];
  for (let k = -back; k < ahead; k++) {
    const m = addMonths(cur, k);
    const isPast = m < cur;
    const isCurrent = m === cur;
    // En el mes actual entra también lo vencido
    const inMonth = moves.filter((x) => (isCurrent ? x.date.slice(0, 7) <= m : x.date.slice(0, 7) === m));
    const conf = (dir: Movement["direction"]) => inMonth.filter((x) => x.direction === dir && !x.probable).reduce((s, x) => s + x.eur, 0);
    const prob = (dir: Movement["direction"]) =>
      inMonth.filter((x) => x.direction === dir && x.probable).reduce((s, x) => s + (x.eur * x.probability) / 100, 0);
    let inC: number, outC: number, inP = 0, outP = 0, arrived = 0, paid = 0;
    if (isPast) {
      inC = cobradas(m);
      outC = pagados(m);
    } else {
      arrived = isCurrent ? cobradas(m) : 0;
      paid = isCurrent ? pagados(m) : 0;
      inC = arrived + conf("entrada");
      outC = paid + conf("salida");
      inP = prob("entrada");
      outP = prob("salida");
    }
    rows.push({
      month: m,
      label: monthLabel(m),
      isPast,
      isCurrent,
      inConfirmed: inC,
      outConfirmed: outC,
      inProbable: inP,
      outProbable: outP,
      net: inC - outC,
      netWithProbable: inC - outC + inP - outP,
      inArrived: arrived,
      outPaid: paid,
    });
  }
  return rows;
}

/** Mensualidades "por activar": se avisan aparte, nunca en lo confirmado. */
export function pendingActivations(projects: FinProject[], recs: FinRecurrence[]) {
  return recs
    .filter((r) => r.status === "por_activar")
    .map((r) => ({ recurrence: r, name: projects.find((p) => p.id === r.fin_project_id)?.name || "", eur: r.client_eur_month }));
}

// --- Próximos 60 días, por mes ----------------------------------------------
// Una tarjeta por mes natural. Entra: las mensualidades juntas (una etiqueta
// por cliente) y lo demás fila a fila. Sale: los pagos únicos fila a fila y el
// resto agrupado por tipo. Lo probable, aparte. En el mes actual entran también
// lo ya cobrado / pagado y lo vencido, así que su "queda" es el mismo que el
// de "Este mes" y el de la línea del tiempo.

export type OutGroup = "gasto_fijo" | "infra_dev" | "comercial" | "comision" | "otro";
export const OUT_GROUPS: { id: OutGroup; label: string }[] = [
  { id: "gasto_fijo", label: "Gastos fijos" },
  { id: "infra_dev", label: "Infra y devs" },
  { id: "comercial", label: "Comercial" },
  { id: "comision", label: "Comisiones" },
  { id: "otro", label: "Otros" },
];
const groupOf = (kind?: OutKind): OutGroup =>
  kind === "dev" || kind === "infra" ? "infra_dev" : kind === "gasto_fijo" || kind === "comercial" || kind === "comision" ? kind : "otro";

export type CardLine = {
  key: string;
  date: string;
  concept: string;
  counterparty: string;
  eur: number;
  usd?: number | null;
  done: boolean; // ya cobrado / pagado
  overdue: boolean;
  movement?: Movement;
  invoice?: FinInvoice;
  payment?: FinPayment;
};

export type MonthCard = {
  month: string;
  label: string;
  isCurrent: boolean;
  mensualidades: CardLine[];
  mensTotal: number;
  otherIn: CardLine[];
  inTotal: number;
  singleOut: CardLine[];
  groups: { id: OutGroup; label: string; lines: CardLine[]; total: number }[];
  outTotal: number;
  probable: CardLine[];
  net: number;
  /** ¿Queda algo por cobrar o pagar (o algo probable)? */
  pending: boolean;
  /** Lo que no es habitual (la tarjeta enseña como mucho 3). */
  alerts: CardAlert[];
};

export type CardAlert = { key: string; tone: "danger" | "warn" | "info" | "probable"; text: string };

/** Pago único a partir del cual se avisa en la tarjeta del mes. */
export const BIG_ONE_OFF_EUR = 300;

const sumEur = (ls: CardLine[]) => ls.reduce((s, l) => s + l.eur, 0);
const byDate = (a: CardLine, b: CardLine) => a.date.localeCompare(b.date);

/** Tarjetas desde el mes actual hasta el mes que contiene hoy + `days`. */
export function monthCards(input: ForecastInput, days = 60, today = todayISO()) {
  const { fx, invoices, payments, scheduled } = input;
  const cur = today.slice(0, 7);
  const end = new Date(`${today}T12:00:00`);
  end.setDate(end.getDate() + days);
  const lastMonth = todayISO(end).slice(0, 7);
  const moves = forecastMovements(input, lastMonth, today);
  const sched = new Map(scheduled.map((s) => [s.id, s]));

  const fromMove = (m: Movement): CardLine => ({
    key: m.key,
    date: m.date,
    concept: m.concept,
    counterparty: m.counterparty,
    eur: m.eur,
    usd: m.usd,
    done: false,
    overdue: m.overdue,
    movement: m,
  });
  const fromInvoice = (f: FinInvoice): CardLine => ({
    key: `inv-${f.id}`,
    date: cashDate(f),
    concept: f.concept || `Factura ${f.number}`,
    counterparty: f.client,
    eur: f.eur,
    usd: f.usd,
    done: true,
    overdue: false,
    invoice: f,
  });
  const fromPayment = (p: FinPayment): CardLine => ({
    key: `pay-${p.id}`,
    date: p.date,
    concept: p.concept,
    counterparty: p.counterparty,
    eur: amountEur(p, fx),
    usd: p.amount_usd,
    done: true,
    overdue: false,
    payment: p,
  });

  const cards: MonthCard[] = [];
  for (let m = cur; m <= lastMonth; m = addMonths(m, 1)) {
    const isCurrent = m === cur;
    const ofMonth = moves.filter((x) => (isCurrent ? x.date.slice(0, 7) <= m : x.date.slice(0, 7) === m));
    const isMens = (x: Movement) =>
      !x.overdue &&
      (x.source === "mensualidad" ||
        (x.source === "factura" && invoices.find((f) => f.id === x.invoiceId)?.kind === "mensualidad"));
    const cobradas = invoices.filter((f) => f.status === "cobrada" && cashDate(f).slice(0, 7) === m);
    const pagos = payments.filter((p) => p.date.slice(0, 7) === m);

    const mensualidades = [
      ...cobradas.filter((f) => f.kind === "mensualidad").map(fromInvoice),
      ...ofMonth.filter((x) => x.direction === "entrada" && !x.probable && isMens(x)).map(fromMove),
    ].sort(byDate);
    const otherIn = [
      ...cobradas.filter((f) => f.kind !== "mensualidad").map(fromInvoice),
      ...ofMonth.filter((x) => x.direction === "entrada" && !x.probable && !isMens(x)).map(fromMove),
    ].sort(byDate);

    // Salidas: únicas y anuales fila a fila; el resto, por tipo
    const oneOff = (f?: FinScheduled["frequency"]) => f === "unica" || f === "anual";
    const out: { line: CardLine; single: boolean; group: OutGroup }[] = [
      ...pagos.map((p) => {
        const s = p.scheduled_id ? sched.get(p.scheduled_id) : undefined;
        return { line: fromPayment(p), single: !s || oneOff(s.frequency), group: groupOf(p.kind) };
      }),
      ...ofMonth
        .filter((x) => x.direction === "salida" && !x.probable)
        .map((x) => ({ line: fromMove(x), single: oneOff(x.frequency), group: groupOf(x.kind) })),
    ];
    const singleOut = out.filter((o) => o.single).map((o) => o.line).sort(byDate);
    const groups = OUT_GROUPS.map((g) => {
      const lines = out.filter((o) => !o.single && o.group === g.id).map((o) => o.line).sort(byDate);
      return { ...g, lines, total: sumEur(lines) };
    }).filter((g) => g.lines.length);

    const probable = ofMonth.filter((x) => x.probable).map(fromMove).sort(byDate);
    const inTotal = sumEur(mensualidades) + sumEur(otherIn);
    const outTotal = sumEur(singleOut) + groups.reduce((s, g) => s + g.total, 0);
    const all = [...mensualidades, ...otherIn, ...singleOut, ...groups.flatMap((g) => g.lines)];

    // Avisos, por orden de importancia
    const alerts: CardAlert[] = [];
    all.filter((l) => l.overdue).forEach((l) =>
      alerts.push({ key: `v-${l.key}`, tone: "danger", text: `Vencido: ${l.concept}${l.counterparty ? ` · ${l.counterparty}` : ""} · ${eur0(l.eur)}` }),
    );
    singleOut
      .filter((l) => !l.done && l.eur >= BIG_ONE_OFF_EUR)
      .forEach((l) =>
        alerts.push({
          key: `u-${l.key}`,
          tone: "warn",
          text: `Pago ${l.movement?.frequency === "anual" ? "anual" : "único"}: ${l.concept} · ${eur0(l.eur)}`,
        }),
      );
    scheduled
      .filter((sc) => !sc.closed && sc.frequency !== "unica" && sc.end_date?.slice(0, 7) === m)
      .forEach((sc) => alerts.push({ key: `e-${sc.id}`, tone: "info", text: `Último mes: ${sc.concept}` }));
    if (m === addMonths(cur, 1))
      pendingActivations(input.projects, input.recs).forEach((a) =>
        alerts.push({ key: `a-${a.recurrence.id}`, tone: "info", text: `Por activar: ${a.name} · +${eur0(a.eur)}/mes` }),
      );
    probable.forEach((l) =>
      alerts.push({ key: `p-${l.key}`, tone: "probable", text: `Probable: ${l.concept} · ${eur0(l.eur)} · ${l.movement?.probability}%` }),
    );
    cards.push({
      month: m,
      label: monthLabel(m),
      isCurrent,
      mensualidades,
      mensTotal: sumEur(mensualidades),
      otherIn,
      inTotal,
      singleOut,
      groups,
      outTotal,
      probable,
      net: inTotal - outTotal,
      pending: all.some((l) => !l.done) || probable.length > 0,
      alerts,
    });
  }
  return cards;
}

// --- Lo que pide atención -----------------------------------------------------

export type StaleItem = {
  key: string;
  scheduled: FinScheduled;
  period: string; // fecha de la cuota
  eur: number;
  probable: boolean;
};

/**
 * Programados con fecha pasada sin pago hecho (ni factura, si es entrada):
 * los confirmados están "sin confirmar"; los probables, "fecha pasada:
 * actualizar o descartar". Las cuotas saltadas o cerradas no salen.
 */
export function staleScheduled(input: ForecastInput, today = todayISO()) {
  const { fx, scheduled, payments, invoices } = input;
  const done = new Set<string>();
  payments.forEach((p) => p.scheduled_id && p.period && done.add(`${p.scheduled_id}|${p.period}`));
  invoices.forEach((f) => f.scheduled_id && f.scheduled_period && done.add(`${f.scheduled_id}|${f.scheduled_period}`));
  const out: StaleItem[] = [];
  for (const sc of scheduled) {
    for (const period of occurrences(sc, sc.date.slice(0, 7), today.slice(0, 7))) {
      if (period >= today || done.has(`${sc.id}|${period}`)) continue;
      out.push({ key: `${sc.id}|${period}`, scheduled: sc, period, eur: amountEur(sc, fx), probable: sc.certainty === "probable" });
    }
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}
