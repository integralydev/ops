"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Client, Profile, Role } from "@/lib/database.types";

interface Me {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
}

interface AppDataValue {
  me: Me;
  team: Record<string, Profile>;
  clients: Record<string, Client>;
  /** Solo administradores: gestionar el equipo (personas y roles). */
  isAdmin: boolean;
  /** Administradores y directores de proyecto: ven y editan todos los proyectos y clientes. */
  isStaff: boolean;
  /** Rol comercial: solo accede a la sección Comercial. */
  isComercial: boolean;
  /** Acceso a la sección Comercial: administradores y comerciales. */
  hasSales: boolean;
  nameFor: (id?: string | null) => string;
  /** Refleja al momento un cambio propio en un perfil, sin esperar a Realtime. */
  patchProfile: (id: string, patch: Partial<Profile>) => void;
}

const AppDataContext = createContext<AppDataValue | null>(null);

/** Color elegido por una persona (null si no hay o fuera de la app). */
export function useChosenColor(id?: string | null) {
  const ctx = useContext(AppDataContext);
  return id ? ctx?.team[id]?.color || null : null;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used inside <AppDataProvider>");
  return ctx;
}

export function AppDataProvider({
  me,
  children,
}: {
  me: Me;
  children: React.ReactNode;
}) {
  const [team, setTeam] = useState<Record<string, Profile>>({});
  const [clients, setClients] = useState<Record<string, Client>>({});
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let alive = true;

    supabase
      .from("profiles")
      .select("*")
      .then(({ data }) => {
        if (!alive || !data) return;
        const t: Record<string, Profile> = {};
        data.forEach((p) => (t[p.id] = p as Profile));
        setTeam(t);
      });

    supabase
      .from("clients")
      .select("*")
      .then(({ data }) => {
        if (!alive || !data) return;
        const c: Record<string, Client> = {};
        data.forEach((cl) => (c[cl.id] = cl as Client));
        setClients(c);
      });

    const channel = supabase
      .channel("app-data")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (payload) => {
        setTeam((prev) => {
          const next = { ...prev };
          if (payload.eventType === "DELETE") delete next[(payload.old as Profile).id];
          else next[(payload.new as Profile).id] = payload.new as Profile;
          return next;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, (payload) => {
        setClients((prev) => {
          const next = { ...prev };
          if (payload.eventType === "DELETE") delete next[(payload.old as Client).id];
          else next[(payload.new as Client).id] = payload.new as Client;
          return next;
        });
      })
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const nameFor = (id?: string | null) => {
    if (!id) return "Sin asignar";
    if (id === me.id) return me.full_name || "Tú";
    return team[id]?.full_name || "Alguien";
  };

  const value: AppDataValue = {
    me,
    team,
    clients,
    isAdmin: me.role === "admin",
    isStaff: me.role === "admin" || me.role === "director",
    isComercial: me.role === "comercial",
    hasSales: me.role === "admin" || me.role === "comercial",
    nameFor,
    patchProfile: (id, patch) =>
      setTeam((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev)),
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}
