"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { useProjects } from "@/lib/hooks/useProjects";
import {
  computeKpis,
  computePeriods,
  eur0,
  fFecha,
  integrityCheck,
  invoiceAmount,
  marginTone,
  parseInvoice,
  parseProject,
  parseReceivable,
  parseRecurrence,
  pctS,
  projectMargin,
  recurrenceMargin,
  recurrencesOf,
  sortInvoices,
  type FinInvoice,
  type FinProject,
  type FinReceivable,
  type FinRecurrence,
} from "@/lib/finance";

type Data = {
  fx: number;
  projects: FinProject[];
  recs: FinRecurrence[];
  invoices: FinInvoice[];
  receivables: FinReceivable[];
};

// Finanzas (solo propietarios, sesión aal2): la parte económica del panel de
// la agencia. Sin Realtime a propósito: se recarga al entrar y al guardar.
export function FinanceApp() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [editProject, setEditProject] = useState<FinProject | "new" | null>(null);
  const [editInvoice, setEditInvoice] = useState<FinInvoice | "new" | null>(null);
  const [editRecv, setEditRecv] = useState<FinReceivable | "new" | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [s, p, r, i, c] = await Promise.all([
      supabase.from("fin_settings").select("fx_usd_eur").eq("id", 1).maybeSingle(),
      supabase.from("fin_projects").select("*").order("position").order("created_at"),
      supabase.from("fin_recurrences").select("*"),
      supabase.from("fin_invoices").select("*"),
      supabase.from("fin_receivables").select("*").order("position").order("created_at"),
    ]);
    const err = [s, p, r, i, c].find((x) => x.error)?.error;
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

  const { fx, projects, recs, invoices, receivables } = data;
  const k = computeKpis(projects, recs);
  const integrity = integrityCheck(projects, receivables);
  const periods = computePeriods(invoices, fx);
  const activos = projects.filter((p) => p.status === "activo");
  const cerrados = projects.filter((p) => p.status === "cerrado");

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
        {/* KPIs */}
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
        {!integrity.ok && (
          <div className="fin-warn">
            ⚠️ <b>Descuadre:</b> los cobros pendientes suman {eur0(integrity.cobrosKpi)} pero el pendiente por proyecto es{" "}
            {eur0(integrity.pendiente)} (diferencia {eur0(integrity.diff)}). Revisa los proyectos o los cobros pendientes.
          </div>
        )}

        {/* Cobros pendientes */}
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

        {/* Rentabilidad */}
        <div className="fin-head">
          <div className="section-title">Rentabilidad · proyectos activos</div>
          <button className="btn btn-sm" onClick={() => setEditProject("new")}>
            + Proyecto
          </button>
        </div>
        <div className="fin-grid">
          {activos.map((p) => {
            const m = projectMargin(p, fx);
            const rs = recurrencesOf(p, recs);
            return (
              <div key={p.id} className="card fin-card" onClick={() => setEditProject(p)}>
                <div className="fin-card-head">
                  <b>{p.name}</b>
                  <span>
                    {eur0(p.agreed_eur)}
                    {rs[0] ? ` + ${rs[0].client_eur_month}€/mes` : ""}
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
                  return (
                    <div key={r.id} className="fin-rec">
                      <div className="fin-rec-title">
                        {r.title || "Recurrencia"}
                        {r.active ? " · activa ✓" : ""}
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

        <div className="section-title">Rentabilidad · proyectos cerrados</div>
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

        {/* Resumen por período */}
        <div className="section-title">Resumen por período</div>
        <div className="card table-card">
          <table className="ptable fin-period">
            <thead>
              <tr>
                <th />
                {periods.map((m, i) => (
                  <th key={m.month} className={i === periods.length - 1 ? "is-last" : ""}>
                    {m.label}
                    {i === periods.length - 1 ? " ★" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <PeriodRow label="Facturado" values={periods.map((p) => p.facturado)} />
              <PeriodRow label="Cobrado" values={periods.map((p) => p.cobrado)} tone="green" />
              <PeriodRow label="↳ Implementación" values={periods.map((p) => p.cobradoImpl)} tone="green" sub />
              <PeriodRow label="↳ Mensualidades" values={periods.map((p) => p.cobradoMens)} tone="teal" sub />
              <PeriodRow label="Comisiones bancarias" values={periods.map((p) => p.comisiones)} tone="red" />
              <PeriodRow label="Gastos dev" values={periods.map(() => 0)} />
              <PeriodRow label="Benef. neto" values={periods.map(() => 0)} />
            </tbody>
          </table>
        </div>

        {/* Facturas */}
        <div className="fin-head">
          <div className="section-title">Facturas emitidas</div>
          <button className="btn btn-sm" onClick={() => setEditInvoice("new")}>
            + Factura
          </button>
        </div>
        <div className="card">
          {sortInvoices(invoices).map((f) => {
            const a = invoiceAmount(f);
            return (
              <div key={f.id} className="fin-inv" onClick={() => setEditInvoice(f)}>
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
      </div>

      {editProject && (
        <ProjectModal
          project={editProject === "new" ? undefined : editProject}
          recs={editProject === "new" ? [] : recurrencesOf(editProject, recs)}
          onClose={() => setEditProject(null)}
          onSaved={load}
        />
      )}
      {editInvoice && (
        <InvoiceModal invoice={editInvoice === "new" ? undefined : editInvoice} onClose={() => setEditInvoice(null)} onSaved={load} />
      )}
      {editRecv && (
        <ReceivableModal receivable={editRecv === "new" ? undefined : editRecv} onClose={() => setEditRecv(null)} onSaved={load} />
      )}
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

function PeriodRow({ label, values, tone, sub }: { label: string; values: number[]; tone?: string; sub?: boolean }) {
  return (
    <tr className={sub ? "fin-period-sub" : ""}>
      <td>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={v ? (tone ? `fin-${tone}` : "") : "muted"}>
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

// --- Formularios -------------------------------------------------------------

// Importes en formato español: "1.975", "1.975,50", "87,5". Un solo punto
// seguido de 1 o 2 cifras ("87.50") se toma como decimal.
const toNum = (s: string) => {
  let t = s.trim().replace(/[€$\s]/g, "");
  if (t === "") return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+\.\d{1,2}$/.test(t)) t = t; // decimal con punto
  else t = t.replace(/\./g, "");
  return Number(t);
};
const fromNum = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

function NumField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const bad = value.trim() !== "" && Number.isNaN(toNum(value));
  return (
    <div className="field">
      <label>{label}</label>
      <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={hint} />
      {bad && <div className="links-error">No es un número</div>}
    </div>
  );
}

async function del(table: string, id: string, what: string) {
  if (!confirm(`¿Borrar ${what}? No se puede deshacer.`)) return false;
  const { data, error } = await createClient().from(table).delete().eq("id", id).select("id");
  if (error || !data?.length) {
    toast("No se pudo borrar" + (error ? ": " + error.message : ""));
    return false;
  }
  return true;
}

type RecDraft = {
  enabled: boolean;
  title: string;
  client: string;
  devUsd: string;
  devTxt: string;
  infra: string;
  active: boolean;
};
const recDraft = (r?: FinRecurrence): RecDraft => ({
  enabled: !!r,
  title: r?.title || "",
  client: fromNum(r?.client_eur_month),
  devUsd: fromNum(r?.dev_usd_month),
  devTxt: r?.dev_txt || "",
  infra: fromNum(r?.infra_eur_month),
  active: r?.active || false,
});

function ProjectModal({
  project,
  recs,
  onClose,
  onSaved,
}: {
  project?: FinProject;
  recs: FinRecurrence[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { clients } = useAppData();
  const { projects: opsProjects } = useProjects();
  const [name, setName] = useState(project?.name || "");
  const [status, setStatus] = useState(project?.status || "activo");
  const [projectId, setProjectId] = useState(project?.project_id || "");
  const [agreed, setAgreed] = useState(fromNum(project?.agreed_eur));
  const [collected, setCollected] = useState(fromNum(project?.collected_eur));
  const [implNote, setImplNote] = useState(project?.impl_note || "");
  const [devCur, setDevCur] = useState<"usd" | "eur">(project?.dev_eur != null ? "eur" : "usd");
  const [devAmount, setDevAmount] = useState(fromNum(project?.dev_eur ?? project?.dev_usd));
  const [devWho, setDevWho] = useState(project?.dev_who || "");
  const [devPaid, setDevPaid] = useState(project?.dev_paid || false);
  const [devNote, setDevNote] = useState(project?.dev_note || "");
  const [r1, setR1] = useState(recDraft(recs.find((r) => r.slot === 1)));
  const [r2, setR2] = useState(recDraft(recs.find((r) => r.slot === 2)));
  const [saving, setSaving] = useState(false);

  const opsOptions = useMemo(
    () =>
      Object.values(opsProjects)
        .map((p) => ({ id: p.id, label: p.client_id && clients[p.client_id] ? `${clients[p.client_id].name} · ${p.name}` : p.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    [opsProjects, clients],
  );

  async function save() {
    if (!name.trim()) {
      toast("Ponle un nombre");
      return;
    }
    const nums = [agreed, collected, devAmount, r1.client, r1.devUsd, r1.infra, r2.client, r2.devUsd, r2.infra];
    if (nums.some((v) => v.trim() !== "" && Number.isNaN(toNum(v)))) {
      toast("Revisa los importes: alguno no es un número");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const dev = toNum(devAmount);
    const payload = {
      name: name.trim(),
      status,
      project_id: projectId || null,
      agreed_eur: toNum(agreed) ?? 0,
      collected_eur: toNum(collected) ?? 0,
      impl_note: implNote.trim(),
      dev_usd: devCur === "usd" ? dev : null,
      dev_eur: devCur === "eur" ? dev : null,
      dev_who: devWho.trim(),
      dev_paid: devPaid,
      dev_note: devNote.trim(),
      updated_at: new Date().toISOString(),
    };
    const res = project
      ? await supabase.from("fin_projects").update(payload).eq("id", project.id).select("id").single()
      : await supabase.from("fin_projects").insert(payload).select("id").single();
    if (res.error || !res.data) {
      setSaving(false);
      toast("No se pudo guardar: " + (res.error?.message || ""));
      return;
    }
    const pid = res.data.id as string;
    // Tramos de recurrencia: se guardan los activados y se borran los quitados
    for (const [slot, d] of [
      [1, r1],
      [2, r2],
    ] as const) {
      if (d.enabled) {
        const { error } = await supabase.from("fin_recurrences").upsert(
          {
            fin_project_id: pid,
            slot,
            title: d.title.trim(),
            client_eur_month: toNum(d.client) ?? 0,
            dev_usd_month: toNum(d.devUsd) ?? 0,
            dev_txt: d.devTxt.trim(),
            infra_eur_month: toNum(d.infra) ?? 0,
            active: d.active,
          },
          { onConflict: "fin_project_id,slot" },
        );
        if (error) toast(`No se pudo guardar el tramo ${slot}: ${error.message}`);
      } else {
        await supabase.from("fin_recurrences").delete().eq("fin_project_id", pid).eq("slot", slot);
      }
    }
    setSaving(false);
    toast(project ? "Proyecto actualizado" : "Proyecto creado");
    onSaved();
    onClose();
  }

  async function remove() {
    if (project && (await del("fin_projects", project.id, `el proyecto «${project.name}» y sus tramos`))) {
      onSaved();
      onClose();
    }
  }

  // Función (no componente) para que los campos no pierdan el foco al escribir
  const recFields = (d: RecDraft, set: (d: RecDraft) => void, n: number) => (
    <div className="fin-form-block">
      <label className="links-check">
        <input type="checkbox" checked={d.enabled} onChange={(e) => set({ ...d, enabled: e.target.checked })} />
        <span>Tramo de recurrencia {n}</span>
      </label>
      {d.enabled && (
        <>
          <div className="field-row">
            <div className="field">
              <label>Título</label>
              <input value={d.title} onChange={(e) => set({ ...d, title: e.target.value })} placeholder="Meses 1-6, Mes 7+…" />
            </div>
            <NumField label="Cliente €/mes" value={d.client} onChange={(v) => set({ ...d, client: v })} />
          </div>
          <div className="field-row">
            <NumField label="Dev $/mes" value={d.devUsd} onChange={(v) => set({ ...d, devUsd: v })} />
            <NumField label="Infra €/mes" value={d.infra} onChange={(v) => set({ ...d, infra: v })} />
          </div>
          <div className="field">
            <label>Texto del coste dev (opcional)</label>
            <input value={d.devTxt} onChange={(e) => set({ ...d, devTxt: e.target.value })} placeholder="Gerardo $X/trim" />
          </div>
          <label className="links-check">
            <input type="checkbox" checked={d.active} onChange={(e) => set({ ...d, active: e.target.checked })} />
            <span>Activa (cuenta en el MRR activo)</span>
          </label>
        </>
      )}
    </div>
  );

  return (
    <Modal title={project ? "Editar proyecto económico" : "Nuevo proyecto económico"} onClose={onClose} onSave={save} saving={saving}>
      <div className="field-row">
        <div className="field">
          <label>Nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!project} />
        </div>
        <div className="field">
          <label>Estado</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as FinProject["status"])}>
            <option value="activo">Activo</option>
            <option value="cerrado">Cerrado</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Proyecto del OPS (opcional)</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">— Sin enlazar —</option>
          {opsOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="fin-form-title">Implementación</div>
      <div className="field-row">
        <NumField label="Acordado €" value={agreed} onChange={setAgreed} />
        <NumField label="Cobrado €" value={collected} onChange={setCollected} />
      </div>
      <div className="field">
        <label>Nota</label>
        <input value={implNote} onChange={(e) => setImplNote(e.target.value)} />
      </div>
      <div className="fin-form-title">Coste dev</div>
      <div className="field-row">
        <NumField label={devCur === "usd" ? "Importe $" : "Importe €"} value={devAmount} onChange={setDevAmount} />
        <div className="field">
          <label>Moneda</label>
          <select value={devCur} onChange={(e) => setDevCur(e.target.value as "usd" | "eur")}>
            <option value="usd">USD</option>
            <option value="eur">EUR</option>
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Quién</label>
          <input value={devWho} onChange={(e) => setDevWho(e.target.value)} />
        </div>
        <div className="field">
          <label>Nota</label>
          <input value={devNote} onChange={(e) => setDevNote(e.target.value)} />
        </div>
      </div>
      <label className="links-check" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={devPaid} onChange={(e) => setDevPaid(e.target.checked)} />
        <span>Pagado</span>
      </label>
      <div className="fin-form-title">Recurrencia</div>
      {recFields(r1, setR1, 1)}
      {recFields(r2, setR2, 2)}
      {project && (
        <button type="button" className="btn btn-sm btn-danger" onClick={remove} style={{ marginTop: 8 }}>
          Borrar proyecto
        </button>
      )}
    </Modal>
  );
}

function InvoiceModal({ invoice, onClose, onSaved }: { invoice?: FinInvoice; onClose: () => void; onSaved: () => void }) {
  const [number, setNumber] = useState(invoice?.number || "");
  const [client, setClient] = useState(invoice?.client || "");
  const [concept, setConcept] = useState(invoice?.concept || "");
  const [date, setDate] = useState(invoice?.date || new Date().toISOString().slice(0, 10));
  const [eur, setEur] = useState(fromNum(invoice?.eur));
  const [usd, setUsd] = useState(fromNum(invoice?.usd));
  const [usdRec, setUsdRec] = useState(fromNum(invoice?.usd_received));
  const [aprox, setAprox] = useState(invoice?.aprox || "");
  const [kind, setKind] = useState(invoice?.kind || "implementacion");
  const [status, setStatus] = useState(invoice?.status || "pendiente");
  const [dateTxt, setDateTxt] = useState(invoice?.date_txt || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!date) {
      toast("Falta la fecha");
      return;
    }
    if ([eur, usd, usdRec].some((v) => v.trim() !== "" && Number.isNaN(toNum(v)))) {
      toast("Revisa los importes: alguno no es un número");
      return;
    }
    setSaving(true);
    const payload = {
      number: number.trim(),
      client: client.trim(),
      concept: concept.trim(),
      date,
      eur: toNum(eur) ?? 0,
      usd: toNum(usd),
      usd_received: toNum(usdRec),
      aprox: aprox.trim() || null,
      kind,
      status,
      date_txt: dateTxt.trim() || null,
    };
    const supabase = createClient();
    const { error } = invoice
      ? await supabase.from("fin_invoices").update(payload).eq("id", invoice.id)
      : await supabase.from("fin_invoices").insert(payload);
    setSaving(false);
    if (error) {
      toast("No se pudo guardar: " + error.message);
      return;
    }
    toast(invoice ? "Factura actualizada" : "Factura creada");
    onSaved();
    onClose();
  }

  async function remove() {
    if (invoice && (await del("fin_invoices", invoice.id, `la factura ${invoice.number}`))) {
      onSaved();
      onClose();
    }
  }

  return (
    <Modal title={invoice ? `Factura ${invoice.number}` : "Nueva factura"} onClose={onClose} onSave={save} saving={saving}>
      <div className="field-row">
        <div className="field">
          <label>Número</label>
          <input value={number} onChange={(e) => setNumber(e.target.value)} autoFocus={!invoice} />
        </div>
        <div className="field">
          <label>Fecha</label>
          <input type="date" className="com-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Cliente</label>
        <input value={client} onChange={(e) => setClient(e.target.value)} />
      </div>
      <div className="field">
        <label>Concepto</label>
        <input value={concept} onChange={(e) => setConcept(e.target.value)} />
      </div>
      <div className="field-row">
        <NumField label="Importe €" value={eur} onChange={setEur} />
        <NumField label="Importe $ (opcional)" value={usd} onChange={setUsd} />
      </div>
      <div className="field-row">
        <NumField label="$ recibidos (opcional)" value={usdRec} onChange={setUsdRec} hint="Para las comisiones" />
        <div className="field">
          <label>Aproximado (opcional)</label>
          <input value={aprox} onChange={(e) => setAprox(e.target.value)} placeholder="al cambio del día…" />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Tipo</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as FinInvoice["kind"])}>
            <option value="implementacion">Implementación</option>
            <option value="mensualidad">Mensualidad</option>
          </select>
        </div>
        <div className="field">
          <label>Estado</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as FinInvoice["status"])}>
            <option value="cobrada">Cobrada</option>
            <option value="pendiente">Pendiente</option>
            <option value="parcial">Parcial</option>
            <option value="abono">Abono</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Fecha en texto (opcional)</label>
        <input value={dateTxt} onChange={(e) => setDateTxt(e.target.value)} placeholder="Si se quiere mostrar distinta" />
      </div>
      {invoice && (
        <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
          Borrar factura
        </button>
      )}
    </Modal>
  );
}

function ReceivableModal({
  receivable,
  onClose,
  onSaved,
}: {
  receivable?: FinReceivable;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [project, setProject] = useState(receivable?.project || "");
  const [concept, setConcept] = useState(receivable?.concept || "");
  const [eur, setEur] = useState(fromNum(receivable?.eur));
  const [invoiced, setInvoiced] = useState(receivable?.invoiced ?? false);
  const [inKpi, setInKpi] = useState(receivable?.in_kpi ?? true);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (eur.trim() !== "" && Number.isNaN(toNum(eur))) {
      toast("El importe no es un número");
      return;
    }
    setSaving(true);
    const payload = { project: project.trim(), concept: concept.trim(), eur: toNum(eur) ?? 0, invoiced, in_kpi: inKpi };
    const supabase = createClient();
    const { error } = receivable
      ? await supabase.from("fin_receivables").update(payload).eq("id", receivable.id)
      : await supabase.from("fin_receivables").insert(payload);
    setSaving(false);
    if (error) {
      toast("No se pudo guardar: " + error.message);
      return;
    }
    toast(receivable ? "Cobro actualizado" : "Cobro añadido");
    onSaved();
    onClose();
  }

  async function remove() {
    if (receivable && (await del("fin_receivables", receivable.id, "este cobro pendiente"))) {
      onSaved();
      onClose();
    }
  }

  return (
    <Modal title={receivable ? "Editar cobro pendiente" : "Nuevo cobro pendiente"} onClose={onClose} onSave={save} saving={saving}>
      <div className="field-row">
        <div className="field">
          <label>Proyecto</label>
          <input value={project} onChange={(e) => setProject(e.target.value)} autoFocus={!receivable} />
        </div>
        <NumField label="Importe €" value={eur} onChange={setEur} />
      </div>
      <div className="field">
        <label>Concepto</label>
        <input value={concept} onChange={(e) => setConcept(e.target.value)} />
      </div>
      <label className="links-check" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={invoiced} onChange={(e) => setInvoiced(e.target.checked)} />
        <span>Ya facturado</span>
      </label>
      <label className="links-check" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={inKpi} onChange={(e) => setInKpi(e.target.checked)} />
        <span>Cuenta en el KPI de pendiente (y en el chequeo de integridad)</span>
      </label>
      {receivable && (
        <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
          Borrar cobro
        </button>
      )}
    </Modal>
  );
}
