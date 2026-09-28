"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { fmtDate, fmtDateTime, fmtRelative, statusLabel } from "@/lib/format";
import { useNotes } from "@/lib/hooks/useProjectDetail";
import { UpdateImages } from "@/components/project/UpdateImages";
import type { Project } from "@/lib/database.types";

export function ResumenTab({ project }: { project: Project }) {
  const { me, isStaff, clients, nameFor } = useAppData();
  const [nextStep, setNextStep] = useState(project.next_step || "");
  const [saving, setSaving] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const { rows: updates } = useNotes(project.id);
  const client = project.client_id ? clients[project.client_id] : null;
  const devs = project.developer_ids || [];

  const lastUpdate = Object.values(updates).sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || ""),
  )[0];

  function startEditNotes() {
    setNotesDraft(project.notes_doc || "");
    setEditingNotes(true);
  }

  async function saveNotes() {
    setSavingNotes(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("projects")
      .update({
        notes_doc: notesDraft,
        notes_updated_at: new Date().toISOString(),
        notes_updated_by: me.id,
      })
      .eq("id", project.id);
    setSavingNotes(false);
    if (error) {
      toast("No se pudieron guardar las notas: " + error.message);
      return;
    }
    setEditingNotes(false);
    toast("Notas guardadas");
  }

  async function saveNextStep() {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("update_next_step", {
      pid: project.id,
      val: nextStep,
    });
    setSaving(false);
    if (error) {
      toast("No se pudo guardar: " + error.message);
      return;
    }
    toast("Próximo paso actualizado");
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", alignItems: "start" }}>
      <div className="card pad">
        <div className="row between" style={{ marginBottom: 14 }}>
          <span className={`badge badge-${project.status}`}>
            <span className="badge-dot" />
            {statusLabel(project.status)}
          </span>
        </div>
        <div className="section-title" style={{ marginTop: 0 }}>
          Próximo paso
        </div>
        <div className="field">
          <textarea
            rows={2}
            value={nextStep}
            onChange={(e) => setNextStep(e.target.value)}
            placeholder="¿Qué toca hacer ahora en este proyecto?"
          />
        </div>
        <button className="btn btn-sm" onClick={saveNextStep} disabled={saving}>
          {saving ? "Guardando…" : "Guardar próximo paso"}
        </button>

        <div className="row between section-title">
          <span>Última actualización</span>
          <Link href={`/projects/${project.id}?tab=actualizaciones`} className="section-link">
            {lastUpdate ? "Ver todas →" : "Añadir →"}
          </Link>
        </div>
        {lastUpdate ? (
          <div className="last-update">
            <div className="note-head">
              <Avatar id={lastUpdate.author_id || ""} name={nameFor(lastUpdate.author_id)} size={20} />
              <span className="note-author">{nameFor(lastUpdate.author_id)}</span>
              <span className="note-time" title={fmtDateTime(lastUpdate.created_at)}>
                {fmtRelative(lastUpdate.created_at)}
              </span>
            </div>
            {lastUpdate.text && <div className="note-text">{lastUpdate.text}</div>}
            <UpdateImages paths={lastUpdate.image_paths || []} size={72} />
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            Todavía no hay actualizaciones.
          </div>
        )}

        <div className="row between section-title">
          <span>Notas del proyecto</span>
          {isStaff && !editingNotes && (
            <button className="section-link" onClick={startEditNotes}>
              {project.notes_doc ? "Editar" : "Añadir notas"}
            </button>
          )}
        </div>
        {editingNotes ? (
          <>
            <div className="field">
              <textarea
                rows={8}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Arquitectura, stack, servicios usados, decisiones tomadas, enlaces útiles…"
                autoFocus
              />
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              No guardes contraseñas ni claves aquí: pon solo dónde encontrarlas.
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm btn-primary" onClick={saveNotes} disabled={savingNotes}>
                {savingNotes ? "Guardando…" : "Guardar notas"}
              </button>
              <button className="btn btn-sm" onClick={() => setEditingNotes(false)} disabled={savingNotes}>
                Cancelar
              </button>
            </div>
          </>
        ) : project.notes_doc ? (
          <>
            <div className="notes-doc">{project.notes_doc}</div>
            {project.notes_updated_at && (
              <div className="muted" style={{ fontSize: 11.8, marginTop: 6 }}>
                Editado por {nameFor(project.notes_updated_by)} · {fmtRelative(project.notes_updated_at)}
              </div>
            )}
          </>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            Sin notas todavía.
          </div>
        )}

        {project.description && (
          <>
            <div className="section-title">Descripción</div>
            <div style={{ fontSize: 13.6, color: "var(--ink-soft)", whiteSpace: "pre-wrap" }}>
              {project.description}
            </div>
          </>
        )}
      </div>
      <div className="card pad">
        <div className="section-title" style={{ marginTop: 0 }}>
          Cliente
        </div>
        <div style={{ fontSize: 13.6 }}>
          {client ? (
            <Link href={`/clients/${project.client_id}`} style={{ fontWeight: 600 }}>
              {client.name}
            </Link>
          ) : (
            <span className="muted">Sin cliente asignado</span>
          )}
        </div>
        <div className="section-title">Encargado</div>
        <div className="row" style={{ fontSize: 13.4 }}>
          <Avatar id={project.owner_id || ""} name={nameFor(project.owner_id)} size={22} />
          {nameFor(project.owner_id)}
        </div>
        <div className="section-title">Developers</div>
        {devs.length ? (
          devs.map((d) => (
            <div className="row" key={d} style={{ fontSize: 13.4, marginBottom: 6 }}>
              <Avatar id={d} name={nameFor(d)} size={22} />
              {nameFor(d)}
            </div>
          ))
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            Sin developers asignados
          </div>
        )}
        <div className="section-title">Creado</div>
        <div className="muted" style={{ fontSize: 12.8 }}>
          {fmtDate(project.created_at)}
        </div>
      </div>
    </div>
  );
}
