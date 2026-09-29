"use server";

import { headers } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { escapeHtml, sendEmail } from "@/lib/email";

// Avisa por email a la persona asignada a una tarea. Se llama justo después de
// crear o reasignar la tarea. No avisa si te la asignas a ti, si no hay nadie
// asignado o si es una tarea del cliente. Nunca lanza errores: si el email
// falla, la tarea ya está guardada igualmente.
export async function notifyTaskAssigned(taskId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { skipped: "no-session" };

    // Leemos con la sesión del usuario: si no tiene acceso a la tarea, RLS no la devuelve
    const { data: task } = await supabase
      .from("tasks")
      .select("id, title, project_id, assignee_id, assigned_to_client")
      .eq("id", taskId)
      .maybeSingle();
    if (!task || !task.assignee_id || task.assigned_to_client) return { skipped: "no-assignee" };
    if (task.assignee_id === user.id) return { skipped: "self" };

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, client_id")
      .eq("id", task.project_id)
      .maybeSingle();
    if (!project) return { skipped: "no-project" };

    const [{ data: client }, { data: profiles }] = await Promise.all([
      project.client_id
        ? supabase.from("clients").select("name").eq("id", project.client_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("profiles").select("id, full_name").in("id", [user.id, task.assignee_id]),
    ]);
    const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.full_name || "Alguien";

    // El email de la persona asignada vive en auth.users: hace falta el cliente admin
    const admin = createAdminClient();
    const { data: assigneeUser } = await admin.auth.admin.getUserById(task.assignee_id);
    const to = assigneeUser?.user?.email;
    if (!to) return { skipped: "no-email" };

    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "https";
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (host ? `${proto}://${host}` : "");
    const link = `${baseUrl}/projects/${project.id}?tab=tareas`;

    const where = client?.name ? `${client.name} · ${project.name}` : project.name;
    const who = nameOf(user.id);
    const firstName = nameOf(task.assignee_id).split(" ")[0];

    const subject = `Nueva tarea: ${task.title}`;
    const text = `Hola ${firstName},\n\n${who} te ha asignado una tarea en ${where}:\n\n«${task.title}»\n\nÁbrela aquí: ${link}\n\n— Integraly Ops`;
    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1C1C1F">
  <p style="margin:0 0 16px;font-size:15px">Hola ${escapeHtml(firstName)},</p>
  <p style="margin:0 0 16px;font-size:15px;color:#6B6B75"><b style="color:#1C1C1F">${escapeHtml(who)}</b> te ha asignado una tarea en <b style="color:#1C1C1F">${escapeHtml(where)}</b>:</p>
  <div style="border:1px solid #ECECF0;border-radius:12px;padding:16px 18px;margin:0 0 22px;font-size:16px;font-weight:600">${escapeHtml(task.title)}</div>
  <a href="${escapeHtml(link)}" style="display:inline-block;background:#17161F;color:#fff;text-decoration:none;padding:11px 22px;border-radius:99px;font-weight:600;font-size:14px">Abrir la tarea</a>
  <p style="margin:28px 0 0;font-size:12px;color:#9D9DA6">Integraly Ops · Te llega este aviso porque te han asignado una tarea.</p>
</div>`;

    const res = await sendEmail({ to, subject, html, text });
    if (!res.ok && !res.skipped) console.error("notifyTaskAssigned: email no enviado", res.error);
    return res;
  } catch (e) {
    console.error("notifyTaskAssigned", e);
    return { ok: false };
  }
}
