"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Project, ProjectLink } from "@/lib/database.types";

export function useProjects() {
  const [projects, setProjects] = useState<Record<string, Project>>({});
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let alive = true;

    async function fetchAll() {
      const { data } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (!alive) return;
      const p: Record<string, Project> = {};
      (data || []).forEach((row) => (p[row.id] = row as Project));
      setProjects(p);
      setLoading(false);
    }
    fetchAll();

    // A developer losing access to a project (removed from developer_ids)
    // doesn't emit a clean "removed" realtime event under RLS, so we
    // re-sync the full list whenever the tab regains focus.
    function onFocus() {
      fetchAll();
    }
    window.addEventListener("focus", onFocus);

    const channel = supabase
      .channel("projects-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, (payload) => {
        setProjects((prev) => {
          const next = { ...prev };
          if (payload.eventType === "DELETE") {
            delete next[(payload.old as Project).id];
          } else {
            const row = payload.new as Project;
            // A row that stops matching this viewer's RLS policy (e.g. a
            // developer removed from a project) simply stops arriving here;
            // Postgres changes don't send an explicit "no longer visible"
            // event, so we trust inserts/updates we do receive.
            next[row.id] = row;
          }
          return next;
        });
      })
      .subscribe();

    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  return { projects, loading };
}

// Enlace destacado de cada proyecto visible (botón rápido en tarjetas y tabla).
// RLS ya filtra: solo llegan los de proyectos de los que eres miembro.
export function useFeaturedLinks() {
  const [byId, setById] = useState<Record<string, ProjectLink>>({});
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let alive = true;
    supabase
      .from("project_links")
      .select("*")
      .eq("featured", true)
      .then(({ data }) => {
        if (!alive) return;
        const m: Record<string, ProjectLink> = {};
        (data || []).forEach((l) => (m[l.id] = l as ProjectLink));
        setById(m);
      });

    const channel = supabase
      .channel("featured-links")
      .on("postgres_changes", { event: "*", schema: "public", table: "project_links" }, (payload) => {
        setById((prev) => {
          const next = { ...prev };
          if (payload.eventType === "DELETE") delete next[(payload.old as ProjectLink).id];
          else {
            const row = payload.new as ProjectLink;
            if (row.featured) next[row.id] = row;
            else delete next[row.id];
          }
          return next;
        });
      })
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Por proyecto
  return useMemo(() => {
    const m: Record<string, ProjectLink> = {};
    Object.values(byId).forEach((l) => (m[l.project_id] = l));
    return m;
  }, [byId]);
}
