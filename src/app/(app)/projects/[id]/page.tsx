"use client";

import { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAppData } from "@/components/app-data";
import { useProject } from "@/lib/hooks/useProjectDetail";
import { ResumenTab } from "@/components/project/ResumenTab";
import { TasksTab } from "@/components/project/TasksTab";
import { FilesTab } from "@/components/project/FilesTab";
import { NotesTab } from "@/components/project/NotesTab";
import { ScopeTab } from "@/components/project/ScopeTab";
import { ProjectFormModal } from "@/components/ProjectFormModal";

const TABS = [
  ["resumen", "Resumen"],
  ["scope", "Scope"],
  ["tareas", "Tareas"],
  ["archivos", "Archivos"],
  ["actualizaciones", "Actualizaciones"],
] as const;

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab") || "resumen";
  const tab = rawTab === "notas" ? "actualizaciones" : rawTab; // enlaces antiguos
  const { isStaff, clients } = useAppData();
  const project = useProject(projectId);
  const [showEdit, setShowEdit] = useState(false);

  function setTab(t: string) {
    router.push(`/projects/${projectId}?tab=${t}`);
  }

  if (project === undefined) {
    return (
      <div className="content">
        <div className="empty">Cargando…</div>
      </div>
    );
  }
  if (project === null) {
    return (
      <div className="content">
        <div className="empty">Proyecto no encontrado, o no tienes acceso a él.</div>
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <div>
          {/* El cliente es lo que se busca: va como título; el proyecto, debajo */}
          <h1>{project.client_id && clients[project.client_id] ? clients[project.client_id].name : project.name}</h1>
          <div className="topbar-sub">
            {project.client_id && clients[project.client_id] ? project.name : "Sin cliente"}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {project.demo_url && (
            <a className="btn" href={project.demo_url} target="_blank" rel="noopener noreferrer">
              Abrir demo ↗
            </a>
          )}
          {isStaff && (
            <button className="btn" onClick={() => setShowEdit(true)}>
              Editar proyecto
            </button>
          )}
        </div>
      </div>
      <div className="content wide">
        <div className="tabs">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              className={"tab" + (tab === key ? " active" : "")}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "scope" ? (
          <ScopeTab project={project} />
        ) : tab === "tareas" ? (
          <TasksTab project={project} />
        ) : tab === "archivos" ? (
          <FilesTab project={project} />
        ) : tab === "actualizaciones" ? (
          <NotesTab project={project} />
        ) : (
          <ResumenTab project={project} />
        )}
      </div>

      {showEdit && <ProjectFormModal project={project} onClose={() => setShowEdit(false)} />}
    </>
  );
}
