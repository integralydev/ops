"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

interface Pending {
  project_id: string;
  project_name: string;
  client_name: string;
  status: string;
}

// Inicio (solo admin): clientes que ya están en propuesta o más adelante y
// aún no tienen acceso a su portal. Cada fila lleva al proyecto, donde se
// invita con un clic.
export function PortalPending() {
  const { isAdmin } = useAppData();
  const [rows, setRows] = useState<Pending[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    createClient()
      .rpc("portal_pending_invites")
      .then(({ data }) => {
        if (alive && Array.isArray(data)) setRows(data as Pending[]);
      });
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  if (!isAdmin || rows.length === 0) return null;

  return (
    <div className="card pad portal-box invite" style={{ marginBottom: 18 }}>
      <div className="portal-box-head" style={{ marginBottom: 6 }}>
        <div className="ico ico-p">
          <Icon name="users" size={20} />
        </div>
        <div>
          <b>Dar acceso al portal</b>
          <div className="muted">
            {rows.length === 1 ? "Un cliente" : `${rows.length} clientes`} sin acceso a su portal. Entra en el proyecto e invítalo con un clic.
          </div>
        </div>
      </div>
      <div className="com-alerts" style={{ marginTop: 8, flexWrap: "wrap" }}>
        {rows.map((r) => (
          <Link key={r.project_id} href={`/projects/${r.project_id}`} className="portal-chip">
            {r.client_name} · {r.project_name} <Icon name="arrow" size={13} />
          </Link>
        ))}
      </div>
    </div>
  );
}
