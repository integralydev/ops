import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalView } from "@/components/portal/PortalView";
import type { PortalHome } from "@/lib/portal";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/portal");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  // El equipo no tiene portal propio: su sitio es el OPS
  if (profile?.role !== "cliente") redirect("/dashboard");

  const { data } = await supabase.rpc("portal_home");
  const home = data as PortalHome | null;
  if (!home?.client) {
    return (
      <div className="center-screen">
        <div className="card center-card">
          <p className="muted">
            Tu acceso todavía no está listo. Escríbenos a hello@integralyaisolutions.com.
          </p>
        </div>
      </div>
    );
  }
  return <PortalView data={home} />;
}
