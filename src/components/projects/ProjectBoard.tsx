"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { toast } from "@/components/toast";
import { updateProject } from "@/components/projects/cells";
import type { Project, ProjectStatus } from "@/lib/database.types";
import type { ProjectGroup } from "@/components/ProjectTable";

// Vista de tablero (como el Board de Notion): una columna por fase; se
// arrastra un proyecto a otra columna para cambiarle la fase (admin/director).
export function ProjectBoard({
  columns,
  pendingTasks,
  onUpdated,
  onNew,
}: {
  /** Todas las fases del tipo, aunque estén vacías. */
  columns: ProjectGroup[];
  pendingTasks: Record<string, { team: number; client: number }>;
  onUpdated: (row: Project) => void;
  onNew?: (status: ProjectStatus) => void;
}) {
  const { isStaff, clients, nameFor } = useAppData();
  const router = useRouter();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const byId: Record<string, Project> = {};
  columns.forEach((c) => c.projects.forEach((p) => (byId[p.id] = p)));

  async function drop(status: string) {
    const p = dragId ? byId[dragId] : null;
    setDragId(null);
    setOverCol(null);
    if (!p || p.status === status || status.startsWith("__")) return;
    if (!isStaff) {
      toast("Solo admin y directores pueden cambiar la fase");
      return;
    }
    onUpdated({ ...p, status: status as ProjectStatus }); // al momento
    const row = await updateProject(p, { status: status as ProjectStatus });
    onUpdated(row || p);
  }

  return (
    <div className="pboard">
      {columns.map((c) => (
        <div
          key={c.key}
          className={"pboard-col" + (overCol === c.key ? " is-over" : "")}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            setOverCol(c.key);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop(c.key);
          }}
        >
          <div className="pboard-head">
            <span className={`badge badge-${c.key}`}>
              <span className="badge-dot" />
              {c.label}
            </span>
            <span className="ndb-group-count">{c.projects.length}</span>
          </div>
          {c.projects.map((p) => {
            const client = p.client_id ? clients[p.client_id] : null;
            const pending = pendingTasks[p.id] || { team: 0, client: 0 };
            return (
              <div
                key={p.id}
                className={"pboard-card" + (dragId === p.id ? " is-dragging" : "")}
                draggable={isStaff}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragId(p.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverCol(null);
                }}
                onClick={() => router.push(`/projects/${p.id}`)}
              >
                <div className="pboard-title">{client ? client.name : p.name}</div>
                <div className="pboard-sub">{client ? p.name : p.kind === "laboratorio" ? "🧪 Laboratorio" : "Sin cliente"}</div>
                {p.next_step && <div className="pboard-next">{p.next_step}</div>}
                <div className="pboard-meta">
                  {pending.team > 0 && <span className="ptable-count" title="Tareas pendientes del equipo">{pending.team}</span>}
                  {pending.client > 0 && (
                    <span className="ptable-count is-client" title="Pendientes del cliente">
                      🏢 {pending.client}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  {p.owner_id && <Avatar id={p.owner_id} name={nameFor(p.owner_id)} size={20} />}
                </div>
              </div>
            );
          })}
          {onNew && !c.key.startsWith("__") && (
            <button className="task-quick-open" onClick={() => onNew(c.key as ProjectStatus)}>
              + Nuevo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
