"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { fmtDateTime, fmtRelative, statusLabel } from "@/lib/format";
import type { Project } from "@/lib/database.types";

export function ProjectTable({
  groups,
  pendingTasks,
  lastUpdates,
}: {
  groups: { key: string; label: string; projects: Project[] }[];
  pendingTasks: Record<string, { team: number; client: number }>;
  lastUpdates: Record<string, { author_id: string | null; text: string; created_at: string }>;
}) {
  const { clients, nameFor } = useAppData();
  const router = useRouter();

  return (
    <div className="card table-card">
      <table className="ptable">
        <thead>
          <tr>
            <th>Cliente · proyecto</th>
            <th>Fase</th>
            <th className="col-next">Próximo paso</th>
            <th className="col-owner">Encargado</th>
            <th className="col-num">Pendientes</th>
            <th className="col-date">Última actualización</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            <tr className="ptable-group">
              <td colSpan={6}>
                {g.label} <span>{g.projects.length}</span>
              </td>
            </tr>
            {g.projects.map((p) => {
              const client = p.client_id ? clients[p.client_id] : null;
              const pending = pendingTasks[p.id] || { team: 0, client: 0 };
              return (
                <tr key={p.id} className="ptable-row" onClick={() => router.push(`/projects/${p.id}`)}>
                  <td>
                    <Link href={`/projects/${p.id}`} className="ptable-name" onClick={(e) => e.stopPropagation()}>
                      {client ? client.name : p.name}
                    </Link>
                    <div className="ptable-sub">
                      {client ? p.name : "Sin cliente"}
                      {p.demo_url && (
                        <a
                          className="demo-link"
                          href={p.demo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Demo ↗
                        </a>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`badge badge-${p.status}`}>
                      <span className="badge-dot" />
                      {statusLabel(p.status)}
                    </span>
                  </td>
                  <td className="col-next">
                    {p.next_step ? (
                      <div className="ptable-next" title={p.next_step}>
                        {p.next_step}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="col-owner">
                    {p.owner_id ? (
                      <div className="row" style={{ gap: 7 }}>
                        <Avatar id={p.owner_id} name={nameFor(p.owner_id)} size={22} />
                        <span className="ptable-owner">{nameFor(p.owner_id)}</span>
                      </div>
                    ) : (
                      <span className="muted">Sin asignar</span>
                    )}
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
                      <span className="muted">—</span>
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
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
