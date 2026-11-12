"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/database.types";

const TEAM_ROLES: Role[] = ["admin", "director", "developer", "comercial"];

export async function inviteTeamMember(email: string, role: Role, fullName?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No has iniciado sesión." };

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!myProfile || myProfile.role !== "admin") {
    return { error: "Solo un administrador puede añadir personas." };
  }

  if (!TEAM_ROLES.includes(role)) return { error: "Rol no válido." };

  const admin = createAdminClient();

  // ¿Ya existe una cuenta con este email? Si es así, no hace falta invitar
  // de nuevo — solo darle acceso a la app.
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let already = existing?.users?.find(
    (u: { email?: string }) => u.email?.toLowerCase() === email.trim().toLowerCase(),
  );
  if (already) {
    const { data: prof } = await admin.from("profiles").select("role, client_id, added_by").eq("id", already.id).maybeSingle();
    if (prof?.role === "cliente" && prof.client_id) {
      return { error: "Este email tiene acceso al portal de un cliente: no se puede usar para el equipo." };
    }
    // Cuenta que nadie del equipo creó ni se confirmó nunca: se borra y se invita de cero
    if (!already.email_confirmed_at && !prof?.added_by) {
      const { error: delErr } = await admin.auth.admin.deleteUser(already.id);
      if (delErr) return { error: "No se pudo preparar la invitación: " + delErr.message };
      already = undefined;
    }
  }

  let userId: string;
  if (already) {
    userId = already.id;
  } else {
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      email.trim(),
      { data: fullName?.trim() ? { full_name: fullName.trim() } : undefined },
    );
    if (inviteErr || !invited?.user) {
      return { error: inviteErr?.message || "No se pudo invitar a esta persona." };
    }
    userId = invited.user.id;
  }

  // Si la persona no abre el email de invitación, su cuenta queda "sin
  // confirmar" y Supabase rechaza enviarle enlaces de acceso. Como la ha
  // invitado un admin, la damos por confirmada: así puede entrar pidiendo
  // un enlace desde la pantalla de login en cualquier momento.
  await admin.auth.admin.updateUserById(userId, { email_confirm: true });

  const { error: upsertErr } = await supabase
    .from("profiles")
    .upsert(
      { id: userId, role, client_id: null, added_by: user.id, ...(fullName?.trim() ? { full_name: fullName.trim() } : {}) },
      { onConflict: "id" },
    );
  if (upsertErr) {
    return { error: "Invitación enviada, pero no se pudo asignar el rol: " + upsertErr.message };
  }

  return { ok: true };
}

// Emails del equipo (viven en auth.users, no en profiles), solo para admins.
export async function getTeamEmails(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return {};

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!myProfile || myProfile.role !== "admin") return {};

  const admin = createAdminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emails: Record<string, string> = {};
  data?.users?.forEach((u: { id: string; email?: string }) => {
    if (u.email) emails[u.id] = u.email;
  });
  return emails;
}
