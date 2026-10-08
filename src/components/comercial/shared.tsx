"use client";

import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { PROSPECT_STALE_DAYS, PROSPECT_STATUSES } from "@/lib/format";
import type { Prospect, ProspectStatus } from "@/lib/database.types";

/** Fecha de hoy (local) como "YYYY-MM-DD", para comparar con next_action_date. */
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isOpen(p: Prospect) {
  return PROSPECT_STATUSES.find((s) => s.value === p.status)?.open ?? true;
}

/** Próxima acción con fecha ya pasada (solo empresas aún en juego). */
export function isOverdue(p: Prospect, today = todayISO()) {
  return isOpen(p) && !!p.next_action_date && p.next_action_date < today;
}

/** Más de PROSPECT_STALE_DAYS días sin ningún cambio ni nota (solo empresas aún en juego). */
export function isStale(p: Prospect, now = Date.now()) {
  return isOpen(p) && now - new Date(p.last_touched_at).getTime() > PROSPECT_STALE_DAYS * 86400000;
}

export function daysSince(iso: string, now = Date.now()) {
  return Math.floor((now - new Date(iso).getTime()) / 86400000);
}

/** Cambia el estado de una empresa. Devuelve la fila actualizada o null. */
export async function updateProspect(id: string, patch: Partial<Prospect>) {
  const { data, error } = await createClient().from("prospects").update(patch).eq("id", id).select().maybeSingle();
  if (error || !data) {
    toast("No se pudo guardar" + (error ? ": " + error.message : ": no tienes permiso"));
    return null;
  }
  return data as Prospect;
}

// Selector de estado con el color de cada fase, para la lista y la ficha.
export function ProspectStatusSelect({
  prospect,
  onUpdated,
}: {
  prospect: Prospect;
  onUpdated: (row: Prospect) => void;
}) {
  return (
    <select
      className={`prospect-status is-${prospect.status}`}
      value={prospect.status}
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        const row = await updateProspect(prospect.id, { status: e.target.value as ProspectStatus });
        if (row) onUpdated(row);
      }}
      title="Cambiar estado"
    >
      {PROSPECT_STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
