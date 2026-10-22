"use client";

import Link from "next/link";
import { useState } from "react";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import type { Profile } from "@/lib/database.types";
import { MfaSettings } from "@/components/MfaSettings";

type Pref = "notify_task_assigned" | "notify_task_comments";

const PREFS: { key: Pref; label: string; hint: string }[] = [
  {
    key: "notify_task_assigned",
    label: "Cuando me asignan una tarea",
    hint: "Te llega un email con la tarea y un enlace para abrirla.",
  },
  {
    key: "notify_task_comments",
    label: "Cuando comentan en una tarea mía",
    hint: "Tareas asignadas a ti, creadas por ti o en las que has comentado. No te avisa de tus propios comentarios.",
  },
];

// Ajustes personales: avisos por email y contraseña.
export default function AjustesPage() {
  const { me, team, patchProfile } = useAppData();
  const mine = team[me.id];
  const [saving, setSaving] = useState<Pref | null>(null);

  async function toggle(key: Pref, value: boolean) {
    setSaving(key);
    patchProfile(me.id, { [key]: value } as Partial<Profile>);
    const { error } = await createClient()
      .from("profiles")
      .update({ [key]: value })
      .eq("id", me.id);
    setSaving(null);
    if (error) {
      patchProfile(me.id, { [key]: !value } as Partial<Profile>);
      toast("No se pudo guardar: " + error.message);
      return;
    }
    toast(value ? "Aviso activado" : "Aviso desactivado");
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Ajustes</h1>
          <div className="topbar-sub">Tus preferencias en Integraly Ops</div>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 720 }}>
        <div className="section-title">Avisos por email</div>
        <div className="card">
          {PREFS.map((p) => {
            const on = mine ? mine[p.key] !== false : true;
            return (
              <label key={p.key} className="pref-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pref-label">{p.label}</div>
                  <div className="pref-hint">{p.hint}</div>
                </div>
                <input
                  type="checkbox"
                  className="switch"
                  checked={on}
                  disabled={!mine || saving === p.key}
                  onChange={(e) => toggle(p.key, e.target.checked)}
                />
              </label>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize: 12.3, marginTop: 10 }}>
          Los avisos llegan a {me.email || "tu email"}. Dentro del OPS verás siempre los comentarios nuevos marcados en las tareas.
        </p>

        <div className="section-title">Seguridad</div>
        <MfaSettings />

        <div className="section-title">Cuenta</div>
        <div className="card">
          <Link href="/set-password" className="pref-row">
            <div style={{ flex: 1 }}>
              <div className="pref-label">Contraseña</div>
              <div className="pref-hint">Pon o cambia la contraseña para entrar sin enlace por email.</div>
            </div>
            <span className="muted">→</span>
          </Link>
        </div>
      </div>
    </>
  );
}
