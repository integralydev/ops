"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useAppData } from "@/components/app-data";
import { useFeaturedLinks, useProjects } from "@/lib/hooks/useProjects";
import { ProjectCard } from "@/components/ProjectCard";
import { ProjectFormModal } from "@/components/ProjectFormModal";
import { RecentActivity } from "@/components/RecentActivity";
import { useRouter } from "next/navigation";
import { PROJECT_STATUSES } from "@/lib/format";
import { pickGreeting } from "@/lib/greetings";

// Saludo y fecha se calculan solo en el navegador (hora local de quien entra)
// y una vez por carga de página, para que no cambien en cada render.
let hello: { name: string; greeting: string; today: string } | null = null;
function helloFor(name: string) {
  if (!hello || hello.name !== name) {
    const d = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
    hello = { name, greeting: pickGreeting({ name }), today: d.charAt(0).toUpperCase() + d.slice(1) };
  }
  return hello;
}
const noSubscribe = () => () => {};

// Inicio: visión general de la agencia. Saludo, cifras clave, proyectos en
// curso y, al lado, un resumen corto de la actividad reciente.
export default function DashboardPage() {
  const { me, isStaff, team, clients } = useAppData();
  const { projects, loading } = useProjects();
  const featured = useFeaturedLinks();
  const [showNew, setShowNew] = useState(false);
  const router = useRouter();

  const firstName = (me.full_name || "").split(" ")[0];
  const getHello = useCallback(() => helloFor(firstName), [firstName]);
  const local = useSyncExternalStore(noSubscribe, getHello, () => null);
  const greeting = firstName ? local?.greeting || `Hola, ${firstName}` : "Inicio";
  const today = local?.today || "";

  const all = Object.values(projects);
  const groupOf = (s: string) => PROJECT_STATUSES.find((x) => x.value === s)?.group;
  const order = (s: string) => PROJECT_STATUSES.findIndex((x) => x.value === s);
  const commercial = all.filter((p) => groupOf(p.status) === "comercial");
  const inDev = all.filter((p) => p.status === "desarrollo" || p.status === "testing");
  const live = all.filter((p) => p.status === "mantenimiento");
  const activeClients = Object.values(clients).filter((c) => c.status === "client");
  // "En curso": todo lo que no está pausado, cerrado ni ya en post go-live
  const active = [...commercial, ...inDev].sort((a, b) => order(a.status) - order(b.status));

  const stats: { value: number; label: string; href?: string }[] = [
    { value: commercial.length, label: "En preventa", href: "/projects" },
    { value: inDev.length, label: "En desarrollo o testing", href: "/projects" },
    { value: live.length, label: "En producción", href: "/projects" },
    ...(isStaff ? [{ value: activeClients.length, label: "Clientes activos", href: "/clients" }] : []),
    { value: Object.keys(team).length, label: "Personas en el equipo" },
  ];

  return (
    <>
      <div className="topbar dash-hero">
        <div>
          <h1>{greeting}</h1>
          <div className="topbar-sub">{today ? `${today} · Así va Integraly` : "Así va Integraly"}</div>
        </div>
        {isStaff && (
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            + Nuevo proyecto
          </button>
        )}
      </div>
      <div className="content wide">
        <div className="dash-stats">
          {stats.map((s) =>
            s.href ? (
              <Link key={s.label} href={s.href} className="card dash-stat">
                <b>{s.value}</b>
                <span>{s.label}</span>
              </Link>
            ) : (
              <div key={s.label} className="card dash-stat">
                <b>{s.value}</b>
                <span>{s.label}</span>
              </div>
            ),
          )}
        </div>

        <div className="dash-grid">
          <section>
            <div className="dash-section-head">
              <div className="section-title">
                {isStaff ? "Proyectos en curso" : "Tus proyectos en curso"}
                {active.length > 0 && <span className="dash-count">{active.length}</span>}
              </div>
              <Link href="/projects" className="section-link">
                Ver todos →
              </Link>
            </div>
            {loading ? (
              <div className="empty">Cargando…</div>
            ) : active.length === 0 ? (
              <div className="empty">
                {isStaff
                  ? 'Todavía no hay proyectos en curso. Crea el primero con "+ Nuevo proyecto".'
                  : "No tienes proyectos en curso asignados ahora mismo."}
              </div>
            ) : (
              <div className="dash-projects">
                {active.map((p) => (
                  <ProjectCard key={p.id} project={p} featured={featured[p.id]} />
                ))}
              </div>
            )}
          </section>

          <aside>
            <div className="dash-section-head">
              <div className="section-title">Actividad reciente</div>
            </div>
            <RecentActivity projects={projects} compact />
          </aside>
        </div>
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
