import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/_next") ||
    path.startsWith("/favicon");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // El rol comercial solo usa la sección Comercial, y Comercial es solo de
  // admin y comercial. Es comodidad de navegación: la protección real está
  // en la base de datos (RLS).
  const appSection = /^\/(dashboard|projects|clients|team|comercial)(\/|$)/.test(path) || path === "/";
  if (user && appSection) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = profile?.role;
    const inSales = path === "/comercial" || path.startsWith("/comercial/");
    // Al redirigir se conservan las cookies de sesión que Supabase acabe de renovar
    const redirectTo = (pathname: string) => {
      const url = request.nextUrl.clone();
      url.pathname = pathname;
      url.search = "";
      const res = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
      return res;
    };
    if (role === "comercial" && !inSales) return redirectTo("/comercial");
    if (inSales && role && role !== "admin" && role !== "comercial") return redirectTo("/dashboard");
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
