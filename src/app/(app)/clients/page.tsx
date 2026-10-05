"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppData } from "@/components/app-data";
import { useProjects } from "@/lib/hooks/useProjects";
import { ClientFormModal } from "@/components/ClientFormModal";
import { CLIENT_STATUSES, clientContacts, clientStatusLabel } from "@/lib/format";
import type { ClientStatus } from "@/lib/database.types";

export default function ClientsPage() {
  const { clients, isStaff } = useAppData();
  const { projects } = useProjects();
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState<ClientStatus | "all">("all");
  const router = useRouter();

  const all = Object.entries(clients);
  const count = (s: ClientStatus) => all.filter(([, c]) => (c.status || "lead") === s).length;
  const list = filter === "all" ? all : all.filter(([, c]) => (c.status || "lead") === filter);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Clientes</h1>
          <div className="topbar-sub">Fichas de cliente</div>
        </div>
        {isStaff && (
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            + Nuevo cliente
          </button>
        )}
      </div>
      <div className="content">
        {all.length > 0 && (
          <div className="task-filters" style={{ marginBottom: 16 }}>
            <button className={"task-filter" + (filter === "all" ? " active" : "")} onClick={() => setFilter("all")}>
              Todos <span>{all.length}</span>
            </button>
            {CLIENT_STATUSES.map((s) => (
              <button
                key={s.value}
                className={"task-filter" + (filter === s.value ? " active" : "")}
                onClick={() => setFilter(s.value)}
                title={s.hint}
              >
                {s.label} <span>{count(s.value)}</span>
              </button>
            ))}
          </div>
        )}
        {all.length === 0 ? (
          <div className="empty">Todavía no hay clientes. Crea el primero con &quot;+ Nuevo cliente&quot;.</div>
        ) : list.length === 0 ? (
          <div className="empty">No hay clientes en este estado.</div>
        ) : (
          <div className="grid grid-cards">
            {list.map(([id, c]) => {
              const n = Object.values(projects).filter((p) => p.client_id === id).length;
              return (
                <Link key={id} href={`/clients/${id}`} className="card proj-card">
                  <div className="proj-top">
                    <div className="proj-name">{c.name}</div>
                    <span className={`client-status client-status-${c.status || "lead"}`}>{clientStatusLabel(c.status)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12.6 }}>
                    {clientContacts(c)
                      .map((p) => p.name)
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {n} proyecto{n === 1 ? "" : "s"}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {showNew && (
        <ClientFormModal
          onClose={() => setShowNew(false)}
          onSaved={(id) => router.push(`/clients/${id}`)}
        />
      )}
    </>
  );
}
