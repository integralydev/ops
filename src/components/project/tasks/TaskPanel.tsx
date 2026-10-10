"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { openProjectFile, uploadProjectFile } from "@/lib/uploads";
import { fileGlyph, fmtDateTime } from "@/lib/format";
import type { FileRow, Task } from "@/lib/database.types";
import { notifyTaskAssigned } from "@/app/(app)/projects/actions";
import {
  CLIENT,
  NO_EDIT_MSG,
  TASK_STATUSES,
  assignmentFields,
  assignmentValue,
  canEditTask,
  dueInfo,
  statusPatch,
  taskStatus,
  updateTask,
  type TaskStatus,
} from "./shared";

// Panel lateral de una tarea (como abrir una página en Notion): propiedades,
// descripción y adjuntos.
export function TaskPanel({
  task: t,
  files,
  projectId,
  assigneeOptions,
  onUpdated,
  onDeleted,
  onClose,
}: {
  task: Task;
  files: FileRow[];
  projectId: string;
  assigneeOptions: (current?: string | null) => React.ReactNode;
  onUpdated: (row: Task) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const { me, isStaff, nameFor } = useAppData();
  const canEdit = canEditTask(t, me.id, isStaff);
  const canDelete = isStaff || t.created_by === me.id;
  const [title, setTitle] = useState(t.title);
  const [description, setDescription] = useState(t.description || "");
  const [attaching, setAttaching] = useState(false);
  const due = dueInfo(t.due_date, t.done);

  // Esc cierra el panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function patch(p: Partial<Task>) {
    const row = await updateTask(t.id, p);
    if (row) onUpdated(row);
    return row;
  }

  async function saveTitle() {
    const v = title.trim();
    if (!v) {
      setTitle(t.title);
      return;
    }
    if (v !== t.title) await patch({ title: v });
  }

  async function saveDescription() {
    if (description !== (t.description || "")) {
      const row = await patch({ description });
      if (row) toast("Descripción guardada");
    }
  }

  async function assign(value: string) {
    const row = await patch(assignmentFields(value));
    if (row && value && value !== CLIENT && value !== me.id) notifyTaskAssigned(t.id);
  }

  async function attach(picked: File[]) {
    if (!picked.length) return;
    setAttaching(true);
    for (const file of picked) {
      const err = await uploadProjectFile(projectId, file, me.id, t.id);
      if (err) toast(err);
    }
    setAttaching(false);
  }

  async function remove() {
    if (!confirm(`¿Eliminar la tarea «${t.title}»?`)) return;
    const { data, error } = await createClient().from("tasks").delete().eq("id", t.id).select("id");
    if (error || !data?.length) {
      toast("No se pudo eliminar" + (error ? ": " + error.message : ""));
      return;
    }
    onDeleted(t.id);
    onClose();
  }

  return (
    <div className="task-panel-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="task-panel" role="dialog" aria-label="Tarea">
        <div className="task-panel-head">
          <span className="muted" style={{ fontSize: 12 }}>
            Tarea
          </span>
          <div className="row" style={{ gap: 4 }}>
            {canDelete && (
              <button className="icon-btn" title="Eliminar tarea" onClick={remove}>
                🗑
              </button>
            )}
            <button className="icon-btn" title="Cerrar (Esc)" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <textarea
          className={"task-panel-title" + (t.done ? " done" : "")}
          value={title}
          rows={1}
          readOnly={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
        />

        <dl className="task-props">
          <dt>Estado</dt>
          <dd>
            <select
              className={`task-status-select is-${taskStatus(t)}`}
              value={taskStatus(t)}
              disabled={!canEdit}
              onChange={(e) => patch(statusPatch(e.target.value as TaskStatus))}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </dd>

          <dt>Asignada a</dt>
          <dd>
            <div className={"task-assignee" + (t.assigned_to_client ? " is-client" : "")}>
              {t.assignee_id && <Avatar id={t.assignee_id} name={nameFor(t.assignee_id)} size={19} />}
              <select
                className="task-assign-select"
                value={assignmentValue(t)}
                disabled={!canEdit}
                onChange={(e) => assign(e.target.value)}
              >
                {assigneeOptions(t.assignee_id)}
              </select>
            </div>
          </dd>

          <dt>Fecha límite</dt>
          <dd className="row" style={{ gap: 6 }}>
            <input
              type="date"
              className={"task-date-input" + (due?.tone ? ` is-${due.tone}` : "")}
              value={t.due_date || ""}
              disabled={!canEdit}
              onChange={(e) => patch({ due_date: e.target.value || null })}
            />
            {due && <span className={`task-due is-${due.tone || "plain"}`}>{due.label}</span>}
            {t.due_date && canEdit && (
              <button className="section-link" onClick={() => patch({ due_date: null })}>
                Quitar
              </button>
            )}
          </dd>

          <dt>Creada</dt>
          <dd className="muted">
            {t.created_by ? nameFor(t.created_by) : "—"} · {fmtDateTime(t.created_at)}
          </dd>
          {t.done && t.done_at && (
            <>
              <dt>Completada</dt>
              <dd className="muted">{fmtDateTime(t.done_at)}</dd>
            </>
          )}
        </dl>

        <div className="task-panel-section">Descripción</div>
        <textarea
          className="task-panel-desc"
          value={description}
          readOnly={!canEdit}
          placeholder={canEdit ? "Añade detalles, pasos, enlaces…" : "Sin descripción"}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
        />

        <div className="task-panel-section">
          Adjuntos {files.length > 0 && <span className="muted">({files.length})</span>}
        </div>
        <div className="task-files" style={{ marginTop: 0 }}>
          {files.map((f) => (
            <button
              key={f.id}
              className="task-file"
              title="Abrir"
              onClick={async () => {
                if (!(await openProjectFile(f.storage_path))) toast("No se pudo abrir el archivo");
              }}
            >
              {fileGlyph(f.content_type)} {f.filename}
            </button>
          ))}
          <label className="task-file" style={{ cursor: "pointer" }}>
            {attaching ? "Subiendo…" : "📎 Adjuntar"}
            <input
              type="file"
              multiple
              style={{ display: "none" }}
              disabled={attaching}
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                e.target.value = "";
                attach(picked);
              }}
            />
          </label>
        </div>

        {!canEdit && <p className="muted" style={{ fontSize: 12, marginTop: 18 }}>{NO_EDIT_MSG}.</p>}
      </aside>
    </div>
  );
}
