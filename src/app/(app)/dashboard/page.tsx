"use client";

import { useState } from "react";
import { useAppData } from "@/components/app-data";
import { useProjects } from "@/lib/hooks/useProjects";
import { ProjectCard } from "@/components/ProjectCard";
import { ProjectFormModal } from "@/components/ProjectFormModal";
import { RecentActivity } from "@/components/RecentActivity";
import { useRouter } from "next/navigation";
import { PROJECT_STATUSES } from "@/lib/format";

export default function DashboardPage() {
  const { isStaff, team } = useAppData();
  const { projects, loading } = useProjects();
  const [showNew, setShowNew] = useState(false);
  const router = useRouter();

  const all = Object.values(projects);
  const groupOf = (s: string) => PROJECT_STATUSES.find((x) => x.value === s)?.group;
  const order = (s: string) => PROJECT_STATUSES.findIndex((x) => x.value === s);
  const commercial = all.filter((p) => groupOf(p.status) === "comercial");
  const inDev = all.filter((p) => p.status === "desarrollo" || p.status === "testing");
  // "En curso": todo lo que no está pausado, cerrado ni ya en post go-live
  const active = [...commercial, ...inDev].sort((a, b) => order(a.status) - order(b.status));

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Inicio</h1>
          <div className="topbar-sub">Resumen de la actividad de la agencia</div>
        </div>
        {isStaff && (
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            + Nuevo proyecto
          </button>
        )}
      </div>
      <div className="content">
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", marginBottom: 8 }}>
          <div className="card pad stat">
            <b>{commercial.length}</b>
            <span>En preventa</span>
          </div>
          <div className="card pad stat">
            <b>{inDev.length}</b>
            <span>En desarrollo o testing</span>
          </div>
          <div className="card pad stat">
            <b>{Object.keys(team).length}</b>
            <span>Personas en el equipo</span>
          </div>
        </div>

        <div className="section-title">Actividad reciente</div>
        <RecentActivity projects={projects} />

        <div className="section-title">{isStaff ? "Proyectos en curso" : "Tus proyectos en curso"}</div>
        {loading ? (
          <div className="empty">Cargando…</div>
        ) : active.length === 0 ? (
          <div className="empty">
            {isStaff
              ? 'Todavía no hay proyectos en curso. Crea el primero con "+ Nuevo proyecto".'
              : "No tienes proyectos en curso asignados ahora mismo."}
          </div>
        ) : (
          <div className="grid grid-cards">
            {active.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
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
