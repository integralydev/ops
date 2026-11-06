"use client";

import Link from "next/link";
import { useAppData } from "@/components/app-data";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { kindOf, statusLabel } from "@/lib/format";
import { CLIENT_PATH, LAB_PATH, phaseIndex, phaseLook } from "@/lib/phase";
import type { Project, ProjectLink } from "@/lib/database.types";

// Tarjeta de proyecto con el lenguaje del portal de cliente: icono de la fase,
// nombre grande, barra de progreso por fases y el próximo paso en una línea.
export function ProjectCard({ project, featured }: { project: Project; featured?: ProjectLink }) {
  const { clients, nameFor } = useAppData();
  const client = project.client_id ? clients[project.client_id] : null;
  const lab = kindOf(project) === "laboratorio";
  const look = phaseLook(project.status);
  const path = lab ? LAB_PATH : CLIENT_PATH;
  const at = phaseIndex(project.status, lab);
  const people = [project.owner_id, ...(project.developer_ids || [])].filter(
    (x, i, a): x is string => !!x && a.indexOf(x) === i,
  );

  return (
    <Link href={`/projects/${project.id}`} className="card proj-card">
      <div className="proj-top">
        <div className={`ico ico-${look.tone}`}>
          <Icon name={look.icon} size={20} />
        </div>
        <div className="proj-titles">
          <div className="proj-name">{client ? client.name : project.name}</div>
          <div className="proj-client">{client ? project.name : lab ? "Laboratorio" : "Sin cliente"}</div>
        </div>
      </div>

      <div className="proj-phase">
        <div className="phase-seg" aria-hidden>
          {path.map((p, i) => (
            <i key={p.value} className={i < at ? "done" : i === at ? "now" : ""} />
          ))}
        </div>
        <span className={`pill pill-${look.tone}`}>{statusLabel(project.status)}</span>
      </div>

      <div className={"proj-next" + (project.next_step ? "" : " empty-next")}>
        <Icon name="arrow" size={15} />
        <span>{project.next_step || "Sin próximo paso"}</span>
      </div>

      <div className="proj-foot">
        <div className="avatars">
          {people.slice(0, 4).map((id) => (
            <span key={id} title={nameFor(id)}>
              <Avatar id={id} name={nameFor(id)} size={24} />
            </span>
          ))}
        </div>
        {featured && (
          <span
            role="link"
            className="demo-chip"
            onClick={(e) => {
              // La tarjeta entera ya es un enlace: abrimos la demo sin navegar al proyecto
              e.preventDefault();
              e.stopPropagation();
              window.open(featured.url, "_blank", "noopener,noreferrer");
            }}
          >
            {featured.label} <Icon name="external" size={13} />
          </span>
        )}
      </div>
    </Link>
  );
}
