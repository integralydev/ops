"use client";

import { useRouter } from "next/navigation";
import { useAppData } from "@/components/app-data";
import { PROJECT_STATUSES, STATUS_GROUP_LABELS, statusLabel } from "@/lib/format";
import type { Project } from "@/lib/database.types";

// Fases del flujo (preventa + ejecución), en orden. Pausado/cerrado quedan fuera.
const FLOW = PROJECT_STATUSES.filter((s) => s.group !== "otros");

export function ProjectTimeline({ projects }: { projects: Project[] }) {
  const { clients, nameFor } = useAppData();
  const router = useRouter();

  const idx = (p: Project) => FLOW.findIndex((s) => s.value === p.status);
  const inFlow = projects
    .filter((p) => idx(p) >= 0)
    .sort((a, b) => idx(b) - idx(a) || a.name.localeCompare(b.name));
  const outOfFlow = projects.filter((p) => idx(p) < 0);

  const preventa = FLOW.filter((s) => s.group === "comercial").length;
  const cols = { gridTemplateColumns: `minmax(180px, 240px) repeat(${FLOW.length}, minmax(96px, 1fr))` };

  return (
    <div className="card table-card">
      <div className="tl">
        {/* Cabecera: grupos y fases */}
        <div className="tl-row tl-head" style={cols}>
          <div />
          <div className="tl-group" style={{ gridColumn: `2 / span ${preventa}` }}>
            {STATUS_GROUP_LABELS.comercial}
          </div>
          <div className="tl-group tl-group-exec" style={{ gridColumn: `${2 + preventa} / span ${FLOW.length - preventa}` }}>
            {STATUS_GROUP_LABELS.ejecucion}
          </div>
        </div>
        <div className="tl-row tl-phases" style={cols}>
          <div className="tl-label-head">Cliente · proyecto</div>
          {FLOW.map((s) => (
            <div key={s.value} className="tl-phase" title={s.hint}>
              {s.label}
            </div>
          ))}
        </div>

        {inFlow.map((p) => {
          const i = idx(p);
          const client = p.client_id ? clients[p.client_id] : null;
          return (
            <div key={p.id} className="tl-row tl-project" style={cols} onClick={() => router.push(`/projects/${p.id}`)}>
              <div className="tl-label">
                <div className="ptable-name">{client ? client.name : p.name}</div>
                <div className="ptable-sub">
                  {client ? p.name : "Sin cliente"}
                  {p.owner_id ? ` · ${nameFor(p.owner_id)}` : ""}
                </div>
              </div>
              <div className="tl-track" style={{ gridColumn: `2 / span ${FLOW.length}` }}>
                {/* Barra de progreso: se anima al cambiar de fase */}
                <div className="tl-line" />
                <div
                  className={`tl-fill tl-fill-${FLOW[i].group}`}
                  style={{ width: `${((i + 0.5) / FLOW.length) * 100}%` }}
                />
                {FLOW.map((s, j) => (
                  <div key={s.value} className="tl-cell">
                    <span
                      className={"tl-dot" + (j < i ? " done" : j === i ? ` current badge-${s.value}` : "")}
                      title={s.label}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {inFlow.length === 0 && <div className="empty" style={{ margin: 16 }}>No hay proyectos en curso.</div>}

        {outOfFlow.length > 0 && (
          <div className="tl-out">
            <div className="tl-out-title">Fuera del flujo</div>
            <div className="tl-out-list">
              {outOfFlow.map((p) => (
                <button key={p.id} className="tl-out-item" onClick={() => router.push(`/projects/${p.id}`)}>
                  <span className="ptable-name">
                    {p.client_id && clients[p.client_id] ? `${clients[p.client_id].name} · ${p.name}` : p.name}
                  </span>
                  <span className={`badge badge-${p.status}`}>
                    <span className="badge-dot" />
                    {statusLabel(p.status)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
