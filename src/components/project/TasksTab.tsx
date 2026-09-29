"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { useTasks } from "@/lib/hooks/useProjectDetail";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import type { Project, Task } from "@/lib/database.types";
import { notifyTaskAssigned } from "@/app/(app)/projects/actions";

// Valor especial del desplegable de asignación: la tarea está en manos del cliente
const CLIENT = "__client";

type Filter = "all" | "mine" | "client" | "none" | string; // string = id de una persona

// Desplegable → columnas de la tabla tasks
function assignmentFields(value: string) {
  return value === CLIENT
    ? { assignee_id: null, assigned_to_client: true }
    : { assignee_id: value || null, assigned_to_client: false };
}

function assignmentValue(t: Task) {
  return t.assigned_to_client ? CLIENT : t.assignee_id || "";
}

export function TasksTab({ project }: { project: Project }) {
  const { me, isStaff, nameFor, clients } = useAppData();
  const { rows: tasks, loading } = useTasks(project.id);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const client = project.client_id ? clients[project.client_id] : null;
  const clientLabel = client ? client.name : "Cliente";

  const assignable = [project.owner_id, ...(project.developer_ids || [])].filter(
    (v, i, arr): v is string => !!v && arr.indexOf(v) === i,
  );

  const all = Object.values(tasks);

  function matches(t: Task, f: Filter) {
    if (f === "all") return true;
    if (f === "mine") return t.assignee_id === me.id;
    if (f === "client") return t.assigned_to_client;
    if (f === "none") return !t.assignee_id && !t.assigned_to_client;
    return t.assignee_id === f;
  }
  const pendingCount = (f: Filter) => all.filter((t) => !t.done && matches(t, f)).length;

  // Personas con tareas en este proyecto (aunque ya no estén asignadas a él), sin contarte a ti
  const people = [
    ...assignable,
    ...all.map((t) => t.assignee_id).filter((v): v is string => !!v),
  ].filter((v, i, arr) => v !== me.id && arr.indexOf(v) === i);

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "Todas" },
    { key: "mine", label: "Mías" },
    { key: "client", label: `🏢 ${clientLabel}` },
    ...people.map((id) => ({ key: id, label: nameFor(id) })),
    { key: "none", label: "Sin asignar" },
  ];

  const list = all
    .filter((t) => matches(t, filter))
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (b.created_at || "").localeCompare(a.created_at || "");
    });

  async function addTask() {
    if (!title.trim()) return;
    setAdding(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        project_id: project.id,
        title: title.trim(),
        ...assignmentFields(assignee),
        created_by: me.id,
      })
      .select("id")
      .single();
    setAdding(false);
    if (error) {
      toast("No se pudo añadir la tarea: " + error.message);
      return;
    }
    setTitle("");
    // Aviso por email a la persona asignada (en segundo plano; nunca bloquea)
    if (data && assignee && assignee !== CLIENT && assignee !== me.id) notifyTaskAssigned(data.id);
  }

  async function toggleTask(taskId: string, done: boolean) {
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .update({ done: !done, done_at: !done ? new Date().toISOString() : null })
      .eq("id", taskId);
    if (error) toast("No se pudo actualizar: " + error.message);
  }

  async function assignTask(taskId: string, value: string) {
    const supabase = createClient();
    const { error } = await supabase.from("tasks").update(assignmentFields(value)).eq("id", taskId);
    if (error) {
      toast("No se pudo asignar: " + error.message);
      return;
    }
    if (value && value !== CLIENT && value !== me.id) notifyTaskAssigned(taskId);
  }

  async function deleteTask(taskId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("tasks").delete().eq("id", taskId);
    if (error) toast("No se pudo eliminar: " + error.message);
  }

  function assigneeOptions(current?: string | null) {
    // Incluye al asignado actual aunque ya no esté en el proyecto
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

  return (
    <div className="card pad">
      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <input
          type="text"
          placeholder="Nueva tarea…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          style={{
            flex: 1,
            padding: "9px 11px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface)",
            color: "var(--ink)",
            fontSize: 13.6,
          }}
        />
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          style={{
            padding: "9px 8px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface)",
            color: "var(--ink)",
            fontSize: 13,
            maxWidth: 170,
          }}
        >
          {assigneeOptions()}
        </select>
        <button className="btn btn-primary" onClick={addTask} disabled={adding}>
          Añadir
        </button>
      </div>

      {all.length > 0 && (
        <div className="task-filters">
          {filters.map((f) => {
            const n = pendingCount(f.key);
            return (
              <button
                key={f.key}
                className={"task-filter" + (filter === f.key ? " active" : "") + (f.key === "client" ? " is-client" : "")}
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
      ) : all.length === 0 ? (
        <div className="empty">No hay tareas todavía.</div>
      ) : list.length === 0 ? (
        <div className="empty">No hay tareas con este filtro.</div>
      ) : (
        list.map((t) => {
          const canToggle = isStaff || t.assignee_id === me.id || (t.assigned_to_client && t.created_by === me.id);
          const canDelete = isStaff || t.created_by === me.id;
          // Igual que la política RLS de tasks: staff, asignado o creador
          const canAssign = isStaff || t.assignee_id === me.id || t.created_by === me.id;
          return (
            <div className="task-row" key={t.id}>
              <button
                className={"task-check" + (t.done ? " done" : "")}
                disabled={!canToggle}
                onClick={() => toggleTask(t.id, t.done)}
              >
                {t.done ? "✓" : ""}
              </button>
              <div className={"task-title" + (t.done ? " done" : "")}>{t.title}</div>
              {canAssign ? (
                <div className={"task-assignee" + (t.assigned_to_client ? " is-client" : "")}>
                  {t.assignee_id && <Avatar id={t.assignee_id} name={nameFor(t.assignee_id)} size={19} />}
                  <select
                    className="task-assign-select"
                    value={assignmentValue(t)}
                    onChange={(e) => assignTask(t.id, e.target.value)}
                    title="Asignar a…"
                  >
                    {assigneeOptions(t.assignee_id)}
                  </select>
                </div>
              ) : t.assigned_to_client ? (
                <div className="task-assignee is-client">🏢 {clientLabel}</div>
              ) : t.assignee_id ? (
                <div className="task-assignee">
                  <Avatar id={t.assignee_id} name={nameFor(t.assignee_id)} size={19} />
                  {nameFor(t.assignee_id)}
                </div>
              ) : (
                <div className="task-assignee muted">Sin asignar</div>
              )}
              {canDelete && (
                <button className="icon-btn" title="Eliminar" onClick={() => deleteTask(t.id)}>
                  ✕
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
