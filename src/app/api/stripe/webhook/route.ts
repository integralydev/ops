import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";

// Webhook de Stripe → factura cobrada en Finanzas. Eventos: invoice.paid
// (suscripciones) y checkout.session.completed / async_payment_succeeded
// (pagos únicos por Payment Link).
// Este endpoint no guarda nada por sí mismo: pasa el cuerpo tal cual y la
// cabecera de firma a fin_stripe_webhook, que verifica la firma de Stripe en la
// base de datos (con el secreto de fin_secrets) y solo puede crear esa factura.
// Sin service_role para eso: se llama con la clave pública y sin sesión.
// Después, solo si la firma era buena, guarda el PDF de Stripe para el portal.
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Falta la firma", { status: 400 });
  // El cuerpo exacto, sin reinterpretar: la firma se calcula sobre él
  const payload = await request.text();

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("fin_stripe_webhook", { p_payload: payload, p_signature: signature });
  if (error) {
    console.error("Webhook de Stripe:", error.message);
    // 500: Stripe lo reintenta más tarde
    return new Response("Error", { status: 500 });
  }
  const result = String(data);
  if (result.startsWith("firma") || result === "payload_invalido") return new Response("Firma no válida", { status: 400 });
  if (result === "sin_secreto") {
    console.error("Webhook de Stripe: falta el secreto en fin_secrets");
    return new Response("No configurado", { status: 500 });
  }
  // ok · duplicado · ignorado · sin_vincular (queda como aviso en Finanzas)
  if (result === "ok" || result === "duplicado") {
    try {
      await saveInvoicePdf(payload);
    } catch (e) {
      // El PDF es un extra: si falla, la factura ya está creada y no se reintenta
      console.error("Webhook de Stripe (PDF):", e instanceof Error ? e.message : e);
    }
  }
  return Response.json({ received: true });
}

/** "1 × Mantenimiento X (at €90.00 / month)" → "Mantenimiento X" */
function cleanConcept(s: string) {
  return s.replace(/^\s*\d+\s*×\s*/, "").replace(/\s*\(at [^)]*\)\s*$/, "").trim();
}

// Guarda el PDF de una factura de Stripe en invoices/<cliente>/<número>.pdf,
// que es donde el portal del cliente lo busca. Solo facturas (invoice.paid).
async function saveInvoicePdf(payload: string) {
  const event = JSON.parse(payload);
  if (event?.type !== "invoice.paid") return;
  const inv = event.data?.object;
  const pdfUrl: string | undefined = inv?.invoice_pdf;
  if (!inv?.id || !pdfUrl || !pdfUrl.startsWith("https://")) return;

  const admin = createAdminClient();
  const { data: rows, error } = await admin.rpc("stripe_invoice_client", { p_stripe_id: inv.id });
  if (error) throw new Error(error.message);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.client_id || !row?.number) return; // sin cliente en el OPS: nada que enseñar

  const res = await fetch(pdfUrl);
  if (!res.ok) throw new Error(`descarga ${res.status}`);
  const pdf = new Uint8Array(await res.arrayBuffer());
  const path = `${row.client_id}/${row.number}.pdf`;
  const { error: upErr } = await admin.storage
    .from("invoices")
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(upErr.message);

  // Concepto legible en el portal (sin "1 ×" ni "(at €90.00 / month)")
  const line = inv.lines?.data?.[0]?.description;
  if (typeof line === "string" && line) {
    await admin
      .from("fin_invoices")
      .update({ portal_concept: cleanConcept(line) })
      .eq("stripe_invoice_id", inv.id)
      .is("portal_concept", null);
  }
}
