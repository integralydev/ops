"use client";

import { useState } from "react";
import { useAppData } from "@/components/app-data";
import { useContentIdeas } from "@/lib/hooks/useProjectDetail";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { fmtRelative } from "@/lib/format";
import type { ContentIdea, Project } from "@/lib/database.types";

// Pestaña "Contenido" (solo laboratorio): ideas para publicar sobre el
// producto, como notas. Sin estados: cuando una se publica, se quita.
export function ContentTab({ project }: { project: Project }) {
  const { me, nameFor } = useAppData();
  const { rows, loading, upsertLocal, removeLocal } = useContentIdeas(project.id);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const ideas = Object.values(rows).sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function add() {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    const { data, error } = await createClient()
      .from("content_ideas")
      .insert({ project_id: project.id, text: v, created_by: me.id })
      .select()
      .single();
    setBusy(false);
    if (error || !data) {
      toast("No se pudo guardar la idea" + (error ? ": " + error.message : ""));
      return;
    }
    upsertLocal(data as ContentIdea);
    setText("");
  }

  async function remove(idea: ContentIdea) {
    const { data, error } = await createClient().from("content_ideas").delete().eq("id", idea.id).select("id");
    if (error || !data?.length) {
      toast("No se pudo quitar" + (error ? ": " + error.message : ""));
      return;
    }
    removeLocal(idea.id);
    toast("Idea quitada");
  }

  return (
    <div className="card pad">
      <div className="idea-compose">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nueva idea de contenido… (Enter para guardar, Shift+Enter para otra línea)"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              add();
            }
          }}
          disabled={busy}
        />
        <button className="btn btn-primary" onClick={add} disabled={busy || !text.trim()}>
          Añadir
        </button>
      </div>

      {loading ? (
        <div className="empty">Cargando…</div>
      ) : ideas.length === 0 ? (
        <div className="empty">Todavía no hay ideas. Apunta la primera arriba.</div>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 12.3, margin: "4px 0 10px" }}>
            {ideas.length} idea{ideas.length === 1 ? "" : "s"} · cuando publiques una, quítala con ✕
          </div>
          <div className="idea-grid">
            {ideas.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} tone={toneOf(idea.id)} by={nameFor(idea.created_by)} onSaved={upsertLocal} onRemove={() => remove(idea)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Color de cada nota: fijo para cada idea (no cambia al añadir otras)
function toneOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 5;
}

function IdeaCard({
  idea,
  tone,
  by,
  onSaved,
  onRemove,
}: {
  idea: ContentIdea;
  tone: number;
  by: string;
  onSaved: (row: ContentIdea) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(idea.text);

  async function save() {
    setEditing(false);
    const v = value.trim();
    if (!v || v === idea.text) {
      setValue(idea.text);
      return;
    }
    const { data, error } = await createClient().from("content_ideas").update({ text: v }).eq("id", idea.id).select().maybeSingle();
    if (error || !data) {
      toast("No se pudo guardar" + (error ? ": " + error.message : ""));
      setValue(idea.text);
      return;
    }
    onSaved(data as ContentIdea);
  }

  return (
    <div className={`idea-card tone-${tone}`}>
      <button className="idea-remove" title="Quitar (ya publicada)" onClick={onRemove}>
        ✕
      </button>
      {editing ? (
        <textarea
          className="idea-edit"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
            if (e.key === "Escape") {
              setValue(idea.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <div
          className="idea-text"
          title="Clic para editar"
          onClick={() => {
            setValue(idea.text);
            setEditing(true);
          }}
        >
          {idea.text}
        </div>
      )}
      <div className="idea-meta">
        {by.split(" ")[0]} · {fmtRelative(idea.created_at)}
      </div>
    </div>
  );
}
