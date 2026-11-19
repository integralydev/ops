"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAppData } from "@/components/app-data";
import type { Project } from "@/lib/database.types";

type Row = { id: string; project_id: string; title: string; due_date: string | null };

// Fecha local de hoy en AAAA-MM-DD (due_date es un date sin hora)
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dueLabel(due: string, today: string) {
  if (due === today) return "Hoy";
  const d = new Date(due + "T00:00:00");
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

/**
 * Inicio: las tareas abiertas a mi nombre de todos los proyectos, agrupadas
 * por proyecto. "Hoy" = las que vencen hoy o ya han vencido; "Todas" = todo
 * lo abierto (con fecha primero).
 */
export function MyTasks({ projects }: { projects: Record<string, Project> }) {
  const { me, team, isStaff, nameFor } = useAppData();
  // Guardamos de quién son las filas: al cambiar de persona, se esperan las nuevas
  const [data, setData] = useState<{ person: string; rows: Row[] } | null>(null);
  const [mode, setMode] = useState<"hoy" | "todas">("hoy");
  // Dirección (admin y directores) puede ver las tareas de otra persona del equipo
  const [who, setWho] = useState<string>("");
  const personId = who || me.id;
  const people = isStaff
    ? Object.values(team).filter((p) => p.role !== "cliente" && p.role !== "comercial" && p.id !== me.id)
    : [];

  useEffect(() => {
    if (!personId) return;
    createClient()
      .from("tasks")
      .select("id, project_id, title, due_date")
      .eq("assignee_id", personId)
      .eq("done", false)
      .eq("assigned_to_client", false)
      .then(({ data: d }) => setData({ person: personId, rows: (d as Row[]) || [] }));
  }, [personId]);

  const rows = data && data.person === personId ? data.rows : null;
  if (rows === null) return null;

  const today = todayISO();
  const dueToday = rows.filter((r) => r.due_date && r.due_date <= today);
  const shown = (mode === "hoy" ? dueToday : rows)
    .filter((r) => projects[r.project_id])
    .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));

  // Agrupar por proyecto, en el orden de la tarea más urgente de cada uno
  const groups: { project: Project; tasks: Row[] }[] = [];
  shown.forEach((r) => {
    let g = groups.find((x) => x.project.id === r.project_id);
    if (!g) groups.push((g = { project: projects[r.project_id], tasks: [] }));
    g.tasks.push(r);
  });

  return (
    <div className="mytasks">
      <div className="dash-section-head">
        <div className="section-title">
          {personId === me.id ? "Mis tareas" : `Tareas de ${nameFor(personId).split(" ")[0]}`}
          <span className="dash-count">{shown.length}</span>
          {people.length > 0 && (
            <select className="mytasks-who" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Ver tareas de">
              <option value="">Yo</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.full_name || "Sin nombre").split(" ")[0]}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="mytasks-toggle">
          <button className={mode === "hoy" ? "on" : ""} onClick={() => setMode("hoy")}>
            Hoy{dueToday.length > 0 && ` · ${dueToday.length}`}
          </button>
          <button className={mode === "todas" ? "on" : ""} onClick={() => setMode("todas")}>
            Todas · {rows.length}
          </button>
        </div>
      </div>
      {groups.length === 0 ? (
        <div className="empty mytasks-empty">
          {mode === "hoy"
            ? rows.length > 0
              ? "Nada para hoy. Hay tareas sin fecha o para más adelante en «Todas»."
              : personId === me.id ? "No tienes tareas abiertas a tu nombre." : "No tiene tareas abiertas."
            : personId === me.id ? "No tienes tareas abiertas a tu nombre." : "No tiene tareas abiertas."}
        </div>
      ) : (
        <div className="card mytasks-list">
          {groups.map((g) => (
            <div key={g.project.id} className="mytasks-group">
              <Link href={`/projects/${g.project.id}?tab=tareas`} className="mytasks-project">
                {g.project.name}
              </Link>
              {g.tasks.map((t) => (
                <Link key={t.id} href={`/projects/${g.project.id}?tab=tareas`} className="mytasks-row">
                  <span className="mytasks-title">{t.title}</span>
                  {t.due_date && (
                    <span className={"mytasks-due" + (t.due_date < today ? " late" : t.due_date === today ? " today" : "")}>
                      {dueLabel(t.due_date, today)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
