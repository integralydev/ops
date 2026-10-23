"use server";

import { headers } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { escapeHtml, sendEmail } from "@/lib/email";

// Dirección pública de la app (para los enlaces de los emails)
async function appBaseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
  return process.env.NEXT_PUBLIC_APP_URL || (host ? `${proto}://${host}` : "");
}

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
      supabase.from("profiles").select("id, full_name, notify_task_assigned").in("id", [user.id, task.assignee_id]),
    ]);
    const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.full_name || "Alguien";
    // La persona puede haber apagado este aviso en Ajustes
    if (profiles?.find((p) => p.id === task.assignee_id)?.notify_task_assigned === false) return { skipped: "opted-out" };

    // El email de la persona asignada vive en auth.users: hace falta el cliente admin
    const admin = createAdminClient();
    const { data: assigneeUser } = await admin.auth.admin.getUserById(task.assignee_id);
    const to = assigneeUser?.user?.email;
    if (!to) return { skipped: "no-email" };

    const link = `${await appBaseUrl()}/projects/${project.id}?tab=tareas&tarea=${task.id}`;

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
  <p style="margin:28px 0 0;font-size:12px;color:#9D9DA6">Integraly Ops · Te llega este aviso porque te han asignado una tarea. Puedes apagarlo en Ajustes.</p>
</div>`;

    const res = await sendEmail({ to, subject, html, text });
    if (!res.ok && !res.skipped) console.error("notifyTaskAssigned: email no enviado", res.error);
    return res;
  } catch (e) {
    console.error("notifyTaskAssigned", e);
    return { ok: false };
  }
}

// Avisa por email de un comentario nuevo en una tarea a quien está metido en
// ella: la persona asignada, quien la creó y quien ya ha comentado. Nunca a
// quien escribe, ni a quien haya apagado este aviso en Ajustes. Se llama
// justo después de comentar; nunca lanza errores.
export async function notifyTaskComment(commentId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { skipped: "no-session" };

    // Con la sesión de quien comenta: RLS solo devuelve lo que puede ver
    const { data: comment } = await supabase
      .from("task_comments")
      .select("id, task_id, project_id, author_id, text")
      .eq("id", commentId)
      .maybeSingle();
    if (!comment || comment.author_id !== user.id) return { skipped: "no-comment" };

    const [{ data: task }, { data: project }, { data: others }] = await Promise.all([
      supabase.from("tasks").select("id, title, assignee_id, created_by").eq("id", comment.task_id).maybeSingle(),
      supabase.from("projects").select("id, name, client_id").eq("id", comment.project_id).maybeSingle(),
      supabase.from("task_comments").select("author_id").eq("task_id", comment.task_id),
    ]);
    if (!task || !project) return { skipped: "no-task" };

    const involved = new Set<string>(
      [task.assignee_id, task.created_by, ...(others || []).map((c) => c.author_id)].filter(
        (id): id is string => !!id && id !== user.id,
      ),
    );
    if (!involved.size) return { skipped: "nobody" };

    const [{ data: client }, { data: profiles }] = await Promise.all([
      project.client_id
        ? supabase.from("clients").select("name").eq("id", project.client_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("profiles").select("id, full_name, notify_task_comments").in("id", [user.id, ...involved]),
    ]);
    const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.full_name || "Alguien";
    const recipients = [...involved].filter((id) => profiles?.find((p) => p.id === id)?.notify_task_comments !== false);
    if (!recipients.length) return { skipped: "opted-out" };

    const link = `${await appBaseUrl()}/projects/${project.id}?tab=tareas&tarea=${task.id}`;
    const where = client?.name ? `${client.name} · ${project.name}` : project.name;
    const who = nameOf(user.id);
    const quote = comment.text.length > 600 ? comment.text.slice(0, 600) + "…" : comment.text;

    // Los emails viven en auth.users: hace falta el cliente admin
    const admin = createAdminClient();
    let sent = 0;
    for (const id of recipients) {
      const { data: u } = await admin.auth.admin.getUserById(id);
      const to = u?.user?.email;
      if (!to) continue;
      const firstName = nameOf(id).split(" ")[0];
      const subject = `${who.split(" ")[0]} ha comentado en «${task.title}»`;
      const text = `Hola ${firstName},\n\n${who} ha comentado en la tarea «${task.title}» (${where}):\n\n${quote}\n\nResponde aquí: ${link}\n\n— Integraly Ops`;
      const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1C1C1F">
  <p style="margin:0 0 16px;font-size:15px">Hola ${escapeHtml(firstName)},</p>
  <p style="margin:0 0 12px;font-size:15px;color:#6B6B75"><b style="color:#1C1C1F">${escapeHtml(who)}</b> ha comentado en la tarea <b style="color:#1C1C1F">«${escapeHtml(task.title)}»</b> <span style="color:#9D9DA6">(${escapeHtml(where)})</span>:</p>
  <div style="border-left:3px solid #7467D3;background:#F7F7F9;border-radius:8px;padding:12px 16px;margin:0 0 22px;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(quote)}</div>
  <a href="${escapeHtml(link)}" style="display:inline-block;background:#17161F;color:#fff;text-decoration:none;padding:11px 22px;border-radius:99px;font-weight:600;font-size:14px">Abrir la tarea</a>
  <p style="margin:28px 0 0;font-size:12px;color:#9D9DA6">Integraly Ops · Te llega porque estás en esta tarea. Puedes apagar estos avisos en Ajustes.</p>
</div>`;
      const res = await sendEmail({ to, subject, html, text });
      if (res.ok) sent++;
      else if (!res.skipped) console.error("notifyTaskComment: email no enviado", res.error);
    }
    return { ok: true, sent };
  } catch (e) {
    console.error("notifyTaskComment", e);
    return { ok: false };
  }
}

