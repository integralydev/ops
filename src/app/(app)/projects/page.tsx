"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/components/app-data";
import { useFeaturedLinks, useProjects } from "@/lib/hooks/useProjects";
import { ProjectCard } from "@/components/ProjectCard";
import { ProjectTable, type ProjectGroup } from "@/components/ProjectTable";
import { ProjectBoard } from "@/components/projects/ProjectBoard";
import { ProjectTimeline } from "@/components/ProjectTimeline";
import { ProjectFormModal } from "@/components/ProjectFormModal";
import { statusesFor } from "@/components/projects/cells";
import { kindOf } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { Project, ProjectKind, ProjectStatus } from "@/lib/database.types";

type View = "table" | "board" | "gallery" | "timeline";
type Sort = "phase" | "name" | "updated" | "pending";

const VIEWS: { value: View; label: string; icon: string }[] = [
  { value: "table", label: "Tabla", icon: "▤" },
  { value: "board", label: "Tablero", icon: "▥" },
  { value: "gallery", label: "Galería", icon: "▦" },
  { value: "timeline", label: "Línea temporal", icon: "⟶" },
];
const SORTS: { value: Sort; label: string }[] = [
  { value: "phase", label: "Por fase" },
  { value: "name", label: "Nombre (A-Z)" },
  { value: "updated", label: "Actualizados recientemente" },
  { value: "pending", label: "Más tareas pendientes" },
];

// Vista preferida, recordada en este navegador.
const VIEW_KEY = "projectsView";
function subscribeView(cb: () => void) {
  window.addEventListener("projects-view", cb);
  return () => window.removeEventListener("projects-view", cb);
}
function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "cards") return "gallery"; // nombre antiguo
    return v === "board" || v === "gallery" || v === "timeline" ? v : "table";
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

// Tipo de proyectos que se ven: ?tipo=laboratorio en la dirección; por defecto, cliente
const noSubscribe = () => () => {};
function readKind(): ProjectKind {
  try {
    return new URLSearchParams(window.location.search).get("tipo") === "laboratorio" ? "laboratorio" : "cliente";
  } catch {
    return "cliente";
  }
}

