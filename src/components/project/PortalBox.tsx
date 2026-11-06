"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { Icon } from "@/components/Icon";
import { fmtRelative, kindOf } from "@/lib/format";
import { PORTAL_STATUSES } from "@/lib/portal";
import {
  getPortalUsers,
  inviteToPortal,
  removePortalUser,
  setPortalPromptDismissed,
  type PortalUser,
} from "@/app/portal/actions";
import type { Project } from "@/lib/database.types";

// Bloque "Portal del cliente" en el Resumen del proyecto (admin y director).
// Disparador: cuando el proyecto llega a Propuesta (o ya está más adelante) y
// el cliente aún no tiene acceso, se propone invitar a su contacto. Un clic
// de confirmación (solo admin) y le llega el email con su enlace.
export function PortalBox({ project }: { project: Project }) {
  const { isAdmin, isStaff, clients } = useAppData();
  const client = project.client_id ? clients[project.client_id] : null;
  const [users, setUsers] = useState<PortalUser[] | null>(null);
  const [inviting, setInviting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [sending, setSending] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [lang, setLang] = useState<"es" | "ca">("es");
  const [stepDraft, setStepDraft] = useState(project.client_next_step || "");
  const [editingStep, setEditingStep] = useState(false);

  const visible = PORTAL_STATUSES.includes(project.status);
  const contacts = (client?.contacts || []).filter((c) => c.email);

  const load = useCallback(async () => {
    if (!client || !isAdmin) return;
    setUsers(await getPortalUsers(client.id));
  }, [client, isAdmin]);

  useEffect(() => {
    // Carga inicial de quién tiene acceso (llamada al servidor)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!isStaff || !client || kindOf(project) === "laboratorio") return null;

  function openForm() {
    const c = contacts[0];
    setName(c?.name || "");
    setEmail(c?.email || "");
    setLang(client?.portal_lang === "ca" ? "ca" : "es");
    setShowForm(true);
  }

  async function invite() {
    if (!client) return;
    setSending(true);
    const r = await inviteToPortal({ clientId: client.id, name, email, lang });
    setSending(false);
    if ("error" in r && r.error) {
      toast(r.error);
      void load();
      return;
    }
    if ("devLink" in r && r.devLink) {
      // Solo en local: no hay envío de emails, el enlace sale por consola
      console.info("[portal] enlace de acceso (solo local):", r.devLink);
      (window as unknown as { __portalDevLink?: string }).__portalDevLink = r.devLink;
      toast("Acceso creado (local: el enlace está en la consola)");
    } else toast(`Invitación enviada a ${email}`);
    setShowForm(false);
    setInviting(false);
    void load();
  }

  async function dismiss(d: boolean) {
    const r = await setPortalPromptDismissed(project.id, d);
    if ("error" in r && r.error) toast(r.error);
  }

  async function remove(u: PortalUser) {
    if (!confirm(`¿Quitar el acceso al portal a ${u.full_name || u.email}?`)) return;
    const r = await removePortalUser(u.id);
    if ("error" in r && r.error) toast(r.error);
    else toast("Acceso quitado");
    void load();
  }

  async function saveStep() {
    const { error } = await createClient()
      .from("projects")
      .update({ client_next_step: stepDraft.trim() || null })
      .eq("id", project.id);
    if (error) {
      toast("No se pudo guardar: " + error.message);
      return;
    }
    setEditingStep(false);
    toast("Siguiente paso para el cliente guardado");
  }

  const hasAccess = (users?.length || 0) > 0;
  const prompt = isAdmin && users !== null && !hasAccess && visible && !client.portal_off && !project.portal_prompt_dismissed;

  const form = (
    <div className="portal-invite-form">
      <div className="field">
        <label>Persona de contacto</label>
        {contacts.length > 1 ? (
          <select
            value={email}
            onChange={(e) => {
              const c = contacts.find((x) => x.email === e.target.value);
              setEmail(e.target.value);
              setName(c?.name || "");
            }}
          >
            {contacts.map((c) => (
              <option key={c.email} value={c.email}>
                {c.name ? `${c.name} · ${c.email}` : c.email}
              </option>
            ))}
          </select>
        ) : (
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
        )}
      </div>
      <div className="field">
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" />
      </div>
      <div className="field">
        <label>Idioma</label>
        <select value={lang} onChange={(e) => setLang(e.target.value as "es" | "ca")}>
          <option value="es">Castellano</option>
          <option value="ca">Català</option>
        </select>
      </div>
      <div className="row" style={{ gap: 8, gridColumn: "1 / -1" }}>
        <button className="btn btn-primary" onClick={invite} disabled={sending || !email.trim()}>
          {sending ? "Enviando…" : "Enviar invitación"}
        </button>
        <button className="btn" onClick={() => setShowForm(false)} disabled={sending}>
          Cancelar
        </button>
      </div>
    </div>
  );

  return (
    <div className={"card pad portal-box" + (prompt ? " invite" : "")}>
      <div className="portal-box-head">
        <div className="ico ico-p">
          <Icon name="users" size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>Portal del cliente</b>
          <div className="muted">
            {client.portal_off
              ? "Este cliente no tiene portal (entra por Ana)."
              : prompt
                ? `${client.name} ya está en ${project.status === "propuesta" ? "propuesta" : "marcha"} y aún no tiene acceso a su portal.`
                : hasAccess
                  ? "Ve la fase, el siguiente paso para el cliente, su equipo y los documentos marcados como visibles."
                  : visible
                    ? "Sin acceso todavía."
                    : "Se propondrá dar acceso cuando el proyecto llegue a Propuesta."}
          </div>
        </div>
        {!client.portal_off && (
          <Link className="btn btn-sm" href={`/portal/ver/${client.id}`} target="_blank">
            Ver como cliente <Icon name="external" size={13} />
          </Link>
        )}
      </div>

      {!client.portal_off && isAdmin && (
        <>
          {prompt && !showForm && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" onClick={openForm}>
                Invitar {contacts[0]?.name ? contacts[0].name.split(" ")[0] : "al cliente"}
              </button>
              <button className="btn" onClick={() => dismiss(true)}>
                Ahora no
              </button>
            </div>
          )}
          {!hasAccess && visible && project.portal_prompt_dismissed && !showForm && (
            <button className="section-link" onClick={() => dismiss(false)}>
              Volver a proponer la invitación
            </button>
          )}
          {hasAccess && (
            <div className="portal-users">
              {users!.map((u) => (
                <div className="portal-user" key={u.id}>
                  <Icon name="check" size={15} />
                  <span>
                    <b>{u.full_name || u.email}</b> · {u.email}
                  </span>
                  <span className="muted">
                    {u.last_seen ? `entró ${fmtRelative(u.last_seen)}` : "aún no ha entrado"}
                  </span>
                  <button className="section-link" onClick={() => remove(u)}>
                    Quitar acceso
                  </button>
                </div>
              ))}
              {!showForm && !inviting && (
                <button className="section-link" style={{ alignSelf: "flex-start" }} onClick={() => { setInviting(true); openForm(); }}>
                  + Invitar a otra persona
                </button>
              )}
            </div>
          )}
          {showForm && form}
        </>
      )}

      {!client.portal_off && (
        <div style={{ marginTop: 14 }}>
          <div className="next-label">Siguiente paso que ve el cliente</div>
          {editingStep ? (
            <>
              <div className="field" style={{ margin: "6px 0 10px" }}>
                <textarea
                  rows={2}
                  value={stepDraft}
                  onChange={(e) => setStepDraft(e.target.value)}
                  placeholder="Ej.: Revisad la propuesta y nos vemos el jueves para resolver dudas."
                  autoFocus
                />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={saveStep}>
                  Guardar
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setStepDraft(project.client_next_step || "");
                    setEditingStep(false);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <button className="next-text" onClick={() => setEditingStep(true)} title="Lo que lee el cliente en su portal">
              <span className={project.client_next_step ? "" : "muted"}>
                {project.client_next_step || "Sin escribir: el cliente solo ve la fase"}
              </span>
              <Icon name="pencil" size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
