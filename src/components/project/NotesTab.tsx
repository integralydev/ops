"use client";

import { useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { useNotes } from "@/lib/hooks/useProjectDetail";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { UPDATES_BUCKET, UpdateImages } from "@/components/project/UpdateImages";
import type { Note, Project } from "@/lib/database.types";

// Pestaña "Actualizaciones": bitácora con fecha de lo que se va haciendo en el
// proyecto (tabla notes), con capturas adjuntas. Edita el autor o
// admin/director; solo admin/director borran.
export function NotesTab({ project }: { project: Project }) {
  const { me, isStaff, nameFor } = useAppData();
  const { rows: notes, loading, removeLocal, upsertLocal } = useNotes(project.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ file: File; url: string }[]>([]);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = Object.values(notes).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  function addImages(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length < files.length) toast("Solo se pueden adjuntar imágenes");
    setImages((prev) => [...prev, ...imgs.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  function removeImage(i: number) {
    setImages((prev) => {
      URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, j) => j !== i);
    });
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files);
    if (files.length) {
      e.preventDefault();
      addImages(files);
    }
  }

  async function post() {
    if (!text.trim() && !images.length) return;
    setPosting(true);
    const supabase = createClient();

    const paths: string[] = [];
    for (const { file } of images) {
      const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "png").toLowerCase();
      const path = `${project.id}/updates/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(UPDATES_BUCKET).upload(path, file, { contentType: file.type });
      if (error) {
        if (paths.length) await supabase.storage.from(UPDATES_BUCKET).remove(paths);
        setPosting(false);
        toast("No se pudo subir la imagen: " + error.message);
        return;
      }
      paths.push(path);
    }

    const { error } = await supabase.from("notes").insert({
      project_id: project.id,
      author_id: me.id,
      text: text.trim(),
      image_paths: paths,
    });
    setPosting(false);
    if (error) {
      if (paths.length) await supabase.storage.from(UPDATES_BUCKET).remove(paths);
      toast("No se pudo publicar: " + error.message);
      return;
    }
    images.forEach((i) => URL.revokeObjectURL(i.url));
    setImages([]);
    setText("");
  }

  async function remove(id: string, paths: string[]) {
    if (!confirm("¿Borrar esta actualización?")) return;
    const supabase = createClient();
    // .select() para saber si se borró algo: si RLS lo impide no da error, solo 0 filas.
    const { data, error } = await supabase.from("notes").delete().eq("id", id).select("id");
    if (error || !data?.length) {
      toast("No se pudo borrar" + (error ? ": " + error.message : ": no tienes permiso"));
      return;
    }
    removeLocal(id);
    if (paths.length) await supabase.storage.from(UPDATES_BUCKET).remove(paths);
  }

  function startEdit(n: Note) {
    setEditingId(n.id);
    setDraft(n.text);
  }

  async function saveEdit(n: Note) {
    if (!draft.trim() && !(n.image_paths || []).length) return;
    setSaving(true);
    const { data, error } = await createClient()
      .from("notes")
      .update({ text: draft.trim(), edited_at: new Date().toISOString() })
      .eq("id", n.id)
      .select()
      .maybeSingle();
    setSaving(false);
    if (error || !data) {
      toast("No se pudo guardar" + (error ? ": " + error.message : ": no tienes permiso"));
      return;
    }
    upsertLocal(data as Note);
    setEditingId(null);
  }

  return (
    <div className="card pad">
      <div className="update-compose">
        <textarea
          placeholder="¿Qué se ha hecho? Ej.: «Supabase, Vercel y GitHub conectados. Calendario funcionando.» Puedes pegar capturas con Cmd+V."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          rows={3}
        />
        {images.length > 0 && (
          <div className="update-images">
            {images.map((img, i) => (
              <div key={img.url} className="update-pending">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="Captura adjunta" />
                <button title="Quitar" onClick={() => removeImage(i)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="row between">
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={posting}>
            🖼️ Adjuntar captura
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              addImages(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <button className="btn btn-primary" onClick={post} disabled={posting || (!text.trim() && !images.length)}>
            {posting ? "Publicando…" : "Publicar actualización"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty">Cargando…</div>
      ) : list.length === 0 ? (
        <div className="empty">Todavía no hay actualizaciones. Cuenta arriba qué se ha hecho.</div>
      ) : (
        list.map((n) => (
          <div className="note" key={n.id}>
            <Avatar id={n.author_id || ""} name={nameFor(n.author_id)} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="note-head">
                <span className="note-author">{nameFor(n.author_id)}</span>
                <span className="note-time" title={fmtDateTime(n.created_at)}>
                  {fmtRelative(n.created_at)} · {fmtDateTime(n.created_at)}
                  {n.edited_at && <span title={"Editado " + fmtDateTime(n.edited_at)}> · editado</span>}
                </span>
              </div>
              {editingId === n.id ? (
                <>
                  <div className="field">
                    <textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => saveEdit(n)}
                      disabled={saving || (!draft.trim() && !(n.image_paths || []).length)}
                    >
                      {saving ? "Guardando…" : "Guardar"}
                    </button>
                    <button className="btn btn-sm" onClick={() => setEditingId(null)} disabled={saving}>
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
                n.text && <div className="note-text">{n.text}</div>
              )}
              <UpdateImages paths={n.image_paths || []} />
            </div>
            {(isStaff || n.author_id === me.id) && editingId !== n.id && (
              <button className="icon-btn" title="Editar actualización" onClick={() => startEdit(n)}>
                ✎
              </button>
            )}
            {isStaff && (
              <button className="icon-btn" title="Borrar actualización" onClick={() => remove(n.id, n.image_paths || [])}>
                ✕
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
