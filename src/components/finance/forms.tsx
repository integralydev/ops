"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { useProjects } from "@/lib/hooks/useProjects";
import {
  eur0,
  fFecha,
  addMonths,
  DEFAULT_PROBABILITY,
  type FinInvoice,
  type FinOpportunity,
  type FinPayment,
  type FinProject,
  type FinReceivable,
  type FinRecurrence,
  type FinScheduled,
  type FinStripePending,
  type OpportunityView,
  type StaleItem,
} from "@/lib/finance";

// Formularios de Finanzas (solo propietarios). Sencillos a propósito.

// --- Formularios -------------------------------------------------------------

// Importes en formato español: "1.975", "1.975,50", "87,5". Un solo punto
// seguido de 1 o 2 cifras ("87.50") se toma como decimal.
export const toNum = (s: string) => {
  let t = s.trim().replace(/[€$\s]/g, "");
  if (t === "") return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+\.\d{1,2}$/.test(t)) t = t; // decimal con punto
  else t = t.replace(/\./g, "");
  return Number(t);
};
export const fromNum = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

export function NumField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const bad = value.trim() !== "" && Number.isNaN(toNum(value));
  return (
    <div className="field">
      <label>{label}</label>
      <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={hint} />
      {bad && <div className="links-error">No es un número</div>}
    </div>
  );
}

export async function del(table: string, id: string, what: string) {
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
  status: "activa" | "confirmada" | "por_activar" | "cancelada";
  probability: string;
  startMonth: string;
  endMonth: string;
  billingDay: string;
  method: "" | "stripe" | "transferencia" | "otro";
  terms: string;
  stripeLink: string;
  stripeCustomer: string;
  stripeEmail: string;
};
const recDraft = (r?: FinRecurrence): RecDraft => ({
  enabled: !!r,
  title: r?.title || "",
  client: fromNum(r?.client_eur_month),
  devUsd: fromNum(r?.dev_usd_month),
  devTxt: r?.dev_txt || "",
  infra: fromNum(r?.infra_eur_month),
  status: r?.status || (r?.active ? "activa" : "por_activar"),
  probability: r?.probability != null ? String(r.probability) : "50",
  startMonth: r?.start_month || "",
  endMonth: r?.end_month || "",
  billingDay: r?.billing_day ? String(r.billing_day) : "",
  method: r?.method || "",
  terms: r?.payment_terms_days ? String(r.payment_terms_days) : "",
  stripeLink: r?.stripe_payment_link || "",
  stripeCustomer: r?.stripe_customer_id || "",
  stripeEmail: r?.stripe_email || "",
});

