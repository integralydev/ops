import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import type { Project, Task, TaskStage } from "@/lib/database.types";

// Valor especial del desplegable de asignación: la tarea está en manos del cliente
export const CLIENT = "__client";

/**
 * Columna del flujo de tareas. `value` es la fase que se guarda al dejar una
 * tarea en esa columna; `stages`, las fases que se muestran en ella.
 */
export type FlowColumn = { value: TaskStage; label: string; stages: TaskStage[]; hint?: string };

// Proyectos en desarrollo, testing, post go-live y laboratorio
export const DEV_FLOW: FlowColumn[] = [
  { value: "backlog", label: "Backlog", stages: ["backlog"], hint: "Todo lo pendiente" },
  { value: "next", label: "Next", stages: ["next"], hint: "Lo que toca ahora (unas 5)" },
  { value: "doing", label: "En curso", stages: ["doing"] },
  { value: "testing", label: "Testing", stages: ["testing"], hint: "Hecha: falta probar y validar" },
  { value: "deploy", label: "Pendiente de deploy", stages: ["deploy"], hint: "Validada y fusionada, aún no en producción" },
  { value: "production", label: "En producción", stages: ["production"] },
];

// Proyectos de preventa: tareas sencillas
export const SIMPLE_FLOW: FlowColumn[] = [
  { value: "backlog", label: "Por hacer", stages: ["backlog", "next"] },
  { value: "doing", label: "En curso", stages: ["doing", "testing", "deploy"] },
  { value: "production", label: "Hecha", stages: ["production"] },
];

/** Tareas en "Next" a partir de las cuales se avisa. */
export const NEXT_LIMIT = 5;

/** Flujo de desarrollo para proyectos en ejecución y de laboratorio; el sencillo para preventa. */
export function usesDevFlow(p: Project) {
  return p.kind === "laboratorio" || ["desarrollo", "testing", "mantenimiento"].includes(p.status);
}

export function flowFor(p: Project) {
  return usesDevFlow(p) ? DEV_FLOW : SIMPLE_FLOW;
}

/** Fase de una tarea (por si alguna llega sin stage: se deduce de done / in_progress). */
export function stageOf(t: Task): TaskStage {
  return t.stage || (t.done ? "production" : t.in_progress ? "doing" : "backlog");
}

/** Columna del flujo en la que se ve una tarea. */
export function columnOf(t: Task, flow: FlowColumn[]) {
  const s = stageOf(t);
  return flow.find((c) => c.stages.includes(s)) || flow[0];
}

/** Siguiente columna (lo que hace la casilla). En la última, vuelve a la primera. */
export function nextColumn(t: Task, flow: FlowColumn[]) {
  const i = flow.indexOf(columnOf(t, flow));
  return flow[(i + 1) % flow.length];
}

/** Cambios para pasar a una fase (la base de datos recalcula done / in_progress igual). */
export function stagePatch(stage: TaskStage): Partial<Task> {
  return {
    stage,
    done: stage === "production",
    done_at: stage === "production" ? new Date().toISOString() : null,
    in_progress: stage === "doing",
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
