"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { FILES_BUCKET } from "@/lib/uploads";
import type { FileRow } from "@/lib/database.types";

export const isImage = (f: Pick<FileRow, "content_type">) => !!f.content_type?.startsWith("image/");

// Miniaturas de las capturas de una tarea (en el panel lateral). El bucket es
// privado: se piden URLs firmadas. Clic → se ve en grande, con flechas para
// pasar de una a otra.
export function TaskImages({
  images,
  canDelete,
  onViewerChange,
}: {
  images: FileRow[];
  canDelete: (f: FileRow) => boolean;
  /** Avisa al panel cuando el visor está abierto (para que Esc cierre el visor y no el panel). */
  onViewerChange: (open: boolean) => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<number | null>(null);
  const key = images.map((f) => f.storage_path).join("|");

  useEffect(() => {
    if (!images.length) return;
    let alive = true;
    createClient()
      .storage.from(FILES_BUCKET)
      .createSignedUrls(
        images.map((f) => f.storage_path),
        3600,
      )
      .then(({ data }) => {
        if (!alive || !data) return;
        const map: Record<string, string> = {};
        data.forEach((d) => {
          if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
        });
        setUrls(map);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function open(i: number | null) {
    setViewing(i);
    onViewerChange(i !== null);
  }

  // Teclado del visor: Esc cierra, flechas pasan de imagen
  useEffect(() => {
    if (viewing === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        open(null);
      }
      if (e.key === "ArrowRight") open((viewing + 1) % images.length);
      if (e.key === "ArrowLeft") open((viewing - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing, images.length]);

  async function remove(f: FileRow) {
    if (!confirm(`¿Borrar la imagen «${f.filename}»?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("files").delete().eq("id", f.id);
    if (error) {
      toast("No se pudo borrar: " + error.message);
      return;
    }
    await supabase.storage.from(FILES_BUCKET).remove([f.storage_path]);
    if (viewing !== null) open(null);
  }

  if (!images.length) return null;
  const current = viewing !== null ? images[viewing] : null;

  return (
    <>
      <div className="task-imgs">
        {images.map((f, i) => (
          <div key={f.id} className="task-img">
            <button className="task-img-btn" onClick={() => open(i)} title={f.filename}>
              {urls[f.storage_path] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urls[f.storage_path]} alt={f.filename} />
              ) : (
                <span className="task-img-loading" />
              )}
            </button>
            {canDelete(f) && (
              <button className="task-img-del" title="Borrar imagen" onClick={() => remove(f)}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {current && (
        <div className="img-viewer" onClick={() => open(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[current.storage_path]} alt={current.filename} onClick={(e) => e.stopPropagation()} />
          <div className="img-viewer-bar" onClick={(e) => e.stopPropagation()}>
            <span>
              {current.filename}
              {images.length > 1 && ` · ${viewing! + 1} de ${images.length}`}
            </span>
            {images.length > 1 && (
              <>
                <button onClick={() => open((viewing! - 1 + images.length) % images.length)} title="Anterior (←)">
                  ←
                </button>
                <button onClick={() => open((viewing! + 1) % images.length)} title="Siguiente (→)">
                  →
                </button>
              </>
            )}
            <a href={urls[current.storage_path]} target="_blank" rel="noopener noreferrer">
              Abrir original ↗
            </a>
            <button onClick={() => open(null)} title="Cerrar (Esc)">
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