export function ProjectModal({
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
            status: d.status,
            active: d.status === "activa",
            probability: d.status === "por_activar" ? Math.min(100, Math.max(0, Number(d.probability) || 0)) : null,
            start_month: d.startMonth || null,
            end_month: d.endMonth || null,
            billing_day: d.billingDay ? Math.min(31, Math.max(1, Number(d.billingDay))) : null,
            method: d.method || null,
            payment_terms_days: Math.min(365, Math.max(0, Number(d.terms) || 0)),
            stripe_payment_link: d.stripeLink.trim() || null,
            stripe_customer_id: d.stripeCustomer.trim() || null,
            stripe_email: d.stripeEmail.trim() || null,
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
              <input type="text" value={d.title} onChange={(e) => set({ ...d, title: e.target.value })} placeholder="Meses 1-6, Mes 7+…" />
            </div>
            <NumField label="Cliente €/mes" value={d.client} onChange={(v) => set({ ...d, client: v })} />
          </div>
          <div className="field-row">
            <NumField label="Dev $/mes" value={d.devUsd} onChange={(v) => set({ ...d, devUsd: v })} />
            <NumField label="Infra €/mes" value={d.infra} onChange={(v) => set({ ...d, infra: v })} />
          </div>
          <div className="field">
            <label>Texto del coste dev (opcional)</label>
            <input type="text" value={d.devTxt} onChange={(e) => set({ ...d, devTxt: e.target.value })} placeholder="Gerardo $X/trim" />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Estado</label>
              <select value={d.status} onChange={(e) => set({ ...d, status: e.target.value as RecDraft["status"] })}>
                <option value="activa">Activa</option>
                <option value="confirmada">Confirmada (pendiente del primer cobro)</option>
                <option value="por_activar">Por activar (probable)</option>
                <option value="cancelada">Cancelada</option>
              </select>
            </div>
            <div className="field">
              <label>Cobro</label>
              <select value={d.method} onChange={(e) => set({ ...d, method: e.target.value as RecDraft["method"] })}>
                <option value="">—</option>
                <option value="stripe">Stripe</option>
                <option value="transferencia">Transferencia</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          </div>
          {d.status === "por_activar" && (
            <div className="field">
              <label>Probabilidad de que se active (%)</label>
              <input type="number" min={0} max={100} value={d.probability} onChange={(e) => set({ ...d, probability: e.target.value })} />
            </div>
          )}
          <div className="field-row">
            <div className="field">
              <label>Desde (mes)</label>
              <input type="month" className="com-input" value={d.startMonth} onChange={(e) => set({ ...d, startMonth: e.target.value })} />
            </div>
            <div className="field">
              <label>Hasta (vacío = indefinida)</label>
              <input type="month" className="com-input" value={d.endMonth} onChange={(e) => set({ ...d, endMonth: e.target.value })} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Día de cobro (opcional)</label>
              <input type="number" min={1} max={31} value={d.billingDay} onChange={(e) => set({ ...d, billingDay: e.target.value })} placeholder="1-31" />
            </div>
            <div className="field">
              <label>Días de pago</label>
              <input type="number" min={0} max={365} value={d.terms} onChange={(e) => set({ ...d, terms: e.target.value })} placeholder="0" />
            </div>
          </div>
          {d.method === "stripe" && (
            <>
              <div className="muted" style={{ fontSize: 11.8, margin: "2px 0 8px" }}>
                Con cualquiera de estos tres, los cobros de Stripe entran solos (se prueba en este orden).
              </div>
              <div className="field">
                <label>Payment Link (plink_…)</label>
                <input type="text" value={d.stripeLink} onChange={(e) => set({ ...d, stripeLink: e.target.value })} placeholder="plink_…" />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Customer (cus_…)</label>
                  <input type="text" value={d.stripeCustomer} onChange={(e) => set({ ...d, stripeCustomer: e.target.value })} placeholder="cus_…" />
                </div>
                <div className="field">
                  <label>Email con el que paga</label>
                  <input type="text" value={d.stripeEmail} onChange={(e) => set({ ...d, stripeEmail: e.target.value })} />
                </div>
              </div>
            </>
          )}
          <div className="muted" style={{ fontSize: 11.8 }}>
            El coste dev e infra del tramo solo cuenta para la rentabilidad (margen medio). En la previsión, las salidas son los
            programados.
          </div>
        </>
      )}
    </div>
  );

  return (
    <Modal title={project ? "Editar proyecto económico" : "Nuevo proyecto económico"} onClose={onClose} onSave={save} saving={saving}>
      <div className="field-row">
        <div className="field">
          <label>Nombre</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!project} />
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
        <input type="text" value={implNote} onChange={(e) => setImplNote(e.target.value)} />
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
          <input type="text" value={devWho} onChange={(e) => setDevWho(e.target.value)} />
        </div>
        <div className="field">
          <label>Nota</label>
          <input type="text" value={devNote} onChange={(e) => setDevNote(e.target.value)} />
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