// Proyectos como una base de datos de Notion: vistas (tabla, tablero,
// galería, línea temporal), buscador, filtro por encargado y orden.
export default function ProjectsPage() {
  const { me, isStaff, clients, team, nameFor } = useAppData();
  const { projects, loading, upsertLocal } = useProjects();
  const featured = useFeaturedLinks();
  const [newStatus, setNewStatus] = useState<ProjectStatus | "default" | null>(null);
  const [pendingTasks, setPendingTasks] = useState<Record<string, { team: number; client: number }>>({});
  const [lastUpdates, setLastUpdates] = useState<
    Record<string, { author_id: string | null; text: string; created_at: string }>
  >({});
  const storedView = useSyncExternalStore(subscribeView, readView, () => "table" as View);
  const urlKind = useSyncExternalStore(noSubscribe, readKind, () => "cliente" as ProjectKind);
  const [kindChoice, setKindChoice] = useState<ProjectKind | null>(null);
  const kind = kindChoice ?? urlKind;
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("all");
  const [sort, setSort] = useState<Sort>("phase");
  const router = useRouter();

  const everything = Object.values(projects);
  const countOf = (k: ProjectKind) => everything.filter((p) => kindOf(p) === k).length;
  // La línea temporal es del proceso con clientes
  const view: View = kind === "laboratorio" && storedView === "timeline" ? "table" : storedView;

  function changeKind(k: ProjectKind) {
    setKindChoice(k);
    router.replace(k === "laboratorio" ? "/projects?tipo=laboratorio" : "/projects", { scroll: false });
  }

  // Nº de tareas pendientes y última actualización de cada proyecto
  const projectCount = everything.length;
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("tasks")
      .select("project_id, assigned_to_client")
      .eq("done", false)
      .then(({ data }) => {
        const counts: Record<string, { team: number; client: number }> = {};
        (data || []).forEach((t) => {
          const c = (counts[t.project_id] ||= { team: 0, client: 0 });
          if (t.assigned_to_client) c.client++;
          else c.team++;
        });
        setPendingTasks(counts);
      });
    supabase
      .from("notes")
      .select("project_id, author_id, text, created_at")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        const latest: Record<string, { author_id: string | null; text: string; created_at: string }> = {};
        (data || []).forEach((n) => {
          if (!latest[n.project_id]) latest[n.project_id] = n;
        });
        setLastUpdates(latest);
      });
  }, [projectCount]);

  // Cliente y laboratorio nunca se mezclan; después, buscador y filtro
  const needle = q.trim().toLowerCase();
  const all = everything
    .filter((p) => kindOf(p) === kind)
    .filter((p) => owner === "all" || (owner === "none" ? !p.owner_id : p.owner_id === owner))
    .filter((p) => {
      if (!needle) return true;
      const client = p.client_id ? clients[p.client_id]?.name || "" : "";
      return `${p.name} ${client} ${p.next_step || ""}`.toLowerCase().includes(needle);
    });

  const displayName = (p: Project) => (p.client_id && clients[p.client_id] ? clients[p.client_id].name : p.name);
  const lastActivity = (p: Project) => lastUpdates[p.id]?.created_at || p.updated_at || p.created_at;
  const pendingOf = (p: Project) => (pendingTasks[p.id]?.team || 0) + (pendingTasks[p.id]?.client || 0);
  const sorter = (a: Project, b: Project) => {
    if (sort === "updated") return lastActivity(b).localeCompare(lastActivity(a));
    if (sort === "pending") return pendingOf(b) - pendingOf(a) || displayName(a).localeCompare(displayName(b), "es");
    return displayName(a).localeCompare(displayName(b), "es");
  };

  // Columnas por fase (todas, para el tablero) y grupos con proyectos (tabla y galería)
  const columns: ProjectGroup[] = useMemo(() => {
    const statuses = statusesFor({ kind });
    const cols = statuses.map((s) => ({
      key: s.value as string,
      label: s.label,
      projects: all.filter((p) => p.status === s.value).sort(sorter),
    }));
    // Red de seguridad: proyectos con un estado que no está en la lista
    const orphans = all.filter((p) => !statuses.some((s) => s.value === p.status));
    if (orphans.length) cols.push({ key: "__otros", label: "Sin estado asignado", projects: orphans.sort(sorter) });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, kind, q, owner, sort, pendingTasks, lastUpdates, clients]);
  const groups =
    sort === "phase"
      ? columns.filter((g) => g.projects.length > 0)
      : all.length
        ? [{ key: "__todos", label: SORTS.find((s) => s.value === sort)!.label, projects: [...all].sort(sorter) }]
        : [];

  const owners = Object.values(team)
    .filter((t) => t.role !== "comercial")
    .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
  const filtered = !!needle || owner !== "all";
  const onNew = isStaff ? (s: ProjectStatus) => setNewStatus(s) : undefined;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Proyectos</h1>
          <div className="topbar-sub">Todos los proyectos que puedes ver</div>
        </div>
        {isStaff && (
          <button className="btn btn-primary" onClick={() => setNewStatus("default")}>
            + Nuevo proyecto
          </button>
        )}
      </div>
      <div className="content wide">
        <div className="tabs kind-tabs">
          <button className={"tab" + (kind === "cliente" ? " active" : "")} onClick={() => changeKind("cliente")}>
            🏢 Clientes <span className="kind-count">{countOf("cliente")}</span>
          </button>
          <button className={"tab" + (kind === "laboratorio" ? " active" : "")} onClick={() => changeKind("laboratorio")}>
            🧪 Laboratorio <span className="kind-count">{countOf("laboratorio")}</span>
          </button>
        </div>

        <div className="ndb-bar">
          <div className="ndb-views" role="tablist" aria-label="Vista">
            {VIEWS.filter((v) => v.value !== "timeline" || kind === "cliente").map((v) => (
              <button
                key={v.value}
                role="tab"
                aria-selected={view === v.value}
                className={"ndb-view" + (view === v.value ? " active" : "")}
                onClick={() => saveView(v.value)}
              >
                <span aria-hidden>{v.icon}</span> {v.label}
              </button>
            ))}
          </div>
          <div className="ndb-tools">
            <input type="search" className="ndb-search" placeholder="🔍 Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className={"ndb-tool" + (owner !== "all" ? " is-on" : "")} value={owner} onChange={(e) => setOwner(e.target.value)} title="Filtrar por encargado">
              <option value="all">Encargado: todos</option>
              <option value={me.id}>Encargado: yo</option>
              {owners
                .filter((t) => t.id !== me.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    Encargado: {nameFor(t.id)}
                  </option>
                ))}
              <option value="none">Sin encargado</option>
            </select>
            {view !== "board" && view !== "timeline" && (
              <select className={"ndb-tool" + (sort !== "phase" ? " is-on" : "")} value={sort} onChange={(e) => setSort(e.target.value as Sort)} title="Ordenar">
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    ⇅ {s.label}
                  </option>
                ))}
              </select>
            )}
            {filtered && (
              <button
                className="section-link"
                onClick={() => {
                  setQ("");
                  setOwner("all");
                }}
              >
                Quitar filtros
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="empty">Cargando…</div>
        ) : everything.filter((p) => kindOf(p) === kind).length === 0 ? (
          <div className="empty">
            {kind === "laboratorio"
              ? isStaff
                ? 'Todavía no hay proyectos de laboratorio. Crea el primero con "+ Nuevo proyecto".'
                : "No tienes proyectos de laboratorio asignados."
              : isStaff
                ? 'Todavía no hay proyectos. Crea el primero con "+ Nuevo proyecto".'
                : "No tienes proyectos asignados todavía."}
          </div>
        ) : all.length === 0 ? (
          <div className="empty">Ningún proyecto coincide con la búsqueda o el filtro.</div>
        ) : view === "timeline" ? (
          <ProjectTimeline projects={all} />
        ) : view === "board" ? (
          <ProjectBoard columns={columns} pendingTasks={pendingTasks} onUpdated={upsertLocal} onNew={onNew} />
        ) : view === "table" ? (
          <ProjectTable
            groups={groups}
            pendingTasks={pendingTasks}
            lastUpdates={lastUpdates}
            featured={featured}
            onUpdated={upsertLocal}
            onNew={sort === "phase" ? onNew : undefined}
          />
        ) : (
          groups.map((g) => (
            <div key={g.key} className="section-block">
              <div className="ndb-gallery-head">
                <span className={`badge badge-${g.key}`}>
                  <span className="badge-dot" />
                  {g.label}
                </span>
                <span className="ndb-group-count">{g.projects.length}</span>
              </div>
              <div className="grid grid-cards">
                {g.projects.map((p) => (
                  <ProjectCard key={p.id} project={p} featured={featured[p.id]} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {newStatus && (
        <ProjectFormModal
          initialKind={kind}
          initialStatus={newStatus === "default" ? undefined : newStatus}
          onClose={() => setNewStatus(null)}
          onSaved={(id) => router.push(`/projects/${id}`)}
        />
      )}
    </>
  );
}
