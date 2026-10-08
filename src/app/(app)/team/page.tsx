"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Modal } from "@/components/Modal";
import { ColorPickerModal } from "@/components/ColorPickerModal";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { getTeamEmails, inviteTeamMember } from "./actions";
import { ROLE_LABELS, type Role } from "@/lib/database.types";
import { avatarColor } from "@/lib/format";

function AddTeamModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("developer");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!email.trim()) {
      toast("Escribe un email");
      return;
    }
    setSaving(true);
    const res = await inviteTeamMember(email.trim(), role, name);
    setSaving(false);
    if (res?.error) {
      toast(res.error);
      return;
    }
    toast("Invitación enviada");
    onClose();
  }

  return (
    <Modal title="Añadir persona al equipo" onClose={onClose} onSave={handleSave} saving={saving} saveLabel="Invitar">
      <div className="field">
        <label>Nombre</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre y apellido"
          autoFocus
        />
      </div>
      <div className="field">
        <label>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nombre@empresa.com"
        />
      </div>
      <div className="field">
        <label>Rol</label>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="developer">Developer — acceso solo a sus proyectos</option>
          <option value="director">Director de proyecto — ve y edita todo, sin gestionar el equipo</option>
          <option value="admin">Administrador — acceso completo</option>
          <option value="comercial">Comercial — solo la sección Comercial</option>
        </select>
      </div>
      <p className="muted" style={{ fontSize: 12.3, lineHeight: 1.5 }}>
        Le llegará un email con un enlace para entrar sin contraseña.
      </p>
    </Modal>
  );
}

export default function TeamPage() {
  const { me, team, nameFor } = useAppData();
  const [showAdd, setShowAdd] = useState(false);
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});

  useEffect(() => {
    getTeamEmails().then(setEmails);
  }, [team]);

  const roleOrder: Record<Role, number> = { admin: 0, director: 1, developer: 2, comercial: 3 };
  const rows = Object.entries(team).sort(([, a], [, b]) => roleOrder[a.role] - roleOrder[b.role]);

  async function setRole(id: string, role: Role) {
    const supabase = createClient();
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    if (error) {
      toast("No se pudo cambiar el rol: " + error.message);
      return;
    }
    toast("Rol actualizado");
  }

  async function renameMember(id: string) {
    const current = team[id]?.full_name || "";
    const name = prompt("Nombre de esta persona:", current);
    if (name === null || !name.trim() || name.trim() === current) return;
    const supabase = createClient();
    const { error } = await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", id);
    if (error) {
      toast("No se pudo cambiar el nombre: " + error.message);
      return;
    }
    toast("Nombre actualizado");
  }

  async function removeMember(id: string) {
    if (!confirm(`¿Quitar a ${nameFor(id)} del equipo? Perderá el acceso.`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("profiles").delete().eq("id", id);
    if (error) {
      toast(error.message);
      return;
    }
    toast("Persona eliminada del equipo");
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Equipo</h1>
          <div className="topbar-sub">Personas con acceso y sus permisos</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + Añadir persona
        </button>
      </div>
      <div className="content">
        <div className="card pad">
          {rows.map(([id, t]) => (
            <div className="team-row" key={id}>
              <button className="avatar-btn" title="Cambiar color" onClick={() => setColorFor(id)}>
                <Avatar id={id} name={nameFor(id)} size={34} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.6 }}>
                  {nameFor(id)}
                  {id === me.id && <span className="muted" style={{ fontWeight: 400 }}> (tú)</span>}
                </div>
                {emails[id] && (
                  <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {emails[id]}
                  </div>
                )}
              </div>
              <span className={`role-pill role-${t.role}`}>
                {ROLE_LABELS[t.role]}
              </span>
              <select
                value={t.role}
                onChange={(e) => setRole(id, e.target.value as Role)}
                style={{
                  padding: "5px 26px 5px 9px",
                  backgroundPosition: "right 8px center",
                  backgroundSize: 10,
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  fontSize: 12.3,
                  backgroundColor: "var(--surface)",
                  color: "var(--ink)",
                }}
              >
                <option value="developer">Developer</option>
                <option value="director">Director de proyecto</option>
                <option value="admin">Administrador</option>
                <option value="comercial">Comercial</option>
              </select>
              <button className="icon-btn" title="Cambiar color" onClick={() => setColorFor(id)}>
                <span className="color-dot" style={{ background: avatarColor(id, t.color) }} />
              </button>
              <button className="icon-btn" title="Editar nombre" onClick={() => renameMember(id)}>
                ✎
              </button>
              <button className="icon-btn" title="Quitar del equipo" onClick={() => removeMember(id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {showAdd && <AddTeamModal onClose={() => setShowAdd(false)} />}
      {colorFor && <ColorPickerModal userId={colorFor} onClose={() => setColorFor(null)} />}
    </>
  );
}
