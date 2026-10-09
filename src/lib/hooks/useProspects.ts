"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Prospect, ProspectEvent } from "@/lib/database.types";

// Empresas de la sección Comercial (RLS: solo admin y comercial las reciben).
// Son pocas (decenas o cientos), así que se cargan todas y se filtran en el
// navegador. Se actualizan en vivo por Realtime.
export function useProspects() {
  const [prospects, setProspects] = useState<Record<string, Prospect>>({});
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);
  // Nombre de canal único por componente: si dos partes de la misma página
  // piden el mismo canal, Supabase devuelve el ya suscrito y falla al añadirle escuchas.
  const uid = useId();

  useEffect(() => {
    let alive = true;
    supabase
      .from("prospects")
      .select("*")
      .order("name")
      .then(({ data }) => {
        if (!alive) return;
        const p: Record<string, Prospect> = {};
        (data || []).forEach((row) => (p[row.id] = row as Prospect));
        setProspects(p);
        setLoading(false);
      });

    const channel = supabase
      .channel(`prospects-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "prospects" }, (payload) => {
        setProspects((prev) => {
          const next = { ...prev };
          if (payload.eventType === "DELETE") delete next[(payload.old as Prospect).id];
          else next[(payload.new as Prospect).id] = payload.new as Prospect;
          return next;
        });
      })
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, uid]);

  // Para reflejar al momento un cambio propio sin esperar a Realtime.
  const upsertLocal = (row: Prospect) => setProspects((prev) => ({ ...prev, [row.id]: row }));
  const removeLocal = (id: string) =>
    setProspects((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  return { prospects, loading, upsertLocal, removeLocal };
}

// Historial de una empresa: notas y cambios automáticos, lo más nuevo primero.
export function useProspectEvents(prospectId: string) {
  const [events, setEvents] = useState<ProspectEvent[] | null>(null);
  const supabase = useMemo(() => createClient(), []);
  // Nombre de canal único por componente: si dos partes de la misma página
  // piden el mismo canal, Supabase devuelve el ya suscrito y falla al añadirle escuchas.
  const uid = useId();

  useEffect(() => {
    let alive = true;
    supabase
      .from("prospect_events")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (alive) setEvents((data as ProspectEvent[]) || []);
      });

    // Los DELETE no se pueden filtrar por columna: se escuchan todos y se
    // descartan los ids que no están en esta lista.
    const channel = supabase
      .channel(`prospect-events-${prospectId}-${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "prospect_events", filter: `prospect_id=eq.${prospectId}` },
        (payload) => {
          const row = payload.new as ProspectEvent;
          setEvents((prev) => [row, ...(prev || []).filter((e) => e.id !== row.id)]);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "prospect_events", filter: `prospect_id=eq.${prospectId}` },
        (payload) => {
          const row = payload.new as ProspectEvent;
          setEvents((prev) => (prev || []).map((e) => (e.id === row.id ? row : e)));
        },
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "prospect_events" }, (payload) => {
        const id = (payload.old as Partial<ProspectEvent>).id;
        setEvents((prev) => (prev || []).filter((e) => e.id !== id));
      })
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [prospectId, supabase, uid]);

  const addLocal = (row: ProspectEvent) => setEvents((prev) => [row, ...(prev || []).filter((e) => e.id !== row.id)]);
  const removeLocal = (id: string) => setEvents((prev) => (prev || []).filter((e) => e.id !== id));

  return { events, addLocal, removeLocal };
}
