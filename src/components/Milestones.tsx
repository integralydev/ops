"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Milestone, MilestoneArea, Project } from "@/lib/database.types";

const AREA: Record<MilestoneArea, { icon: string; label: string }> = {
  clientes: { icon: "🤝", label: "Clientes" },
  ventas: { icon: "📈", label: "Ventas" },
  captacion: { icon: "📣", label: "Captación" },
  equipo: { icon: "👥", label: "Equipo" },
  estrategia: { icon: "🧭", label: "Estrategia" },
  dinero: { icon: "💶", label: "Dinero" },
  laboratorio: { icon: "🧪", label: "Laboratorio" },
  otros: { icon: "•", label: "Otros" },
};

// Fecha de hoy en Madrid, en formato AAAA-MM-DD (como happened_on)
function isoDay(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
}

function dayLabel(day: string) {
  if (day === isoDay()) return "Hoy";
  if (day === isoDay(-1)) return "Ayer";
  const d = new Date(`${day}T12:00:00`);
  const s = d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "Lo que ha pasado": los hitos de la agencia, agrupados por día. Solo los ven
// los propietarios (RLS con is_owner()). Los escribe Claudia desde los chats.
export function Milestones({ projects }: { projects: Record<string, Project> }) {
  const supabase = useMemo(() => createClient(), []);
  const [days, setDays] = useState(14);
  const [items, setItems] = useState<Milestone[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from("milestones")
      .select("*")
      .gte("happened_on", isoDay(-days))
      .order("happened_on", { ascending: false })
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (alive) setItems((data as Milestone[]) || []);
      });
    return () => {
      alive = false;
    };
  }, [supabase, days]);

  async function remove(m: Milestone) {
    if (!confirm(`¿Borrar el hito «${m.title}»?`)) return;
    const { error } = await supabase.from("milestones").delete().eq("id", m.id);
    if (!error) setItems((prev) => (prev || []).filter((x) => x.id !== m.id));
  }

  if (items === null) return <div className="empty">Cargando…</div>;
  if (items.length === 0)
    return <div className="empty">Nada apuntado en los últimos {days} días.</div>;

  const groups: { day: string; rows: Milestone[] }[] = [];
  for (const m of items) {
    const g = groups[groups.length - 1];
    if (g && g.day === m.happened_on) g.rows.push(m);
    else groups.push({ day: m.happened_on, rows: [m] });
  }

  return (
    <div className="card ms-card">
      {groups.map((g) => (
        <div key={g.day} className="ms-day">
          <div className="ms-day-label">{dayLabel(g.day)}</div>
          {g.rows.map((m) => {
            const p = m.project_id ? projects[m.project_id] : undefined;
            const a = AREA[m.area] || AREA.otros;
            return (
              <div key={m.id} className="ms-row">
                <span className="ms-icon" title={a.label}>
                  {a.icon}
                </span>
                <div className="ms-body">
                  <div
                    className={`ms-title${m.detail ? " has-detail" : ""}`}
                    onClick={() => m.detail && setOpen(open === m.id ? null : m.id)}
                  >
                    {m.title}
                  </div>
                  {open === m.id && m.detail && <div className="ms-detail">{m.detail}</div>}
                  {p && (
                    <Link href={`/projects/${p.id}`} className="ms-project">
                      {p.name}
                    </Link>
                  )}
                </div>
                <button className="ms-del" title="Borrar" onClick={() => remove(m)}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ))}
      {days < 90 && (
        <button className="ms-more" onClick={() => setDays(days < 30 ? 30 : 90)}>
          Ver más antiguos
        </button>
      )}
    </div>
  );
}
