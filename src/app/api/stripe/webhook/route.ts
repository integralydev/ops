import { createClient } from "@supabase/supabase-js";

// Webhook de Stripe (invoice.paid → factura cobrada en Finanzas).
// Este endpoint no guarda nada por sí mismo: pasa el cuerpo tal cual y la
// cabecera de firma a fin_stripe_webhook, que verifica la firma de Stripe en la
// base de datos (con el secreto de fin_secrets) y solo puede crear esa factura.
// Sin service_role: se llama con la clave pública y sin sesión.
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
  return Response.json({ received: true });
}
