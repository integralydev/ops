"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { openProjectFile, uploadProjectFile } from "@/lib/uploads";
import { fileGlyph, fmtDateTime } from "@/lib/format";
import type { FileRow, Task, TaskComment, TaskStage } from "@/lib/database.types";
import { notifyTaskAssigned } from "@/app/(app)/projects/actions";
import { TaskImages, isMedia } from "./TaskImages";
import { AudioRecorder, TaskAudios, isAudio } from "./TaskAudio";
import { TaskCommentsSection } from "./TaskComments";
import {
  CLIENT,
  NO_EDIT_MSG,
  assignmentFields,
  assignmentValue,
  canEditTask,
  dueInfo,
  columnOf,
  stagePatch,
  updateTask,
  type FlowColumn,
} from "./shared";

// Panel lateral de una tarea (como abrir una página en Notion): propiedades,
// descripción y adjuntos.
export function TaskPanel({
  task: t,
  files,
  projectId,
  flow,
  assigneeOptions,
  onUpdated,
  onDeleted,
  onClose,
  comments,
  lastRead,
  onCommentChanged,
  onCommentRemoved,
}: {
  task: Task;
  files: FileRow[];
  projectId: string;
  /** Columnas del flujo de este proyecto (desarrollo o sencillo). */
  flow: FlowColumn[];
  assigneeOptions: (current?: string | null) => React.ReactNode;
  onUpdated: (row: Task) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
  comments: TaskComment[];
  lastRead?: string;
  onCommentChanged: (row: TaskComment) => void;
  onCommentRemoved: (id: string) => void;
}) {
  const { me, isStaff, nameFor } = useAppData();
  const canEdit = canEditTask(t, me.id, isStaff);
  const canDelete = isStaff || t.created_by === me.id;
  const [title, setTitle] = useState(t.title);
  const [description, setDescription] = useState(t.description || "");
  const [attaching, setAttaching] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const due = dueInfo(t.due_date, t.done);
  const images = files.filter(isMedia);
  const audios = files.filter(isAudio);
  const others = files.filter((f) => !isMedia(f) && !isAudio(f));
  const canDeleteFile = (f: FileRow) => isStaff || f.uploaded_by === me.id;

  // Esc cierra el panel (si el visor de imágenes está abierto, cierra solo el visor)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !viewerOpen && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, viewerOpen]);

  // Pegar una captura (⌘V / Ctrl+V) con la tarea abierta la adjunta como imagen
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
      if (!pasted.length) return; // texto normal: se pega como siempre
      e.preventDefault();
      attach(pasted.map(asCapture));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id]);

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
    let ok = 0;
    for (const file of picked) {
      const err = await uploadProjectFile(projectId, file, me.id, t.id);
      if (err) toast(err);
      else ok++;
    }
    setAttaching(false);
    if (ok) toast(ok === 1 ? "Adjuntado a la tarea" : `${ok} archivos adjuntados`);
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
      <aside
        className={"task-panel" + (dropping ? " is-dropping" : "")}
        role="dialog"
        aria-label="Tarea"
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDropping(false);
          attach(Array.from(e.dataTransfer.files));
        }}
      >
        {dropping && <div className="task-drop-hint">Suelta aquí para adjuntarlo a la tarea</div>}
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

        {/* Las imágenes van arriba y en grande: es lo primero que se ve al abrir la tarea */}
        <TaskImages images={images} canDelete={canDeleteFile} onViewerChange={setViewerOpen} />
        <div className="task-img-add">
          <label className="task-file" style={{ cursor: "pointer" }}>
            {attaching ? "Subiendo…" : "🖼 Añadir imagen o vídeo"}
            <input
              type="file"
              accept="image/*,video/*"
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
          <AudioRecorder disabled={attaching} onRecorded={(file) => attach([file])} />
          <span className="muted">o pega una captura con ⌘V / Ctrl+V, o arrástrala aquí</span>
        </div>
        <TaskAudios audios={audios} nameFor={nameFor} canDelete={canDeleteFile} />

        <dl className="task-props">
          <dt>Estado</dt>
          <dd>
            <select
              className={`task-status-select is-${columnOf(t, flow).value}`}
              value={columnOf(t, flow).value}
              disabled={!canEdit}
              onChange={(e) => patch(stagePatch(e.target.value as TaskStage))}
            >
              {flow.map((s) => (
                <option key={s.value} value={s.value} title={s.hint}>
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
          Otros adjuntos {others.length > 0 && <span className="muted">({others.length})</span>}
        </div>
        <div className="task-files" style={{ marginTop: 0 }}>
          {others.map((f) => (
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

        <TaskCommentsSection
          taskId={t.id}
          projectId={projectId}
          comments={comments}
          lastRead={lastRead}
          onChanged={onCommentChanged}
          onRemoved={onCommentRemoved}
        />
      </aside>
    </div>
  );
}

// Las capturas pegadas llegan como "image.png": se les pone un nombre con fecha
function asCapture(f: File) {
  if (f.name && f.name !== "image.png") return f;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ext = f.type.split("/")[1] || "png";
  const name = `captura-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
  return new File([f], name, { type: f.type });
}
