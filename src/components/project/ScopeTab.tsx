"use client";

import { useState } from "react";
import { useAppData } from "@/components/app-data";
import { useFiles, useScope } from "@/lib/hooks/useProjectDetail";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { fmtDate } from "@/lib/format";
import type { FileRow, Project, ScopeItem, ScopeStatus } from "@/lib/database.types";
import { openProjectFile, uploadProjectFile } from "@/lib/uploads";
import { extractScopeFromFile, type ExtractedScopeItem } from "@/app/(app)/projects/scope-actions";

const STATUSES: { value: ScopeStatus; label: string; icon: string }[] = [
  { value: "incluido", label: "Incluido", icon: "✅" },
  { value: "excluido", label: "Fuera de scope", icon: "❌" },
  { value: "por_decidir", label: "Por decidir", icon: "❓" },
];
const statusOf = (s: ScopeStatus) => STATUSES.find((x) => x.value === s)!;

type Filter = "all" | ScopeStatus | "ext";

// Convierte el texto pegado del PDF en puntos del scope:
//  - cada línea es un punto (se quitan viñetas y numeración)
//  - una línea que acaba en ":" o está en MAYÚSCULAS es un bloque
//  - bloques tipo "Fuera de alcance / No incluye" → puntos "excluido";
//    "Opcional / Por definir" → "por decidir"
function parseScopeText(text: string) {
  const items: { title: string; block: string; status: ScopeStatus }[] = [];
  let block = "";
  let status: ScopeStatus = "incluido";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-–—•·*▪◦●○]|\d+[.)]|[a-z][.)])\s+/i, "").trim();
    if (!line) continue;
    const isHeader =
      (line.endsWith(":") && line.length < 90) ||
      (line.length > 3 && line.length < 70 && line === line.toUpperCase() && /[A-ZÁÉÍÓÚÀÈÒÇ]/.test(line));
    if (isHeader) {
      block = line.replace(/:$/, "").trim();
      const b = block.toLowerCase();
      status = /fuera|no incl|exclu|no entra|queda fuera/.test(b)
        ? "excluido"
        : /opcional|por definir|por decidir|a decidir|a definir|pendiente/.test(b)
          ? "por_decidir"
          : "incluido";
      continue;
    }
    items.push({ title: line.slice(0, 300), block, status });
  }
  return items;
}