export function InvoiceModal({
  invoice,
  prefill,
  closeScheduledId,
  finProjects,
  onClose,
  onSaved,
}: {
  invoice?: FinInvoice;
  /** Nueva factura con datos ya puestos (p. ej. "Facturado" desde la previsión). */
  prefill?: Partial<FinInvoice>;
  /** Programado único que queda cerrado al crear la factura. */
  closeScheduledId?: string;
  finProjects: FinProject[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const base = invoice || prefill;
  const [number, setNumber] = useState(base?.number || "");
  const [client, setClient] = useState(base?.client || "");
  const [concept, setConcept] = useState(base?.concept || "");
  const [date, setDate] = useState(base?.date || new Date().toISOString().slice(0, 10));
  const [eur, setEur] = useState(fromNum(base?.eur));
  const [status, setStatus] = useState(base?.status || "pendiente");
  const [usd, setUsd] = useState(fromNum(base?.usd));
  const [usdRec, setUsdRec] = useState(fromNum(base?.usd_received));
  const [aprox, setAprox] = useState(base?.aprox || "");
  const [kind, setKind] = useState(base?.kind || "implementacion");
  const [dateTxt, setDateTxt] = useState(base?.date_txt || "");
  const [finProjectId, setFinProjectId] = useState(base?.fin_project_id || "");
  // Fecha de cobro (caja). Vacía en una cobrada = la fecha de factura.
  const [paidDate, setPaidDate] = useState(base?.paid_date || "");
  const [saving, setSaving] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);

  function changeStatus(next: FinInvoice["status"]) {
    // Al pasar a cobrada se pide la fecha de cobro: por defecto, hoy
    if (next === "cobrada" && status !== "cobrada" && !paidDate) setPaidDate(todayStr);
    setStatus(next);
  }

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
      fin_project_id: finProjectId || null,
      paid_date: status === "cobrada" ? paidDate || null : null,
      ...(!invoice && prefill?.scheduled_id
        ? { scheduled_id: prefill.scheduled_id, scheduled_period: prefill.scheduled_period || null }
        : {}),
    };
    const supabase = createClient();
    const { error } = invoice
      ? await supabase.from("fin_invoices").update(payload).eq("id", invoice.id)
      : await supabase.from("fin_invoices").insert(payload);
    if (!error && closeScheduledId) await supabase.from("fin_scheduled").update({ closed: true }).eq("id", closeScheduledId);
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
          <input type="text" value={number} onChange={(e) => setNumber(e.target.value)} autoFocus={!invoice} />
        </div>
        <div className="field">
          <label>Fecha de factura</label>
          <input type="date" className="com-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Cliente</label>
        <input type="text" value={client} onChange={(e) => setClient(e.target.value)} />
      </div>
      <div className="field">
        <label>Concepto</label>
        <input type="text" value={concept} onChange={(e) => setConcept(e.target.value)} />
      </div>
      <div className="field">
        <label>Proyecto económico (para no contar dos veces la mensualidad)</label>
        <select value={finProjectId} onChange={(e) => setFinProjectId(e.target.value)}>
          <option value="">—</option>
          {finProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <NumField label="Importe €" value={eur} onChange={setEur} />
        <NumField label="Importe $ (opcional)" value={usd} onChange={setUsd} />
      </div>
      <div className="field-row">
        <NumField label="$ recibidos (opcional)" value={usdRec} onChange={setUsdRec} hint="Para las comisiones" />
        <div className="field">
          <label>Aproximado (opcional)</label>
          <input type="text" value={aprox} onChange={(e) => setAprox(e.target.value)} placeholder="al cambio del día…" />
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
          <select value={status} onChange={(e) => changeStatus(e.target.value as FinInvoice["status"])}>
            <option value="cobrada">Cobrada</option>
            <option value="pendiente">Pendiente</option>
            <option value="parcial">Parcial</option>
            <option value="abono">Abono</option>
          </select>
        </div>
      </div>
      {status === "cobrada" && (
        <div className="field">
          <label>Fecha de cobro (cuándo llegó el dinero)</label>
          <input type="date" className="com-input" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          {!paidDate && <div className="muted" style={{ fontSize: 11.8, marginTop: 4 }}>Vacía: cuenta la fecha de la factura.</div>}
        </div>
      )}
      <div className="field">
        <label>Fecha en texto (opcional)</label>
        <input type="text" value={dateTxt} onChange={(e) => setDateTxt(e.target.value)} placeholder="Si se quiere mostrar distinta" />
      </div>
      {invoice && (
        <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
          Borrar factura
        </button>
      )}
    </Modal>
  );
}

