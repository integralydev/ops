"use server";

import { headers } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { CLIENT_FROM, CLIENT_REPLY_TO, escapeHtml, sendEmail } from "@/lib/email";
import type { PortalLang } from "@/lib/portal";

async function appBaseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
  return process.env.NEXT_PUBLIC_APP_URL || (host ? `${proto}://${host}` : "");
}

/** Comprueba que quien llama es admin. Devuelve su cliente de Supabase (con su sesión). */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No has iniciado sesión." as const };
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return { error: "Solo un administrador puede hacer esto." as const };
  return { supabase, user };
}

export interface PortalUser {
  id: string;
  full_name: string | null;
  email: string;
  last_seen: string | null;
  invited_at: string;
}

/** Quién del cliente tiene acceso a su portal (solo admin; lo filtra la base de datos). */
export async function getPortalUsers(clientId: string): Promise<PortalUser[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_users", { cid: clientId });
  return (data as PortalUser[]) || [];
}

/** "Ahora no" en el aviso de invitar al cliente (o volver a mostrarlo). */
export async function setPortalPromptDismissed(projectId: string, dismissed: boolean) {
  const r = await requireAdmin();
  if ("error" in r) return { error: r.error };
  const { error } = await r.supabase
    .from("projects")
    .update({ portal_prompt_dismissed: dismissed })
    .eq("id", projectId);
  return error ? { error: error.message } : { ok: true };
}

const EMAIL_TEXT = {
  es: {
    subject: (c: string) => `Tu portal de cliente de Integraly · ${c}`,
    hi: (n: string) => (n ? `Hola, ${n}:` : "Hola:"),
    body: "Te damos acceso a tu portal de cliente. Ahí verás en qué punto está tu proyecto, el siguiente paso, tu equipo y los documentos que compartamos contigo.",
    cta: "Entrar a mi portal",
    note: "No hace falta contraseña: el botón te da acceso directo. Si el enlace caduca, entra en la misma dirección, escribe tu email y te enviaremos uno nuevo.",
    bye: "Un saludo,\nEl equipo de Integraly",
  },
  ca: {
    subject: (c: string) => `El teu portal de client d'Integraly · ${c}`,
    hi: (n: string) => (n ? `Hola, ${n}:` : "Hola:"),
    body: "Et donem accés al teu portal de client. Hi veuràs en quin punt està el teu projecte, el següent pas, el teu equip i els documents que compartim amb tu.",
    cta: "Entrar al meu portal",
    note: "No cal contrasenya: el botó et dona accés directe. Si l'enllaç caduca, entra a la mateixa adreça, escriu el teu email i te n'enviarem un de nou.",
    bye: "Salutacions,\nL'equip d'Integraly",
  },
};

/**
 * Da acceso al portal a una persona de contacto del cliente y le manda el
 * email con su enlace (sin contraseña). Solo admin. Es el "clic de
 * confirmación": nunca se llama sola.
 */
