"use client";

import Link from "next/link";
import { useAppData } from "@/components/app-data";
import { statusLabel } from "@/lib/format";
import type { Project, ProjectLink } from "@/lib/database.types";

export function ProjectCard({ project, featured }: { project: Project; featured?: ProjectLink }) {
  const { clients, nameFor } = useAppData();
  const client = project.client_id ? clients[project.client_id] : null;

  return (
    <Link href={`/projects/${project.id}`} className="card proj-card">
      <div className="proj-top">
        <div>
          <div className="proj-name">{client ? client.name : project.name}</div>
          <div className="proj-client">{client ? project.name : "Sin cliente"}</div>
        </div>
        <span className={`badge badge-${project.status}`}>
          <span className="badge-dot" />
          {statusLabel(project.status)}
        </span>
      </div>
      {project.next_step ? (
        <div className="next-step">
          <b>Próximo paso · </b>
          {project.next_step}
        </div>
      ) : (
        <div className="next-step muted">Sin próximo paso definido</div>
      )}
      <div className="proj-foot">
        {featured ? (
          <span
            role="link"
            className="demo-link"
            style={{ marginLeft: 0 }}
            onClick={(e) => {
              // La tarjeta entera ya es un enlace: abrimos la demo sin navegar al proyecto
              e.preventDefault();
              e.stopPropagation();
              window.open(featured.url, "_blank", "noopener,noreferrer");
            }}
          >
            {featured.label} ↗
          </span>
        ) : (
          <span />
        )}
        <span className="muted" style={{ fontSize: 11.8 }}>
          Encargado: {nameFor(project.owner_id)}
        </span>
      </div>
    </Link>
  );
}
