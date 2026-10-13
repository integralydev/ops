"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { NextStepCell, OwnerCell, StatusCell } from "@/components/projects/cells";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import type { Project, ProjectLink, ProjectStatus } from "@/lib/database.types";

export type ProjectGroup = { key: string; label: string; projects: Project[] };

// Vista de tabla al estilo de una base de datos de Notion: grupos por fase
// plegables, propiedades editables en la celda y "+ Nuevo" en cada grupo.
export function ProjectTable({
  groups,
  pendingTasks,
  lastUpdates,
  featured = {},
  onUpdated,
  onNew,
}: {
  groups: ProjectGroup[];
  pendingTasks: Record<string, { team: number; client: number }>;
  lastUpdates: Record<string, { author_id: string | null; text: string; created_at: string }>;
  /** Enlace destacado de cada proyecto (por id de proyecto). */
  featured?: Record<string, ProjectLink>;
  onUpdated: (row: Project) => void;
  /** "+ Nuevo" de un grupo (solo admin/director): crea un proyecto en esa fase. */
  onNew?: (status: ProjectStatus) => void;
}) {
  const { clients, nameFor } = useAppData();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="ndb-table-wrap">
      <table className="ndb-table">
        <thead>
          <tr>
            <th className="ndb-col-name">
              <span className="ndb-prop">Aa</span> Cliente · proyecto
            </th>
            <th>
              <span className="ndb-prop">◉</span> Fase
            </th>
            <th className="col-next">
              <span className="ndb-prop">≡</span> Próximo paso
            </th>
            <th className="col-owner">
              <span className="ndb-prop">👤</span> Encargado
            </th>
            <th className="col-num">
              <span className="ndb-prop">☐</span> Pendientes
            </th>
            <th className="col-date">
              <span className="ndb-prop">🕒</span> Última actualización
            </th>
          </tr>
        </thead>
        {groups.map((g) => {
          const isCollapsed = !!collapsed[g.key];
          return (
            <tbody key={g.key}>
              <tr className="ndb-group">
                <td colSpan={6}>
                  <button className="ndb-group-toggle" onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}>
                    <span className={"tasks-caret" + (isCollapsed ? "" : " open")}>▸</span>
                    <span className={`badge badge-${g.key}`}>
                      <span className="badge-dot" />
                      {g.label}
                    </span>
                    <span className="ndb-group-count">{g.projects.length}</span>
                  </button>
                </td>
              </tr>
              {!isCollapsed &&
                g.projects.map((p) => {
                  const client = p.client_id ? clients[p.client_id] : null;
                  const pending = pendingTasks[p.id] || { team: 0, client: 0 };
                  return (
                    <tr key={p.id} className="ndb-row" onClick={() => router.push(`/projects/${p.id}`)}>
                      <td className="ndb-col-name">
                        <div className="ndb-name-cell">
                          <div style={{ minWidth: 0 }}>
                            <Link href={`/projects/${p.id}`} className="ndb-name" onClick={(e) => e.stopPropagation()}>
                              {client ? client.name : p.name}
                            </Link>
                            <div className="ptable-sub">
                              {client ? p.name : p.kind === "laboratorio" ? "🧪 Laboratorio" : "Sin cliente"}
                              {featured[p.id] && (
                                <a
                                  className="demo-link"
                                  href={featured[p.id].url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={featured[p.id].url}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {featured[p.id].label} ↗
                                </a>
                              )}
                            </div>
                          </div>
                          <span className="ndb-open">Abrir</span>
                        </div>
                      </td>
                      <td>
                        <StatusCell project={p} onUpdated={onUpdated} />
                      </td>
                      <td className="col-next">
                        <NextStepCell project={p} onUpdated={onUpdated} />
                      </td>
                      <td className="col-owner">
                        <OwnerCell project={p} onUpdated={onUpdated} />
                      </td>
                      <td className="col-num">
                        {pending.team || pending.client ? (
                          <span style={{ whiteSpace: "nowrap" }}>
                            {pending.team > 0 && (
                              <span className="ptable-count" title="Pendientes del equipo">
                                {pending.team}
                              </span>
                            )}
                            {pending.client > 0 && (
                              <span className="ptable-count is-client" title="Pendientes del cliente">
                                🏢 {pending.client}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="cell-empty">—</span>
                        )}
                      </td>
                      <td className="col-date">
                        {lastUpdates[p.id] ? (
                          <div
                            className="row"
                            style={{ gap: 6 }}
                            title={`${nameFor(lastUpdates[p.id].author_id)} · ${fmtDateTime(lastUpdates[p.id].created_at)}\n${lastUpdates[p.id].text}`}
                          >
                            <Avatar id={lastUpdates[p.id].author_id || ""} name={nameFor(lastUpdates[p.id].author_id)} size={18} />
                            <span className="muted">{fmtRelative(lastUpdates[p.id].created_at)}</span>
                          </div>
                        ) : (
                          <span className="cell-empty">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {!isCollapsed && onNew && !g.key.startsWith("__") && (
                <tr className="ndb-new-row">
                  <td colSpan={6}>
                    <button onClick={() => onNew(g.key as ProjectStatus)}>+ Nuevo</button>
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