export function ReceivableModal({
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
          <input type="text" value={project} onChange={(e) => setProject(e.target.value)} autoFocus={!receivable} />
        </div>
        <NumField label="Importe €" value={eur} onChange={setEur} />
      </div>
      <div className="field">
        <label>Concepto</label>
        <input type="text" value={concept} onChange={(e) => setConcept(e.target.value)} />
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

// --- Programados y pagos hechos ----------------------------------------------

export function ScheduledModal({
  scheduled,
  finProjects,
  onClose,
  onSaved,
}: {
  scheduled?: FinScheduled;
  finProjects: FinProject[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [direction, setDirection] = useState(scheduled?.direction || "salida");
  const [concept, setConcept] = useState(scheduled?.concept || "");
  const [counterparty, setCounterparty] = useState(scheduled?.counterparty || "");
  const [finProjectId, setFinProjectId] = useState(scheduled?.fin_project_id || "");
  const [cur, setCur] = useState<"eur" | "usd">(scheduled?.amount_usd != null ? "usd" : "eur");
  const [amount, setAmount] = useState(fromNum(scheduled?.amount_usd ?? scheduled?.amount_eur));
  const [frequency, setFrequency] = useState(scheduled?.frequency || "unica");
  const [date, setDate] = useState(scheduled?.date || new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(scheduled?.end_date || "");
  const [certainty, setCertainty] = useState(scheduled?.certainty || "confirmado");
  const [probability, setProbability] = useState(scheduled?.probability != null ? String(scheduled.probability) : "50");
  const [note, setNote] = useState(scheduled?.note || "");
  const [closed, setClosed] = useState(scheduled?.closed || false);
  const [kind, setKind] = useState<FinScheduled["kind"]>(scheduled?.kind || "otro");
  const [saving, setSaving] = useState(false);

  async function save() {
    const a = toNum(amount);
    if (!concept.trim() || a == null || Number.isNaN(a)) {
      toast("Falta el concepto o el importe");
      return;
    }
    setSaving(true);
    const payload = {
      direction,
      concept: concept.trim(),
      counterparty: counterparty.trim(),
      fin_project_id: finProjectId || null,
      amount_eur: cur === "eur" ? a : null,
      amount_usd: cur === "usd" ? a : null,
      frequency,
      date,
      end_date: frequency === "unica" ? null : endDate || null,
      certainty,
      probability: certainty === "probable" ? Math.min(100, Math.max(0, Number(probability) || 0)) : null,
      note: note.trim(),
      closed,
      kind: direction === "salida" ? kind : "otro",
    };
    const supabase = createClient();
    const { error } = scheduled
      ? await supabase.from("fin_scheduled").update(payload).eq("id", scheduled.id)
      : await supabase.from("fin_scheduled").insert(payload);
    setSaving(false);
    if (error) {
      toast("No se pudo guardar: " + error.message);
      return;
    }
    toast(scheduled ? "Programado actualizado" : "Programado creado");
    onSaved();
    onClose();
  }

  async function remove() {
    if (scheduled && (await del("fin_scheduled", scheduled.id, `«${scheduled.concept}»`))) {
      onSaved();
      onClose();
    }
  }

  return (
    <Modal title={scheduled ? "Editar programado" : "Nuevo movimiento programado"} onClose={onClose} onSave={save} saving={saving}>
      <div className="field-row">
        <div className="field">
          <label>Tipo</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as FinScheduled["direction"])}>
            <option value="salida">Salida (pago)</option>
            <option value="entrada">Entrada (cobro)</option>
          </select>
        </div>
        <div className="field">
          <label>Certeza</label>
          <select value={certainty} onChange={(e) => setCertainty(e.target.value as FinScheduled["certainty"])}>
            <option value="confirmado">Confirmado</option>
            <option value="probable">Probable</option>
          </select>
        </div>
      </div>
      {direction === "salida" && (
        <div className="field">
          <label>Tipo de salida (para agruparla)</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as FinScheduled["kind"])}>
            <option value="gasto_fijo">Gasto fijo</option>
            <option value="infra">Infra</option>
            <option value="dev">Dev</option>
            <option value="comercial">Comercial</option>
            <option value="comision">Comisión</option>
            <option value="otro">Otro</option>
          </select>
        </div>
      )}
      {certainty === "probable" && (
        <div className="field">
          <label>Probabilidad (%)</label>
          <input type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label>Concepto</label>
        <input type="text" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Gestoría, pago trimestral dev, comisión…" autoFocus={!scheduled} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>{direction === "salida" ? "A quién" : "De quién"}</label>
          <input type="text" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
        </div>
        <div className="field">
          <label>Proyecto (opcional)</label>
          <select value={finProjectId} onChange={(e) => setFinProjectId(e.target.value)}>
            <option value="">—</option>
            {finProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field-row">
        <NumField label={cur === "usd" ? "Importe $" : "Importe €"} value={amount} onChange={setAmount} />
        <div className="field">
          <label>Moneda</label>
          <select value={cur} onChange={(e) => setCur(e.target.value as "eur" | "usd")}>
            <option value="eur">EUR</option>
            <option value="usd">USD (se pasa a € con el tipo de cambio)</option>
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Frecuencia</label>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as FinScheduled["frequency"])}>
            <option value="unica">Única</option>
            <option value="mensual">Mensual</option>
            <option value="trimestral">Trimestral</option>
            <option value="anual">Anual</option>
          </select>
        </div>
        <div className="field">
          <label>{frequency === "unica" ? "Fecha" : "Primer cargo"}</label>
          <input type="date" className="com-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      {frequency !== "unica" && (
        <div className="field">
          <label>Hasta (opcional)</label>
          <input type="date" className="com-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label>Nota</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {scheduled && (
        <label className="links-check" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
          <span>Cerrado (ya no sale en la previsión)</span>
        </label>
      )}
      {scheduled && (
        <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
          Borrar programado
        </button>
      )}
    </Modal>
  );
}

