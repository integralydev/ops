"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useAppData } from "@/components/app-data";
import { useFiles, useOnboardingSteps } from "@/lib/hooks/useProjectDetail";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { fmtDate, fmtDateTime, looksLikeSecret } from "@/lib/format";
import type {
  OnboardingChannel,
  OnboardingStep,
  OnboardingStepKey,
  OnboardingTrack,
  Project,
} from "@/lib/database.types";

const STEPS: { key: OnboardingStepKey; label: Record<OnboardingTrack | "none", string>; hint: string }[] = [
  {
    key: "propuesta",
    label: { implementacion: "Propuesta aceptada", diagnostico: "Diagnóstico aceptado", none: "Propuesta aceptada" },
    hint: "El cliente ha dicho que sí, por escrito o de palabra.",
  },
  {
    key: "contrato",
    label: { implementacion: "Contrato firmado", diagnostico: "Contrato del diagnóstico firmado", none: "Contrato firmado" },
    hint: "Adjunta el PDF firmado si lo tienes en Archivos.",
  },
  {
    key: "primer_pago",
    label: { implementacion: "Primer pago recibido", diagnostico: "Pago del diagnóstico recibido", none: "Primer pago recibido" },
    hint: "Sin importes: el dinero se lleva en Finanzas.",
  },
  {
    key: "reunion_inicio",
    label: { implementacion: "Reunión de inicio", diagnostico: "Primera sesión del diagnóstico", none: "Reunión de inicio" },
    hint: "Puedes apuntar cuándo está agendada antes de que se haga.",
  },
];

const CHANNELS: { value: OnboardingChannel; label: string }[] = [
  { value: "correo", label: "Correo" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "llamada", label: "Llamada" },
  { value: "en_persona", label: "En persona" },
  { value: "stripe", label: "Stripe" },
  { value: "banco", label: "Transferencia" },
  { value: "portal", label: "Portal" },
  { value: "otro", label: "Otro" },
];

