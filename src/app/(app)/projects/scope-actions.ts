"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import type { ScopeStatus } from "@/lib/database.types";

export type ExtractedScopeItem = {
  title: string;
  description: string;
  block: string;
  status: ScopeStatus;
};

const MAX_PDF_BYTES = 20 * 1024 * 1024; // el límite de la API es 32 MB por petición (en base64)

const SCOPE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          block: { type: "string" },
          status: { type: "string", enum: ["incluido", "excluido", "por_decidir"] },
        },
        required: ["title", "description", "block", "status"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const INSTRUCTIONS = `Eres el asistente de una agencia de automatización con IA. Te paso el PDF de un presupuesto o propuesta para un cliente. Extrae su ALCANCE (scope) como una lista de funcionalidades concretas, para que el equipo pueda consultar rápido si algo entraba o no.

Reglas:
- Un punto por funcionalidad o entregable concreto ("Calendario de citas con recordatorios por email"). Título corto y claro; en "description", el detalle o los límites que diga el documento (puede ir vacío).
- "block": el módulo, fase o apartado al que pertenece según el documento ("Fase 1 · Reservas"...). Vacío si no hay agrupación.
- "status": "incluido" si el documento lo incluye; "excluido" si dice explícitamente que queda fuera del alcance / no incluido; "por_decidir" si es opcional, a definir, pendiente de confirmar o una alternativa.
- NUNCA incluyas importes, precios, tarifas, horas facturables, descuentos ni condiciones de pago, ni en el título ni en la descripción. Si una línea mezcla funcionalidad y precio, quédate solo con la funcionalidad.
- Ignora portada, presentación de la agencia, condiciones legales y datos de contacto.
- Escribe en el mismo idioma que el documento.
- Si el documento no contiene ningún alcance reconocible, devuelve una lista vacía.`;

// Lee un PDF de la pestaña Archivos con Claude y devuelve los puntos del scope
// para que el usuario los revise antes de guardarlos. Solo admin/director.
export async function extractScopeFromFile(
  fileId: string,
): Promise<{ items?: ExtractedScopeItem[]; error?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "La lectura automática de PDFs no está configurada todavía (falta ANTHROPIC_API_KEY)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No has iniciado sesión." };

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!me || (me.role !== "admin" && me.role !== "director")) {
    return { error: "Solo un administrador o director puede importar el scope." };
  }

  // Con la sesión del usuario: RLS garantiza que tiene acceso al proyecto del archivo
  const { data: file } = await supabase
    .from("files")
    .select("storage_path, filename, content_type, size_bytes")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return { error: "No se encuentra el archivo." };
  const isPdf = file.content_type === "application/pdf" || file.filename.toLowerCase().endsWith(".pdf");
  if (!isPdf) return { error: `«${file.filename}» no es un PDF.` };
  if ((file.size_bytes || 0) > MAX_PDF_BYTES) return { error: `«${file.filename}» es demasiado grande (máx. 20 MB).` };

  const { data: blob, error: dlErr } = await supabase.storage.from("project-files").download(file.storage_path);
  if (dlErr || !blob) return { error: "No se pudo descargar el PDF." };
  const data = Buffer.from(await blob.arrayBuffer()).toString("base64");

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SCOPE_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
            { type: "text", text: INSTRUCTIONS },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") return { error: "No se pudo analizar este PDF." };
    if (response.stop_reason === "max_tokens") {
      return { error: "El PDF es demasiado largo para extraerlo de una vez. Pega solo el apartado de alcance." };
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return { error: "No se obtuvo respuesta al leer el PDF." };
    const parsed = JSON.parse(text.text) as { items: ExtractedScopeItem[] };
    const items = (parsed.items || [])
      .map((i) => ({
        title: (i.title || "").trim().slice(0, 300),
        description: (i.description || "").trim(),
        block: (i.block || "").trim(),
        status: (["incluido", "excluido", "por_decidir"] as const).includes(i.status) ? i.status : "incluido",
      }))
      .filter((i) => i.title);
    if (!items.length) return { error: "No se ha encontrado ningún apartado de alcance en este PDF." };
    return { items };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: "La clave de Anthropic no es válida." };
    if (e instanceof Anthropic.RateLimitError) return { error: "Demasiadas peticiones seguidas. Prueba en un minuto." };
    if (e instanceof Anthropic.APIError) {
      console.error("extractScopeFromFile", e.status, e.message);
      return { error: `Error al leer el PDF (${e.status ?? "API"}). Inténtalo de nuevo.` };
    }
    console.error("extractScopeFromFile", e);
    return { error: "Error inesperado al leer el PDF." };
  }
}
