"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Antes de mostrar Finanzas, la sesión tiene que estar verificada en dos
// pasos (aal2). Si la cuenta tiene el segundo paso activado, pide el código;
// si no, explica cómo activarlo. Sin aal2 la base de datos tampoco devuelve
// nada (RLS), esto es solo la puerta amable.
export function MfaGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "ok" | "code" | "enroll">("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!alive) return;
      if (aal?.currentLevel === "aal2") return setState("ok");
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.find((f) => f.status === "verified");
      if (!alive) return;
      if (totp) {
        setFactorId(totp.id);
        setState("code");
      } else setState("enroll");
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || busy) return;
    setBusy(true);
    setError("");
    const { error: err } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
    setBusy(false);
    if (err) {
      setError("Código incorrecto o caducado. Prueba con el que sale ahora en la app.");
      setCode("");
      return;
    }
    setState("ok");
  }

  if (state === "ok") return <>{children}</>;

  return (
    <div className="content" style={{ maxWidth: 460 }}>
      <div className="card pad" style={{ marginTop: 40, textAlign: "center" }}>
        <div style={{ fontSize: 34, marginBottom: 10 }}>🔐</div>
        {state === "loading" && <div className="muted">Comprobando…</div>}
        {state === "code" && (
          <form onSubmit={verify}>
            <h3 style={{ fontSize: 17, marginBottom: 6 }}>Verificación en dos pasos</h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              Escribe el código de 6 cifras de tu app de autenticación para entrar en Finanzas.
            </p>
            <input
              className="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123 456"
            />
            {error && <div className="links-error" style={{ marginTop: 8 }}>{error}</div>}
            <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy || code.replace(/\s/g, "").length < 6}>
              {busy ? "Comprobando…" : "Entrar"}
            </button>
          </form>
        )}
        {state === "enroll" && (
          <>
            <h3 style={{ fontSize: 17, marginBottom: 6 }}>Activa la verificación en dos pasos</h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              Finanzas solo se abre con el segundo paso activado. Se configura una vez, en Ajustes, con una app como Google
              Authenticator o 1Password.
            </p>
            <Link href="/ajustes" className="btn btn-primary">
              Ir a Ajustes
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