export function ScopeTab({ project }: { project: Project }) {
  const { me, isStaff, nameFor } = useAppData();
  const { rows, loading } = useScope(project.id);
  const { rows: files } = useFiles(project.id);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const items = Object.values(rows).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  const blocks = [...new Set(items.map((i) => i.block).filter(Boolean))];
  const nextPos = () => (items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0);
  const closed = !!project.scope_closed_at;
  const sourceFile = project.scope_source_file_id ? files[project.scope_source_file_id] : null;

  const count = (f: Filter) =>
    f === "all" ? items.length : f === "ext" ? items.filter((i) => i.is_extension).length : items.filter((i) => i.status === f).length;

  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const visible = items.filter((i) => {
    if (filter === "ext" ? !i.is_extension : filter !== "all" && i.status !== filter) return false;
    if (!q.trim()) return true;
    return norm(`${i.title} ${i.description} ${i.block}`).includes(norm(q.trim()));
  });
  const grouped = new Map<string, ScopeItem[]>();
  visible.forEach((i) => grouped.set(i.block, [...(grouped.get(i.block) || []), i]));

  async function update(id: string, patch: Partial<ScopeItem>) {
    const { error } = await createClient().from("scope_items").update(patch).eq("id", id);
    if (error) toast("No se pudo guardar: " + error.message);
  }

  async function remove(item: ScopeItem) {
    if (!confirm(`¿Borrar «${item.title}» del scope?`)) return;
    const { error } = await createClient().from("scope_items").delete().eq("id", item.id);
    if (error) toast("No se pudo borrar: " + error.message);
  }

  async function setClosed(close: boolean, fileId?: string) {
    const patch = close
      ? { scope_closed_at: new Date().toISOString(), scope_closed_by: me.id, scope_source_file_id: fileId || null }
      : { scope_closed_at: null, scope_closed_by: null };
    const { error } = await createClient().from("projects").update(patch).eq("id", project.id);
    if (error) toast("No se pudo guardar: " + error.message);
    else toast(close ? "Scope cerrado" : "Scope reabierto");
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      {/* Estado del scope */}
      <div className={"card pad scope-banner" + (closed ? " is-closed" : "")}>
        {closed ? (
          <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
            <div>
              <b>🔒 Scope cerrado</b> el {fmtDate(project.scope_closed_at)} por {nameFor(project.scope_closed_by)}.
              <span className="muted"> Lo que se añada ahora queda marcado como ampliación.</span>
              {sourceFile && (
                <div style={{ marginTop: 4 }}>
                  Fuente:{" "}
                  <button
                    className="section-link"
                    onClick={async () => {
                      if (!(await openProjectFile(sourceFile.storage_path))) toast("No se pudo abrir el archivo");
                    }}
                  >
                    📕 {sourceFile.filename}
                  </button>
                </div>
              )}
            </div>
            {isStaff && (
              <button className="btn btn-sm" onClick={() => confirm("¿Reabrir el scope?") && setClosed(false)}>
                Reabrir
              </button>
            )}
          </div>
        ) : (
          <CloseScope canEdit={isStaff} files={Object.values(files)} onClose={(fid) => setClosed(true, fid)} />
        )}
      </div>

      <div className="card pad">
        <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input
            className="scope-search"
            type="search"
            placeholder="Busca una funcionalidad… ¿entraba en el scope?"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {isStaff && (
            <>
              <button className="btn" onClick={() => { setShowImport((v) => !v); setShowAdd(false); }}>
                ✨ Importar desde PDF
              </button>
              <button className="btn btn-primary" onClick={() => { setShowAdd((v) => !v); setShowImport(false); }}>
                + Añadir punto
              </button>
            </>
          )}
        </div>

        {showAdd && (
          <ItemForm
            blocks={blocks}
            closed={closed}
            onCancel={() => setShowAdd(false)}
            onSave={async (v) => {
              const { error } = await createClient()
                .from("scope_items")
                .insert({ ...v, project_id: project.id, position: nextPos(), is_extension: closed, created_by: me.id });
              if (error) return toast("No se pudo añadir: " + error.message);
              setShowAdd(false);
            }}
          />
        )}

        {showImport && (
          <ImportBox
            projectId={project.id}
            userId={me.id}
            files={Object.values(files)}
            closed={closed}
            onCancel={() => setShowImport(false)}
            onImport={async (parsed) => {
              const start = nextPos();
              const { error } = await createClient()
                .from("scope_items")
                .insert(
                  parsed.map((p, i) => ({
                    ...p,
                    project_id: project.id,
                    position: start + i,
                    is_extension: closed,
                    created_by: me.id,
                  })),
                );
              if (error) return toast("No se pudo importar: " + error.message);
              toast(`${parsed.length} puntos importados`);
              setShowImport(false);
            }}
          />
        )}

        {items.length > 0 && (
          <div className="task-filters">
            {(
              [
                ["all", "Todos"],
                ["incluido", "✅ Incluido"],
                ["excluido", "❌ Fuera de scope"],
                ["por_decidir", "❓ Por decidir"],
                ["ext", "➕ Ampliaciones"],
              ] as [Filter, string][]
            ).map(([k, label]) => (
              <button key={k} className={"task-filter" + (filter === k ? " active" : "")} onClick={() => setFilter(k)}>
                {label}
                {count(k) > 0 && <span>{count(k)}</span>}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="empty">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="empty">
            {isStaff
              ? "Todavía no hay scope. Pulsa «✨ Importar desde PDF», elige el presupuesto y la IA sacará los puntos para que los revises."
              : "Todavía no se ha definido el scope de este proyecto."}
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            {q.trim() ? `Nada en el scope coincide con «${q.trim()}».` : "No hay puntos con este filtro."}
          </div>
        ) : (
          [...grouped.entries()].map(([block, list]) => (
            <div key={block || "_"} className="scope-block">
              {(block || grouped.size > 1) && <div className="scope-block-title">{block || "General"}</div>}
              {list.map((i) =>
                editingId === i.id ? (
                  <ItemForm
                    key={i.id}
                    initial={i}
                    blocks={blocks}
                    closed={closed}
                    onCancel={() => setEditingId(null)}
                    onSave={async (v) => {
                      await update(i.id, v);
                      setEditingId(null);
                    }}
                  />
                ) : (
                  <div key={i.id} className={`scope-item is-${i.status}`}>
                    {isStaff ? (
                      <select
                        className={`scope-status is-${i.status}`}
                        value={i.status}
                        onChange={(e) => update(i.id, { status: e.target.value as ScopeStatus })}
                      >
                        {STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.icon} {s.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`scope-status is-${i.status}`}>
                        {statusOf(i.status).icon} {statusOf(i.status).label}
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="scope-title">
                        {i.title}
                        {i.is_extension && (
                          <span className="scope-ext" title={`Añadido después de cerrar el scope (${fmtDate(i.created_at)})`}>
                            Ampliación · {fmtDate(i.created_at)}
                          </span>
                        )}
                      </div>
                      {i.description && <div className="scope-desc">{i.description}</div>}
                    </div>
                    {isStaff && (
                      <>
                        <button className="icon-btn" title="Editar" onClick={() => setEditingId(i.id)}>
                          ✎
                        </button>
                        <button className="icon-btn" title="Borrar" onClick={() => remove(i)}>
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                ),
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CloseScope({
  canEdit,
  files,
  onClose,
}: {
  canEdit: boolean;
  files: { id: string; filename: string; content_type: string | null }[];
  onClose: (fileId?: string) => void;
}) {
  const [fileId, setFileId] = useState("");
  const pdfsFirst = [...files].sort(
    (a, b) => Number(b.content_type === "application/pdf") - Number(a.content_type === "application/pdf"),
  );
  return (
    <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
      <div>
        <b>🔓 Scope abierto</b>
        <span className="muted"> · Cuando el cliente acepte el presupuesto, ciérralo para que lo que se pida después quede como ampliación.</span>
      </div>
      {canEdit && (
        <div className="row" style={{ gap: 8 }}>
          <select className="scope-select" value={fileId} onChange={(e) => setFileId(e.target.value)} title="PDF del presupuesto aceptado">
            <option value="">PDF del presupuesto aceptado (opcional)</option>
            {pdfsFirst.map((f) => (
              <option key={f.id} value={f.id}>
                {f.filename}
              </option>
            ))}
          </select>
          <button className="btn btn-sm btn-primary" onClick={() => confirm("¿Cerrar el scope?") && onClose(fileId || undefined)}>
            Cerrar scope
          </button>
        </div>
      )}
    </div>
  );
}

function ItemForm({
  initial,
  blocks,
  closed,
  onSave,
  onCancel,
}: {
  initial?: ScopeItem;
  blocks: string[];
  closed: boolean;
  onSave: (v: { title: string; description: string; block: string; status: ScopeStatus }) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [block, setBlock] = useState(initial?.block || "");
  const [status, setStatus] = useState<ScopeStatus>(initial?.status || "incluido");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return toast("Escribe qué funcionalidad es");
    setSaving(true);
    await onSave({ title: title.trim(), description: description.trim(), block: block.trim(), status });
    setSaving(false);
  }

  return (
    <div className="scope-form">
      <div className="field-row">
        <div className="field">
          <label>Funcionalidad</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Calendario de citas con recordatorios" autoFocus />
        </div>
        <div className="field">
          <label>Bloque (opcional)</label>
          <input type="text" list="scope-blocks" value={block} onChange={(e) => setBlock(e.target.value)} placeholder="Ej.: Módulo reservas" />
          <datalist id="scope-blocks">
            {blocks.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="field">
        <label>Detalle (opcional)</label>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Qué incluye exactamente, límites, matices…" />
      </div>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <select className="scope-select" value={status} onChange={(e) => setStatus(e.target.value as ScopeStatus)}>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.icon} {s.label}
            </option>
          ))}
        </select>
        <div className="row" style={{ gap: 8 }}>
          {!initial && closed && <span className="muted" style={{ fontSize: 12 }}>Se marcará como ampliación</span>}
          <button className="btn btn-sm" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportBox({
  projectId,
  userId,
  files,
  closed,
  onImport,
  onCancel,
}: {
  projectId: string;
  userId: string;
  files: FileRow[];
  closed: boolean;
  onImport: (items: { title: string; description?: string; block: string; status: ScopeStatus }[]) => Promise<unknown>;
  onCancel: () => void;
}) {
  const pdfs = files
    .filter((f) => f.content_type === "application/pdf" || f.filename.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  const [mode, setMode] = useState<"pdf" | "text">("pdf");
  const [fileId, setFileId] = useState(pdfs[0]?.id || "");
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedScopeItem[] | null>(null);
  const [saving, setSaving] = useState(false);

  const preview = mode === "pdf" ? extracted || [] : parseScopeText(text);

  async function readPdf(id = fileId) {
    if (!id) return toast("Elige un PDF");
    setReading(true);
    setExtracted(null);
    const res = await extractScopeFromFile(id);
    setReading(false);
    if (res.error) return toast(res.error);
    setExtracted(res.items || []);
  }

  async function uploadPdf(file: File) {
    setUploading(true);
    const err = await uploadProjectFile(projectId, file, userId);
    setUploading(false);
    if (err) return toast(err);
    // Se elige solo cuando llegue por realtime; mientras tanto avisamos
    toast("PDF subido. Elígelo en la lista y pulsa «Leer PDF».");
  }

  return (
    <div className="scope-form">
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={mode === "pdf" ? "active" : ""} onClick={() => setMode("pdf")}>
          Leer un PDF
        </button>
        <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>
          Pegar texto
        </button>
      </div>

      {mode === "pdf" ? (
        <>
          <div className="muted" style={{ fontSize: 12.6, marginBottom: 8 }}>
            Elige el PDF del presupuesto o propuesta (de la pestaña Archivos). La IA lee el documento, saca solo las
            funcionalidades del alcance —sin importes— y te las enseña para revisarlas antes de guardar.
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <select className="scope-select" style={{ flex: 1, maxWidth: "none" }} value={fileId} onChange={(e) => { setFileId(e.target.value); setExtracted(null); }}>
              {pdfs.length === 0 && <option value="">No hay PDFs en este proyecto</option>}
              {pdfs.map((f) => (
                <option key={f.id} value={f.id}>
                  📕 {f.filename}
                </option>
              ))}
            </select>
            <label className="btn btn-sm" style={{ cursor: "pointer" }}>
              {uploading ? "Subiendo…" : "📎 Subir PDF"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                style={{ display: "none" }}
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) uploadPdf(f);
                }}
              />
            </label>
            <button className="btn btn-sm btn-primary" onClick={() => readPdf()} disabled={reading || !fileId}>
              {reading ? "Leyendo el PDF…" : "✨ Leer PDF"}
            </button>
          </div>
          {reading && (
            <div className="muted" style={{ fontSize: 12.6, marginBottom: 12 }}>
              Leyendo el documento… puede tardar entre 20 segundos y un minuto.
            </div>
          )}
        </>
      ) : (
        <div className="field">
          <label>Pega aquí el apartado de alcance</label>
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Cada línea será un punto. Las líneas que acaban en «:» o están en MAYÚSCULAS se usan como bloque.\nUn bloque tipo «Fuera de alcance:» marca sus puntos como excluidos.\n\nMÓDULO RESERVAS\n- Calendario de citas\n- Recordatorios por email\nFuera de alcance:\n- App móvil nativa"}
            autoFocus
          />
        </div>
      )}

      {preview.length > 0 && (
        <div className="scope-preview">
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Revisa · {preview.length} puntos{closed ? " (se marcarán como ampliación)" : ""}. Después puedes editar cada uno.
          </div>
          {preview.map((p, i) => (
            <div key={i} className="scope-preview-row">
              {statusOf(p.status).icon} {p.block && <span className="muted">{p.block} · </span>}
              <b style={{ color: "var(--ink)", fontWeight: 600 }}>{p.title}</b>
              {(p as { description?: string }).description ? (
                <span className="muted"> — {(p as { description?: string }).description}</span>
              ) : null}
              {mode === "pdf" && (
                <button
                  className="scope-preview-x"
                  title="Quitar de la importación"
                  onClick={() => setExtracted((prev) => (prev || []).filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-sm" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={saving || !preview.length}
          onClick={async () => {
            setSaving(true);
            await onImport(preview);
            setSaving(false);
          }}
        >
          {saving ? "Guardando…" : `Guardar ${preview.length || ""} puntos en el scope`}
        </button>
      </div>
    </div>
  );
}