const TRACKS: { value: OnboardingTrack; label: string }[] = [
  { value: "implementacion", label: "Implementación" },
  { value: "diagnostico", label: "Diagnóstico de pago" },
];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// datetime-local <-> ISO, en la hora local del navegador
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Pestaña "Arranque" (solo admin y director, también por RLS): cómo va el
// arranque del proyecto. Cada paso se marca hecho por el canal que sea; nada
// obliga a que el cliente use el portal. Es un registro, no un flujo.
export function ArranqueTab({ project }: { project: Project }) {
  const { nameFor } = useAppData();
  const { rows, loading, upsertLocal } = useOnboardingSteps(project.id);
  const { rows: files } = useFiles(project.id);
  const [editing, setEditing] = useState<OnboardingStepKey | null>(null);
  const [track, setTrack] = useState<OnboardingTrack | null>(project.onboarding_track ?? null);

  const byKey = Object.fromEntries(Object.values(rows).map((r) => [r.step, r])) as Partial<
    Record<OnboardingStepKey, OnboardingStep>
  >;
  const done = STEPS.filter((s) => byKey[s.key]?.done_on).length;
  const next = STEPS.find((s) => !byKey[s.key]?.done_on);
  const trackKey = track || "none";

  async function changeTrack(value: string) {
    const t = (value || null) as OnboardingTrack | null;
    const prev = track;
    setTrack(t);
    const { error, data } = await createClient()
      .from("projects")
      .update({ onboarding_track: t })
      .eq("id", project.id)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      setTrack(prev);
      toast("No se pudo guardar" + (error ? ": " + error.message : ": no tienes permiso"));
    }
  }

  async function undo(step: OnboardingStep) {
    if (!confirm("¿Volver a dejar este paso como pendiente? La nota y el archivo se mantienen.")) return;
    const { data, error } = await createClient()
      .from("project_onboarding_steps")
      .update({ done_on: null, done_by: null })
      .eq("id", step.id)
      .select()
      .maybeSingle();
    if (error || !data) {
      toast("No se pudo guardar" + (error ? ": " + error.message : ": no tienes permiso"));
      return;
    }
    upsertLocal(data as OnboardingStep);
  }

  return (
    <div className="card pad">
      <div className="links-help">
        <span aria-hidden>🚪</span>
        <span>
          Cómo va el arranque. Marca cada paso cuando quede cerrado, <b>por el canal que sea</b> (correo, WhatsApp, llamada,
          en persona…): nada depende de que el cliente entre al portal. Solo lo ven admin y directores.
        </span>
      </div>

      <div className="row between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12.6 }}>
            Arranca con
          </span>
          <select value={track || ""} onChange={(e) => changeTrack(e.target.value)}>
            <option value="">Sin decidir</option>
            {TRACKS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <span className="muted" style={{ fontSize: 12.6 }}>
          {done === STEPS.length ? "Arranque completo ✓" : `${done} de ${STEPS.length} · ahora: ${next?.label[trackKey]}`}
        </span>
      </div>

      {loading ? (
        <div className="empty">Cargando…</div>
      ) : (
        <ol className="arranque-list">
          {STEPS.map((s, i) => {
            const r = byKey[s.key];
            const isDone = !!r?.done_on;
            const file = r?.file_id ? files[r.file_id] : undefined;
            const channel = CHANNELS.find((c) => c.value === r?.channel)?.label;
            return (
              <li key={s.key} className={"arranque-step" + (isDone ? " is-done" : next?.key === s.key ? " is-next" : "")}>
                <span className="arranque-num">{isDone ? "✓" : i + 1}</span>
                <div className="arranque-body">
                  <div className="arranque-title">{s.label[trackKey]}</div>
                  {isDone ? (
                    <div className="arranque-meta">
                      Hecho el {fmtDate(r!.done_on)}
                      {channel ? ` · ${channel}` : ""}
                      {r!.done_by ? ` · ${nameFor(r!.done_by)}` : ""}
                    </div>
                  ) : (
                    <div className="arranque-meta muted">{s.hint}</div>
                  )}
                  {s.key === "reunion_inicio" && r?.scheduled_at && (
                    <div className="arranque-meta">📅 {isDone ? "Fue" : "Agendada"} el {fmtDateTime(r.scheduled_at)}</div>
                  )}
                  {r?.note && <div className="arranque-note">{r.note}</div>}
                  {file && <div className="arranque-meta">📎 {file.filename}</div>}
                </div>
                <div className="row" style={{ gap: 4, justifyContent: "flex-end", alignSelf: "center" }}>
                  {isDone ? (
                    <>
                      <button className="icon-btn" title="Editar" onClick={() => setEditing(s.key)}>
                        ✎
                      </button>
                      <button className="icon-btn" title="Volver a pendiente" onClick={() => undo(r!)}>
                        ↺
                      </button>
                    </>
                  ) : (
                    <>
                      {r && (
                        <button className="icon-btn" title="Editar" onClick={() => setEditing(s.key)}>
                          ✎
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={() => setEditing(s.key)}>
                        Marcar hecho
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {editing && (
        <StepModal
          project={project}
          stepKey={editing}
          title={STEPS.find((s) => s.key === editing)!.label[trackKey]}
          step={byKey[editing]}
          files={Object.values(files).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))}
          onClose={() => setEditing(null)}
          onSaved={upsertLocal}
        />
      )}
    </div>
  );
}

function StepModal({
  project,
  stepKey,
  title,
  step,
  files,
  onClose,
  onSaved,
}: {
  project: Project;
  stepKey: OnboardingStepKey;
  title: string;
  step?: OnboardingStep;
  files: { id: string; filename: string }[];
  onClose: () => void;
  onSaved: (row: OnboardingStep) => void;
}) {
  const { me, team } = useAppData();
  const [isDone, setIsDone] = useState(step ? !!step.done_on : true);
  const [doneOn, setDoneOn] = useState(step?.done_on || todayISO());
  const [doneBy, setDoneBy] = useState(step?.done_by || me.id);
  const [channel, setChannel] = useState<OnboardingChannel | "">(step?.channel || "");
  const [note, setNote] = useState(step?.note || "");
  const [fileId, setFileId] = useState(step?.file_id || "");
  const [scheduled, setScheduled] = useState(toLocalInput(step?.scheduled_at ?? null));
  const [saving, setSaving] = useState(false);
  const staff = Object.entries(team).filter(([, t]) => t.role === "admin" || t.role === "director");
  const secret = looksLikeSecret(note);

  async function handleSave() {
    if (secret) {
      toast("Parece que hay una credencial en la nota. Quítala.");
      return;
    }
    setSaving(true);
    const payload = {
      project_id: project.id,
      step: stepKey,
      done_on: isDone ? doneOn || todayISO() : null,
      done_by: isDone ? doneBy || null : null,
      channel: channel || null,
      note: note.trim(),
      file_id: fileId || null,
      scheduled_at: stepKey === "reunion_inicio" && scheduled ? new Date(scheduled).toISOString() : null,
    };
    const { data, error } = await createClient()
      .from("project_onboarding_steps")
      .upsert(payload, { onConflict: "project_id,step" })
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      const msg = error?.message?.includes("no_secrets")
        ? "la base de datos lo ha rechazado porque parece contener una credencial."
        : error
          ? error.message
          : "no tienes permiso";
      toast("No se pudo guardar: " + msg);
      return;
    }
    onSaved(data as OnboardingStep);
    toast(isDone ? "Paso marcado como hecho" : "Guardado");
    onClose();
  }

  return (
    <Modal title={title} onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="field">
        <label className="row" style={{ gap: 8, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={isDone} onChange={(e) => setIsDone(e.target.checked)} style={{ width: "auto" }} />
          Hecho
        </label>
      </div>
      {isDone && (
        <div className="field-row">
          <div className="field">
            <label>Fecha</label>
            <input type="date" className="com-input" value={doneOn} onChange={(e) => setDoneOn(e.target.value)} />
          </div>
          <div className="field">
            <label>Lo cerró</label>
            <select value={doneBy} onChange={(e) => setDoneBy(e.target.value)}>
              <option value="">—</option>
              {staff.map(([id, t]) => (
                <option key={id} value={id}>
                  {t.full_name || "Sin nombre"}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="field">
        <label>Por dónde (opcional)</label>
        <select value={channel} onChange={(e) => setChannel(e.target.value as OnboardingChannel | "")}>
          <option value="">—</option>
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {stepKey === "reunion_inicio" && (
        <div className="field">
          <label>Agendada para (opcional)</label>
          <input
            type="datetime-local"
            className="com-input"
            value={scheduled}
            onChange={(e) => setScheduled(e.target.value)}
          />
        </div>
      )}
      <div className="field">
        <label>Documento (opcional, de Archivos)</label>
        <select value={fileId} onChange={(e) => setFileId(e.target.value)}>
          <option value="">—</option>
          {files.map((f) => (
            <option key={f.id} value={f.id}>
              {f.filename}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Nota (opcional)</label>
        <textarea
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Lo aceptó por WhatsApp; el contrato firmado llegó por correo…"
        />
      </div>
      {secret && <div className="links-error">Parece que has escrito una credencial. Quítala antes de guardar.</div>}
    </Modal>
  );
}
