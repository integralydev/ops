import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalView } from "@/components/portal/PortalView";
import type { PortalHome } from "@/lib/portal";

export const dynamic = "force-dynamic";

// Vista previa para el equipo (admin y director): el portal tal y como lo ve
// ese cliente. La base de datos solo la devuelve a admin y director.
export default async function PortalPreviewPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_home", { p_client: clientId });
  const home = data as PortalHome | null;
  if (!home?.client) redirect("/dashboard");
  return <PortalView data={home} />;
}
