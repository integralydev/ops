"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/components/app-data";
import { useProjects } from "@/lib/hooks/useProjects";
import { ProjectCard } from "@/components/ProjectCard";
import { ProjectTable } from "@/components/ProjectTable";
import { ProjectTimeline } from "@/components/ProjectTimeline";
import { ProjectFormModal } from "@/components/ProjectFormModal";
import { PROJECT_STATUSES } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

type View = "table" | "cards" | "timeline";

// Vista preferida (tabla/tarjetas), recordada en este navegador.
const VIEW_KEY = "projectsView";
function subscribeView(cb: () => void) {
  window.addEventListener("projects-view", cb);
  return () => window.removeEventListener("projects-view", cb);
}
function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "cards" || v === "timeline" ? v : "table";
  } catch {
    return "table";
  }
}
function saveView(v: View) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {}
  window.dispatchEvent(new Event("projects-view"));
}

export default function ProjectsPage() {
  const { isStaff } = useAppData();
  const { projects, loading } = useProjects();
  const [showNew, setShowNew] = useState(false);
  const [pendingTasks, setPendingTasks] = useState<Record<string, number>>({});
  const view = useSyncExternalStore(subscribeView, readView, () => "table" as View);
  const router = useRouter();
  const all = Object.values(projects);

  // Nº de tareas pendientes por proyecto (se recalcula si cambian los proyectos)
  const projectCount = all.length;
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("tasks")
      .select("project_id")
      .eq("done", false)
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        (data || []).forEach((t) => (counts[t.project_id] = (counts[t.project_id] || 0) + 1));
        setPendingTasks(counts);
      });
  }, [projectCount]);

  const groups = useMemo(() => {
    const known = PROJECT_STATUSES.map(({ value, label }) => ({
      key: value as string,
      label,
      projects: all.filter((p) => p.status === value),
    }));
    // Red de seguridad: proyectos con un estado que no está en la lista
    // (p. ej. el antiguo "activo") no deben desaparecer de la vista.
    known.push({
      key: "__otros",
      label: "Sin estado asignado",
      projects: all.filter((p) => !PROJECT_STATUSES.some((s) => s.value === p.status)),
    });
    return known.filter((g) => g.projects.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Proyectos</h1>
          <div className="topbar-sub">Todos los proyectos que puedes ver</div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div className="seg" role="group" aria-label="Vista">
            <button className={view === "table" ? "active" : ""} onClick={() => saveView("table")}>
              Tabla
            </button>
            <button className={view === "cards" ? "active" : ""} onClick={() => saveView("cards")}>
              Tarjetas
            </button>
            <button className={view === "timeline" ? "active" : ""} onClick={() => saveView("timeline")}>
              Línea temporal
            </button>
          </div>
          {isStaff && (
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>
              + Nuevo proyecto
            </button>
          )}
        </div>
      </div>
      <div className="content">
        {loading ? (
          <div className="empty">Cargando…</div>
        ) : all.length === 0 ? (
          <div className="empty">
            {isStaff
              ? 'Todavía no hay proyectos. Crea el primero con "+ Nuevo proyecto".'
              : "No tienes proyectos asignados todavía."}
          </div>
        ) : view === "timeline" ? (
          <ProjectTimeline projects={all} />
        ) : view === "table" ? (
          <ProjectTable groups={groups} pendingTasks={pendingTasks} />
        ) : (
          groups.map((g) => (
            <div key={g.key} className="section-block">
              <div className="section-title">
                {g.label} ({g.projects.length})
              </div>
              <div className="grid grid-cards">
                {g.projects.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {showNew && (
        <ProjectFormModal
          onClose={() => setShowNew(false)}
          onSaved={(id) => router.push(`/projects/${id}`)}
        />
      )}
    </>
  );
}
