"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { useProjects } from "@/lib/hooks/useProjects";
import type { FinInvoice, FinPayment, FinProject, FinReceivable, FinRecurrence, FinScheduled } from "@/lib/finance";

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
  status: "activa" | "por_activar" | "cancelada";
  startMonth: string;
  endMonth: string;
  billingDay: string;
  method: "" | "stripe" | "transferencia" | "otro";
};
const recDraft = (r?: FinRecurrence): RecDraft => ({
  enabled: !!r,
  title: r?.title || "",
  client: fromNum(r?.client_eur_month),
  devUsd: fromNum(r?.dev_usd_month),
  devTxt: r?.dev_txt || "",
  infra: fromNum(r?.infra_eur_month),
  status: r?.status || (r?.active ? "activa" : "por_activar"),
  startMonth: r?.start_month || "",
  endMonth: r?.end_month || "",
  billingDay: r?.billing_day ? String(r.billing_day) : "",
  method: r?.method || "",
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
            start_month: d.startMonth || null,
            end_month: d.endMonth || null,
            billing_day: d.billingDay ? Math.min(31, Math.max(1, Number(d.billingDay))) : null,
            method: d.method || null,
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
                <option value="por_activar">Por activar</option>
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
          <div className="field">
            <label>Día de cobro (opcional)</label>
            <input type="number" min={1} max={31} value={d.billingDay} onChange={(e) => set({ ...d, billingDay: e.target.value })} placeholder="1-31" />
          </div>
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
  const [usd, setUsd] = useState(fromNum(base?.usd));
  const [usdRec, setUsdRec] = useState(fromNum(base?.usd_received));
  const [aprox, setAprox] = useState(base?.aprox || "");
  const [kind, setKind] = useState(base?.kind || "implementacion");
  const [status, setStatus] = useState(base?.status || "pendiente");
  const [dateTxt, setDateTxt] = useState(base?.date_txt || "");
  const [finProjectId, setFinProjectId] = useState(base?.fin_project_id || "");
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
      fin_project_id: finProjectId || null,
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
          <label>Fecha</label>
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
