"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { useFiles, useTasks } from "@/lib/hooks/useProjectDetail";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import type { FileRow, Project, Task } from "@/lib/database.types";
import { notifyTaskAssigned } from "@/app/(app)/projects/actions";
import { TaskPanel } from "@/components/project/tasks/TaskPanel";
import {
  CLIENT,
  NO_EDIT_MSG,
  TASK_STATUSES,
  assignmentFields,
  assignmentValue,
  between,
  byPosition,
  canEditTask,
  dueInfo,
  moveTask,
  posOf,
  statusPatch,
  taskStatus,
  updateTask,
  type TaskStatus,
} from "@/components/project/tasks/shared";

type Filter = "all" | "mine" | "client" | "none" | "overdue" | string; // string = id de una persona
type View = "list" | "board";

const VIEW_KEY = "ops.tasks.view";
const noSubscribe = () => () => {};
function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

// Tareas del proyecto al estilo Notion / Todoist: escribir y Enter para
// añadir, todo editable en línea, arrastrar para ordenar, vista de tablero y
// panel lateral con los detalles.
export function TasksTab({ project }: { project: Project }) {
  const { me, isStaff, nameFor, clients, team } = useAppData();
  const { rows: tasks, loading, upsertLocal, removeLocal } = useTasks(project.id);
  const { rows: files } = useFiles(project.id);
  // Vista recordada en este navegador (en el servidor, siempre lista)
  const storedView = useSyncExternalStore(noSubscribe, readView, () => "list" as View);
  const [viewChoice, setViewState] = useState<View | null>(null);
  const view = viewChoice ?? storedView;
  const [filter, setFilter] = useState<Filter>("all");
  const [showDone, setShowDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  function setView(v: View) {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }

  const filesByTask: Record<string, FileRow[]> = {};
  Object.values(files).forEach((f) => {
    if (f.task_id) (filesByTask[f.task_id] ||= []).push(f);
  });

  const client = project.client_id ? clients[project.client_id] : null;
  const clientLabel = client ? client.name : "Cliente";

  // Encargado, developers del proyecto y siempre admins/directores
  const staffIds = Object.values(team)
    .filter((t) => t.role === "admin" || t.role === "director")
    .map((t) => t.id);
  const assignable = [project.owner_id, ...(project.developer_ids || []), ...staffIds].filter(
    (v, i, arr): v is string => !!v && arr.indexOf(v) === i,
  );

  function assigneeOptions(current?: string | null) {
    const ids = current && !assignable.includes(current) ? [current, ...assignable] : assignable;
    return (
      <>
        <option value="">Sin asignar</option>
        <option value={CLIENT}>🏢 {clientLabel}</option>
        {ids.map((a) => (
          <option key={a} value={a}>
            {nameFor(a)}
          </option>
        ))}
      </>
    );
  }

  const all = Object.values(tasks).sort(byPosition);
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  function matches(t: Task, f: Filter) {
    if (f === "all") return true;
    if (f === "mine") return t.assignee_id === me.id;
    if (f === "client") return t.assigned_to_client;
    if (f === "none") return !t.assignee_id && !t.assigned_to_client;
    if (f === "overdue") return !!t.due_date && t.due_date < todayISO;
    return t.assignee_id === f;
  }
  const pendingCount = (f: Filter) => all.filter((t) => !t.done && matches(t, f)).length;

  const people = [...assignable, ...all.map((t) => t.assignee_id).filter((v): v is string => !!v)].filter(
    (v, i, arr) => v !== me.id && arr.indexOf(v) === i,
  );
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "Todas" },
    { key: "mine", label: "Mías" },
    { key: "client", label: `🏢 ${clientLabel}` },
    ...people.map((id) => ({ key: id, label: nameFor(id) })),
    { key: "none", label: "Sin asignar" },
    ...(pendingCount("overdue") ? [{ key: "overdue" as Filter, label: "⏰ Vencidas" }] : []),
  ];

  const visible = all.filter((t) => matches(t, filter));
  const pending = visible.filter((t) => !t.done);
  const done = visible.filter((t) => t.done).sort((a, b) => (b.done_at || "").localeCompare(a.done_at || ""));

  // --- acciones ---------------------------------------------------------------

  async function addTask(title: string, status: TaskStatus = "todo", position?: number) {
    // En la vista "Mías", de una persona o del cliente, la nueva tarea va para ellos
    const assignee = filter === "mine" ? me.id : filter === "client" ? CLIENT : people.includes(filter) ? filter : "";
    const top = all.length ? Math.min(...all.map(posOf)) - 1 : 0;
    const { data, error } = await createClient()
      .from("tasks")
      .insert({
        project_id: project.id,
        title,
        created_by: me.id,
        position: position ?? top,
        ...assignmentFields(assignee),
        ...statusPatch(status),
      })
      .select()
      .single();
    if (error || !data) {
      toast("No se pudo añadir la tarea" + (error ? ": " + error.message : ""));
      return false;
    }
    upsertLocal(data as Task);
    if (assignee && assignee !== CLIENT && assignee !== me.id) notifyTaskAssigned(data.id);
    return true;
  }

  async function patch(t: Task, p: Partial<Task>) {
    if (!canEditTask(t, me.id, isStaff)) {
      toast(NO_EDIT_MSG);
      return;
    }
    upsertLocal({ ...t, ...p }); // al momento; si falla, Realtime/recarga lo corrige
    const row = await updateTask(t.id, p);
    upsertLocal(row || t);
  }

  async function assign(t: Task, value: string) {
    await patch(t, assignmentFields(value));
    if (value && value !== CLIENT && value !== me.id) notifyTaskAssigned(t.id);
  }

  async function remove(t: Task) {
    if (!confirm(`¿Eliminar la tarea «${t.title}»?`)) return;
    const { data, error } = await createClient().from("tasks").delete().eq("id", t.id).select("id");
    if (error || !data?.length) {
      toast("No se pudo eliminar" + (error ? ": " + error.message : ""));
      return;
    }
    removeLocal(t.id);
  }

  // Soltar una tarea arrastrada delante/detrás de otra (o al final de una lista)
  async function dropAt(list: Task[], targetIndex: number, status?: TaskStatus) {
    const t = dragId ? tasks[dragId] : null;
    setDragId(null);
    if (!t) return;
    const rest = list.filter((x) => x.id !== t.id);
    const idx = Math.max(0, Math.min(targetIndex - (list.slice(0, targetIndex).some((x) => x.id === t.id) ? 1 : 0), rest.length));
    const pos = between(rest[idx - 1], rest[idx]);
    const changesStatus = status && status !== taskStatus(t);
    if (changesStatus && !canEditTask(t, me.id, isStaff)) {
      toast(NO_EDIT_MSG);
      return;
    }
    upsertLocal({ ...t, position: pos, ...(changesStatus ? statusPatch(status) : {}) });
    const ok = await moveTask(t.id, pos);
    if (changesStatus) {
      const row = await updateTask(t.id, statusPatch(status));
      upsertLocal(row ? { ...row, position: pos } : t);
    } else if (!ok) upsertLocal(t);
  }

  const rowProps = (t: Task) => ({
    task: t,
    files: filesByTask[t.id] || [],
    clientLabel,
    canEdit: canEditTask(t, me.id, isStaff),
    canDelete: isStaff || t.created_by === me.id,
    assigneeOptions,
    onToggle: () => patch(t, statusPatch(t.done ? "todo" : "done")),
    onTitle: (title: string) => patch(t, { title }),
    onDue: (due: string | null) => patch(t, { due_date: due }),
    onAssign: (v: string) => assign(t, v),
    onOpen: () => setOpenId(t.id),
    onDelete: () => remove(t),
  });

  const openTask = openId ? tasks[openId] : null;

  return (
    <div className="card pad">
      <div className="tasks-toolbar">
        <div className="seg">
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
            ☰ Lista
          </button>
          <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>
            ▦ Tablero
          </button>
        </div>
        {all.length > 0 && (
          <span className="muted" style={{ fontSize: 12.3 }}>
            {all.filter((t) => !t.done).length} pendientes · {all.filter((t) => t.done).length} hechas
          </span>
        )}
      </div>

      {all.length > 0 && (
        <div className="task-filters">
          {filters.map((f) => {
            const n = pendingCount(f.key);
            return (
              <button
                key={f.key}
                className={
                  "task-filter" +
                  (filter === f.key ? " active" : "") +
                  (f.key === "client" ? " is-client" : "") +
                  (f.key === "overdue" ? " is-overdue" : "")
                }
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                {n > 0 && <span>{n}</span>}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="empty">Cargando…</div>
      ) : view === "list" ? (
        <>
          <QuickAdd onAdd={(title) => addTask(title)} />
          {pending.length === 0 && done.length === 0 && (
            <div className="tasks-empty">{all.length ? "No hay tareas con este filtro." : "No hay tareas todavía. Escribe arriba y pulsa Enter."}</div>
          )}
          <div className="tasks-list" onDragOver={(e) => dragId && e.preventDefault()}>
            {pending.map((t, i) => (
              <DropSlot key={t.id} active={!!dragId && dragId !== t.id} onDrop={(after) => dropAt(pending, after ? i + 1 : i)}>
                <TaskRow {...rowProps(t)} dragging={dragId === t.id} onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)} />
              </DropSlot>
            ))}
          </div>
          {done.length > 0 && (
            <>
              <button className="tasks-done-toggle" onClick={() => setShowDone((v) => !v)}>
                <span className={"tasks-caret" + (showDone ? " open" : "")}>▸</span> Completadas ({done.length})
              </button>
              {showDone && (
                <div className="tasks-list">
                  {done.map((t) => (
                    <TaskRow key={t.id} {...rowProps(t)} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className="task-board">
          {TASK_STATUSES.map((s) => {
            const col = visible.filter((t) => taskStatus(t) === s.value);
            return (
              <div
                key={s.value}
                className={`task-col is-${s.value}`}
                onDragOver={(e) => dragId && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  dropAt(col, col.length, s.value);
                }}
              >
                <div className="task-col-head">
                  <span className={`task-status-dot is-${s.value}`} />
                  {s.label}
                  <span className="muted">{col.length}</span>
                </div>
                {col.map((t, i) => (
                  <DropSlot key={t.id} active={!!dragId && dragId !== t.id} onDrop={(after) => dropAt(col, after ? i + 1 : i, s.value)}>
                    <TaskCard
                      {...rowProps(t)}
                      dragging={dragId === t.id}
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => setDragId(null)}
                    />
                  </DropSlot>
                ))}
                <QuickAdd
                  compact
                  onAdd={(title) => addTask(title, s.value, col.length ? posOf(col[col.length - 1]) + 1 : undefined)}
                />
              </div>
            );
          })}
        </div>
      )}

      {openTask && (
        <TaskPanel
          key={openTask.id}
          task={openTask}
          files={filesByTask[openTask.id] || []}
          projectId={project.id}
          assigneeOptions={assigneeOptions}
          onUpdated={upsertLocal}
          onDeleted={removeLocal}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

// "+ Añadir tarea": escribir y Enter; se queda listo para la siguiente.
function QuickAdd({ onAdd, compact = false }: { onAdd: (title: string) => Promise<boolean>; compact?: boolean }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!compact);

  async function submit() {
    const title = value.trim();
    if (!title || busy) return;
    setBusy(true);
    const ok = await onAdd(title);
    setBusy(false);
    if (ok) setValue("");
  }

  if (!open) {
    return (
      <button className="task-quick-open" onClick={() => setOpen(true)}>
        + Nueva
      </button>
    );
  }
  return (
    <div className={"task-quick" + (compact ? " compact" : "")}>
      <span className="task-quick-plus">+</span>
      <input
        type="text"
        value={value}
        autoFocus={compact}
        placeholder={compact ? "Título y Enter…" : "Añadir tarea… (escribe y pulsa Enter)"}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setValue("");
            if (compact) setOpen(false);
          }
        }}
        onBlur={() => compact && !value.trim() && setOpen(false)}
        disabled={busy}
      />
    </div>
  );
}

// Zona donde soltar: la mitad superior deja la tarea delante, la inferior detrás.
function DropSlot({
  active,
  onDrop,
  children,
}: {
  active: boolean;
  onDrop: (after: boolean) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState<"before" | "after" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={"task-drop" + (over ? ` is-${over}` : "")}
      onDragOver={(e) => {
        if (!active) return;
        e.preventDefault();
        e.stopPropagation();
        const r = ref.current!.getBoundingClientRect();
        setOver(e.clientY > r.top + r.height / 2 ? "after" : "before");
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        if (!active) return;
        e.preventDefault();
        e.stopPropagation();
        const after = over === "after";
        setOver(null);
        onDrop(after);
      }}
    >
      {children}
    </div>
  );
}

type RowProps = {
  task: Task;
  files: FileRow[];
  clientLabel: string;
  canEdit: boolean;
  canDelete: boolean;
  assigneeOptions: (current?: string | null) => React.ReactNode;
  onToggle: () => void;
  onTitle: (title: string) => void;
  onDue: (due: string | null) => void;
  onAssign: (value: string) => void;
  onOpen: () => void;
  onDelete: () => void;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

function TaskRow(p: RowProps) {
  const t = p.task;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const due = dueInfo(t.due_date, t.done);
  const status = taskStatus(t);

  function save() {
    setEditing(false);
    const v = title.trim();
    if (v && v !== t.title) p.onTitle(v);
    else setTitle(t.title);
  }

  return (
    <div
      className={"task-line" + (t.done ? " is-done" : "") + (p.dragging ? " is-dragging" : "")}
      draggable={!!p.onDragStart && !editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        p.onDragStart?.();
      }}
      onDragEnd={p.onDragEnd}
    >
      {p.onDragStart && <span className="task-grip" title="Arrastrar para ordenar">⋮⋮</span>}
      <button
        className={"task-circle" + (t.done ? " done" : "")}
        onClick={p.onToggle}
        disabled={!p.canEdit}
        title={p.canEdit ? (t.done ? "Marcar como pendiente" : "Completar") : NO_EDIT_MSG}
      >
        {t.done ? "✓" : ""}
      </button>
      <div className="task-main">
        {editing ? (
          <input
            className="task-title-input"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") {
                setTitle(t.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span
            className={"task-line-title" + (p.canEdit ? " editable" : "")}
            onClick={() => {
              if (!p.canEdit) return p.onOpen();
              setTitle(t.title);
              setEditing(true);
            }}
            title={p.canEdit ? "Clic para editar" : undefined}
          >
            {t.title}
          </span>
        )}
        {status === "doing" && <span className="task-pill is-doing">En curso</span>}
        {t.description && (
          <button className="task-meta-btn" onClick={p.onOpen} title="Tiene descripción">
            ≡
          </button>
        )}
        {p.files.length > 0 && (
          <button className="task-meta-btn" onClick={p.onOpen} title="Adjuntos">
            📎 {p.files.length}
          </button>
        )}
      </div>

      <DueChip due={due} value={t.due_date} canEdit={p.canEdit} onChange={p.onDue} />
      <Assignee {...p} />
      <button className="task-open" onClick={p.onOpen} title="Abrir detalles">
        Abrir
      </button>
      {p.canDelete && (
        <button className="icon-btn task-hover" title="Eliminar" onClick={p.onDelete}>
          ✕
        </button>
      )}
    </div>
  );
}

function TaskCard(p: RowProps) {
  const { nameFor } = useAppData();
  const t = p.task;
  const due = dueInfo(t.due_date, t.done);
  return (
    <div
      className={"task-card" + (t.done ? " is-done" : "") + (p.dragging ? " is-dragging" : "")}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        p.onDragStart?.();
      }}
      onDragEnd={p.onDragEnd}
      onClick={p.onOpen}
    >
      <div className="task-card-title">{t.title}</div>
      <div className="task-card-meta">
        {due && <span className={`task-due is-${due.tone || "plain"}`}>📅 {due.label}</span>}
        {p.files.length > 0 && <span className="muted">📎 {p.files.length}</span>}
        {t.description && <span className="muted">≡</span>}
        <span style={{ flex: 1 }} />
        {t.assigned_to_client ? (
          <span className="task-pill is-client">🏢 {p.clientLabel}</span>
        ) : t.assignee_id ? (
          <Avatar id={t.assignee_id} name={nameFor(t.assignee_id)} size={20} />
        ) : null}
      </div>
    </div>
  );
}

// Fecha límite: chip que abre el calendario del navegador.
function DueChip({
  due,
  value,
  canEdit,
  onChange,
}: {
  due: ReturnType<typeof dueInfo>;
  value: string | null;
  canEdit: boolean;
  onChange: (v: string | null) => void;
}) {
  if (!canEdit && !due) return null;
  return (
    <label
      className={"task-due-chip" + (due ? ` is-${due.tone || "plain"}` : " is-empty task-hover") + (canEdit ? "" : " readonly")}
      title={canEdit ? "Fecha límite" : undefined}
    >
      📅 {due ? due.label : "Fecha"}
      {canEdit && <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value || null)} />}
    </label>
  );
}

function Assignee(p: RowProps) {
  const { nameFor } = useAppData();
  const t = p.task;
  if (p.canEdit) {
    return (
      <div className={"task-assignee" + (t.assigned_to_client ? " is-client" : "")}>
        {t.assignee_id && <Avatar id={t.assignee_id} name={nameFor(t.assignee_id)} size={19} />}
        <select className="task-assign-select" value={assignmentValue(t)} onChange={(e) => p.onAssign(e.target.value)} title="Asignar a…">
          {p.assigneeOptions(t.assignee_id)}
        </select>
      </div>
    );
  }
  if (t.assigned_to_client) return <div className="task-assignee is-client">🏢 {p.clientLabel}</div>;
  if (t.assignee_id)
    return (
      <div className="task-assignee">
        <Avatar id={t.assignee_id} name={nameFor(t.assignee_id)} size={19} />
        {nameFor(t.assignee_id).split(" ")[0]}
      </div>
    );
  return <div className="task-assignee muted">Sin asignar</div>;
}
