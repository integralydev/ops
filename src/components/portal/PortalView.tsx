"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { createClient } from "@/lib/supabase/client";
import { portalFileUrl, portalInvoiceUrl } from "@/app/portal/actions";
import {
  CONTACT_EMAIL,
  PORTAL_PATH,
  SIGNED_STATUSES,
  T,
  portalStep,
  referralLink,
  type PortalBilling,
  type PortalFile,
  type PortalHome,
  type PortalInvoice,
  type PortalProject,
} from "@/lib/portal";

type Texts = (typeof T)["es"] | (typeof T)["ca"];

function fmtDay(iso: string, lang: "es" | "ca") {
  return new Date(iso).toLocaleDateString(lang === "ca" ? "ca-ES" : "es-ES", { day: "numeric", month: "short", year: "numeric" });
}

function fmtSize(n: number | null) {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function PortalView({ data }: { data: PortalHome }) {
  const lang = data.client.lang === "ca" ? "ca" : "es";
  const t = T[lang];
  const router = useRouter();
  const firstName = (data.me || "").split(" ")[0];
  const signed = data.projects.some((p) => SIGNED_STATUSES.includes(p.status));
  const many = data.projects.length > 1;

  // Con varios proyectos: null = visión general; si no, el id del proyecto.
  // Va en la URL (?p=) para que el botón de volver del navegador funcione.
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (!many) return;
    const read = () => {
      const id = new URLSearchParams(window.location.search).get("p");
      setSel(id && data.projects.some((p) => p.id === id) ? id : null);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [many, data.projects]);

  function go(id: string | null) {
    setSel(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("p", id);
    else url.searchParams.delete("p");
    window.history.pushState(null, "", url.toString());
    window.scrollTo({ top: 0 });
  }

  // Orden de las pestañas: visión general y luego cada proyecto
  const order: (string | null)[] = [null, ...data.projects.map((p) => p.id)];
  function step(d: 1 | -1) {
    const i = order.indexOf(sel);
    go(order[(i + d + order.length) % order.length]);
  }

  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const current = many ? data.projects.find((p) => p.id === sel) || null : data.projects[0] || null;
  const billing = data.billing;
  const hasBilling = !!billing && (billing.invoices.length > 0 || billing.fees.length > 0);

  return (
    <div className="portal">
      <header className="portal-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-integraly.png" alt="Integraly" className="portal-logo theme-light-only" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-integraly-dark.png" alt="Integraly" className="portal-logo theme-dark-only" />
        <div className="portal-top-right">
          <span className="portal-client">{data.client.name}</span>
          {data.preview ? (
            <Link href="/clients" className="btn btn-sm">
              {T.es.back}
            </Link>
          ) : (
            <button className="btn btn-sm" onClick={logout}>
              <Icon name="logout" size={15} /> {t.logout}
            </button>
          )}
        </div>
      </header>

      {data.preview && <div className="portal-preview">{T.es.preview}</div>}

      <main className="portal-main">
        <div className="portal-hello">
          <h1>{firstName && !data.preview ? t.hello(firstName) : t.helloNoName}</h1>
          <p>{many ? t.introMany : t.intro}</p>
        </div>

        {many && (
          <nav className="portal-tabs" aria-label={t.overview}>
            <div className="portal-tabs-list" role="tablist">
              {order.map((id) => {
                const p = data.projects.find((x) => x.id === id);
                return (
                  <button
                    key={id || "all"}
                    role="tab"
                    aria-selected={sel === id}
                    className={"portal-tab" + (sel === id ? " on" : "")}
                    onClick={() => go(id)}
                  >
                    {p ? p.name : t.overview}
                  </button>
                );
              })}
            </div>
            <div className="portal-tabs-arrows">
              <button className="btn btn-sm portal-arrow" aria-label={t.prev} onClick={() => step(-1)}>
                <Icon name="arrow" size={16} />
              </button>
              <button className="btn btn-sm portal-arrow next" aria-label={t.nextProject} onClick={() => step(1)}>
                <Icon name="arrow" size={16} />
              </button>
            </div>
          </nav>
        )}

        {data.projects.length === 0 ? (
          <div className="card pad portal-empty">{t.empty}</div>
        ) : many && !current ? (
          <Overview data={data} t={t} lang={lang} go={go} />
        ) : current ? (
          <ProjectBlock key={current.id} p={current} t={t} lang={lang} title={many ? current.name : null} />
        ) : null}

        {/* Facturas: en la visión general (o con un solo proyecto) todas; dentro de un proyecto, las suyas */}
        {hasBilling && billing && (!many || !current) && <Billing b={billing} t={t} lang={lang} title={t.billing} />}
        {hasBilling && billing && many && current && (
          <ProjectBilling b={billing} projectId={current.id} t={t} lang={lang} />
        )}

        {signed && data.client.referral_code && (!many || !current) && (
          <Referral code={data.client.referral_code} t={t} />
        )}

        <p className="portal-foot">
          {t.questions} <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </main>
    </div>
  );
}

function phaseName(status: string, lang: "es" | "ca") {
  const at = portalStep(status);
  return at >= 0 ? PORTAL_PATH[at][lang] : "";
}

function Overview({
  data,
  t,
  lang,
  go,
}: {
  data: PortalHome;
  t: Texts;
  lang: "es" | "ca";
  go: (id: string) => void;
}) {
  return (
    <>
      <section className="card pad portal-steps">
        <div className="portal-h3">
          <span className="ico ico-sm ico-p">
            <Icon name="flag" size={16} />
          </span>
          {t.nextSteps}
        </div>
        {data.projects.map((p) => (
          <button key={p.id} className="portal-step-row" onClick={() => go(p.id)}>
            <span className="portal-step-proj">{p.name}</span>
            <span className={"portal-step-text" + (p.next_step ? "" : " muted")}>{p.next_step || t.nextEmpty}</span>
            <Icon name="arrow" size={16} />
          </button>
        ))}
      </section>

      <div className="portal-cards">
        {data.projects.map((p) => {
          const at = portalStep(p.status);
          return (
            <button key={p.id} className="card pad portal-pcard" onClick={() => go(p.id)}>
              <div className="portal-pcard-head">
                <span className="portal-pcard-name">{p.name}</span>
                <span className="portal-phase">{phaseName(p.status, lang)}</span>
              </div>
              <div className="portal-progress" aria-hidden>
                {PORTAL_PATH.map((s, i) => (
                  <span key={s.value} className={i < at ? "done" : i === at ? "now" : ""} />
                ))}
              </div>
              <span className="muted portal-small">
                {t.updated} {fmtDay(p.updated_at, lang)}
              </span>
              <span className="portal-pcard-go">
                {t.seeProject} <Icon name="arrow" size={15} />
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function ProjectBlock({ p, t, lang, title }: { p: PortalProject; t: Texts; lang: "es" | "ca"; title: string | null }) {
  const at = portalStep(p.status);
  return (
    <section className="portal-project">
      {title && (
        <div className="portal-project-head">
          <h2 className="portal-project-name">{title}</h2>
          <span className="portal-phase">{phaseName(p.status, lang)}</span>
        </div>
      )}

      <div className="card pad">
        <div className="next-hero portal-next">
          <div className="ico ico-p">
            <Icon name="flag" size={20} />
          </div>
          <div className="next-body">
            <div className="next-label">{t.next}</div>
            <div className={"portal-next-text" + (p.next_step ? "" : " muted")}>{p.next_step || t.nextEmpty}</div>
          </div>
        </div>
      </div>

      <div className="card pad journey">
        <div className="journey-head">
          <h2>{t.phase}</h2>
          <span className="muted portal-updated">
            {t.updated} {fmtDay(p.updated_at, lang)}
          </span>
        </div>
        <div className="stepper">
          {PORTAL_PATH.map((s, i) => {
            const c = i < at ? "done" : i === at ? "now" : "";
            return (
              <div key={s.value} className={"st " + c}>
                <div className="c">{c === "done" ? <Icon name="check" size={15} /> : i + 1}</div>
                {s[lang]}
              </div>
            );
          })}
        </div>
      </div>

      <div className="portal-two">
        <div className="card pad">
          <div className="portal-h3">
            <span className="ico ico-sm ico-in">
              <Icon name="file" size={16} />
            </span>
            {t.docs}
          </div>
          {p.files.length === 0 ? (
            <div className="muted portal-small">{t.docsEmpty}</div>
          ) : (
            p.files.map((f) => <FileRow key={f.id} f={f} t={t} lang={lang} />)
          )}
        </div>

        <div className="card pad">
          <div className="portal-h3">
            <span className="ico ico-sm ico-ok">
              <Icon name="users" size={16} />
            </span>
            {t.team}
          </div>
          {p.team.map((m) => (
            <div className="portal-person" key={m.id}>
              <Avatar id={m.id} name={m.name || ""} size={34} color={m.color || undefined} />
              <div>
                <div className="portal-person-name">{m.name}</div>
                <div className="muted portal-small">{m.lead ? t.lead : t.contact}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Facturas y cuota de un solo proyecto (si la base de datos ya dice de qué proyecto es cada una). */
function ProjectBilling({ b, projectId, t, lang }: { b: PortalBilling; projectId: string; t: Texts; lang: "es" | "ca" }) {
  const known = b.invoices.some((i) => i.project_id !== undefined);
  if (!known) return null;
  const mine: PortalBilling = {
    invoices: b.invoices.filter((i) => i.project_id === projectId),
    fees: b.fees.filter((f) => f.project_id === projectId),
  };
  if (mine.invoices.length === 0 && mine.fees.length === 0) {
    return (
      <section className="card pad portal-billing">
        <div className="portal-h3">
          <span className="ico ico-sm ico-p">
            <Icon name="file" size={16} />
          </span>
          {t.projectBilling}
        </div>
        <div className="muted portal-small">{t.projectInvoicesEmpty}</div>
      </section>
    );
  }
  return <Billing b={mine} t={t} lang={lang} title={t.projectBilling} />;
}

function fmtMoney(inv: { eur: number; usd: number | null }, lang: "es" | "ca") {
  void lang; // mismo formato en los dos idiomas: 1.621,58
  // A mano: toLocaleString("es-ES") no pone el punto en 4 cifras (1621,58)
  const n = (v: number) => {
    const [int, dec] = (Math.round(v * 100) / 100).toFixed(v % 1 ? 2 : 0).split(".");
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (dec ? "," + dec : "");
  };
  const v = Number(inv.usd != null ? inv.usd : inv.eur);
  const sign = v < 0 ? "−" : "";
  return inv.usd != null ? `${sign}$${n(Math.abs(v))}` : `${sign}${n(Math.abs(v))} €`;
}

/** Concepto legible: las facturas de Stripe llegan como "1 × Producto (at €350.00 / month)". */
function cleanConcept(c: string) {
  return c
    .replace(/^\d+\s*×\s*/, "")
    .replace(/\s*\(at [^)]*\)\s*$/i, "")
    .replace(/\s*\(Stripe\)\s*$/i, "")
    .trim();
}

function Billing({ b, t, lang, title }: { b: PortalBilling; t: Texts; lang: "es" | "ca"; title: string }) {
  const pending = b.invoices.filter((i) => i.status === "pendiente" || i.status === "parcial");
  return (
    <section className="card pad portal-billing">
      <div className="portal-h3">
        <span className="ico ico-sm ico-p">
          <Icon name="file" size={16} />
        </span>
        {title}
      </div>

      <div className="portal-bill-sum">
        <div>
          <div className="next-label">{t.pendingTitle}</div>
          {pending.length === 0 ? (
            <div className="portal-small">{t.pendingNone}</div>
          ) : (
            <>
              {pending.map((i) => (
                <div key={i.id} className="portal-bill-line">
                  <b>{fmtMoney(i, lang)}</b>{" "}
                  <span className="muted">
                    · {i.number} · {fmtDay(i.date, lang)}
                  </span>
                </div>
              ))}
              <div className="muted portal-small">{t.payNote}</div>
            </>
          )}
        </div>
        {b.fees.length > 0 && (
          <div>
            <div className="next-label">{t.fee}</div>
            {b.fees.map((f, k) => (
              <div key={k} className="portal-bill-line">
                <b>{fmtMoney({ eur: f.eur, usd: null }, lang)}</b>
                <span className="muted">{t.perMonth}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="next-label" style={{ marginTop: 18 }}>
        {t.invoices}
      </div>
      {b.invoices.length === 0 ? (
        <div className="muted portal-small">{t.invoicesEmpty}</div>
      ) : (
        b.invoices.map((i) => <InvoiceRow key={i.id} i={i} t={t} lang={lang} />)
      )}
    </section>
  );
}

function InvoiceRow({ i, t, lang }: { i: PortalInvoice; t: Texts; lang: "es" | "ca" }) {
  const [opening, setOpening] = useState(false);
  async function open() {
    // La pestaña se abre ya (si no, el navegador la bloquea) y luego se le pone la URL
    const win = window.open("", "_blank");
    setOpening(true);
    const r = await portalInvoiceUrl(i.id);
    setOpening(false);
    if ("url" in r && r.url) {
      if (win) win.location.href = r.url;
      else window.location.href = r.url;
    } else win?.close();
  }
  return (
    <div className="portal-invoice">
      <div className="portal-file-body">
        <div className="portal-file-name">{cleanConcept(i.concept || "") || i.number}</div>
        <div className="muted portal-small">
          {i.number} · {fmtDay(i.date, lang)}
        </div>
      </div>
      <span className="portal-inv-amount">{fmtMoney(i, lang)}</span>
      <span className={"portal-inv-st st-" + i.status}>{t.st[i.status]}</span>
      {i.pdf ? (
        <button className="btn btn-sm" onClick={open} disabled={opening}>
          {opening ? t.opening : t.download}
        </button>
      ) : (
        <span className="portal-inv-nopdf" />
      )}
    </div>
  );
}

function FileRow({ f, t, lang }: { f: PortalFile; t: Texts; lang: "es" | "ca" }) {
  const [opening, setOpening] = useState(false);
  async function open() {
    // La pestaña se abre ya (si no, el navegador la bloquea) y luego se le pone la URL
    const win = window.open("", "_blank");
    setOpening(true);
    const r = await portalFileUrl(f.id);
    setOpening(false);
    if ("url" in r && r.url) {
      if (win) win.location.href = r.url;
      else window.location.href = r.url;
    } else win?.close();
  }
  return (
    <div className="portal-file">
      <Icon name="file" size={18} />
      <div className="portal-file-body">
        <div className="portal-file-name">{f.name}</div>
        <div className="muted portal-small">
          {fmtDay(f.at, lang)}
          {f.size ? ` · ${fmtSize(f.size)}` : ""}
        </div>
      </div>
      <button className="btn btn-sm" onClick={open} disabled={opening}>
        {opening ? t.opening : t.open}
      </button>
    </div>
  );
}

function Referral({ code, t }: { code: string; t: Texts }) {
  const [copied, setCopied] = useState(false);
  const link = referralLink(code);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* sin permiso de portapapeles: el enlace se puede seleccionar a mano */
    }
  }
  return (
    <section className="portal-refer">
      <p className="portal-refer-text">
        <Icon name="spark" size={15} /> {t.referShort}
      </p>
      <div className="portal-refer-link">
        <code>{link}</code>
        <button className="btn btn-sm" onClick={copy}>
          {copied ? (
            <>
              <Icon name="check" size={15} /> {t.copied}
            </>
          ) : (
            t.copy
          )}
        </button>
      </div>
    </section>
  );
}
