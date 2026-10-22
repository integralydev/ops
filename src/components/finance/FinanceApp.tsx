"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { FlowChart } from "./FlowChart";
import { MonthDetail, UpcomingMonths } from "./UpcomingMonths";
import { InvoiceModal, PaymentModal, ProjectModal, ReceivableModal, ScheduledModal, SkipModal, StripePendingRow } from "./forms";
import {
  amountEur,
  computeKpis,
  computePeriods,
  currentRecurrence,
  eur0,
  fFecha,
  integrityCheck,
  invoiceAmount,
  marginTone,
  monthLabel,
  monthCards,
  monthlyFlows,
  parseInvoice,
  parsePayment,
  parseProject,
  parseReceivable,
  parseRecurrence,
  parseScheduled,
  parseStripePending,
  pctS,
  pendingActivations,
  projectMargin,
  recurrenceMargin,
  recurrencesOf,
  sortInvoices,
  staleScheduled,
  todayISO,
  usd0,
  type FinInvoice,
  type FinPayment,
  type FinProject,
  type FinReceivable,
  type FinRecurrence,
  type FinScheduled,
  type FinStripePending,
  type StaleItem,
  type Movement,
} from "@/lib/finance";

type Data = {
  fx: number;
  projects: FinProject[];
  recs: FinRecurrence[];
  invoices: FinInvoice[];
  receivables: FinReceivable[];
  scheduled: FinScheduled[];
  payments: FinPayment[];
  stripePending: FinStripePending[];
};

type InvoiceEdit = { invoice?: FinInvoice; prefill?: Partial<FinInvoice>; closeScheduledId?: string };
type PaymentEdit = { payment?: FinPayment; prefill?: Partial<FinPayment>; closeScheduledId?: string };

const REC_STATUS: Record<string, string> = { activa: "activa ✓", por_activar: "por activar", cancelada: "cancelada" };
const KIND_LABEL: Record<FinPayment["kind"], string> = {
  dev: "Dev",
  comision: "Comisión",
  comercial: "Comercial",
  gasto_fijo: "Gasto fijo",
  infra: "Infra",
  otro: "Otro",
};
const FREQ_LABEL: Record<FinScheduled["frequency"], string> = {
  unica: "Única",
  mensual: "Mensual",
  trimestral: "Trimestral",
  anual: "Anual",
};

