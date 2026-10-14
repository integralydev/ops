"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useAppData } from "@/components/app-data";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import type { TaskComment } from "@/lib/database.types";

// Hasta cuándo ha leído esta persona los comentarios de cada tarea (solo las
// suyas, por RLS). Sirve para marcar desde fuera los comentarios nuevos.
export function useCommentReads(userId: string) {
  const [reads, setReads] = useState<Record<string, string>>({});
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let alive = true;
    supabase
      .from("task_comment_reads")
      .select("task_id, last_read_at")
      .then(({ data }) => {
        if (!alive || !data) return;
        const m: Record<string, string> = {};
        data.forEach((r) => (m[r.task_id] = r.last_read_at));
        setReads(m);
      });
    return () => {
      alive = false;
    };
  }, [supabase]);

  const markRead = useCallback(
    async (taskId: string) => {
      const now = new Date().toISOString();
      setReads((prev) => ({ ...prev, [taskId]: now }));
      await supabase
        .from("task_comment_reads")
        .upsert({ task_id: taskId, user_id: userId, last_read_at: now }, { onConflict: "task_id,user_id" });
    },
    [supabase, userId],
  );

  return { reads, markRead };
}

/** Comentarios de otras personas posteriores a la última lectura. */
export function unreadOf(comments: TaskComment[], meId: string, lastRead?: string) {
  return comments.filter((c) => c.author_id !== meId && (!lastRead || c.created_at > lastRead));
}

// Indicador para la lista y el tablero: 💬 n, resaltado si hay comentarios
// nuevos de otras personas.
export function CommentBadge({
  comments,
  unread,
  onOpen,
}: {
  comments: TaskComment[];
  unread: TaskComment[];
  onOpen?: () => void;
}) {
  const { nameFor } = useAppData();
  if (!comments.length) return null;
  const who = [...new Set(unread.map((c) => nameFor(c.author_id).split(" ")[0]))].join(", ");
  const title = unread.length
    ? `${unread.length} comentario${unread.length === 1 ? "" : "s"} nuevo${unread.length === 1 ? "" : "s"} de ${who}`
    : `${comments.length} comentario${comments.length === 1 ? "" : "s"}`;
  const Tag = onOpen ? "button" : "span";
  return (
    <Tag className={"task-comment-badge" + (unread.length ? " is-unread" : "")} onClick={onOpen} title={title}>
      💬 {comments.length}
      {unread.length > 0 && <span className="task-comment-dot" />}
    </Tag>
  );
}

// Sección "Comentarios" del panel de una tarea.
export function TaskCommentsSection({
  taskId,
  projectId,
  comments,
  lastRead,
  onChanged,
  onRemoved,
}: {
  taskId: string;
  projectId: string;
  comments: TaskComment[];
  /** Última lectura antes de abrir la tarea: lo posterior de otros sale como nuevo. */
  lastRead?: string;
  onChanged: (row: TaskComment) => void;
  onRemoved: (id: string) => void;
}) {
  const { me, isStaff, nameFor } = useAppData();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const sorted = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at));

  async function post() {
    const v = text.trim();
    if (!v || posting) return;
    setPosting(true);
    const { data, error } = await createClient()
      .from("task_comments")
      .insert({ task_id: taskId, project_id: projectId, text: v, author_id: me.id })
      .select()
      .single();
    setPosting(false);
    if (error || !data) {
      toast("No se pudo comentar" + (error ? ": " + error.message : ""));
      return;
    }
    onChanged(data as TaskComment);
    setText("");
  }

  async function saveEdit(c: TaskComment) {
    const v = draft.trim();
    setEditingId(null);
    if (!v || v === c.text) return;
    const { data, error } = await createClient()
      .from("task_comments")
      .update({ text: v, edited_at: new Date().toISOString() })
      .eq("id", c.id)
      .select()
      .maybeSingle();
    if (error || !data) {
      toast("No se pudo guardar" + (error ? ": " + error.message : ""));
      return;
    }
    onChanged(data as TaskComment);
  }

  async function remove(c: TaskComment) {
    if (!confirm("¿Borrar este comentario?")) return;
    const { data, error } = await createClient().from("task_comments").delete().eq("id", c.id).select("id");
    if (error || !data?.length) {
      toast("No se pudo borrar" + (error ? ": " + error.message : ""));
      return;
    }
    onRemoved(c.id);
  }

  return (
    <>
      <div className="task-panel-section">
        Comentarios {sorted.length > 0 && <span className="muted">({sorted.length})</span>}
      </div>
      {sorted.map((c) => {
        const mine = c.author_id === me.id;
        const isNew = !mine && (!lastRead || c.created_at > lastRead);
        return (
          <div key={c.id} className={"tc-item" + (isNew ? " is-new" : "")}>
            <Avatar id={c.author_id || ""} name={nameFor(c.author_id)} size={26} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="tc-head">
                <b>{c.author_id ? nameFor(c.author_id) : "Alguien"}</b>
                <span className="note-time" title={fmtDateTime(c.created_at)}>
                  {fmtRelative(c.created_at)}
                  {c.edited_at ? " · editado" : ""}
                </span>
                {isNew && <span className="tc-new">Nuevo</span>}
                {(mine || isStaff) && editingId !== c.id && (
                  <span className="tc-actions">
                    {mine && (
                      <button
                        onClick={() => {
                          setDraft(c.text);
                          setEditingId(c.id);
                        }}
                      >
                        Editar
                      </button>
                    )}
                    <button onClick={() => remove(c)}>Borrar</button>
                  </span>
                )}
              </div>
              {editingId === c.id ? (
                <textarea
                  className="tc-input"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => saveEdit(c)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      (e.target as HTMLTextAreaElement).blur();
                    }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <div className="tc-text">{c.text}</div>
              )}
            </div>
          </div>
        );
      })}
      <div className="tc-compose">
        <Avatar id={me.id} name={me.full_name} size={26} />
        <textarea
          className="tc-input"
          rows={2}
          value={text}
          placeholder="Escribe un comentario… (Enter para enviar, Shift+Enter para otra línea)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              post();
            }
          }}
          readOnly={posting}
        />
      </div>
    </>
  );
}
