"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { LAB_STATUSES, PROJECT_STATUSES, kindOf, statusLabel } from "@/lib/format";
import type { Project, ProjectStatus } from "@/lib/database.types";

// Celdas editables de la base de datos de proyectos (como las propiedades de
// Notion). Fase y encargado: admin/director (RLS de projects). Próximo paso:
// cualquier miembro, por la función update_next_step.

/** Fases del tipo del proyecto, con número de orden las que son del proceso. */
export function statusesFor(p: Pick<Project, "kind">) {
  const list = kindOf(p) === "laboratorio" ? LAB_STATUSES : PROJECT_STATUSES;
  const offFlow = ["pausado", "cerrado", "aparcado"];
  let n = 0;
  return list.map((s) => ({ value: s.value, label: offFlow.includes(s.value) ? s.label : `${++n}. ${s.label}` }));
}

export async function updateProject(p: Project, patch: Partial<Project>) {
  const { data, error } = await createClient()
    .from("projects")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", p.id)
    .select()
    .maybeSingle();
  if (error || !data) {
    toast("No se pudo guardar" + (error ? ": " + error.message : ": solo admin y directores pueden cambiarlo"));
    return null;
  }
  return data as Project;
}

export function StatusCell({ project: p, onUpdated }: { project: Project; onUpdated: (row: Project) => void }) {
  const { isStaff } = useAppData();
  if (!isStaff) {
    return (
      <span className={`badge badge-${p.status}`}>
        <span className="badge-dot" />
        {statusLabel(p.status)}
      </span>
    );
  }
  return (
    <select
      className={`badge badge-${p.status} cell-select`}
      value={p.status}
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        const row = await updateProject(p, { status: e.target.value as ProjectStatus });
        if (row) onUpdated(row);
      }}
      title="Cambiar fase"
    >
      {statusesFor(p).map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

export function OwnerCell({ project: p, onUpdated }: { project: Project; onUpdated: (row: Project) => void }) {
  const { isStaff, team, nameFor } = useAppData();
  const people = Object.values(team)
    .filter((t) => t.role !== "comercial")
    .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
  return (
    <div className="cell-owner" onClick={(e) => e.stopPropagation()}>
      {p.owner_id && <Avatar id={p.owner_id} name={nameFor(p.owner_id)} size={20} />}
      {isStaff ? (
        <select
          className="task-assign-select"
          value={p.owner_id || ""}
          onChange={async (e) => {
            const row = await updateProject(p, { owner_id: e.target.value || null });
            if (row) onUpdated(row);
          }}
          title="Cambiar encargado"
        >
          <option value="">Sin encargado</option>
          {people.map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name || "Sin nombre"}
            </option>
          ))}
        </select>
      ) : (
        <span className={p.owner_id ? "" : "muted"}>{p.owner_id ? nameFor(p.owner_id) : "Sin encargado"}</span>
      )}
    </div>
  );
}

export function NextStepCell({ project: p, onUpdated }: { project: Project; onUpdated: (row: Project) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(p.next_step || "");

  async function save() {
    setEditing(false);
    const v = value.trim();
    if (v === (p.next_step || "")) return;
    const { error } = await createClient().rpc("update_next_step", { pid: p.id, val: v });
    if (error) {
      toast("No se pudo guardar el próximo paso: " + error.message);
      setValue(p.next_step || "");
      return;
    }
    onUpdated({ ...p, next_step: v });
  }

  if (editing) {
    return (
      <input
        className="cell-input"
        value={value}
        autoFocus
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setValue(p.next_step || "");
            setEditing(false);
          }
        }}
        placeholder="Qué toca ahora"
      />
    );
  }
  return (
    <div
      className="cell-text"
      title={p.next_step ? `${p.next_step}\n\nClic para editar` : "Clic para añadir"}
      onClick={(e) => {
        e.stopPropagation();
        setValue(p.next_step || "");
        setEditing(true);
      }}
    >
      {p.next_step || <span className="cell-empty">Vacío</span>}
    </div>
  );
}
