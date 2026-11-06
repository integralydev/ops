"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "link" | "reset";

function friendlyError(message: string) {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "Email o contraseña incorrectos. Si todavía no has creado una contraseña, entra con un enlace por email.";
  }
  if (m.includes("signups not allowed")) {
    return "No podemos enviar un enlace a este email: o no ha sido invitado, o la invitación está pendiente. Pide a un administrador que te vuelva a añadir desde Equipo.";
  }
  if (m.includes("rate limit") || m.includes("only request this after")) {
    return "Se han pedido demasiados emails seguidos. Espera un poco (hasta una hora si has pedido varios) e inténtalo de nuevo.";
  }
  if (m.includes("email not confirmed")) {
    return "Tu email todavía no está confirmado. Entra una vez con un enlace por email.";
  }
  return message;
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";
  const linkFailed = params.get("error") === "auth";
  // Enlace del portal del cliente caducado o ya usado: se pide uno nuevo
  const portalLinkFailed = params.get("error") === "enlace";

  const [mode, setMode] = useState<Mode>(portalLinkFailed ? "link" : "password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    linkFailed || portalLinkFailed ? "error" : "idle",
  );
  const [errorMsg, setErrorMsg] = useState(
    portalLinkFailed
      ? "El enlace ha caducado o ya se ha usado. Escribe tu email y te enviamos uno nuevo. / L'enllaç ha caducat o ja s'ha fet servir: escriu el teu email i te n'enviem un de nou."
      : linkFailed
      ? "El enlace no es válido o ha caducado. Suele pasar si lo abres en otro navegador o dispositivo distinto al que lo pidió. Entra con tu contraseña o pide un enlace nuevo."
      : "",
  );

  function switchMode(m: Mode) {
    setMode(m);
    setStatus("idle");
    setErrorMsg("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    setErrorMsg("");
    const supabase = createClient();

    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setStatus("error");
        setErrorMsg(friendlyError(error.message));
        return;
      }
      router.replace(next);
      router.refresh();
      return;
    }

    const { error } =
      mode === "link"
        ? await supabase.auth.signInWithOtp({
            email: email.trim(),
            options: {
              shouldCreateUser: false,
              emailRedirectTo: `${window.location.origin}/auth/callback${nextParam ? `?next=${encodeURIComponent(next)}` : ""}`,
            },
          })
        : await supabase.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: `${window.location.origin}/auth/callback?next=/set-password`,
          });
    if (error) {
      setStatus("error");
      setErrorMsg(friendlyError(error.message));
      return;
    }
    setStatus("sent");
  }

  const linkStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    color: "var(--accent)",
    fontSize: 12.8,
    fontWeight: 600,
  };

  return (
    <div className="center-screen">
      <div className="card center-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-integraly.png" alt="Integraly" className="theme-light-only" style={{ height: 20, width: "auto", margin: "0 auto 22px", display: "block" }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-integraly-dark.png" alt="Integraly" className="theme-dark-only" style={{ height: 20, width: "auto", margin: "0 auto 22px", display: "block" }} />
        {status === "sent" ? (
          <>
            <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 16 }}>
              Te hemos enviado un enlace a <b>{email}</b>. Ábrelo en <b>este mismo navegador</b>{" "}
              (no desde la app del correo) para que funcione.
            </p>
            <button type="button" style={linkStyle} onClick={() => switchMode("password")}>
              ← Volver
            </button>
          </>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 18 }}>
              {mode === "password" && "Entra con tu email y contraseña."}
              {mode === "link" &&
                "Te enviaremos un enlace para entrar sin contraseña. Úsalo la primera vez, y luego crea tu contraseña."}
              {mode === "reset" && "Te enviaremos un enlace para crear una contraseña nueva."}
            </p>
            <form onSubmit={handleSubmit}>
              <div className="field" style={{ textAlign: "left" }}>
                <input
                  type="email"
                  required
                  placeholder="tu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                />
              </div>
              {mode === "password" && (
                <div className="field" style={{ textAlign: "left" }}>
                  <input
                    type="password"
                    required
                    placeholder="Contraseña"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
              )}
              {status === "error" && (
                <p style={{ color: "var(--danger)", fontSize: 12.6, marginBottom: 12, textAlign: "left" }}>
                  {errorMsg}
                </p>
              )}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={status === "sending"}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {status === "sending"
                  ? mode === "password"
                    ? "Entrando…"
                    : "Enviando…"
                  : mode === "password"
                    ? "Entrar"
                    : mode === "link"
                      ? "Enviar enlace de acceso"
                      : "Enviar enlace para cambiar contraseña"}
              </button>
            </form>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16, alignItems: "center" }}
            >
              {mode === "password" ? (
                <>
                  <button type="button" style={linkStyle} onClick={() => switchMode("reset")}>
                    ¿Has olvidado tu contraseña?
                  </button>
                  <button type="button" style={linkStyle} onClick={() => switchMode("link")}>
                    Primera vez / entrar con enlace por email
                  </button>
                </>
              ) : (
                <button type="button" style={linkStyle} onClick={() => switchMode("password")}>
                  ← Entrar con contraseña
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
