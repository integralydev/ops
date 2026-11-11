import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

// Enlaces de acceso que enviamos nosotros (invitación al portal del cliente):
// llevan un token_hash que se canjea aquí por una sesión.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next") ?? "/portal";
  const next = safeNext(nextParam, "/portal");

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    console.error("[auth/confirm] verifyOtp:", type, error.message);
  }

  // Caducado o ya usado: desde el login se pide uno nuevo con el email
  return NextResponse.redirect(`${origin}/login?error=enlace&next=${encodeURIComponent(next)}`);
}
