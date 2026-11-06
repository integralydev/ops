// Envío de emails transaccionales con Resend (https://resend.com).
// Solo servidor: usa RESEND_API_KEY, que nunca debe llegar al navegador.
// Si no hay API key configurada, no se envía nada (y no falla).

const FROM = process.env.EMAIL_FROM || "Integraly Ops <no-reply@integralyaisolutions.com>";
/** Correos a clientes: con nuestro nombre y, si contestan, llega a hello@. */
export const CLIENT_FROM = process.env.EMAIL_FROM_CLIENTS || "Integraly <hello@integralyaisolutions.com>";
export const CLIENT_REPLY_TO = "hello@integralyaisolutions.com";

export function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  from,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Remitente propio (p. ej. los correos a clientes salen como "Integraly <hello@…>"). */
  from?: string;
  replyTo?: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: true };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: from || FROM,
        to: [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!res.ok) return { ok: false, error: `${res.status} ${await res.text()}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
