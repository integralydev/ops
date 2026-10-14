"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { FILES_BUCKET } from "@/lib/uploads";
import { fmtRelative } from "@/lib/format";
import type { FileRow } from "@/lib/database.types";

export const isAudio = (f: Pick<FileRow, "content_type">) => !!f.content_type?.startsWith("audio/");

/** Grabación más larga permitida (para no subir archivos enormes por despiste). */
const MAX_SECONDS = 5 * 60;

// Formato de grabación: mp4/AAC se reproduce en todos los navegadores (también
// Safari); si el navegador no sabe grabarlo, webm/Opus.
function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Grabar un audio para explicar la tarea. Al parar, se sube como adjunto.
export function AudioRecorder({ onRecorded, disabled }: { onRecorded: (file: File) => void; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "recording">("idle");
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Si se cierra la tarea grabando, se corta sin guardar
  useEffect(
    () => () => {
      cancelled.current = true;
      if (recRef.current?.state === "recording") recRef.current.stop();
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  async function start() {
    const mime = pickMime();
    if (mime === null || !navigator.mediaDevices?.getUserMedia) {
      toast("Este navegador no permite grabar audio");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast("No hay permiso para usar el micrófono. Actívalo en el navegador e inténtalo de nuevo.");
      return;
    }
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    cancelled.current = false;
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      setState("idle");
      if (cancelled.current || !chunks.current.length) return;
      const type = (rec.mimeType || mime || "audio/webm").split(";")[0];
      const ext = type.includes("mp4") ? "m4a" : "webm";
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const name = `audio-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
      onRecorded(new File(chunks.current, name, { type }));
    };
    rec.start(1000);
    recRef.current = rec;
    setSeconds(0);
    setState("recording");
    const started = Date.now();
    timer.current = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      setSeconds(s);
      if (s >= MAX_SECONDS && rec.state === "recording") rec.stop();
    }, 250);
  }

  function stop(save: boolean) {
    cancelled.current = !save;
    if (recRef.current?.state === "recording") recRef.current.stop();
  }

  if (state === "recording") {
    return (
      <div className="audio-rec">
        <span className="audio-rec-dot" />
        <span className="audio-rec-time">{mmss(seconds)}</span>
        <span className="muted" style={{ fontSize: 12 }} title={`Máximo ${MAX_SECONDS / 60} minutos`}>
          Grabando…
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => stop(false)}>
          Descartar
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => stop(true)}>
          ■ Parar y guardar
        </button>
      </div>
    );
  }
  return (
    <button className="task-file" onClick={start} disabled={disabled}>
      🎙 Grabar audio
    </button>
  );
}

// Audios de la tarea, con su reproductor.
export function TaskAudios({
  audios,
  nameFor,
  canDelete,
}: {
  audios: FileRow[];
  nameFor: (id?: string | null) => string;
  canDelete: (f: FileRow) => boolean;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = audios.map((f) => f.storage_path).join("|");

  useEffect(() => {
    if (!audios.length) return;
    let alive = true;
    createClient()
      .storage.from(FILES_BUCKET)
      .createSignedUrls(
        audios.map((f) => f.storage_path),
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

  async function remove(f: FileRow) {
    if (!confirm("¿Borrar este audio?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("files").delete().eq("id", f.id);
    if (error) {
      toast("No se pudo borrar: " + error.message);
      return;
    }
    await supabase.storage.from(FILES_BUCKET).remove([f.storage_path]);
  }

  if (!audios.length) return null;
  const sorted = [...audios].sort((a, b) => (a.uploaded_at || "").localeCompare(b.uploaded_at || ""));
  return (
    <div className="audio-list">
      {sorted.map((f) => (
        <div key={f.id} className="audio-item">
          <div className="audio-meta">
            🎙 <b>{nameFor(f.uploaded_by).split(" ")[0]}</b> · {fmtRelative(f.uploaded_at)}
            {canDelete(f) && (
              <button className="audio-del" title="Borrar audio" onClick={() => remove(f)}>
                ✕
              </button>
            )}
          </div>
          {urls[f.storage_path] ? (
            <audio controls preload="metadata" src={urls[f.storage_path]} />
          ) : (
            <div className="audio-loading" />
          )}
        </div>
      ))}
    </div>
  );
}
