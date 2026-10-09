"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtRelative, statusLabel } from "@/lib/format";
import type { Activity, Project } from "@/lib/database.types";

const PAGE = 15;

const ICONS: Record<Activity["kind"], string> = {
  project_created: "✨",
  status_changed: "🔀",
  owner_changed: "👤",
  developer_added: "➕",
  demo_link: "🔗",
  link_added: "🔗",
  notes_edited: "📝",
  next_step: "🎯",
  task_created: "☐",
  task_done: "✅",
  file_uploaded: "📎",
  update_posted: "💬",
};

// Pestaña del proyecto a la que lleva cada tipo de actividad
const TAB: Partial<Record<Activity["kind"], string>> = {
  link_added: "enlaces",
  demo_link: "enlaces",
  task_created: "tareas",
  task_done: "tareas",
  file_uploaded: "archivos",
  update_posted: "actualizaciones",
};

// Actividad reciente de todos los proyectos visibles (RLS filtra por proyecto).
// La rellenan triggers de la base de datos y llega en vivo por realtime.
// compact: versión resumida para Inicio (menos filas, sin el texto citado).
export function RecentActivity({
  projects,
  compact = false,
}: {
  projects: Record<string, Project>;
  compact?: boolean;
}) {
  const { nameFor, clients } = useAppData();
  const pageSize = compact ? 6 : PAGE;
  const [items, setItems] = useState<Activity[] | null>(null);
  const [limit, setLimit] = useState(pageSize);
  const [hasMore, setHasMore] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let alive = true;
    supabase
      .from("activity")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit + 1)
      .then(({ data }) => {
        if (!alive) return;
        const rows = (data as Activity[]) || [];
        setHasMore(rows.length > limit);
        setItems(rows.slice(0, limit));
      });
    return () => {
      alive = false;
    };
  }, [supabase, limit]);

  useEffect(() => {
    const channel = supabase
      .channel("recent-activity")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity" }, (payload) => {
        const row = payload.new as Activity;
        setItems((prev) => [row, ...(prev || []).filter((a) => a.id !== row.id)].slice(0, limit));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, limit]);

  function describe(a: Activity) {
    const d = a.data || {};
    const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
    switch (a.kind) {
      case "project_created":
        return "ha creado el proyecto";
      case "status_changed":
        return (
          <>
            ha movido el proyecto de <b>{statusLabel(str("from"))}</b> a <b>{statusLabel(str("to"))}</b>
          </>
        );
      case "owner_changed":
        return str("to") ? (
          <>
            ha puesto a <b>{nameFor(str("to"))}</b> como encargado
          </>
        ) : (
          "ha quitado el encargado"
        );
      case "developer_added":
        return (
          <>
            ha añadido a <b>{nameFor(str("user_id"))}</b> al proyecto
          </>
        );
      case "demo_link":
        return "ha añadido el enlace a la demo";
      case "link_added":
        return (
          <>
            ha añadido el enlace <b>«{str("label")}»</b>
          </>
        );
      case "notes_edited":
        return "ha editado las notas del proyecto";
      case "next_step":
        return (
          <>
            ha cambiado el próximo paso: <i>«{str("text")}»</i>
          </>
        );
      case "task_created":
        return (
          <>
            ha creado la tarea <b>«{str("title")}»</b>
            {d.client ? " para el cliente" : str("assignee_id") ? ` para ${nameFor(str("assignee_id"))}` : ""}
          </>
        );
      case "task_done":
        return (
          <>
            ha completado la tarea <b>«{str("title")}»</b>
            {d.client ? " (del cliente)" : ""}
          </>
        );
      case "file_uploaded":
        return (
          <>
            ha subido <b>«{str("filename")}»</b>
          </>
        );
      case "update_posted":
        return "ha publicado una actualización";
      default:
        return "ha hecho un cambio";
    }
  }

  if (items === null) return <div className="empty">Cargando…</div>;
  if (items.length === 0) return <div className="empty">Todavía no hay actividad en ningún proyecto.</div>;

  return (
    <div className={"card" + (compact ? " activity-compact" : "")}>
      {items.map((a) => {
        const project = projects[a.project_id];
        const client = project?.client_id ? clients[project.client_id] : null;
        const tab = TAB[a.kind];
        const quote = !compact && a.kind === "update_posted" ? (a.data?.text as string) || "" : "";
        const imgs = !compact && a.kind === "update_posted" ? Number(a.data?.images || 0) : 0;
        return (
          <Link
            key={a.id}
            href={`/projects/${a.project_id}${tab ? `?tab=${tab}` : ""}`}
            className="activity-row"
          >
            {a.actor_id ? (
              <Avatar id={a.actor_id} name={nameFor(a.actor_id)} size={compact ? 24 : 28} />
            ) : (
              <span className="activity-icon">{ICONS[a.kind]}</span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="activity-line">
                {a.actor_id && <span className="activity-kind">{ICONS[a.kind]}</span>}
                <b>{a.actor_id ? nameFor(a.actor_id) : "Se"}</b> {describe(a)}
              </div>
              {(quote || imgs > 0) && (
                <div className="activity-text">
                  {quote}
                  {imgs > 0 && <span className="muted">{quote ? " · " : ""}🖼️ {imgs}</span>}
                </div>
              )}
              <div className="activity-meta">
                <b>{client ? client.name : project?.name || "Proyecto"}</b>
                {client && project ? ` · ${project.name}` : ""}
              </div>
            </div>
            <span className="note-time" title={fmtDateTime(a.created_at)} style={{ whiteSpace: "nowrap" }}>
              {fmtRelative(a.created_at)}
            </span>
          </Link>
        );
      })}
      {hasMore && (
        <button className="activity-more" onClick={() => setLimit((l) => l + pageSize)}>
          Ver más actividad
        </button>
      )}
    </div>
  );
}
