import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    // Salvaguarda: el trigger de la base de datos debería haber creado el
    // perfil al iniciar sesión por primera vez. Si por lo que sea no existe
    // todavía, no hay nada que mostrar en la app.
    redirect("/login?error=no_profile");
  }

  if (!profile.full_name) redirect("/onboarding");

  // Ubicación aproximada según la IP, que Vercel añade a cada petición
  // (no se guarda en ningún sitio). En local no existe y el saludo se adapta.
  const h = await headers();
  const decode = (v: string | null) => {
    try {
      return v ? decodeURIComponent(v) : "";
    } catch {
      return v || "";
    }
  };
  const place = {
    city: decode(h.get("x-vercel-ip-city")),
    country: h.get("x-vercel-ip-country") || "",
  };

  return (
    <AppShell
      me={{
        id: user.id,
        email: user.email || "",
        full_name: profile.full_name,
        role: profile.role,
        place,
      }}
    >
      {children}
    </AppShell>
  );
}
