import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Portal de cliente · Integraly" };

// Portal del cliente: sin el menú del equipo. Entran las personas de los
// clientes (rol cliente) y, para la vista previa, admin y director.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/portal");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/login?error=no_profile");

  return <>{children}</>;
}