// Finanzas (solo propietarios, sesión aal2): primero lo que viene (este mes,
// línea del tiempo y próximos 60 días) y debajo, plegado, el detalle de la
// fase 1. Sin Realtime a propósito: se recarga al entrar y al guardar.
export function FinanceApp() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [showProbable, setShowProbable] = useState(true);
  const [allMonths, setAllMonths] = useState(false);
  const [editProject, setEditProject] = useState<FinProject | "new" | null>(null);
  const [editInvoice, setEditInvoice] = useState<InvoiceEdit | null>(null);
  const [editRecv, setEditRecv] = useState<FinReceivable | "new" | null>(null);
  const [editScheduled, setEditScheduled] = useState<FinScheduled | "new" | null>(null);
  const [editPayment, setEditPayment] = useState<PaymentEdit | null>(null);
  const [skipItem, setSkipItem] = useState<StaleItem | null>(null);
  const [detailMonth, setDetailMonth] = useState<string | null>(null);
  const [allStale, setAllStale] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [s, p, r, i, c, sc, po, sp] = await Promise.all([
      supabase.from("fin_settings").select("fx_usd_eur").eq("id", 1).maybeSingle(),
      supabase.from("fin_projects").select("*").order("position").order("created_at"),
      supabase.from("fin_recurrences").select("*"),
      supabase.from("fin_invoices").select("*"),
      supabase.from("fin_receivables").select("*").order("position").order("created_at"),
      supabase.from("fin_scheduled").select("*").order("date"),
      supabase.from("fin_payments_out").select("*").order("date", { ascending: false }),
      supabase.from("fin_stripe_pending").select("*").order("paid_date"),
    ]);
    const err = [s, p, r, i, c, sc, po, sp].find((x) => x.error)?.error;
    if (err) {
      setError(err.message);
      return;
    }
    setError("");
    setData({
      fx: Number(s.data?.fx_usd_eur ?? 0.92),
      projects: (p.data || []).map(parseProject),
      recs: (r.data || []).map(parseRecurrence),
      invoices: (i.data || []).map(parseInvoice),
      receivables: (c.data || []).map(parseReceivable),
      scheduled: (sc.data || []).map(parseScheduled),
      payments: (po.data || []).map(parsePayment),
      stripePending: (sp.data || []).map(parseStripePending),
    });
  }, []);

  useEffect(() => {
    // Primera carga; después se recarga tras cada cambio
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (error) {
    return (
      <div className="content">
        <div className="empty">No se pudieron cargar las finanzas: {error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="content">
        <div className="empty">Cargando…</div>
      </div>
    );
  }

  const { fx, projects, recs, invoices, receivables, scheduled, payments, stripePending } = data;
  const today = todayISO();
  const curMonth = today.slice(0, 7);
  const k = computeKpis(projects, recs);
  const integrity = integrityCheck(projects, receivables);
  const flows = monthlyFlows(data, 4, 6, today);
  const now = flows.find((f) => f.isCurrent)!;
  const cards = monthCards(data, 60, today);
  const nextCards = cards.filter((c) => !c.isCurrent);
  const detailCard = cards.find((c) => c.month === detailMonth);
  const stale = staleScheduled(data, today);
  const staleConfirmed = stale.filter((x) => !x.probable);
  const staleProbable = stale.filter((x) => x.probable);
  const activations = pendingActivations(projects, recs);
  const periods = computePeriods(invoices, fx, payments);
  const shownPeriods = allMonths ? periods : periods.slice(-6);
  const activos = projects.filter((p) => p.status === "activo");
  const cerrados = projects.filter((p) => p.status === "cerrado");
  const schedById = new Map(scheduled.map((s) => [s.id, s]));
  const projName = (id?: string | null) => projects.find((p) => p.id === id)?.name || "";

  function markPaid(m: Movement) {
    const s = m.scheduledId ? schedById.get(m.scheduledId) : undefined;
    setEditPayment({
      prefill: {
        date: today,
        concept: m.concept,
        counterparty: m.counterparty,
        amount_eur: s?.amount_usd != null ? null : (s?.amount_eur ?? m.eur),
        amount_usd: s?.amount_usd ?? null,
        fin_project_id: m.finProjectId ?? null,
        scheduled_id: m.scheduledId,
        period: m.period,
        // El tipo del programado o, si no tiene, uno sugerido por el concepto
        kind:
          s && s.kind !== "otro"
            ? s.kind
            : /\bdev\b/i.test(m.concept) ? "dev" : /comisi/i.test(m.concept) ? "comision" : /comercial/i.test(m.concept) ? "comercial" : "otro",
      },
      closeScheduledId: s?.frequency === "unica" ? s.id : undefined,
    });
  }

  // Una cuota de programado como movimiento (para "Pagado" / "Facturado")
  const staleMove = (x: StaleItem): Movement => ({
    key: x.key,
    date: x.period,
    direction: x.scheduled.direction,
    concept: x.scheduled.concept,
    counterparty: x.scheduled.counterparty || projName(x.scheduled.fin_project_id),
    eur: x.eur,
    usd: x.scheduled.amount_usd,
    probable: x.probable,
    probability: x.scheduled.probability ?? 100,
    overdue: true,
    source: "programado",
    scheduledId: x.scheduled.id,
    period: x.period,
    finProjectId: x.scheduled.fin_project_id,
    kind: x.scheduled.kind,
    frequency: x.scheduled.frequency,
  });

  function markInvoiced(m: Movement) {
    const s = m.scheduledId ? schedById.get(m.scheduledId) : undefined;
    setEditInvoice({
      prefill: {
        client: m.counterparty,
        concept: m.concept,
        // Mensualidad con días de pago: la factura lleva la fecha de cobro
        date: (m.billedOn || m.date) < today ? today : m.billedOn || m.date,
        eur: m.eur,
        usd: m.usd ?? null,
        kind: m.source === "mensualidad" ? "mensualidad" : "implementacion",
        status: "pendiente",
        fin_project_id: m.finProjectId ?? null,
        ...(s ? { scheduled_id: s.id, scheduled_period: m.period } : {}),
      },
      closeScheduledId: s?.frequency === "unica" ? s.id : undefined,
    });
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Finanzas</h1>
          <div className="topbar-sub">🔒 Solo propietarios · sesión verificada en dos pasos</div>
        </div>
        <FxEditor fx={fx} onSaved={load} />
      </div>
      <div className="content wide fin">
        {!integrity.ok && (
          <div className="fin-warn">
            ⚠️ <b>Descuadre:</b> los cobros pendientes suman {eur0(integrity.cobrosKpi)} pero el pendiente por proyecto es{" "}
            {eur0(integrity.pendiente)} (diferencia {eur0(integrity.diff)}). Revisa los proyectos o los cobros pendientes.
          </div>
        )}

        {/* Lo que pide atención */}
        {stripePending.length > 0 && (
          <div className="fin-attn">
            <b>💳 {stripePending.length === 1 ? "1 cobro de Stripe sin vincular" : `${stripePending.length} cobros de Stripe sin vincular`}</b>
            <span className="muted"> · no se sabe de qué cliente es; vincúlalo y los siguientes entran solos</span>
            {stripePending.map((x) => (
              <StripePendingRow key={x.id} item={x} projects={projects} recs={recs} fx={fx} onSaved={load} />
            ))}
          </div>
        )}
        {stale.length > 0 && (
          <div className="fin-attn">
            {staleConfirmed.length > 0 && (
              <>
                <b>
                  ⏳ {staleConfirmed.length === 1 ? "1 movimiento sin confirmar" : `${staleConfirmed.length} movimientos sin confirmar`}
                </b>
                <span className="muted"> · programados con fecha pasada sin pago hecho</span>
                {(allStale ? staleConfirmed : staleConfirmed.slice(0, 3)).map((x) => (
                  <div key={x.key} className="fin-attn-row">
                    <span className="fin-move-date">{fFecha(x.period)}</span>
                    <span>
                      {x.scheduled.concept}
                      {x.scheduled.counterparty && <span className="muted"> · {x.scheduled.counterparty}</span>}
                    </span>
                    <span className={"fin-move-amount " + (x.scheduled.direction === "entrada" ? "fin-in" : "fin-out")}>
                      {x.scheduled.direction === "entrada" ? "+" : "−"}
                      {x.scheduled.amount_usd != null ? usd0(x.scheduled.amount_usd) : eur0(x.eur)}
                    </span>
                    <span className="fin-attn-acts">
                      {x.scheduled.direction === "salida" ? (
                        <button className="btn btn-sm" onClick={() => markPaid(staleMove(x))}>
                          Pagado
                        </button>
                      ) : (
                        <button className="btn btn-sm" onClick={() => markInvoiced(staleMove(x))}>
                          Facturado
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={() => setSkipItem(x)}>
                        No se {x.scheduled.direction === "salida" ? "pagó" : "cobró"} / mover fecha
                      </button>
                    </span>
                  </div>
                ))}
                {staleConfirmed.length > 3 && (
                  <button className="fin-attn-more" onClick={() => setAllStale(!allStale)}>
                    {allStale ? "Ver menos" : `Ver los ${staleConfirmed.length}`}
                  </button>
                )}
              </>
            )}
            {staleProbable.length > 0 && (
              <div style={{ marginTop: staleConfirmed.length ? 12 : 0 }}>
                <b>🤔 Probables con fecha pasada</b>
                <span className="muted"> · actualizar o descartar</span>
                {staleProbable.map((x) => (
                  <div key={x.key} className="fin-attn-row is-probable">
                    <span className="fin-move-date">{fFecha(x.period)}</span>
                    <span>
                      {x.scheduled.concept} <span className="fin-tag">{x.scheduled.probability ?? 50}%</span>
                    </span>
                    <span className="fin-move-amount">{eur0(x.eur)}</span>
                    <span className="fin-attn-acts">
                      <button className="btn btn-sm" onClick={() => setEditScheduled(x.scheduled)}>
                        Actualizar
                      </button>
                      <button className="btn btn-sm" onClick={() => setSkipItem(x)}>
                        Descartar
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Este mes */}
        <div className="fin-head" style={{ marginTop: 0 }}>
          <div className="section-title">Este mes · {monthLabel(curMonth)}</div>
          <div className="fin-actions">
            <button className="btn btn-sm" onClick={() => setDetailMonth(curMonth)}>
              Ver detalle
            </button>
            <button className="btn btn-sm" onClick={() => setEditScheduled("new")}>
              + Programado
            </button>
            <button className="btn btn-sm" onClick={() => setEditPayment({})}>
              + Pago hecho
            </button>
          </div>
        </div>
        <div className="fin-now">
          <div className="card fin-now-card">
            <div className="fin-kpi-label">Entra</div>
            <div className="fin-now-value fin-in">{eur0(now.inConfirmed)}</div>
            <div className="fin-kpi-sub">
              Ya llegado {eur0(now.inArrived)} · falta {eur0(now.inConfirmed - now.inArrived)}
            </div>
          </div>
          <div className="card fin-now-card">
            <div className="fin-kpi-label">Sale</div>
            <div className="fin-now-value fin-out">{eur0(now.outConfirmed)}</div>
            <div className="fin-kpi-sub">
              Ya pagado {eur0(now.outPaid)} · falta {eur0(now.outConfirmed - now.outPaid)}
            </div>
          </div>
          <div className={"card fin-now-card is-net" + (now.net < 0 ? " is-neg" : "")}>
            <div className="fin-kpi-label">Queda</div>
            <div className="fin-now-value">{eur0(now.net)}</div>
            <div className="fin-kpi-sub">Solo lo confirmado (incluye lo vencido sin cobrar ni pagar)</div>
          </div>
        </div>
        {activations.length > 0 && (
          <div className="fin-note">
            Por activar:{" "}
            {activations.map((a, i) => (
              <span key={a.recurrence.id}>
                {i > 0 && " · "}
                <b>+{eur0(a.eur)}/mes</b> si se activa {a.name}
              </span>
            ))}
            . No cuentan en lo confirmado.
          </div>
        )}

        {/* Línea del tiempo */}
        <div className="card fin-flow-card">
          <div className="fin-flow-head">
            <div className="fin-legend">
              <span>
                <i className="flow-key is-in" /> Entra
              </span>
              <span>
                <i className="flow-key is-out" /> Sale
              </span>
              <span>
                <i className="flow-key is-net" /> Neto confirmado
              </span>
              {showProbable && (
                <>
                  <span>
                    <i className="flow-key is-prob" /> Probable (ponderado)
                  </span>
                  <span>
                    <i className="flow-key is-net-prob" /> Neto con probable
                  </span>
                </>
              )}
            </div>
            <label className="links-check">
              <input type="checkbox" checked={showProbable} onChange={(e) => setShowProbable(e.target.checked)} />
              <span>Mostrar probable</span>
            </label>
          </div>
          <FlowChart rows={flows} showProbable={showProbable} />
        </div>

        {/* Próximos 60 días */}
        <div className="fin-head">
          <div className="section-title">Próximos 60 días</div>
        </div>
        <UpcomingMonths cards={nextCards} showProbable={showProbable} onOpen={setDetailMonth} />

        {/* Detalle, plegado */}
        <details className="fin-sec">
          <summary>Indicadores y cobros pendientes</summary>
          <div className="fin-kpis">
            <div className="card fin-kpi is-purple">
              <div className="fin-kpi-label">Facturación total</div>
              <div className="fin-kpi-value">{eur0(k.facturado)}</div>
              <div className="fin-kpi-sub">{k.count} proyectos cerrados y en curso</div>
            </div>
            <div className="card fin-kpi is-green">
              <div className="fin-kpi-label">Ya cobrado</div>
              <div className="fin-kpi-value">{eur0(k.cobrado)}</div>
              <div className="fin-kpi-sub">{pctS(k.cobradoPct)} de lo facturado</div>
            </div>
            <div className="card fin-kpi is-yellow">
              <div className="fin-kpi-label">Pendiente cobro</div>
              <div className="fin-kpi-value">{eur0(k.pendiente)}</div>
              <div className="fin-kpi-sub">
                {k.pendLista.map((x) => `${x.name} ${Math.round(x.eur).toLocaleString("de-DE")}`).join(" · ")}
              </div>
            </div>
            <div className="card fin-kpi is-teal">
              <div className="fin-kpi-label">MRR activo / potencial</div>
              <div className="fin-kpi-value">
                {eur0(k.mrrActivo)} / {eur0(k.mrrTotal)}
              </div>
              <div className="fin-kpi-sub">
                {k.mrrActivo ? `Activo: ${k.mrrAct.join(", ")} ✓ · ` : ""}Pendientes:{" "}
                {k.mrrPend.map((x) => `${x.name} ${x.eur}`).join(" · ")}
              </div>
            </div>
          </div>
          <div className="fin-head">
            <div className="section-title">Cobros pendientes</div>
            <button className="btn btn-sm" onClick={() => setEditRecv("new")}>
              + Cobro
            </button>
          </div>
          <div className="card table-card">
            <table className="ptable">
              <tbody>
                {receivables.length === 0 && (
                  <tr>
                    <td className="muted">Ningún cobro pendiente.</td>
                  </tr>
                )}
                {receivables.map((c) => (
                  <tr key={c.id} className="ptable-row" onClick={() => setEditRecv(c)}>
                    <td style={{ width: "28%" }}>
                      <b className={c.invoiced ? "" : "muted"}>{c.project}</b>
                    </td>
                    <td className="muted" style={{ fontSize: 12.3 }}>
                      {c.concept}
                      {!c.in_kpi && <span className="fin-tag">fuera del KPI</span>}
                      {!c.invoiced && <span className="fin-tag">sin facturar</span>}
                    </td>
                    <td className={c.invoiced ? "fin-yellow fin-num" : "muted fin-num"}>{eur0(c.eur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <details className="fin-sec">
          <summary>Resumen por mes</summary>
          <div className="card table-card fin-scroll">
            <table className="ptable fin-period">
              <thead>
                <tr>
                  <th />
                  {shownPeriods.map((m, i) => (
                    <th key={m.month} className={i === shownPeriods.length - 1 ? "is-last" : ""}>
                      {m.label}
                      {i === shownPeriods.length - 1 ? " ★" : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <PeriodRow label="Facturado" values={shownPeriods.map((p) => p.facturado)} />
                <PeriodRow label="Cobrado" values={shownPeriods.map((p) => p.cobrado)} tone="green" />
                <PeriodRow label="↳ Implementación" values={shownPeriods.map((p) => p.cobradoImpl)} tone="green" sub />
                <PeriodRow label="↳ Mensualidades" values={shownPeriods.map((p) => p.cobradoMens)} tone="teal" sub />
                <PeriodRow label="Comisiones bancarias" values={shownPeriods.map((p) => p.comisiones)} tone="red" />
                <PeriodRow label="Gastos dev" values={shownPeriods.map((p) => p.gastosDev || 0)} tone="red" />
                <PeriodRow label="Pagos hechos (todos)" values={shownPeriods.map((p) => p.salidas || 0)} tone="red" />
                <PeriodRow label="Benef. neto" values={shownPeriods.map((p) => p.beneficioNeto || 0)} strong />
              </tbody>
            </table>
          </div>
          {periods.length > 6 && (
            <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setAllMonths(!allMonths)}>
              {allMonths ? "Ver solo los últimos 6 meses" : `Ver todo (${periods.length} meses)`}
            </button>
          )}
        </details>

        <details className="fin-sec">
          <summary>Rentabilidad por proyecto</summary>
          <div className="fin-head">
            <div className="section-title">Proyectos activos</div>
            <button className="btn btn-sm" onClick={() => setEditProject("new")}>
              + Proyecto
            </button>
          </div>
          <div className="fin-grid">
            {activos.map((p) => {
              const m = projectMargin(p, fx);
              const rs = recurrencesOf(p, recs);
              const enCurso = currentRecurrence(p, recs);
              return (
                <div key={p.id} className="card fin-card" onClick={() => setEditProject(p)}>
                  <div className="fin-card-head">
                    <b>{p.name}</b>
                    <span>
                      {eur0(p.agreed_eur)}
                      {enCurso ? ` + ${enCurso.client_eur_month}€/mes` : ""}
                    </span>
                  </div>
                  <div className="fin-bar">
                    <div style={{ width: `${Math.min(100, m.bar)}%` }} />
                  </div>
                  <div className="fin-stats">
                    <Stat label="Cobrado" value={p.collected_eur ? eur0(p.collected_eur) : "—"} tone={p.collected_eur ? "green" : "muted"} />
                    <Stat label="Pendiente" value={m.pend ? eur0(m.pend) : "—"} tone={m.pend ? "yellow" : "muted"} />
                    <Stat label="Margen" value={`${eur0(m.margen)} · ${pctS(m.pct)}`} tone={marginTone(m.pct)} />
                  </div>
                  <div className="fin-sub">
                    Dev: <span className="fin-red">{m.devTxt}</span>
                    {m.pend && p.impl_note ? ` · ${p.impl_note}` : ""}
                  </div>
                  {rs.map((r) => {
                    const rm = recurrenceMargin(r, fx);
                    const cal = r.start_month
                      ? ` · ${monthLabel(r.start_month)}${r.end_month ? ` → ${monthLabel(r.end_month)}` : " →"}`
                      : "";
                    return (
                      <div key={r.id} className={"fin-rec" + (r.status === "cancelada" ? " is-off" : "")}>
                        <div className="fin-rec-title">
                          {r.title || "Recurrencia"} · {REC_STATUS[r.status || (r.active ? "activa" : "por_activar")]}
                          {cal}
                          {enCurso?.id === r.id && rs.length > 1 ? " · en curso" : ""}
                        </div>
                        <div className="fin-stats">
                          <Stat label="€/mes cliente" value={`${r.client_eur_month}€`} />
                          <Stat label="€/mes coste" value={rm.coste ? eur0(rm.coste) : "Sin coste"} tone={rm.coste ? "red" : "muted"} />
                          <Stat label="Margen/mes" value={`${eur0(rm.margen)} · ${pctS(rm.pct)}`} tone={marginTone(rm.pct)} />
                        </div>
                        {rm.detalle && <div className="fin-sub">{rm.detalle}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="section-title" style={{ marginTop: 22 }}>
            Proyectos cerrados
          </div>
          <div className="fin-grid">
            {cerrados.map((p) => {
              const m = projectMargin(p, fx);
              return (
                <div key={p.id} className="card fin-card" onClick={() => setEditProject(p)}>
                  <div className="fin-card-head">
                    <b>{p.name}</b>
                    <span>{eur0(p.agreed_eur)}</span>
                  </div>
                  <div className="fin-stats">
                    <Stat label="Cobrado" value={`${eur0(p.collected_eur)} ✓`} tone="green" />
                    <Stat label="Dev" value={m.de ? eur0(m.de) : p.dev_who} tone={m.de ? "red" : "muted"} />
                    <Stat label="Margen" value={`${eur0(m.margen)} · ${pctS(m.pct)}`} tone={marginTone(m.pct)} />
                  </div>
                  <div className="fin-sub">
                    {p.dev_who}
                    {p.impl_note ? ` · ${p.impl_note}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </details>

        <details className="fin-sec">
          <summary>Facturas emitidas</summary>
          <div className="fin-head">
            <div className="section-title">{invoices.length} facturas</div>
            <button className="btn btn-sm" onClick={() => setEditInvoice({})}>
              + Factura
            </button>
          </div>
          <div className="card">
            {sortInvoices(invoices).map((f) => {
              const a = invoiceAmount(f);
              return (
                <div key={f.id} className="fin-inv" onClick={() => setEditInvoice({ invoice: f })}>
                  <span className="fin-inv-num">{f.number}</span>
                  <span className="fin-inv-client">{f.client}</span>
                  <span className="fin-inv-concept">{f.concept}</span>
                  <span className="muted fin-inv-date">{f.date_txt || fFecha(f.date)}</span>
                  <span className="fin-inv-amount">
                    {a.main} {a.sub && <span className="muted">{a.sub}</span>}
                  </span>
                  <span className={`fin-badge is-${f.status}`}>{f.status.charAt(0).toUpperCase() + f.status.slice(1)}</span>
                </div>
              );
            })}
            {invoices.length === 0 && <div className="empty" style={{ margin: 12 }}>Todavía no hay facturas.</div>}
          </div>
        </details>

        <details className="fin-sec">
          <summary>Programados</summary>
          <div className="fin-head">
            <div className="section-title">Entradas y salidas previstas</div>
            <button className="btn btn-sm" onClick={() => setEditScheduled("new")}>
              + Programado
            </button>
          </div>
          <div className="card">
            {scheduled.map((s) => (
              <div key={s.id} className={"fin-list-row" + (s.closed ? " is-off" : "")} onClick={() => setEditScheduled(s)}>
                <span className="fin-move-date">{fFecha(s.date)}</span>
                <span className="fin-move-concept">
                  <b>{s.concept || "—"}</b>
                  {(s.counterparty || s.fin_project_id) && <span className="muted"> · {s.counterparty || projName(s.fin_project_id)}</span>}
                  {s.direction === "salida" && <span className="fin-tag">{KIND_LABEL[s.kind]}</span>}
                  <span className="fin-tag">
                    {FREQ_LABEL[s.frequency]}
                    {s.end_date ? ` hasta ${fFecha(s.end_date)}` : ""}
                  </span>
                  {s.certainty === "probable" && <span className="fin-tag">probable {s.probability ?? 50}%</span>}
                  {s.closed && <span className="fin-tag">cerrado</span>}
                </span>
                <span className={"fin-move-amount " + (s.direction === "entrada" ? "fin-in" : "fin-out")}>
                  {s.direction === "entrada" ? "+" : "−"}
                  {s.amount_usd != null ? usd0(s.amount_usd) : eur0(s.amount_eur || 0)}
                </span>
              </div>
            ))}
            {scheduled.length === 0 && <div className="empty" style={{ margin: 12 }}>Nada programado todavía.</div>}
          </div>
        </details>

        <details className="fin-sec">
          <summary>Pagos hechos</summary>
          <div className="fin-head">
            <div className="section-title">Salidas reales</div>
            <button className="btn btn-sm" onClick={() => setEditPayment({})}>
              + Pago hecho
            </button>
          </div>
          <div className="card">
            {payments.map((p) => (
              <div key={p.id} className="fin-list-row" onClick={() => setEditPayment({ payment: p })}>
                <span className="fin-move-date">{fFecha(p.date)}</span>
                <span className="fin-move-concept">
                  <b>{p.concept || "—"}</b>
                  {(p.counterparty || p.fin_project_id) && <span className="muted"> · {p.counterparty || projName(p.fin_project_id)}</span>}
                  <span className="fin-tag">{KIND_LABEL[p.kind]}</span>
                </span>
                <span className="fin-move-amount fin-out">
                  −{p.amount_usd != null ? usd0(p.amount_usd) : eur0(p.amount_eur || 0)}
                  {p.amount_usd != null && <span className="muted"> ≈{eur0(amountEur(p, fx))}</span>}
                </span>
              </div>
            ))}
            {payments.length === 0 && <div className="empty" style={{ margin: 12 }}>Todavía no hay pagos registrados.</div>}
          </div>
        </details>
      </div>

      {detailCard && (
        <MonthDetail
          card={detailCard}
          showProbable={showProbable}
          onClose={() => setDetailMonth(null)}
          actions={{
            markPaid,
            markInvoiced,
            openInvoice: (id) => {
              const f = invoices.find((x) => x.id === id);
              if (f) setEditInvoice({ invoice: f });
            },
            openPayment: (p) => setEditPayment({ payment: p }),
            openScheduled: (id) => {
              const sc = schedById.get(id);
              if (sc) setEditScheduled(sc);
            },
          }}
        />
      )}
      {editProject && (
        <ProjectModal
          project={editProject === "new" ? undefined : editProject}
          recs={editProject === "new" ? [] : recurrencesOf(editProject, recs)}
          onClose={() => setEditProject(null)}
          onSaved={load}
        />
      )}
      {editInvoice && (
        <InvoiceModal {...editInvoice} finProjects={projects} onClose={() => setEditInvoice(null)} onSaved={load} />
      )}
      {editRecv && (
        <ReceivableModal receivable={editRecv === "new" ? undefined : editRecv} onClose={() => setEditRecv(null)} onSaved={load} />
      )}
      {editScheduled && (
        <ScheduledModal
          scheduled={editScheduled === "new" ? undefined : editScheduled}
          finProjects={projects}
          onClose={() => setEditScheduled(null)}
          onSaved={load}
        />
      )}
      {editPayment && (
        <PaymentModal {...editPayment} finProjects={projects} onClose={() => setEditPayment(null)} onSaved={load} />
      )}
      {skipItem && <SkipModal item={skipItem} onClose={() => setSkipItem(null)} onSaved={load} />}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="fin-stat-label">{label}</div>
      <div className={`fin-stat-val${tone ? ` fin-${tone}` : ""}`}>{value}</div>
    </div>
  );
}

function PeriodRow({ label, values, tone, sub, strong }: { label: string; values: number[]; tone?: string; sub?: boolean; strong?: boolean }) {
  return (
    <tr className={(sub ? "fin-period-sub" : "") + (strong ? " fin-period-strong" : "")}>
      <td>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={v ? (strong ? (v < 0 ? "fin-red" : "fin-green") : tone ? `fin-${tone}` : "") : "muted"}>
          {v ? eur0(v) : "—"}
        </td>
      ))}
    </tr>
  );
}

// Tipo de cambio USD → EUR
function FxEditor({ fx, onSaved }: { fx: number; onSaved: () => void }) {
  const [value, setValue] = useState(String(fx).replace(".", ","));
  const [busy, setBusy] = useState(false);
  const parsed = Number(value.replace(",", "."));
  const dirty = parsed !== fx;
  async function save() {
    if (!(parsed > 0)) {
      toast("Tipo de cambio no válido");
      return;
    }
    setBusy(true);
    const { error } = await createClient()
      .from("fin_settings")
      .update({ fx_usd_eur: parsed, updated_at: new Date().toISOString() })
      .eq("id", 1);
    setBusy(false);
    if (error) {
      toast("No se pudo guardar: " + error.message);
      return;
    }
    toast("Tipo de cambio actualizado");
    onSaved();
  }
  return (
    <div className="fin-fx">
      <span className="muted">1 $ ≈</span>
      <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
      <span className="muted">€</span>
      {dirty && (
        <button className="btn btn-sm btn-primary" onClick={save} disabled={busy}>
          Guardar
        </button>
      )}
    </div>
  );
}
