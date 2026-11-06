"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/components/app-data";
import { Avatar } from "@/components/Avatar";
import { useProspects } from "@/lib/hooks/useProspects";
import { ProspectFormModal, useSalesPeople } from "@/components/comercial/ProspectFormModal";
import { PrioritySelect, ProspectStatusSelect, isOverdue, isStale, priorityRank, todayISO } from "@/components/comercial/shared";
import {
  PROSPECT_SOURCES,
  PROSPECT_STALE_DAYS,
  PROSPECT_STATUSES,
  PROSPECT_ZONES,
  fmtDate,
  fmtRelative,
} from "@/lib/format";
import type { Prospect, ProspectStatus } from "@/lib/database.types";
import { Icon, type IconName } from "@/components/Icon";

type Quick = "stale" | "overdue" | null;

// Comercial: embudo de empresas a las que queremos vender, antes de que haya
// proyecto. Solo la ven admin y comercial (RLS en prospects).
export default function ComercialPage() {
  const { nameFor, isAdmin } = useAppData();
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
  const [sector, setSector] = useState("all");
  const [priority, setPriority] = useState("all");
  const [sortBy, setSortBy] = useState<"action" | "priority">("action");
  // Solo admin: todas, solo las compartidas con Comercial o solo las privadas
  // (RLS ya no le manda las privadas a quien no es admin)
  const [scope, setScope] = useState<"all" | "shared" | "private">("all");
  const [showFilters, setShowFilters] = useState(false);

  const everything = useMemo(() => Object.values(prospects), [prospects]);
  // El resumen y la lista cuentan según lo elegido arriba
  const all = everything.filter((p) => scope === "all" || (scope === "private" ? p.is_private : !p.is_private));
  const sectors = [...new Set(everything.map((p) => (p.sector || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
  const privateCount = everything.filter((p) => p.is_private).length;
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
    .filter((p) => sector === "all" || (sector === "none" ? !p.sector : p.sector === sector))
    .filter((p) => priority === "all" || (priority === "none" ? !p.priority : p.priority === priority))
    .filter((p) => quick !== "stale" || isStale(p))
    .filter((p) => quick !== "overdue" || isOverdue(p, today))
    .filter(
      (p) =>
        !needle ||
        p.name.toLowerCase().includes(needle) ||
        p.city.toLowerCase().includes(needle) ||
        (p.address || "").toLowerCase().includes(needle) ||
        (p.sector || "").toLowerCase().includes(needle) ||
        (p.app_code || "").toLowerCase().includes(needle),
    )
    // Primero lo que sigue en juego; dentro, lo que tiene acción más próxima.
    // "Por prioridad": A, B, C y sin prioridad, y dentro de cada una lo mismo.
    .sort(
      (a, b) =>
        (sortBy === "priority" ? priorityRank(a) - priorityRank(b) : 0) ||
        Number(!isOpen(a)) - Number(!isOpen(b)) ||
        (a.next_action_date || "9999").localeCompare(b.next_action_date || "9999") ||
        a.name.localeCompare(b.name, "es"),
    );

  const filtered =
    !!needle ||
    status !== "all" ||
    zone !== "all" ||
    source !== "all" ||
    owner !== "all" ||
    sector !== "all" ||
    priority !== "all" ||
    !!quick;
  function clearFilters() {
    setSector("all");
    setPriority("all");
    setQ("");
    setStatus("all");
    setZone("all");
    setSource("all");
    setOwner("all");
    setQuick(null);
  }

  // Los cuatro pasos del embudo van grandes; cerradas y descartadas, en Filtros
  const FUNNEL: { value: ProspectStatus; icon: IconName; tone: string }[] = [
    { value: "sin_contactar", icon: "target", tone: "g" },
    { value: "contactada", icon: "phone", tone: "p" },
    { value: "reunion_hecha", icon: "users", tone: "in" },
    { value: "propuesta_enviada", icon: "file", tone: "w" },
  ];
  const extraFilters = [zone, source, owner, sector, priority].filter((x) => x !== "all").length +
    (status === "cerrada" || status === "descartada" ? 1 : 0);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Comercial</h1>
          <div className="topbar-sub">Empresas a las que queremos vender</div>
        </div>
        <button className="btn btn-primary btn-icon" onClick={() => setShowNew(true)}>
          <Icon name="plus" size={16} /> Nueva empresa
        </button>
      </div>
      <div className="content wide">
        {isAdmin && (
          <div className="seg com-scope" role="group" aria-label="Qué empresas ver">
            <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>
              Todas <span className="kind-count">{everything.length}</span>
            </button>
            <button className={scope === "shared" ? "active" : ""} onClick={() => setScope("shared")}>
              Compartidas <span className="kind-count">{everything.length - privateCount}</span>
            </button>
            <button className={scope === "private" ? "active" : ""} onClick={() => setScope("private")}>
              Mi prospección <span className="kind-count">{privateCount}</span>
            </button>
          </div>
        )}

        <div className="funnel">
          {FUNNEL.map((f) => {
            const label = PROSPECT_STATUSES.find((s) => s.value === f.value)?.label || f.value;
            return (
              <button
                key={f.value}
                className={"card funnel-tile" + (status === f.value ? " active" : "")}
                onClick={() => {
                  setQuick(null);
                  setStatus(status === f.value ? "all" : f.value);
                }}
              >
                <div className={`ico ico-${f.tone}`}>
                  <Icon name={f.icon} size={20} />
                </div>
                <div>
                  <b>{countBy(f.value)}</b>
                  <span>{label}</span>
                </div>
              </button>
            );
          })}
        </div>

        {(overdueCount > 0 || staleCount > 0) && (
          <div className="com-alerts">
            <Icon name="alert" size={17} />
            <span>Para mover:</span>
            {overdueCount > 0 && (
              <button
                className={"alert-chip" + (quick === "overdue" ? " active" : "")}
                onClick={() => setQuick(quick === "overdue" ? null : "overdue")}
                title="Empresas con la próxima acción ya vencida"
              >
                <b>{overdueCount}</b> con la acción vencida
              </button>
            )}
            {staleCount > 0 && (
              <button
                className={"alert-chip" + (quick === "stale" ? " active" : "")}
                onClick={() => setQuick(quick === "stale" ? null : "stale")}
                title={`Empresas en juego sin ningún cambio ni nota en más de ${PROSPECT_STALE_DAYS} días`}
              >
                <b>{staleCount}</b> sin tocar en +{PROSPECT_STALE_DAYS} días
              </button>
            )}
          </div>
        )}

        <div className="com-bar">
          <label className="search-box">
            <Icon name="search" size={17} />
            <input
              type="search"
              placeholder="Buscar empresa, población o sector…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <button className={"btn" + (showFilters || extraFilters ? " btn-on" : "")} onClick={() => setShowFilters((v) => !v)}>
            Filtros{extraFilters > 0 && <span className="kind-count">{extraFilters}</span>}
          </button>
          <select
            className="scope-select com-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "action" | "priority")}
            title="Ordenar"
          >
            <option value="action">Por próxima acción</option>
            <option value="priority">Por prioridad</option>
          </select>
        </div>

        {showFilters && (
          <div className="card com-filter-panel">
            <select className="scope-select" value={status} onChange={(e) => setStatus(e.target.value as ProspectStatus | "all")}>
              <option value="all">Todos los estados</option>
              {PROSPECT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <select className="scope-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="all">Todas las prioridades</option>
              <option value="A">Prioridad A · llamar primero</option>
              <option value="B">Prioridad B · después</option>
              <option value="C">Prioridad C · poco encaje</option>
              <option value="none">Sin prioridad</option>
            </select>
            {sectors.length > 0 && (
              <select className="scope-select" value={sector} onChange={(e) => setSector(e.target.value)}>
                <option value="all">Todos los sectores</option>
                {sectors.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                <option value="none">Sin sector</option>
              </select>
            )}
            <select className="scope-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="all">Todos los responsables</option>
              {people.map(([id, t]) => (
                <option key={id} value={id}>
                  {t.full_name || "Sin nombre"}
                </option>
              ))}
              <option value="none">Sin responsable</option>
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
          </div>
        )}

        <div className="com-listhead">
          <span>
            {list.length === all.length ? `${all.length} empresas` : `${list.length} de ${all.length} empresas`}
          </span>
          {filtered && (
            <button className="section-link" onClick={clearFilters}>
              Quitar filtros
            </button>
          )}
        </div>

        {loading ? (
          <div className="empty">Cargando…</div>
        ) : all.length === 0 ? (
          <div className="empty">Todavía no hay empresas. Añade la primera con «Nueva empresa».</div>
        ) : list.length === 0 ? (
          <div className="empty">Ninguna empresa coincide con estos filtros.</div>
        ) : (
          <div className="card com-list">
            {list.map((p) => {
              const overdue = isOverdue(p, today);
              const stale = isStale(p);
              return (
                <div
                  key={p.id}
                  className="com-item"
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/comercial/${p.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") router.push(`/comercial/${p.id}`);
                  }}
                >
                  <PrioritySelect prospect={p} onUpdated={upsertLocal} />
                  <div className="com-item-body">
                    <div className="com-item-name">
                      <span className="nm">{p.name}</span>
                      {p.is_private && (
                        <span className="com-lock" title="Privada: solo la ven los admin">
                          <Icon name="lock" size={13} />
                        </span>
                      )}
                      {(p.city || p.sector) && (
                        <span className="com-item-meta">{[p.city, p.sector].filter(Boolean).join(" · ")}</span>
                      )}
                    </div>
                    {p.next_action || p.next_action_date ? (
                      <div className={"com-item-next" + (overdue ? " is-overdue" : "")}>
                        {p.next_action_date && (
                          <b>
                            {overdue && <Icon name="clock" size={13} />}
                            {fmtDate(p.next_action_date)}
                          </b>
                        )}
                        {p.next_action && <span>{p.next_action}</span>}
                      </div>
                    ) : (
                      <div className="com-item-next none">Sin próxima acción</div>
                    )}
                  </div>
                  <div className="com-item-side">
                    {stale && (
                      <span className="stale-dot" title={`Sin tocar desde ${fmtRelative(p.last_touched_at)}`} />
                    )}
                    <ProspectStatusSelect prospect={p} onUpdated={upsertLocal} />
                    {p.owner_id ? (
                      <span title={nameFor(p.owner_id)}>
                        <Avatar id={p.owner_id} name={nameFor(p.owner_id)} size={26} />
                      </span>
                    ) : (
                      <span className="no-owner" title="Sin responsable" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showNew && (
        <ProspectFormModal
          sectors={sectors}
          startPrivate={isAdmin && scope === "private"}
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