// Avisa por email de una actualización nueva a quien sigue el proyecto (el
// ojo de la pestaña Actualizaciones). Nunca a quien publica ni a quien ya no
// tiene acceso al proyecto (lo decide project_update_recipients en la base de
// datos). Se llama justo después de publicar; nunca lanza errores.
export async function notifyProjectUpdate(noteId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { skipped: "no-session" };

    // Con la sesión de quien publica: RLS solo devuelve lo que puede ver
    const { data: note } = await supabase
      .from("notes")
      .select("id, project_id, author_id, text, image_paths")
      .eq("id", noteId)
      .maybeSingle();
    if (!note || note.author_id !== user.id) return { skipped: "no-note" };

    const [{ data: project }, { data: followers }] = await Promise.all([
      supabase.from("projects").select("id, name, client_id").eq("id", note.project_id).maybeSingle(),
      supabase.rpc("project_update_recipients", { pid: note.project_id }),
    ]);
    const recipients = ((followers || []) as string[]).filter((id) => id !== user.id);
    if (!project || !recipients.length) return { skipped: "nobody" };

    const [{ data: client }, { data: profiles }] = await Promise.all([
      project.client_id
        ? supabase.from("clients").select("name").eq("id", project.client_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("profiles").select("id, full_name").in("id", [user.id, ...recipients]),
    ]);
    const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.full_name || "Alguien";

    const link = `${await appBaseUrl()}/projects/${project.id}?tab=actualizaciones`;
    const where = client?.name ? `${client.name} · ${project.name}` : project.name;
    const who = nameOf(user.id);
    const body = note.text.length > 1200 ? note.text.slice(0, 1200) + "…" : note.text;
    const nImages = (note.image_paths || []).length;
    const imagesTxt = nImages ? (nImages === 1 ? "Incluye 1 captura." : `Incluye ${nImages} capturas.`) : "";

    // Los emails viven en auth.users: hace falta el cliente admin
    const admin = createAdminClient();
    let sent = 0;
    for (const id of recipients) {
      const { data: u } = await admin.auth.admin.getUserById(id);
      const to = u?.user?.email;
      if (!to) continue;
      const firstName = nameOf(id).split(" ")[0];
      const subject = `Actualización en ${where}`;
      const text = `Hola ${firstName},\n\n${who} ha publicado una actualización en ${where}:\n\n${body}${imagesTxt ? `\n\n${imagesTxt}` : ""}\n\nÁbrela aquí: ${link}\n\n— Integraly Ops`;
      const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1C1C1F">
  <p style="margin:0 0 16px;font-size:15px">Hola ${escapeHtml(firstName)},</p>
  <p style="margin:0 0 12px;font-size:15px;color:#6B6B75"><b style="color:#1C1C1F">${escapeHtml(who)}</b> ha publicado una actualización en <b style="color:#1C1C1F">${escapeHtml(where)}</b>:</p>
  ${body ? `<div style="border-left:3px solid #7467D3;background:#F7F7F9;border-radius:8px;padding:12px 16px;margin:0 0 ${imagesTxt ? 10 : 22}px;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(body)}</div>` : ""}
  ${imagesTxt ? `<p style="margin:0 0 22px;font-size:13px;color:#9D9DA6">🖼️ ${imagesTxt}</p>` : ""}
  <a href="${escapeHtml(link)}" style="display:inline-block;background:#17161F;color:#fff;text-decoration:none;padding:11px 22px;border-radius:99px;font-weight:600;font-size:14px">Ver la actualización</a>
  <p style="margin:28px 0 0;font-size:12px;color:#9D9DA6">Integraly Ops · Te llega porque sigues este proyecto. Para dejar de recibirlo, quita el ojo en su pestaña Actualizaciones.</p>
</div>`;
      const res = await sendEmail({ to, subject, html, text });
      if (res.ok) sent++;
      else if (!res.skipped) console.error("notifyProjectUpdate: email no enviado", res.error);
    }
    return { ok: true, sent };
  } catch (e) {
    console.error("notifyProjectUpdate", e);
    return { ok: false };
  }
}
