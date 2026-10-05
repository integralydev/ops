"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAppData } from "@/components/app-data";
import { useProjects } from "@/lib/hooks/useProjects";
import { ClientFormModal } from "@/components/ClientFormModal";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { clientContacts, clientStatusLabel, statusLabel } from "@/lib/format";

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const clientId = params.id;
  const { clients, isStaff } = useAppData();
  const { projects } = useProjects();
  const [showEdit, setShowEdit] = useState(false);
  const router = useRouter();

  const client = clients[clientId];
  const contacts = client ? clientContacts(client) : [];
  const clientProjects = Object.entries(projects).filter(([, p]) => p.client_id === clientId);

  async function handleDelete() {
    if (clientProjects.length) {
      toast("No se puede borrar: hay proyectos con este cliente");
      return;
    }
    if (!confirm("¿Borrar este cliente?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("clients").delete().eq("id", clientId);
    if (error) {
      toast("No se pudo borrar: " + error.message);
      return;
    }
    router.push("/clients");
  }

  if (!client) {
    return (
      <div className="content">
        <div className="empty">Cliente no encontrado.</div>
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{client.name}</h1>
        </div>
        <span className={`client-status client-status-${client.status || "lead"}`}>{clientStatusLabel(client.status)}</span>
      </div>
      <div className="content">
        <div className="grid" style={{ gridTemplateColumns: "1fr 1.4fr", alignItems: "start" }}>
          <div className="card pad">
            <div className="row between" style={{ marginBottom: 10 }}>
              <h3 style={{ fontSize: 15 }}>Ficha</h3>
              {isStaff && (
                <div className="row">
                  <button className="btn btn-sm" onClick={() => setShowEdit(true)}>
                    Editar
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={handleDelete}>
                    Borrar
                  </button>
                </div>
              )}
            </div>
            <div className="section-title" style={{ marginTop: 0 }}>
              {contacts.length > 1 ? "Personas de contacto" : "Persona de contacto"}
            </div>
            {contacts.length ? (
              <div className="contact-list">
                {contacts.map((c, i) => (
                  <div key={i}>
                    <div className="contact-name">
                      {c.name || "Sin nombre"}
                      {c.role && <span className="contact-role">{c.role}</span>}
                    </div>
                    {c.email && (
                      <div className="contact-line">
                        <a href={`mailto:${c.email}`}>{c.email}</a>
                      </div>
                    )}
                    {c.phone && (
                      <div className="contact-line">
                        <a href={`tel:${c.phone.replace(/\s+/g, "")}`}>{c.phone}</a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13.5 }}>—</div>
            )}
            {client.notes && (
              <>
                <div className="section-title">Notas</div>
                <div style={{ fontSize: 13.4, whiteSpace: "pre-wrap", color: "var(--ink-soft)" }}>
                  {client.notes}
                </div>
              </>
            )}
          </div>
          <div className="card pad">
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>Proyectos ({clientProjects.length})</h3>
            {clientProjects.length ? (
              clientProjects.map(([pid, p]) => (
                <div
                  key={pid}
                  className="row between"
                  style={{ padding: "9px 0", borderBottom: "1px solid var(--border)" }}
                >
                  <Link href={`/projects/${pid}`} style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {p.name}
                  </Link>
                  <span className={`badge badge-${p.status}`}>{statusLabel(p.status)}</span>
                </div>
              ))
            ) : (
              <div className="empty">Sin proyectos todavía.</div>
            )}
          </div>
        </div>
      </div>

      {showEdit && <ClientFormModal client={client} onClose={() => setShowEdit(false)} />}
    </>
  );
}
