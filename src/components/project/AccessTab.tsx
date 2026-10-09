"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useAppData } from "@/components/app-data";
import { useAccesses } from "@/lib/hooks/useProjectDetail";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { ACCESS_LEVELS, ACCESS_SYSTEMS, fmtDate, looksLikeSecret } from "@/lib/format";
import type { AccessLevel, Project, ProjectAccess } from "@/lib/database.types";

const NO_CREDENTIALS =
  "Nunca credenciales: aquí solo se apunta que el acceso existe y dónde. Ni usuarios, ni contraseñas, ni claves de API, ni tokens.";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Pestaña "Accesos externos" (solo admin y director, también por RLS): qué
// personas de fuera tienen acceso a qué sistema de este proyecto, para
// poder quitarlo todo al acabar.
export function AccessTab({ project }: { project: Project }) {
  const { me, nameFor } = useAppData();
  const { rows, loading, upsertLocal, removeLocal } = useAccesses(project.id);
  const [editing, setEditing] = useState<ProjectAccess | "new" | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  const all = Object.values(rows);
  const byPerson = (a: ProjectAccess, b: ProjectAccess) =>
    a.person.localeCompare(b.person, "es") || a.system.localeCompare(b.system, "es");
  const active = all.filter((a) => !a.revoked_at).sort(byPerson);
  const revoked = all.filter((a) => a.revoked_at).sort((a, b) => (b.revoked_at || "").localeCompare(a.revoked_at || ""));
  const people = new Set(active.map((a) => a.person.trim().toLowerCase())).size;

  async function save(id: string, patch: Partial<ProjectAccess>, done: string) {
    const { data, error } = await createClient().from("project_accesses").update(patch).eq("id", id).select().maybeSingle();
    if (error || !data) {
      toast("No se pudo guardar" + (error ? ": " + error.message : ": no tienes permiso"));
      return;
    }
    upsertLocal(data as ProjectAccess);
    toast(done);
  }

  function revoke(a: ProjectAccess) {
    const how = a.revoke_how ? `\n\nCómo se revoca: ${a.revoke_how}` : "";
    if (!confirm(`¿Ya has quitado el acceso de ${a.person} a ${a.system}? Se marcará como revocado hoy.${how}`)) return;
    save(a.id, { revoked_at: todayISO(), revoked_by: me.id }, "Marcado como revocado");
  }

  async function remove(a: ProjectAccess) {
    if (!confirm(`¿Borrar el registro de ${a.person} en ${a.system}? Si ya no tiene acceso, mejor márcalo como revocado para que quede constancia.`))
      return;
    const { data, error } = await createClient().from("project_accesses").delete().eq("id", a.id).select("id");
    if (error || !data?.length) {
      toast("No se pudo borrar" + (error ? ": " + error.message : ": no tienes permiso"));
      return;
    }
    removeLocal(a.id);
  }

  return (
    <div className="card pad">
      <div className="links-help">
        <span aria-hidden>🔒</span>
        <span>
          Accesos de personas externas a los sistemas de este proyecto. Solo lo ven admin y directores. {NO_CREDENTIALS}
        </span>
      </div>
      <div className="row between" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          + Añadir acceso
        </button>
        {active.length > 0 && (
          <span className="muted" style={{ fontSize: 12.6 }}>
            {active.length} acceso{active.length === 1 ? "" : "s"} activo{active.length === 1 ? "" : "s"} · {people} persona
            {people === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="empty">Cargando…</div>
      ) : active.length === 0 ? (
        <div className="empty">Ninguna persona externa tiene acceso activo a los sistemas de este proyecto.</div>
      ) : (
        <div className="table-card">
          <table className="ptable access-table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Sistema</th>
                <th>Nivel</th>
                <th>Concedido</th>
                <th>Cómo se revoca</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {active.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="ptable-name" style={{ fontSize: 13.6 }}>
                      {a.person}
                    </div>
                    {a.company && <div className="ptable-sub">{a.company}</div>}
                  </td>
                  <td>{a.system}</td>
                  <td>
                    <span className={`access-level is-${a.level}`}>{ACCESS_LEVELS.find((l) => l.value === a.level)?.label}</span>
                  </td>
                  <td className="access-meta">
                    {fmtDate(a.granted_at)}
                    {a.granted_by && <div className="ptable-sub">por {nameFor(a.granted_by)}</div>}
                  </td>
                  <td className="access-how">{a.revoke_how || <span className="muted">—</span>}</td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                      <button className="btn btn-sm" onClick={() => revoke(a)}>
                        Revocado
                      </button>
                      <button className="icon-btn" title="Editar" onClick={() => setEditing(a)}>
                        ✎
                      </button>
                      <button className="icon-btn" title="Borrar registro" onClick={() => remove(a)}>
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {revoked.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button className="section-link" onClick={() => setShowRevoked((v) => !v)}>
            {showRevoked ? "Ocultar" : "Ver"} revocados ({revoked.length})
          </button>
          {showRevoked &&
            revoked.map((a) => (
              <div key={a.id} className="access-revoked">
                <span>
                  <b>{a.person}</b>
                  {a.company ? ` (${a.company})` : ""} · {a.system} ·{" "}
                  {ACCESS_LEVELS.find((l) => l.value === a.level)?.label}
                </span>
                <span className="muted">
                  revocado el {fmtDate(a.revoked_at)}
                  {a.revoked_by ? ` por ${nameFor(a.revoked_by)}` : ""}
                </span>
                <button className="icon-btn" title="Editar" onClick={() => setEditing(a)}>
                  ✎
                </button>
              </div>
            ))}
        </div>
      )}

      {editing && (
        <AccessFormModal
          project={project}
          access={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={upsertLocal}
        />
      )}
    </div>
  );
}

function AccessFormModal({
  project,
  access,
  onClose,
  onSaved,
}: {
  project: Project;
  access?: ProjectAccess;
  onClose: () => void;
  onSaved: (row: ProjectAccess) => void;
}) {
  const { me, team } = useAppData();
  const [person, setPerson] = useState(access?.person || "");
  const [company, setCompany] = useState(access?.company || "");
  const [system, setSystem] = useState(access?.system || "");
  const [level, setLevel] = useState<AccessLevel>(access?.level || "escritura");
  const [grantedBy, setGrantedBy] = useState(access ? access.granted_by || "" : me.id);
  const [grantedAt, setGrantedAt] = useState(access?.granted_at || todayISO());
  const [revokeHow, setRevokeHow] = useState(access?.revoke_how || "");
  const [revokedAt, setRevokedAt] = useState(access?.revoked_at || "");
  const [saving, setSaving] = useState(false);
  const staff = Object.entries(team).filter(([, t]) => t.role === "admin" || t.role === "director");
  const secret = [person, company, system, revokeHow].some(looksLikeSecret);

  async function handleSave() {
    if (!person.trim() || !system.trim()) {
      toast("Falta la persona o el sistema");
      return;
    }
    if (secret) {
      toast("Parece que hay una credencial. Quítala: aquí solo se apunta que el acceso existe.");
      return;
    }
    setSaving(true);
    const payload = {
      person: person.trim(),
      company: company.trim(),
      system: system.trim(),
      level,
      granted_by: grantedBy || null,
      granted_at: grantedAt || todayISO(),
      revoke_how: revokeHow.trim(),
      ...(access
        ? {
            revoked_at: revokedAt || null,
            revoked_by: revokedAt ? access.revoked_by || me.id : null,
          }
        : {}),
    };
    const supabase = createClient();
    const { data, error } = access
      ? await supabase.from("project_accesses").update(payload).eq("id", access.id).select().maybeSingle()
      : await supabase
          .from("project_accesses")
          .insert({ ...payload, project_id: project.id })
          .select()
          .single();
    setSaving(false);
    if (error || !data) {
      const msg = error?.message?.includes("no_secrets")
        ? "la base de datos lo ha rechazado porque parece contener una credencial."
        : error
          ? error.message
          : "no tienes permiso";
      toast("No se pudo guardar: " + msg);
      return;
    }
    onSaved(data as ProjectAccess);
    toast(access ? "Acceso actualizado" : "Acceso registrado");
    onClose();
  }

  return (
    <Modal title={access ? "Editar acceso" : "Registrar acceso externo"} onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="links-help" style={{ marginBottom: 14 }}>
        <span aria-hidden>🔒</span>
        <span>{NO_CREDENTIALS}</span>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Persona</label>
          <input type="text" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Nombre y apellido" autoFocus />
        </div>
        <div className="field">
          <label>Empresa (opcional)</label>
          <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Sistema o servicio</label>
          <input
            type="text"
            list="access-systems"
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            placeholder="GCP, GitHub, Vercel…"
          />
          <datalist id="access-systems">
            {ACCESS_SYSTEMS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label>Nivel</label>
          <select value={level} onChange={(e) => setLevel(e.target.value as AccessLevel)}>
            {ACCESS_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Lo concedió</label>
          <select value={grantedBy} onChange={(e) => setGrantedBy(e.target.value)}>
            <option value="">—</option>
            {staff.map(([id, t]) => (
              <option key={id} value={id}>
                {t.full_name || "Sin nombre"}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Fecha</label>
          <input type="date" className="com-input" value={grantedAt} onChange={(e) => setGrantedAt(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Cómo se revoca (opcional)</label>
        <input
          type="text"
          value={revokeHow}
          onChange={(e) => setRevokeHow(e.target.value)}
          placeholder="GCP → IAM → quitar principal"
        />
      </div>
      {access && (
        <div className="field">
          <label>Revocado el (vacío = sigue activo)</label>
          <input type="date" className="com-input" value={revokedAt} onChange={(e) => setRevokedAt(e.target.value)} />
        </div>
      )}
      {secret && <div className="links-error">Parece que has escrito una credencial. Quítala antes de guardar.</div>}
    </Modal>
  );
}
