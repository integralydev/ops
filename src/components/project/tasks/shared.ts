import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import type { Task } from "@/lib/database.types";

// Valor especial del desplegable de asignación: la tarea está en manos del cliente
export const CLIENT = "__client";

export type TaskStatus = "todo" | "doing" | "done";

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "Por hacer" },
  { value: "doing", label: "En curso" },
  { value: "done", label: "Hecha" },
];

export function taskStatus(t: Task): TaskStatus {
  return t.done ? "done" : t.in_progress ? "doing" : "todo";
}

/** Columnas de la tabla tasks para pasar a un estado. */
export function statusPatch(s: TaskStatus): Partial<Task> {
  return {
    done: s === "done",
    done_at: s === "done" ? new Date().toISOString() : null,
    in_progress: s === "doing",
  };
}

// Desplegable de asignación → columnas de la tabla tasks
export function assignmentFields(value: string) {
  return value === CLIENT
    ? { assignee_id: null, assigned_to_client: true }
    : { assignee_id: value || null, assigned_to_client: false };
}

export function assignmentValue(t: Task) {
  return t.assigned_to_client ? CLIENT : t.assignee_id || "";
}

/** Igual que la política RLS de tasks: staff, la persona asignada o quien la creó. */
export function canEditTask(t: Task, meId: string, isStaff: boolean) {
  return isStaff || t.assignee_id === meId || t.created_by === meId;
}

export const NO_EDIT_MSG = "Solo puede cambiarla quien la tiene asignada, quien la creó o admin/director";

/** Orden de una tarea (por si alguna llega sin position: la más nueva arriba). */
export function posOf(t: Task) {
  return typeof t.position === "number" ? t.position : -new Date(t.created_at).getTime() / 1000;
}

export const byPosition = (a: Task, b: Task) => posOf(a) - posOf(b);

/** Guarda cambios en una tarea y devuelve la fila actualizada (o null si falla). */
export async function updateTask(id: string, patch: Partial<Task>) {
  const { data, error } = await createClient().from("tasks").update(patch).eq("id", id).select().maybeSingle();
  if (error || !data) {
    toast("No se pudo guardar" + (error ? ": " + error.message : ": " + NO_EDIT_MSG.toLowerCase()));
    return null;
  }
  return data as Task;
}

/** Mueve una tarea en el orden manual (cualquier miembro del proyecto). */
export async function moveTask(id: string, position: number) {
  const { error } = await createClient().rpc("move_task", { tid: id, pos: position });
  if (error) toast("No se pudo mover: " + error.message);
  return !error;
}

/** Posición para dejar una tarea entre dos vecinas (undefined = extremo). */
export function between(before?: Task, after?: Task) {
  if (before && after) return (posOf(before) + posOf(after)) / 2;
  if (before) return posOf(before) + 1;
  if (after) return posOf(after) - 1;
  return 0;
}

function localISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Hoy", "Mañana", "Ayer", "vie", "12 oct"… y si está vencida. */
export function dueInfo(date: string | null, done = false) {
  if (!date) return null;
  const today = new Date();
  const t = localISO(today);
  const tomorrow = localISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  const yesterday = localISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  const [y, m, d] = date.split("-").map(Number);
  const when = new Date(y, m - 1, d);
  const days = Math.round((when.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  let label: string;
  if (date === t) label = "Hoy";
  else if (date === tomorrow) label = "Mañana";
  else if (date === yesterday) label = "Ayer";
  else if (days > 1 && days < 7) label = when.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
  else
    label = when.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: y === today.getFullYear() ? undefined : "numeric",
    });
  const tone = done ? "" : date < t ? "overdue" : date === t ? "today" : days <= 2 ? "soon" : "";
  return { label, tone };
}
