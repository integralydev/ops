"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { FileRow, Note, Project, ScopeItem, Task } from "@/lib/database.types";

export function useProject(id: string) {
  const [project, setProject] = useState<Project | null | undefined>(undefined); // undefined = loading
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate reset when `id` changes
    setProject(undefined);

    supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setProject((data as Project) || null);
      });

    const channel = supabase
      .channel("project-" + id)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects", filter: `id=eq.${id}` },
        (payload) => {
          if (payload.eventType === "DELETE") setProject(null);
          else setProject(payload.new as Project);
        },
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [id, supabase]);

  return project;
}

function useSubcollection<T extends { id: string }>(table: "tasks" | "files" | "notes" | "scope_items", projectId: string, orderCol = "created_at") {
  const [rows, setRows] = useState<Record<string, T>>({});
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate reset when `projectId` changes
    setRows({});
    setLoading(true);

    supabase
      .from(table)
      .select("*")
      .eq("project_id", projectId)
      .order(orderCol, { ascending: true })
      .then(({ data }) => {
        if (!alive) return;
        const r: Record<string, T> = {};
        (data || []).forEach((row) => (r[(row as T).id] = row as T));
        setRows(r);
        setLoading(false);
      });

    // Supabase no entrega los DELETE a una suscripción con filtro (y con RLS
    // el registro borrado solo trae el id), así que se escuchan sin filtro y
    // se descartan los ids que no son de este proyecto.
    const channel = supabase
      .channel(`${table}-${projectId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table, filter: `project_id=eq.${projectId}` },
        (payload) => setRows((prev) => ({ ...prev, [(payload.new as T).id]: payload.new as T })),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table, filter: `project_id=eq.${projectId}` },
        (payload) => setRows((prev) => ({ ...prev, [(payload.new as T).id]: payload.new as T })),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table }, (payload) => {
        const id = (payload.old as Partial<T>).id;
        setRows((prev) => {
          if (!id || !(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      })
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [table, projectId, orderCol, supabase]);

  // Para reflejar al momento un cambio propio sin esperar a Realtime.
  const removeLocal = (id: string) =>
    setRows((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  const upsertLocal = (row: T) => setRows((prev) => ({ ...prev, [row.id]: row }));

  return { rows, loading, removeLocal, upsertLocal };
}

export function useTasks(projectId: string) {
  return useSubcollection<Task>("tasks", projectId);
}
export function useFiles(projectId: string) {
  return useSubcollection<FileRow>("files", projectId, "uploaded_at");
}
export function useNotes(projectId: string) {
  return useSubcollection<Note>("notes", projectId);
}
export function useScope(projectId: string) {
  return useSubcollection<ScopeItem>("scope_items", projectId, "position");
}
