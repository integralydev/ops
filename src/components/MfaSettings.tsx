"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";

type Enrolling = { id: string; qr: string; secret: string };

// Ajustes → Verificación en dos pasos (TOTP de Supabase): activarla con una
// app de autenticación. Para Finanzas es obligatoria.
export function MfaSettings() {
  const [active, setActive] = useState<boolean | null>(null);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const { data } = await createClient().auth.mfa.listFactors();
    setActive(!!data?.totp?.some((f) => f.status === "verified"));
  }

  useEffect(() => {
    let alive = true;
    createClient()
      .auth.mfa.listFactors()
      .then(({ data }) => {
        if (alive) setActive(!!data?.totp?.some((f) => f.status === "verified"));
      });
    return () => {
      alive = false;
    };
  }, []);

  async function start() {
    setBusy(true);
    const supabase = createClient();
    // Un alta que se quedó a medias impide empezar otra: se limpia antes
    const { data: factors } = await supabase.auth.mfa.listFactors();
    for (const f of factors?.all || []) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Integraly Ops" });
    setBusy(false);
    if (error || !data) {
      toast("No se pudo empezar: " + (error?.message || ""));
      return;
    }
    setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!enrolling || busy) return;
    setBusy(true);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: enrolling.id, code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) {
      toast("Código incorrecto. Prueba con el que sale ahora en la app.");
      setCode("");
      return;
    }
    toast("Verificación en dos pasos activada");
    setEnrolling(null);
    setCode("");
    refresh();
  }

  return (
    <div className="card">
      <div className="pref-row" style={{ cursor: "default" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pref-label">Verificación en dos pasos</div>
          <div className="pref-hint">
            {active === null
              ? "Comprobando…"
              : active
                ? "Activada ✓. Al entrar en zonas protegidas (Finanzas) se pide el código de tu app."
                : "Un código de una app de autenticación (Google Authenticator, 1Password…) además de la contraseña."}
          </div>
        </div>
        {active === false && !enrolling && (
          <button className="btn btn-sm btn-primary" onClick={start} disabled={busy}>
            {busy ? "…" : "Activar"}
          </button>
        )}
      </div>
      {enrolling && (
        <form className="mfa-enroll" onSubmit={confirm}>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrolling.qr} alt="Código QR para la app de autenticación" width={168} height={168} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <ol className="mfa-steps">
              <li>Abre tu app de autenticación y escanea el código QR.</li>
              <li>
                Si no puedes escanearlo, añade la clave a mano: <code>{enrolling.secret}</code>
              </li>
              <li>Escribe el código de 6 cifras que te muestra:</li>
            </ol>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123 456"
                autoFocus
              />
              <button className="btn btn-primary" disabled={busy || code.replace(/\s/g, "").length < 6}>
                Confirmar
              </button>
              <button type="button" className="btn" onClick={() => setEnrolling(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
