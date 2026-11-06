"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useAppData } from "@/components/app-data";
import { useFeaturedLinks, useProjects } from "@/lib/hooks/useProjects";
import { ProjectCard } from "@/components/ProjectCard";
import { ProjectFormModal } from "@/components/ProjectFormModal";
import { RecentActivity } from "@/components/RecentActivity";
import { Milestones } from "@/components/Milestones";
import { PortalPending } from "@/components/PortalPending";
import { useRouter } from "next/navigation";
import { LAB_STATUSES, PROJECT_STATUSES, kindOf, statusLabel } from "@/lib/format";
import { pickGreeting } from "@/lib/greetings";
import { Icon, type IconName } from "@/components/Icon";
import { phaseLook } from "@/lib/phase";

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
  // Laboratorio: productos propios. Aparte y debajo: los clientes van primero
  const labOrder = (s: string) => LAB_STATUSES.findIndex((x) => x.value === s);
  const lab = all.filter((p) => kindOf(p) === "laboratorio").sort((a, b) => labOrder(a.status) - labOrder(b.status));
  const activeClients = Object.values(clients).filter((c) => c.status === "client");
  // "En curso": todo lo que no está pausado, cerrado ni ya en post go-live
  const active = [...commercial, ...inDev].sort((a, b) => order(a.status) - order(b.status));

  // Cuatro cifras, grandes y con icono: lo que se ve de un vistazo
  const stats: { value: number; label: string; href: string; icon: IconName; tone: string }[] = [
    { value: commercial.length, label: "En preventa", href: "/projects", icon: "spark", tone: "p" },
    { value: inDev.length, label: "En desarrollo", href: "/projects", icon: "code", tone: "in" },
    { value: live.length, label: "En producción", href: "/projects", icon: "pulse", tone: "ok" },
    ...(isStaff
      ? [{ value: activeClients.length, label: "Clientes", href: "/clients", icon: "building" as IconName, tone: "w" }]
      : []),
  ];
  void team;

  return (
    <>
      <div className="topbar dash-hero">
        <div>
          <h1>{greeting}</h1>
          <div className="topbar-sub">{today || "Así va Integraly"}</div>
        </div>
        {isStaff && (
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" size={16} /> Nuevo proyecto
          </button>
        )}
      </div>
      <div className="content wide">
        <PortalPending />
        <div className="dash-stats">
          {stats.map((s) => (
            <Link key={s.label} href={s.href} className="card dash-stat">
              <div className={`ico ico-${s.tone}`}>
                <Icon name={s.icon} size={20} />
              </div>
              <div>
                <b>{s.value}</b>
                <span>{s.label}</span>
              </div>
            </Link>
          ))}
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
            {lab.length > 0 && (
              <>
                <div className="dash-section-head" style={{ marginTop: 26 }}>
                  <div className="section-title">
                    Laboratorio<span className="dash-count">{lab.length}</span>
                  </div>
                  <Link href="/projects?tipo=laboratorio" className="section-link">
                    Ver todos →
                  </Link>
                </div>
                <div className="card lab-list">
                  {lab.map((p) => (
                    <Link key={p.id} href={`/projects/${p.id}`} className="lab-row">
                      <span className={`ico ico-sm ico-${phaseLook(p.status).tone}`}>
                        <Icon name={phaseLook(p.status).icon} size={16} />
                      </span>
                      <span className="lab-name">{p.name}</span>
                      {p.next_step && <span className="lab-next">{p.next_step}</span>}
                      <span className={`pill pill-${phaseLook(p.status).tone}`}>{statusLabel(p.status)}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </section>

          <aside>
            {me.isOwner && (
              <>
                <div className="dash-section-head">
                  <div className="section-title">Lo que ha pasado</div>
                </div>
                <Milestones projects={projects} />
              </>
            )}
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
