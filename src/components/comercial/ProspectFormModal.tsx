"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { PROSPECT_SOURCES, PROSPECT_STATUSES, PROSPECT_ZONES } from "@/lib/format";
import type { Prospect, ProspectSource, ProspectStatus, ProspectZone } from "@/lib/database.types";

/** Personas que pueden llevar empresas en Comercial: admin y comercial. */
export function useSalesPeople() {
  const { team } = useAppData();
  return Object.entries(team)
    .filter(([, t]) => t.role === "admin" || t.role === "comercial")
    .sort(([, a], [, b]) => (a.full_name || "").localeCompare(b.full_name || ""));
}

// Alta y edición de los datos de una empresa del embudo. El estado y la
// próxima acción se cambian desde la lista o la ficha.
export function ProspectFormModal({
  prospect,
  onClose,
  onSaved,
}: {
  prospect?: Prospect;
  onClose: () => void;
  onSaved?: (row: Prospect) => void;
}) {
  const { me } = useAppData();
  const people = useSalesPeople();
  const [name, setName] = useState(prospect?.name || "");
  const [zone, setZone] = useState<ProspectZone | "">(prospect?.zone || "");
  const [source, setSource] = useState<ProspectSource>(prospect?.source || "propio");
  const [status, setStatus] = useState<ProspectStatus>(prospect?.status || "sin_contactar");
  const [city, setCity] = useState(prospect?.city || "");
  const [province, setProvince] = useState(prospect?.province || "");
  const [phone, setPhone] = useState(prospect?.phone || "");
  const [mobile, setMobile] = useState(prospect?.mobile || "");
  const [email, setEmail] = useState(prospect?.email || "");
  const [appCode, setAppCode] = useState(prospect?.app_code || "");
  const [ownerId, setOwnerId] = useState(prospect ? prospect.owner_id || "" : me.id);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      toast("Ponle un nombre a la empresa");
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      zone: zone || null,
      source,
      city: city.trim(),
      province: province.trim(),
      phone: phone.trim(),
      mobile: mobile.trim(),
      email: email.trim(),
      app_code: appCode.trim() || null,
      owner_id: ownerId || null,
      ...(prospect ? {} : { status }),
    };
    const supabase = createClient();
    const { data, error } = prospect
      ? await supabase.from("prospects").update(payload).eq("id", prospect.id).select().maybeSingle()
      : await supabase.from("prospects").insert(payload).select().single();
    setSaving(false);
    if (error || !data) {
      const dup = error?.code === "23505" ? ": ya hay otra empresa con ese código de App" : error ? ": " + error.message : "";
      toast("No se pudo guardar" + dup);
      return;
    }
    toast(prospect ? "Empresa actualizada" : "Empresa añadida");
    onSaved?.(data as Prospect);
    onClose();
  }

  return (
    <Modal title={prospect ? "Editar empresa" : "Nueva empresa"} onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="field">
        <label>Nombre (razón social)</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!prospect} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Origen</label>
          <select value={source} onChange={(e) => setSource(e.target.value as ProspectSource)}>
            {PROSPECT_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Zona</label>
          <select value={zone} onChange={(e) => setZone(e.target.value as ProspectZone | "")}>
            <option value="">Sin zona</option>
            {PROSPECT_ZONES.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Población</label>
          <input type="text" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="field">
          <label>Provincia</label>
          <input type="text" value={province} onChange={(e) => setProvince(e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Teléfono</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label>Móvil</label>
          <input type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Responsable</label>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Sin responsable</option>
            {people.map(([id, t]) => (
              <option key={id} value={id}>
                {t.full_name || "Sin nombre"}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Código en App (opcional)</label>
          <input type="text" value={appCode} onChange={(e) => setAppCode(e.target.value)} />
        </div>
      </div>
      {!prospect && (
        <div className="field">
          <label>Estado</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as ProspectStatus)}>
            {PROSPECT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </Modal>
  );
}
