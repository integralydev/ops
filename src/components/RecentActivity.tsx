"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import type { Note, Project } from "@/lib/database.types";

const LIMIT = 8;

// Últimas actualizaciones de todos los proyectos visibles (RLS filtra por
// proyecto). Se actualiza en vivo cuando alguien publica una nueva.
export function RecentActivity({ projects }: { projects: Record<string, Project> }) {
  const { nameFor } = useAppData();
  const [items, setItems] = useState<Note[] | null>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let alive = true;
    supabase
      .from("notes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(LIMIT)
      .then(({ data }) => {
        if (alive) setItems((data as Note[]) || []);
      });

    const channel = supabase
      .channel("recent-activity")
      .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, (payload) => {
        setItems((prev) => {
          const list = prev || [];
          if (payload.eventType === "DELETE") return list.filter((n) => n.id !== (payload.old as Note).id);
          const row = payload.new as Note;
          return [row, ...list.filter((n) => n.id !== row.id)].slice(0, LIMIT);
        });
      })
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  if (items === null) return <div className="empty">Cargando…</div>;
  if (items.length === 0)
    return <div className="empty">Todavía no hay actualizaciones en ningún proyecto.</div>;

  return (
    <div className="card">
      {items.map((n) => {
        const project = projects[n.project_id];
        const imgs = n.image_paths?.length || 0;
        return (
          <Link key={n.id} href={`/projects/${n.project_id}?tab=actualizaciones`} className="activity-row">
            <Avatar id={n.author_id || ""} name={nameFor(n.author_id)} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="note-head">
                <span className="note-author">{nameFor(n.author_id)}</span>
                <span className="muted" style={{ fontSize: 12.3 }}>
                  en <b style={{ color: "var(--ink)", fontWeight: 600 }}>{project?.name || "un proyecto"}</b>
                </span>
              </div>
              <div className="activity-text">
                {n.text || (imgs ? "Ha añadido capturas" : "")}
                {imgs > 0 && n.text && <span className="muted"> · 🖼️ {imgs}</span>}
              </div>
            </div>
            <span className="note-time" title={fmtDateTime(n.created_at)} style={{ whiteSpace: "nowrap" }}>
              {fmtRelative(n.created_at)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
