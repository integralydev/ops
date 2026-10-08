"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAppData } from "@/components/app-data";
import { Avatar } from "@/components/Avatar";
import { ProjectFormModal } from "@/components/ProjectFormModal";
import { ProspectFormModal, useSalesPeople } from "@/components/comercial/ProspectFormModal";
import { ProspectStatusSelect, daysSince, isOverdue, isStale, updateProspect } from "@/components/comercial/shared";
import { useProspectEvents, useProspects } from "@/lib/hooks/useProspects";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import {
  PROSPECT_STALE_DAYS,
  fmtDate,
  fmtDateTime,
  fmtRelative,
  prospectSourceLabel,
  prospectStatusLabel,
  prospectZoneLabel,
} from "@/lib/format";
import type { Prospect, ProspectEvent } from "@/lib/database.types";

export default function ProspectPage() {
  const { id } = useParams<{ id: string }>();
  const { prospects, loading, upsertLocal, removeLocal } = useProspects();
  const { isAdmin } = useAppData();
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const p = prospects[id];

  if (loading) {
    return (
      <div className="content">
        <div className="empty">Cargando…</div>
      </div>
    );
  }
  if (!p) {
    return (
      <div className="content">
        <div className="empty">
          Empresa no encontrada. <Link href="/comercial" className="section-link">Volver a Comercial</Link>
        </div>
      </div>
    );
  }

  async function handleDelete() {
    if (!confirm(`¿Borrar «${p.name}» y todo su historial? No se puede deshacer.`)) return;
    const { data, error } = await createClient().from("prospects").delete().eq("id", p.id).select("id");
    if (error || !data?.length) {
      toast("No se pudo borrar" + (error ? ": " + error.message : ": no tienes permiso"));
      return;
    }
    removeLocal(p.id);
    toast("Empresa borrada");
    router.push("/comercial");
  }

  return (
    <>
      <div className="topbar">
        <div style={{ minWidth: 0 }}>
          <Link href="/comercial" className="com-back">
            ← Comercial
          </Link>
          <h1>{p.name}</h1>
          <div className="topbar-sub">
            {[p.city, p.province].filter(Boolean).join(" · ") || "Sin población"} · {prospectZoneLabel(p.zone)} ·{" "}
            {prospectSourceLabel(p.source)}
          </div>
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => setShowEdit(true)}>
            Editar datos
          </button>
          {isAdmin && (
            <button className="btn btn-sm btn-danger" onClick={handleDelete}>
              Borrar
            </button>
          )}
        </div>
      </div>
      <div className="content wide">
        <div className="com-detail">
          <div className="com-col">
            {/* key: si otra persona cambia la próxima acción, el formulario se pone al día */}
            <FollowUp key={`${p.next_action}|${p.next_action_date}`} prospect={p} onUpdated={upsertLocal} />
            {p.status === "cerrada" && <Closed prospect={p} onUpdated={upsertLocal} />}
            <ContactCard prospect={p} />
          </div>
          <History prospect={p} />
        </div>
      </div>

      {showEdit && <ProspectFormModal prospect={p} onClose={() => setShowEdit(false)} onSaved={upsertLocal} />}
    </>
  );
}

