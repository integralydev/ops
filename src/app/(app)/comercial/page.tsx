"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/components/app-data";
import { Avatar } from "@/components/Avatar";
import { useProspects } from "@/lib/hooks/useProspects";
import { ProspectFormModal, useSalesPeople } from "@/components/comercial/ProspectFormModal";
import { ProspectStatusSelect, isOverdue, isStale, todayISO } from "@/components/comercial/shared";
import {
  PROSPECT_SOURCES,
  PROSPECT_STALE_DAYS,
  PROSPECT_STATUSES,
  PROSPECT_ZONES,
  fmtDate,
  fmtDateTime,
  fmtRelative,
  prospectSourceLabel,
  prospectZoneLabel,
} from "@/lib/format";
import type { Prospect, ProspectStatus } from "@/lib/database.types";

type Quick = "stale" | "overdue" | null;

// Comercial: embudo de empresas a las que queremos vender, antes de que haya
// proyecto. Solo la ven admin y comercial (RLS en prospects).
export default function ComercialPage() {
  const { nameFor } = useAppData();
  const people = useSalesPeople();
  const { prospects, loading, upsertLocal } = useProspects();
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ProspectStatus | "all">("all");
  const [zone, setZone] = useState("all");
  const [source, setSource] = useState("all");
  const [owner, setOwner] = useState("all");
  const [quick, setQuick] = useState<Quick>(null);

  const all = useMemo(() => Object.values(prospects), [prospects]);
  const today = todayISO();
  const countBy = (s: ProspectStatus) => all.filter((p) => p.status === s).length;
  const staleCount = all.filter((p) => isStale(p)).length;
  const overdueCount = all.filter((p) => isOverdue(p, today)).length;

  const isOpen = (p: Prospect) => PROSPECT_STATUSES.find((s) => s.value === p.status)?.open ?? true;
  const needle = q.trim().toLowerCase();
  const list = all
    .filter((p) => status === "all" || p.status === status)
    .filter((p) => zone === "all" || (zone === "none" ? !p.zone : p.zone === zone))
    .filter((p) => source === "all" || p.source === source)
    .filter((p) => owner === "all" || (owner === "none" ? !p.owner_id : p.owner_id === owner))
    .filter((p) => quick !== "stale" || isStale(p))
    .filter((p) => quick !== "overdue" || isOverdue(p, today))
    .filter(
      (p) =>
        !needle ||
        p.name.toLowerCase().includes(needle) ||
        p.city.toLowerCase().includes(needle) ||
        (p.app_code || "").toLowerCase().includes(needle),
    )
    // Primero lo que sigue en juego; dentro, lo que tiene acción más próxima
    .sort(
      (a, b) =>
        Number(!isOpen(a)) - Number(!isOpen(b)) ||
        (a.next_action_date || "9999").localeCompare(b.next_action_date || "9999") ||
        a.name.localeCompare(b.name, "es"),
    );

  const filtered = !!needle || status !== "all" || zone !== "all" || source !== "all" || owner !== "all" || !!quick;
  function clearFilters() {
    setQ("");
    setStatus("all");
    setZone("all");
    setSource("all");
    setOwner("all");
    setQuick(null);
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Comercial</h1>
          <div className="topbar-sub">Empresas a las que queremos vender, antes de que sean proyecto</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          + Nueva empresa
        </button>
      </div>
      <div className="content wide">
        <div className="com-summary">
          {PROSPECT_STATUSES.map((s) => (
            <button
              key={s.value}
              className={`card com-tile is-${s.value}` + (status === s.value ? " active" : "")}
              onClick={() => {
                setQuick(null);
                setStatus(status === s.value ? "all" : s.value);
              }}
            >
              <b>{countBy(s.value)}</b>
              <span>{s.label}</span>
            </button>
          ))}
          <button
            className={"card com-tile is-alert" + (quick === "stale" ? " active" : "")}
            onClick={() => setQuick(quick === "stale" ? null : "stale")}
            title={`Empresas en juego sin ningún cambio ni nota en más de ${PROSPECT_STALE_DAYS} días`}
          >
            <b>{staleCount}</b>
            <span>+{PROSPECT_STALE_DAYS} días sin tocar</span>
          </button>
          <button
            className={"card com-tile is-alert" + (quick === "overdue" ? " active" : "")}
            onClick={() => setQuick(quick === "overdue" ? null : "overdue")}
            title="Empresas con la próxima acción ya vencida"
          >
            <b>{overdueCount}</b>
            <span>Acción vencida</span>
          </button>
        </div>

        <div className="com-filters">
          <input
            type="search"
            className="scope-search"
            placeholder="Buscar por nombre, población o código…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="scope-select" value={status} onChange={(e) => setStatus(e.target.value as ProspectStatus | "all")}>
            <option value="all">Todos los estados</option>
            {PROSPECT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select className="scope-select" value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="all">Todas las zonas</option>
            {PROSPECT_ZONES.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
            <option value="none">Sin zona</option>
          </select>
          <select className="scope-select" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">Todos los orígenes</option>
            {PROSPECT_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select className="scope-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">Todos los responsables</option>
            {people.map(([id, t]) => (
              <option key={id} value={id}>
                {t.full_name || "Sin nombre"}
              </option>
            ))}
            <option value="none">Sin responsable</option>
          </select>
          {filtered && (
            <button className="section-link" onClick={clearFilters}>
              Quitar filtros
            </button>
          )}
          <span className="muted com-count">
            {list.length} de {all.length}
          </span>
        </div>

        {loading ? (
          <div className="empty">Cargando…</div>
        ) : all.length === 0 ? (
          <div className="empty">Todavía no hay empresas. Añade la primera con «+ Nueva empresa».</div>
        ) : list.length === 0 ? (
          <div className="empty">Ninguna empresa coincide con estos filtros.</div>
        ) : (
          <div className="card table-card">
            <table className="ptable com-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Estado</th>
                  <th>Próxima acción</th>
                  <th className="col-owner">Responsable</th>
                  <th className="col-next">Zona · origen</th>
                  <th className="col-date">Último movimiento</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const overdue = isOverdue(p, today);
                  const stale = isStale(p);
                  return (
                    <tr key={p.id} className="ptable-row" onClick={() => router.push(`/comercial/${p.id}`)}>
                      <td>
                        <div className="ptable-name">{p.name}</div>
                        <div className="ptable-sub">{[p.city, p.province].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                      <td>
                        <ProspectStatusSelect prospect={p} onUpdated={upsertLocal} />
                      </td>
                      <td>
                        {p.next_action || p.next_action_date ? (
                          <div className={"com-next" + (overdue ? " is-overdue" : "")}>
                            {p.next_action_date && <b>{fmtDate(p.next_action_date)}</b>}
                            {p.next_action && <span>{p.next_action}</span>}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="col-owner">
                        {p.owner_id ? (
                          <span className="row" style={{ gap: 7 }}>
                            <Avatar id={p.owner_id} name={nameFor(p.owner_id)} size={22} />
                            {nameFor(p.owner_id).split(" ")[0]}
                          </span>
                        ) : (
                          <span className="muted">Sin responsable</span>
                        )}
                      </td>
                      <td className="col-next">
                        <div>{prospectZoneLabel(p.zone)}</div>
                        <div className="ptable-sub">{prospectSourceLabel(p.source)}</div>
                      </td>
                      <td className="col-date" title={fmtDateTime(p.last_touched_at)}>
                        <span className={stale ? "com-stale" : "muted"}>{fmtRelative(p.last_touched_at)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <ProspectFormModal
          onClose={() => setShowNew(false)}
          onSaved={(row) => {
            upsertLocal(row);
            router.push(`/comercial/${row.id}`);
          }}
        />
      )}
    </>
  );
}
