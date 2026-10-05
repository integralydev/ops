"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { CLIENT_STATUSES, clientContacts } from "@/lib/format";
import type { Client, ClientContact, ClientStatus } from "@/lib/database.types";

const emptyContact = (): ClientContact => ({ name: "", role: "", email: "", phone: "" });

export function ClientFormModal({
  client,
  onClose,
  onSaved,
}: {
  client?: Client;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const [name, setName] = useState(client?.name || "");
  const [status, setStatus] = useState<ClientStatus>(client?.status || "lead");
  const [contacts, setContacts] = useState<ClientContact[]>(() => {
    const list = client ? clientContacts(client) : [];
    return list.length ? list : [emptyContact()];
  });
  const [notes, setNotes] = useState(client?.notes || "");
  const [saving, setSaving] = useState(false);

  function setContact(i: number, patch: Partial<ClientContact>) {
    setContacts((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  function removeContact(i: number) {
    setContacts((prev) => prev.filter((_, j) => j !== i));
  }

  async function handleSave() {
    if (!name.trim()) {
      toast("Ponle un nombre al cliente");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      status,
      contacts: contacts
        .map((c) => ({ name: c.name.trim(), role: c.role.trim(), email: c.email.trim(), phone: c.phone.trim() }))
        .filter((c) => c.name || c.email || c.phone),
      notes,
    };
    if (client) {
      const { error } = await supabase.from("clients").update(payload).eq("id", client.id);
      setSaving(false);
      if (error) {
        toast("No se pudo guardar: " + error.message);
        return;
      }
      toast("Cliente actualizado");
      onClose();
    } else {
      const { data, error } = await supabase.from("clients").insert(payload).select().single();
      setSaving(false);
      if (error || !data) {
        toast("No se pudo crear: " + (error?.message || ""));
        return;
      }
      toast("Cliente creado");
      onClose();
      onSaved?.(data.id);
    }
  }

  return (
    <Modal
      title={client ? "Editar cliente" : "Nuevo cliente"}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
    >
      <div className="field">
        <label>Nombre del cliente</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Estado</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as ClientStatus)}>
          {CLIENT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label} — {s.hint}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Personas de contacto</label>
        {contacts.map((c, i) => (
          <div key={i} className="contact-edit">
            <div className="field-row">
              <input type="text" placeholder="Nombre" value={c.name} onChange={(e) => setContact(i, { name: e.target.value })} />
              <input type="text" placeholder="Cargo (opcional)" value={c.role} onChange={(e) => setContact(i, { role: e.target.value })} />
            </div>
            <div className="field-row">
              <input type="email" placeholder="Email" value={c.email} onChange={(e) => setContact(i, { email: e.target.value })} />
              <input type="tel" placeholder="Teléfono" value={c.phone} onChange={(e) => setContact(i, { phone: e.target.value })} />
            </div>
            {contacts.length > 1 && (
              <button type="button" className="contact-remove" title="Quitar contacto" onClick={() => removeContact(i)}>
                ✕
              </button>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => setContacts((prev) => [...prev, emptyContact()])}>
          + Añadir contacto
        </button>
      </div>
      <div className="field">
        <label>Notas</label>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}