// Estado, responsable y próxima acción: lo que se toca a diario.
function FollowUp({ prospect: p, onUpdated }: { prospect: Prospect; onUpdated: (row: Prospect) => void }) {
  const people = useSalesPeople();
  const [action, setAction] = useState(p.next_action);
  const [date, setDate] = useState(p.next_action_date || "");
  const [saving, setSaving] = useState(false);
  const dirty = action.trim() !== p.next_action || (date || null) !== (p.next_action_date || null);
  const overdue = isOverdue(p);
  const stale = isStale(p);

  async function saveAction() {
    setSaving(true);
    const row = await updateProspect(p.id, { next_action: action.trim(), next_action_date: date || null });
    setSaving(false);
    if (row) {
      onUpdated(row);
      toast("Próxima acción guardada");
    }
  }

  return (
    <div className="card pad">
      <div className="row between" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15 }}>Seguimiento</h3>
        {stale && (
          <span className="com-flag" title={`Sin cambios ni notas desde ${fmtDateTime(p.last_touched_at)}`}>
            {daysSince(p.last_touched_at)} días sin tocar
          </span>
        )}
      </div>
      <div className="field-row">
        <div className="field">
          <label>Estado</label>
          <ProspectStatusSelect prospect={p} onUpdated={onUpdated} />
        </div>
        <div className="field">
          <label>Responsable</label>
          <select
            value={p.owner_id || ""}
            onChange={async (e) => {
              const row = await updateProspect(p.id, { owner_id: e.target.value || null });
              if (row) onUpdated(row);
            }}
          >
            <option value="">Sin responsable</option>
            {people.map(([id, t]) => (
              <option key={id} value={id}>
                {t.full_name || "Sin nombre"}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>
          Próxima acción
          {overdue && <span className="com-overdue-tag">Vencida</span>}
        </label>
        <input
          type="text"
          className="com-input"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Qué toca ahora: llamar, enviar info, visitar…"
        />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input type="date" className="com-input com-date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn btn-sm btn-primary" onClick={saveAction} disabled={!dirty || saving}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {dirty && (
          <button
            className="btn btn-sm"
            onClick={() => {
              setAction(p.next_action);
              setDate(p.next_action_date || "");
            }}
          >
            Deshacer
          </button>
        )}
      </div>
    </div>
  );
}

// Empresa cerrada: admin crea el cliente y el proyecto en el OPS, enlazados.
function Closed({ prospect: p, onUpdated }: { prospect: Prospect; onUpdated: (row: Prospect) => void }) {
  const { isStaff, clients } = useAppData();
  const router = useRouter();
  const [clientId, setClientId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const client = p.client_id ? clients[p.client_id] : null;

  if (!isStaff) {
    return (
      <div className="card pad com-closed">
        <b>¡Cerrada! 🎉</b>
        <div className="muted" style={{ fontSize: 12.8, marginTop: 3 }}>
          {p.project_id ? "Ya tiene proyecto en el OPS." : "Eloi creará el cliente y el proyecto en el OPS."}
        </div>
      </div>
    );
  }

  async function start() {
    if (p.client_id) {
      setClientId(p.client_id);
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const phone = p.mobile || p.phone;
    const { data: c, error } = await supabase
      .from("clients")
      .insert({
        name: p.name,
        status: "client",
        contacts: p.email || phone ? [{ name: "", role: "", email: p.email, phone }] : [],
        notes: `Viene de Comercial (${prospectSourceLabel(p.source)}).`,
      })
      .select("id")
      .single();
    if (error || !c) {
      setBusy(false);
      toast("No se pudo crear el cliente" + (error ? ": " + error.message : ""));
      return;
    }
    const row = await updateProspect(p.id, { client_id: c.id });
    setBusy(false);
    if (row) onUpdated(row);
    setClientId(c.id);
  }

  return (
    <div className="card pad com-closed">
      <b>¡Cerrada! 🎉</b>
      {p.project_id ? (
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
          <Link href={`/projects/${p.project_id}`} className="btn btn-sm btn-primary">
            Ver proyecto →
          </Link>
          {p.client_id && (
            <Link href={`/clients/${p.client_id}`} className="btn btn-sm">
              Ficha de cliente
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 12.8, margin: "3px 0 10px" }}>
            {client
              ? `Ya es cliente (${client.name}). Falta crear el proyecto.`
              : "Crea la ficha de cliente con estos datos y su proyecto, enlazados a esta empresa."}
          </div>
          <button className="btn btn-sm btn-primary" onClick={start} disabled={busy}>
            {busy ? "Creando…" : client ? "Crear proyecto" : "Crear cliente y proyecto"}
          </button>
        </>
      )}

      {clientId && (
        <ProjectFormModal
          initialClientId={clientId}
          onClose={() => setClientId(null)}
          onSaved={async (projectId) => {
            const row = await updateProspect(p.id, { project_id: projectId });
            if (row) onUpdated(row);
            router.push(`/projects/${projectId}`);
          }}
        />
      )}
    </div>
  );
}

function ContactCard({ prospect: p }: { prospect: Prospect }) {
  const tel = (v: string) => `tel:${v.replace(/\s+/g, "")}`;
  return (
    <div className="card pad">
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>Contacto</h3>
      <dl className="com-data">
        <dt>Teléfono</dt>
        <dd>{p.phone ? <a href={tel(p.phone)}>{p.phone}</a> : "—"}</dd>
        <dt>Móvil</dt>
        <dd>{p.mobile ? <a href={tel(p.mobile)}>{p.mobile}</a> : "—"}</dd>
        <dt>Email</dt>
        <dd>{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : "—"}</dd>
        <dt>Población</dt>
        <dd>{[p.city, p.province].filter(Boolean).join(" · ") || "—"}</dd>
        <dt>Zona</dt>
        <dd>{prospectZoneLabel(p.zone)}</dd>
        <dt>Origen</dt>
        <dd>{prospectSourceLabel(p.source)}</dd>
        <dt>Código App</dt>
        <dd>{p.app_code || "—"}</dd>
        <dt>Alta</dt>
        <dd>{fmtDate(p.created_at)}</dd>
      </dl>
    </div>
  );
}

// Notas escritas a mano y cambios que se apuntan solos, lo más nuevo arriba.
function History({ prospect: p }: { prospect: Prospect }) {
  const { me, isAdmin, nameFor } = useAppData();
  const { events, addLocal, removeLocal } = useProspectEvents(p.id);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  async function addNote() {
    if (!text.trim()) return;
    setPosting(true);
    const { data, error } = await createClient()
      .from("prospect_events")
      .insert({ prospect_id: p.id, kind: "note", text: text.trim(), actor_id: me.id })
      .select()
      .single();
    setPosting(false);
    if (error || !data) {
      toast("No se pudo guardar la nota" + (error ? ": " + error.message : ""));
      return;
    }
    addLocal(data as ProspectEvent);
    setText("");
  }

  async function removeNote(e: ProspectEvent) {
    if (!confirm("¿Borrar esta nota?")) return;
    const { data, error } = await createClient().from("prospect_events").delete().eq("id", e.id).select("id");
    if (error || !data?.length) {
      toast("No se pudo borrar" + (error ? ": " + error.message : ": no tienes permiso"));
      return;
    }
    removeLocal(e.id);
  }

  function describe(e: ProspectEvent) {
    const d = e.data || {};
    const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
    switch (e.kind) {
      case "created":
        return <>ha añadido la empresa ({prospectSourceLabel(str("source"))})</>;
      case "status":
        return (
          <>
            ha cambiado el estado de <b>{prospectStatusLabel(str("from"))}</b> a <b>{prospectStatusLabel(str("to"))}</b>
          </>
        );
      case "owner":
        return str("to") ? (
          <>
            ha puesto a <b>{nameFor(str("to"))}</b> como responsable
          </>
        ) : (
          "ha quitado el responsable"
        );
      case "next_action":
        return e.text || str("date") ? (
          <>
            próxima acción: <i>«{e.text || "sin texto"}»</i>
            {str("date") ? ` · ${fmtDate(str("date"))}` : ""}
          </>
        ) : (
          "ha quitado la próxima acción"
        );
      default:
        return null;
    }
  }

  return (
    <div className="card pad">
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>Notas e historial</h3>
      <div className="com-compose">
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="¿Qué ha pasado? Llamada, visita, respuesta del cliente…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addNote();
          }}
        />
        <div className="row between">
          <span className="muted" style={{ fontSize: 11.5 }}>
            Las notas quedan firmadas con tu nombre y la fecha
          </span>
          <button className="btn btn-sm btn-primary" onClick={addNote} disabled={posting || !text.trim()}>
            {posting ? "Guardando…" : "Añadir nota"}
          </button>
        </div>
      </div>
      {events === null ? (
        <div className="muted" style={{ fontSize: 13, padding: "10px 0" }}>
          Cargando…
        </div>
      ) : events.length === 0 ? (
        <div className="muted" style={{ fontSize: 13, padding: "10px 0" }}>
          Todavía no hay notas.
        </div>
      ) : (
        events.map((e) =>
          e.kind === "note" ? (
            <div key={e.id} className="note">
              {e.actor_id ? <Avatar id={e.actor_id} name={nameFor(e.actor_id)} size={28} /> : <span className="activity-icon">💬</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="note-head">
                  <span className="note-author">{e.actor_id ? nameFor(e.actor_id) : "Alguien"}</span>
                  <span className="note-time" title={fmtDateTime(e.created_at)}>
                    {fmtRelative(e.created_at)} · {fmtDateTime(e.created_at)}
                  </span>
                </div>
                <div className="note-text">{e.text}</div>
              </div>
              {(isAdmin || e.actor_id === me.id) && (
                <button className="icon-btn" title="Borrar nota" onClick={() => removeNote(e)}>
                  ✕
                </button>
              )}
            </div>
          ) : (
            <div key={e.id} className="com-event">
              <span className="com-event-dot" />
              <span>
                <b>{e.actor_id ? nameFor(e.actor_id).split(" ")[0] : "Se"}</b> {describe(e)}
              </span>
              <span className="note-time" title={fmtDateTime(e.created_at)}>
                {fmtRelative(e.created_at)}
              </span>
            </div>
          ),
        )
      )}
      <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
        Una empresa en juego se marca como parada si pasa más de {PROSPECT_STALE_DAYS} días sin cambios ni notas.
      </div>
    </div>
  );
}
