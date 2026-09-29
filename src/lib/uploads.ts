"use client";

import { createClient } from "@/lib/supabase/client";

export const FILES_BUCKET = "project-files";

// Supabase Storage rechaza claves con acentos y símbolos ("Invalid key"), p. ej.
// "Resposta Gerardo – acta reunió.pdf". Para la ruta usamos una versión limpia;
// el nombre original (con acentos) se guarda en files.filename y es el que se ve.
export function safeStorageName(name: string) {
  const clean = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos: ó → o, ç → c
    .replace(/[^A-Za-z0-9._-]+/g, "_") // espacios y símbolos → _
    .replace(/_+/g, "_")
    .replace(/_\./g, ".")
    .replace(/^[_.]+|_+$/g, "");
  return clean.slice(-120) || "archivo";
}

// Sube un archivo al proyecto (opcionalmente vinculado a una tarea) y lo
// registra en la tabla files. Devuelve un mensaje de error en español o null.
export async function uploadProjectFile(
  projectId: string,
  file: File,
  userId: string,
  taskId?: string,
): Promise<string | null> {
  const supabase = createClient();
  const path = `${projectId}/${crypto.randomUUID()}-${safeStorageName(file.name)}`;
  const { error: upErr } = await supabase.storage
    .from(FILES_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (upErr) {
    const m = upErr.message.toLowerCase();
    if (m.includes("exceeded") || m.includes("too large") || m.includes("size"))
      return `«${file.name}» es demasiado grande para subirlo.`;
    if (m.includes("row-level security") || m.includes("unauthorized"))
      return "No tienes permiso para subir archivos a este proyecto.";
    return `No se pudo subir «${file.name}»: ${upErr.message}`;
  }

  const { error: insErr } = await supabase.from("files").insert({
    project_id: projectId,
    storage_path: path,
    filename: file.name,
    content_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: userId,
    ...(taskId ? { task_id: taskId } : {}),
  });
  if (insErr) {
    await supabase.storage.from(FILES_BUCKET).remove([path]);
    return `No se pudo registrar «${file.name}»: ${insErr.message}`;
  }
  return null;
}

// Abre un archivo privado con una URL firmada (válida 60 s)
export async function openProjectFile(storagePath: string): Promise<boolean> {
  const { data, error } = await createClient().storage.from(FILES_BUCKET).createSignedUrl(storagePath, 60);
  if (error || !data) return false;
  window.open(data.signedUrl, "_blank", "noopener");
  return true;
}
