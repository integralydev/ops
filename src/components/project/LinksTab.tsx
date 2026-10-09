"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useAppData } from "@/components/app-data";
import { useLinks } from "@/lib/hooks/useProjectDetail";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import {
  LINK_CATEGORIES,
  fmtDate,
  isGoogleShareLink,
  linkCredentialProblem,
  normalizeUrl,
  urlHost,
} from "@/lib/format";
import type { LinkCategory, Project, ProjectLink } from "@/lib/database.types";

const CREDENTIALS_HELP =
  "Solo enlaces. Nunca usuarios, contraseñas ni claves de API. Tampoco enlaces que den acceso por sí solos, como un Google Sheet o un Drive compartido con «cualquiera con el enlace».";

// Pestaña "Enlaces": dónde está cada cosa del proyecto (app en producción,
// consola cloud, repositorio, Excels…), agrupado por categoría. Solo la ven
// los miembros del proyecto (RLS en project_links).
export function LinksTab({ project }: { project: Project }) {
  const { me, isStaff, nameFor } = useAppData();
  const { rows, loading, upsertLocal, removeLocal } = useLinks(project.id);
  const [editing, setEditing] = useState<ProjectLink | "new" | null>(null);

  const all = Object.values(rows);
  const groups = LINK_CATEGORIES.map((c) => ({
    ...c,
    links: all
      .filter((l) => l.category === c.value)
      .sort((a, b) => Number(b.featured) - Number(a.featured) || a.label.localeCompare(b.label, "es")),
  })).filter((g) => g.links.length);

  async function remove(l: ProjectLink) {
    if (!confirm(`¿Borrar el enlace «${l.label}»?`)) return;
    const { data, error } = await createClient().from("project_links").delete().eq("id", l.id).select("id");
    if (error || !data?.length) {
      toast("No se pudo borrar" + (error ? ": " + error.message : ": no tienes permiso"));
      return;
    }
    removeLocal(l.id);
  }

  async function copy(l: ProjectLink) {
    try {
      await navigator.clipboard.writeText(l.url);
      toast("Enlace copiado");
    } catch {
      toast("No se pudo copiar");
    }
  }

  return (
    <div className="card pad">
      <div className="links-help">
        <span aria-hidden>🔒</span>
        <span>{CREDENTIALS_HELP}</span>
      </div>
      <div className="row" style={{ marginBottom: 6 }}>
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          + Añadir enlace
        </button>
      </div>

      {loading ? (
        <div className="empty">Cargando…</div>
      ) : groups.length === 0 ? (
        <div className="empty" style={{ marginTop: 10 }}>
          Todavía no hay enlaces. Añade la app en producción, la consola, el repositorio, los Excels de seguimiento…
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.value} className="links-group">
            <div className="scope-block-title">
              {g.icon} {g.label}
            </div>
            {g.links.map((l) => (
              <div key={l.id} className="file-row">
                <div className="file-icon">{g.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="file-name">
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="link-name">
                      {l.label}
                    </a>
                    {l.featured && (
                      <span className="link-featured" title="Botón rápido del proyecto">
                        ★ Destacado
                      </span>
                    )}
                  </div>
                  <div className="file-meta">
                    {urlHost(l.url)} · añadido por {nameFor(l.created_by)} · {fmtDate(l.created_at)}
                  </div>
                </div>
                <a className="btn btn-sm" href={l.url} target="_blank" rel="noopener noreferrer">
                  Abrir ↗
                </a>
                <button className="icon-btn" title="Copiar enlace" onClick={() => copy(l)}>
                  ⧉
                </button>
                <button className="icon-btn" title="Editar" onClick={() => setEditing(l)}>
                  ✎
                </button>
                {(isStaff || l.created_by === me.id) && (
                  <button className="icon-btn" title="Borrar" onClick={() => remove(l)}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        ))
      )}

      {editing && (
        <LinkFormModal
          project={project}
          link={editing === "new" ? undefined : editing}
          all={all}
          onClose={() => setEditing(null)}
          onSaved={upsertLocal}
        />
      )}
    </div>
  );
}

function LinkFormModal({
  project,
  link,
  all,
  onClose,
  onSaved,
}: {
  project: Project;
  link?: ProjectLink;
  all: ProjectLink[];
  onClose: () => void;
  onSaved: (row: ProjectLink) => void;
}) {
  const { me } = useAppData();
  const [label, setLabel] = useState(link?.label || "");
  const [url, setUrl] = useState(link?.url || "");
  const [category, setCategory] = useState<LinkCategory>(link?.category || "produccion");
  const [featured, setFeatured] = useState(link?.featured || false);
  const [saving, setSaving] = useState(false);
  const problem = url.trim() ? linkCredentialProblem(normalizeUrl(url)) : null;
  const otherFeatured = all.find((l) => l.featured && l.id !== link?.id);

  async function handleSave() {
    const clean = normalizeUrl(url);
    if (!label.trim()) {
      toast("Ponle un nombre al enlace");
      return;
    }
    if (!clean) {
      toast("Falta la dirección");
      return;
    }
    const issue = linkCredentialProblem(clean);
    if (issue) {
      toast(issue);
      return;
    }
    if (
      isGoogleShareLink(clean) &&
      !confirm(
        "Es un enlace de Google. Comprueba que NO está compartido con «cualquiera con el enlace»: tiene que pedir iniciar sesión con una cuenta con permiso.\n\n¿Está bien así?",
      )
    )
      return;

    setSaving(true);
    const supabase = createClient();
    // Solo puede haber un destacado: si este pasa a serlo, se quita el anterior
    if (featured && otherFeatured) {
      const { error } = await supabase.from("project_links").update({ featured: false }).eq("id", otherFeatured.id);
      if (error) {
        setSaving(false);
        toast("No se pudo quitar el destacado anterior: " + error.message);
        return;
      }
      onSaved({ ...otherFeatured, featured: false });
    }
    const payload = { label: label.trim(), url: clean, category, featured };
    const { data, error } = link
      ? await supabase.from("project_links").update(payload).eq("id", link.id).select().maybeSingle()
      : await supabase
          .from("project_links")
          .insert({ ...payload, project_id: project.id, created_by: me.id })
          .select()
          .single();
    setSaving(false);
    if (error || !data) {
      const msg = error?.message?.includes("project_links_no_")
        ? "La base de datos ha rechazado el enlace porque parece llevar una credencial."
        : error
          ? error.message
          : "no tienes permiso";
      toast("No se pudo guardar: " + msg);
      return;
    }
    onSaved(data as ProjectLink);
    toast(link ? "Enlace actualizado" : "Enlace añadido");
    onClose();
  }

  return (
    <Modal title={link ? "Editar enlace" : "Añadir enlace"} onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="links-help" style={{ marginBottom: 14 }}>
        <span aria-hidden>🔒</span>
        <span>{CREDENTIALS_HELP}</span>
      </div>
      <div className="field">
        <label>Nombre</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="App en producción, Consola de Google Cloud, Excel de seguimiento…"
          autoFocus
        />
      </div>
      <div className="field">
        <label>Dirección</label>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        {problem && <div className="links-error">{problem}</div>}
        {!problem && isGoogleShareLink(url) && (
          <div className="links-warn">
            Enlace de Google: asegúrate de que no está compartido con «cualquiera con el enlace».
          </div>
        )}
      </div>
      <div className="field">
        <label>Categoría</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as LinkCategory)}>
          {LINK_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label} — {c.hint}
            </option>
          ))}
        </select>
      </div>
      <label className="links-check">
        <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
        <span>
          Destacado: botón rápido del proyecto (cabecera, tarjetas y tabla)
          {featured && otherFeatured && <span className="muted"> · sustituye a «{otherFeatured.label}»</span>}
        </span>
      </label>
    </Modal>
  );
}