export async function inviteToPortal(input: {
  clientId: string;
  name: string;
  email: string;
  lang: PortalLang;
}) {
  const r = await requireAdmin();
  if ("error" in r) return { error: r.error };
  const { supabase, user } = r;

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const lang: PortalLang = input.lang === "ca" ? "ca" : "es";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "El email no es válido." };

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, portal_off")
    .eq("id", input.clientId)
    .maybeSingle();
  if (!client) return { error: "Cliente no encontrado." };
  if (client.portal_off) return { error: "Este cliente no tiene portal (entra por Ana)." };

  const admin = createAdminClient();
  const base = await appBaseUrl();

  // ¿Ya hay una cuenta con este email? Si es del equipo, no se toca.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users?.find((u: { email?: string }) => u.email?.toLowerCase() === email);
  if (existing) {
    const { data: prof } = await admin.from("profiles").select("role, client_id").eq("id", existing.id).maybeSingle();
    if (prof && prof.role !== "cliente") {
      return { error: "Este email es de una persona del equipo: no se puede usar para un portal de cliente." };
    }
    if (prof?.client_id && prof.client_id !== client.id) {
      return { error: "Este email ya tiene acceso al portal de otro cliente." };
    }
  }

  // Cuenta que ya existía: se da por confirmada ANTES de crear el enlace (si
  // se hace después, Supabase anula el enlace). Así también puede pedir
  // enlaces nuevos desde el login. Las cuentas nuevas se confirman al abrir
  // la invitación.
  if (existing) await admin.auth.admin.updateUserById(existing.id, { email_confirm: true });

  // Enlace de acceso. No lo envía Supabase: lo enviamos nosotros con nuestro texto.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: existing ? "magiclink" : "invite",
    email,
    options: { data: name ? { full_name: name } : undefined },
  });
  if (linkErr || !link?.user || !link.properties?.hashed_token) {
    return { error: linkErr?.message || "No se pudo crear el acceso." };
  }
  const userId = link.user.id;

  // Rol cliente + su empresa (con la sesión del admin: lo exige la base de datos)
  const { error: profErr } = await supabase
    .from("profiles")
    .upsert(
      { id: userId, role: "cliente", client_id: client.id, added_by: user.id, ...(name ? { full_name: name } : {}) },
      { onConflict: "id" },
    );
  if (profErr) return { error: "No se pudo dar el acceso: " + profErr.message };

  await supabase.from("clients").update({ portal_lang: lang }).eq("id", client.id);

  // verifyOtp con token_hash: "invite" para cuentas nuevas, "email" para las que ya existían
  const type = existing ? "email" : "invite";
  const url = `${base}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=${type}&next=/portal`;
  const t = EMAIL_TEXT[lang];
  const firstName = name.split(" ")[0] || "";
  const html = `
<div style="background:#F6F6F9;padding:32px 16px">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 28px;color:#1A1625;font-size:15px;line-height:1.6">
  <img src="${base}/logo-integraly.png" alt="Integraly" height="20" style="height:20px;width:auto;display:block;margin:0 0 28px">
  <p>${escapeHtml(t.hi(firstName))}</p>
  <p>${escapeHtml(t.body)}</p>
  <p style="margin:28px 0">
    <a href="${url}" style="background:#6B5BB5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(t.cta)}</a>
  </p>
  <p style="color:#6E6A7C;font-size:13px">${escapeHtml(t.note)}</p>
  <p style="white-space:pre-line;margin-bottom:0">${escapeHtml(t.bye)}</p>
</div>
<p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;text-align:center;color:#A7A4B3;font-size:12px;margin:18px 0 0">Integraly AI Solutions · hello@integralyaisolutions.com</p>
</div>`;
  const text = `${t.hi(firstName)}\n\n${t.body}\n\n${t.cta}: ${url}\n\n${t.note}\n\n${t.bye}`;

  const sent = await sendEmail({
    to: email,
    subject: t.subject(client.name),
    html,
    text,
    from: CLIENT_FROM,
    replyTo: CLIENT_REPLY_TO,
  });
  // En local (sin envío de emails) se devuelve el enlace para poder probarlo
  if (sent.skipped && process.env.NODE_ENV !== "production") return { ok: true, devLink: url };
  if (!sent.ok) {
    return {
      error: sent.skipped
        ? "Acceso creado, pero el envío de emails no está configurado: no se ha mandado nada."
        : "Acceso creado, pero el email no se pudo enviar: " + (sent.error || ""),
    };
  }
  return { ok: true };
}

/** Quita el acceso al portal a una persona del cliente (solo admin). */
export async function removePortalUser(userId: string) {
  const r = await requireAdmin();
  if ("error" in r) return { error: r.error };
  const admin = createAdminClient();
  const { data: prof } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (prof?.role !== "cliente") return { error: "Solo se puede quitar el acceso a personas de un cliente." };
  const { error } = await admin.auth.admin.deleteUser(userId);
  return error ? { error: error.message } : { ok: true };
}

/** URL temporal para abrir un documento del portal (comprueba antes que es visible para quien lo pide). */
export async function portalFileUrl(fileId: string) {
  const supabase = await createClient();
  const { data: path } = await supabase.rpc("portal_file_path", { fid: fileId });
  if (!path || typeof path !== "string") return { error: "No disponible" };
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("project-files").createSignedUrl(path, 300);
  if (error || !data) return { error: "No disponible" };
  return { url: data.signedUrl };
}

/** URL temporal para abrir el PDF de una factura (comprueba antes que es de quien la pide). */
export async function portalInvoiceUrl(invoiceId: string) {
  const supabase = await createClient();
  const { data: path } = await supabase.rpc("portal_invoice_path", { iid: invoiceId });
  if (!path || typeof path !== "string") return { error: "No disponible" };
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("invoices").createSignedUrl(path, 300);
  if (error || !data) return { error: "No disponible" };
  return { url: data.signedUrl };
}
