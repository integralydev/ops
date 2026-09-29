"use client";

import { useRef, useState } from "react";
import { useAppData } from "@/components/app-data";
import { useFiles, useTasks } from "@/lib/hooks/useProjectDetail";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { fileGlyph, fmtDate, fmtSize } from "@/lib/format";
import { FILES_BUCKET as BUCKET, openProjectFile, uploadProjectFile } from "@/lib/uploads";
import type { Project } from "@/lib/database.types";

export function FilesTab({ project }: { project: Project }) {
  const { me, isStaff, nameFor } = useAppData();
  const { rows: files, loading } = useFiles(project.id);
  const { rows: tasks } = useTasks(project.id);
  const [uploading, setUploading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const list = Object.values(files).sort((a, b) =>
    (b.uploaded_at || "").localeCompare(a.uploaded_at || ""),
  );

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (!picked.length) return;
    setUploading(true);
    let ok = 0;
    for (const file of picked) {
      const err = await uploadProjectFile(project.id, file, me.id);
      if (err) toast(err);
      else ok++;
    }
    setUploading(false);
    if (ok) toast(ok === 1 ? "Archivo subido" : `${ok} archivos subidos`);
  }

  async function openFile(fileId: string, storagePath: string) {
    setOpeningId(fileId);
    const ok = await openProjectFile(storagePath);
    setOpeningId(null);
    if (!ok) toast("No se pudo abrir el archivo");
  }

  async function deleteFile(fileId: string, storagePath: string) {
    if (!confirm("¿Borrar este archivo?")) return;
    const supabase = createClient();
    await supabase.storage.from(BUCKET).remove([storagePath]);
    const { error } = await supabase.from("files").delete().eq("id", fileId);
    if (error) toast("No se pudo eliminar: " + error.message);
  }

  return (
    <div className="card pad">
      <div className="row" style={{ marginBottom: 16 }}>
        <label className="btn btn-primary" style={{ cursor: "pointer" }}>
          📎 {uploading ? "Subiendo…" : "Subir archivo"}
          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleUpload}
            disabled={uploading}
          />
        </label>
      </div>

      {loading ? (
        <div className="empty">Cargando…</div>
      ) : list.length === 0 ? (
        <div className="empty">No hay archivos en este proyecto todavía.</div>
      ) : (
        list.map((f) => {
          const canDelete = isStaff || f.uploaded_by === me.id;
          return (
            <div className="file-row" key={f.id}>
              <div className="file-icon">{fileGlyph(f.content_type)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="file-name">{f.filename}</div>
                <div className="file-meta">
                  {fmtSize(f.size_bytes)} · subido por {nameFor(f.uploaded_by)} ·{" "}
                  {fmtDate(f.uploaded_at)}
                  {f.task_id && tasks[f.task_id] && <> · 📋 tarea «{tasks[f.task_id].title}»</>}
                </div>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => openFile(f.id, f.storage_path)}
                disabled={openingId === f.id}
              >
                {openingId === f.id ? "Abriendo…" : "Abrir"}
              </button>
              {canDelete && (
                <button
                  className="icon-btn"
                  title="Eliminar"
                  onClick={() => deleteFile(f.id, f.storage_path)}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
