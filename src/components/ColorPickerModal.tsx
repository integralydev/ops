"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { COLOR_CHOICES, avatarColor } from "@/lib/format";

// Elegir el color del avatar de una persona: uno de la paleta, uno a medida o
// el automático (vacío). Cada uno puede cambiar el suyo; los admins, cualquiera.
export function ColorPickerModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { me, team, nameFor, patchProfile } = useAppData();
  const current = team[userId]?.color || null;
  const [color, setColor] = useState<string | null>(current);
  const [saving, setSaving] = useState(false);
  const name = nameFor(userId);

  async function handleSave() {
    setSaving(true);
    const { data, error } = await createClient()
      .from("profiles")
      .update({ color })
      .eq("id", userId)
      .select("id")
      .maybeSingle();
    setSaving(false);
    if (error || !data) {
      toast("No se pudo guardar el color" + (error ? ": " + error.message : ": no tienes permiso"));
      return;
    }
    patchProfile(userId, { color });
    toast("Color actualizado");
    onClose();
  }

  return (
    <Modal title={userId === me.id ? "Tu color" : `Color de ${name}`} onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="color-preview">
        <Avatar id={userId} name={name} size={52} color={avatarColor(userId, color)} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
          <div className="muted" style={{ fontSize: 12.3 }}>
            Se usa en su avatar en toda la herramienta
          </div>
        </div>
      </div>
      <div className="field">
        <label>Elige un color</label>
        <div className="color-swatches">
          {COLOR_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              className={"color-swatch" + (color?.toLowerCase() === c.toLowerCase() ? " active" : "")}
              style={{ background: c }}
              title={c}
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
            />
          ))}
          <label className="color-swatch color-custom" title="Color a medida">
            <input
              type="color"
              value={avatarColor(userId, color)}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
            />
            <span>+</span>
          </label>
        </div>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => setColor(null)} disabled={!color}>
        Volver al color automático
      </button>
    </Modal>
  );
}