export function PaymentModal({
  payment,
  prefill,
  closeScheduledId,
  finProjects,
  onClose,
  onSaved,
}: {
  payment?: FinPayment;
  /** "Marcar como pagado": datos del programado y su cuota. */
  prefill?: Partial<FinPayment>;
  closeScheduledId?: string;
  finProjects: FinProject[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const base = payment || prefill;
  const [date, setDate] = useState(base?.date || new Date().toISOString().slice(0, 10));
  const [concept, setConcept] = useState(base?.concept || "");
  const [counterparty, setCounterparty] = useState(base?.counterparty || "");
  const [cur, setCur] = useState<"eur" | "usd">(base?.amount_usd != null ? "usd" : "eur");
  const [amount, setAmount] = useState(fromNum(base?.amount_usd ?? base?.amount_eur));
  const [finProjectId, setFinProjectId] = useState(base?.fin_project_id || "");
  const [kind, setKind] = useState(base?.kind || "otro");
  const [saving, setSaving] = useState(false);

  async function save() {
    const a = toNum(amount);
    if (a == null || Number.isNaN(a)) {
      toast("Falta el importe pagado");
      return;
    }
    setSaving(true);
    const payload = {
      date,
      concept: concept.trim(),
      counterparty: counterparty.trim(),
      amount_eur: cur === "eur" ? a : null,
      amount_usd: cur === "usd" ? a : null,
      fin_project_id: finProjectId || null,
      kind,
      ...(!payment && prefill?.scheduled_id ? { scheduled_id: prefill.scheduled_id, period: prefill.period || null } : {}),
    };
    const supabase = createClient();
    const { error } = payment
      ? await supabase.from("fin_payments_out").update(payload).eq("id", payment.id)
      : await supabase.from("fin_payments_out").insert(payload);
    if (!error && closeScheduledId) await supabase.from("fin_scheduled").update({ closed: true }).eq("id", closeScheduledId);
    setSaving(false);
    if (error) {
      toast("No se pudo guardar: " + error.message);
      return;
    }
    toast(payment ? "Pago actualizado" : "Pago registrado");
    onSaved();
    onClose();
  }

  async function remove() {
    if (payment && (await del("fin_payments_out", payment.id, "este pago"))) {
      onSaved();
      onClose();
    }
  }

  return (
    <Modal
      title={payment ? "Editar pago hecho" : prefill?.scheduled_id ? "Marcar como pagado" : "Nuevo pago hecho"}
      onClose={onClose}
      onSave={save}
      saving={saving}
    >
      {prefill?.scheduled_id && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          Pon el importe real que ha salido; viene puesto el previsto.
        </p>
      )}
      <div className="field-row">
        <div className="field">
          <label>Fecha del pago</label>
          <input type="date" className="com-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Tipo</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as FinPayment["kind"])}>
            <option value="dev">Dev</option>
            <option value="comision">Comisión</option>
            <option value="comercial">Comercial</option>
            <option value="gasto_fijo">Gasto fijo</option>
            <option value="infra">Infra</option>
            <option value="otro">Otro</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Concepto</label>
        <input type="text" value={concept} onChange={(e) => setConcept(e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>A quién</label>
          <input type="text" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
        </div>
        <div className="field">
          <label>Proyecto (opcional)</label>
          <select value={finProjectId} onChange={(e) => setFinProjectId(e.target.value)}>
            <option value="">—</option>
            {finProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field-row">
        <NumField label={cur === "usd" ? "Importe pagado $" : "Importe pagado €"} value={amount} onChange={setAmount} />
        <div className="field">
          <label>Moneda</label>
          <select value={cur} onChange={(e) => setCur(e.target.value as "eur" | "usd")}>
            <option value="eur">EUR</option>
            <option value="usd">USD</option>
          </select>
        </div>
      </div>
      {payment && (
        <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
          Borrar pago
        </button>
      )}
    </Modal>
  );
}

// --- Lo que pide atención ------------------------------------------------------

/** Cuota de un programado con fecha pasada: moverla a otra fecha o descartarla. */
export function SkipModal({ item, onClose, onSaved }: { item: StaleItem; onClose: () => void; onSaved: () => void }) {
  const sc = item.scheduled;
  const [mode, setMode] = useState<"mover" | "descartar">(item.probable ? "descartar" : "mover");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (mode === "mover" && !date) {
      toast("Pon la fecha nueva");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    let error;
    if (sc.frequency === "unica") {
      ({ error } = await supabase
        .from("fin_scheduled")
        .update(mode === "mover" ? { date } : { closed: true })
        .eq("id", sc.id));
    } else {
      // Recurrente: se salta esta cuota y, si se mueve, queda como única en la fecha nueva
      ({ error } = await supabase
        .from("fin_scheduled")
        .update({ skipped: [...sc.skipped, item.period] })
        .eq("id", sc.id));
      if (!error && mode === "mover") {
        ({ error } = await supabase.from("fin_scheduled").insert({
          direction: sc.direction,
          concept: sc.concept,
          counterparty: sc.counterparty,
          fin_project_id: sc.fin_project_id,
          amount_eur: sc.amount_eur,
          amount_usd: sc.amount_usd,
          frequency: "unica",
          date,
          certainty: sc.certainty,
          probability: sc.probability,
          note: `Movido desde ${fFecha(item.period)}`,
          kind: sc.kind,
        }));
      }
    }
    setSaving(false);
    if (error) {
      toast("No se pudo guardar: " + error.message);
      return;
    }
    toast(mode === "mover" ? "Fecha cambiada" : "Descartado");
    onSaved();
    onClose();
  }

  const salida = sc.direction === "salida";
  return (
    <Modal title={item.probable ? "Probable con fecha pasada" : `No se ${salida ? "pagó" : "cobró"}`} onClose={onClose} onSave={save} saving={saving}>
      <p style={{ marginTop: 0, fontSize: 13.5 }}>
        <b>{sc.concept}</b> · {eur0(item.eur)} · previsto el {fFecha(item.period)}
        {sc.frequency !== "unica" && <span className="muted"> (solo esta cuota; las siguientes siguen igual)</span>}
      </p>
      <label className="links-check" style={{ marginBottom: 8 }}>
        <input type="radio" checked={mode === "mover"} onChange={() => setMode("mover")} />
        <span>Moverlo a otra fecha</span>
      </label>
      {mode === "mover" && (
        <div className="field" style={{ marginLeft: 24 }}>
          <input type="date" className="com-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}
      <label className="links-check">
        <input type="radio" checked={mode === "descartar"} onChange={() => setMode("descartar")} />
        <span>{item.probable ? "Descartarlo" : `No se ${salida ? "pagará" : "cobrará"}: descartarlo`}</span>
      </label>
    </Modal>
  );
}

/** Cobro de Stripe de un customer sin vincular: se vincula a un proyecto y se crea la factura. */
export function StripePendingRow({
  item,
  projects,
  recs,
  fx,
  onSaved,
}: {
  item: FinStripePending;
  projects: FinProject[];
  recs: FinRecurrence[];
  fx: number;
  onSaved: () => void;
}) {
  const withRecs = projects.filter((p) => recs.some((r) => r.fin_project_id === p.id && r.status !== "cancelada"));
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);

  async function link() {
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      toast("Elige el proyecto");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    // 1) Lo que identifica al cliente en Stripe queda en sus mensualidades: los siguientes cobros entran solos
    const keys = {
      ...(item.payment_link ? { stripe_payment_link: item.payment_link } : {}),
      ...(item.customer_id ? { stripe_customer_id: item.customer_id } : {}),
      ...(item.email ? { stripe_email: item.email } : {}),
    };
    let { error } = await supabase.from("fin_recurrences").update(keys).eq("fin_project_id", project.id).neq("status", "cancelada");
    // 2) Este cobro (y otros pendientes del mismo cliente) pasan a facturas cobradas
    if (!error) {
      const { data: rows } = await supabase.from("fin_stripe_pending").select("*");
      const same = (x: FinStripePending) =>
        x.id === item.id ||
        (!!item.payment_link && x.payment_link === item.payment_link) ||
        (!!item.customer_id && x.customer_id === item.customer_id) ||
        (!!item.email && x.email.toLowerCase() === item.email.toLowerCase());
      for (const x of ((rows || []) as FinStripePending[]).filter(same)) {
        const amount = Number(x.amount);
        const usd = x.currency === "usd";
        ({ error } = await supabase.from("fin_invoices").insert({
          number: x.number,
          client: project.name,
          concept: x.concept,
          date: x.paid_date,
          paid_date: x.paid_date,
          eur: usd ? Math.round(amount * fx * 100) / 100 : amount,
          usd: usd ? amount : null,
          kind: "mensualidad",
          status: "cobrada",
          fin_project_id: project.id,
          stripe_invoice_id: x.stripe_invoice_id,
        }));
        if (error) break;
        await supabase.from("fin_stripe_pending").delete().eq("id", x.id);
      }
    }
    setBusy(false);
    if (error) {
      toast("No se pudo vincular: " + error.message);
      return;
    }
    toast(`Vinculado a ${project.name}`);
    onSaved();
  }

  async function discard() {
    if (await del("fin_stripe_pending", item.id, "este cobro de Stripe (no se creará factura)")) onSaved();
  }

  return (
    <div className="fin-attn-row">
      <span className="fin-move-date">{fFecha(item.paid_date)}</span>
      <span>
        {item.customer_name || item.email || item.customer_id || "Sin nombre"}{" "}
        <span className="muted">
          · {item.number} · {item.concept}
          {item.payment_link ? " · por enlace de pago" : ""}
        </span>
      </span>
      <span className="fin-move-amount fin-in">
        +{item.currency === "usd" ? `$${item.amount}` : eur0(item.amount)}
      </span>
      <span className="fin-attn-acts">
        <select className="com-input fin-attn-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Vincular a…</option>
          {withRecs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={link} disabled={busy || !projectId}>
          Vincular
        </button>
        <button className="btn btn-sm" onClick={discard} disabled={busy}>
          Descartar
        </button>
      </span>
    </div>
  );
}

// --- Oportunidades ---------------------------------------------------------------
// Importes de un proyecto del OPS que aún no se ha cerrado. Viven en
// fin_opportunities (solo propietarios): nunca en la ficha del proyecto.

export function OpportunityModal({ view, onClose, onSaved }: { view: OpportunityView; onClose: () => void; onSaved: () => void }) {
  const o = view.opp;
  const label = view.project.client ? `${view.project.client} · ${view.project.name}` : view.project.name;
  const [amount, setAmount] = useState(fromNum(o?.amount_eur));
  const [monthly, setMonthly] = useState(fromNum(o?.monthly_eur));
  const [probability, setProbability] = useState(String(o?.probability ?? DEFAULT_PROBABILITY[view.project.status] ?? 30));
  const [close, setClose] = useState(o?.expected_close || view.closeMonth);
  const [firstPct, setFirstPct] = useState(String(o?.first_payment_pct ?? 50));
  const [delivery, setDelivery] = useState(String(o?.delivery_months ?? 2));
  const [note, setNote] = useState(o?.note || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const a = toNum(amount);
    const m = toNum(monthly);
    if ([a, m].some((v) => v != null && Number.isNaN(v))) {
      toast("Revisa los importes: alguno no es un número");
      return;
    }
    setSaving(true);
    const payload = {
      project_id: view.project.id,
      amount_eur: a,
      monthly_eur: m,
      probability: Math.min(100, Math.max(0, Number(probability) || 0)),
      expected_close: close || null,
      first_payment_pct: Math.min(100, Math.max(0, Number(firstPct) || 0)),
      delivery_months: Math.min(24, Math.max(0, Number(delivery) || 0)),
      note: note.trim(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await createClient().from("fin_opportunities").upsert(payload, { onConflict: "project_id" });
    setSaving(false);
    if (error) {
      toast("No se pudo guardar: " + error.message);
      return;
    }
    toast("Oportunidad guardada");
    onSaved();
    onClose();
  }

  async function remove() {
    if (o && (await del("fin_opportunities", o.id, `los importes de «${label}»`))) {
      onSaved();
      onClose();
    }
  }

  return (
    <Modal title={label} onClose={onClose} onSave={save} saving={saving}>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Estado en el OPS: <b>{view.project.status}</b>. Solo tú ves estos importes; en la ficha del proyecto no aparecen.
      </div>
      <div className="field-row">
        <NumField label="Implementación €" value={amount} onChange={setAmount} />
        <NumField label="Mensualidad €/mes" value={monthly} onChange={setMonthly} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Probabilidad (%)</label>
          <input type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} />
        </div>
        <div className="field">
          <label>Mes previsto de cierre</label>
          <input type="month" className="com-input" value={close} onChange={(e) => setClose(e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Primer pago al cerrar (%)</label>
          <input type="number" min={0} max={100} value={firstPct} onChange={(e) => setFirstPct(e.target.value)} />
        </div>
        <div className="field">
          <label>Meses hasta la entrega</label>
          <input type="number" min={0} max={24} value={delivery} onChange={(e) => setDelivery(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Nota</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {o && (
        <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
          Borrar importes
        </button>
      )}
    </Modal>
  );
}

/**
 * Oportunidad ganada → confirmada: crea el proyecto económico, los pagos de la
 * implementación como entradas programadas confirmadas y la mensualidad como
 * 'confirmada' (pendiente del primer cobro). Devuelve true si todo fue bien.
 */
export async function convertOpportunity(view: OpportunityView, today: string) {
  const o = view.opp as FinOpportunity;
  const label = view.project.client ? `${view.project.client} · ${view.project.name}` : view.project.name;
  if (!o.amount_eur) {
    toast("Falta el importe de la implementación");
    return false;
  }
  if (!confirm(`¿Pasar «${label}» a confirmado? Se crea el proyecto en Finanzas con sus pagos y su mensualidad.`)) return false;
  const supabase = createClient();
  const { data: fp, error } = await supabase
    .from("fin_projects")
    .insert({ name: label, status: "activo", project_id: view.project.id, agreed_eur: o.amount_eur, collected_eur: 0, impl_note: "", dev_who: "", dev_paid: false, dev_note: "" })
    .select("id")
    .single();
  if (error || !fp) {
    toast("No se pudo crear el proyecto: " + (error?.message || ""));
    return false;
  }
  const close = view.closeMonth;
  const delivery = addMonths(close, o.delivery_months);
  const on = (m: string) => {
    const d = `${m}-15`;
    return d < today ? today : d;
  };
  const first = Math.round(((o.amount_eur * o.first_payment_pct) / 100) * 100) / 100;
  const rest = Math.round((o.amount_eur - first) * 100) / 100;
  const rows = [
    first > 0 && { concept: `Implementación — primer pago (${o.first_payment_pct}%)`, amount_eur: first, date: on(close) },
    rest > 0 && { concept: "Implementación — pago a la entrega", amount_eur: rest, date: on(delivery) },
  ].filter(Boolean) as { concept: string; amount_eur: number; date: string }[];
  for (const r of rows) {
    const { error: e } = await supabase.from("fin_scheduled").insert({
      ...r,
      direction: "entrada",
      counterparty: label,
      fin_project_id: fp.id,
      frequency: "unica",
      certainty: "confirmado",
      kind: "otro",
      note: "",
    });
    if (e) toast("No se pudo crear un pago: " + e.message);
  }
  if (o.monthly_eur) {
    const { error: e } = await supabase.from("fin_recurrences").insert({
      fin_project_id: fp.id,
      slot: 1,
      title: "",
      client_eur_month: o.monthly_eur,
      dev_usd_month: 0,
      dev_txt: "",
      infra_eur_month: 0,
      status: "confirmada",
      active: false,
      start_month: addMonths(delivery, 1),
      billing_day: 1,
    });
    if (e) toast("No se pudo crear la mensualidad: " + e.message);
  }
  await supabase
    .from("fin_opportunities")
    .update({ converted_fin_project_id: fp.id, converted_at: new Date().toISOString() })
    .eq("id", o.id);
  toast("Pasado a confirmado. Revisa el coste de dev en Rentabilidad.");
  return true;
}
