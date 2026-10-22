"use client";

import { useState } from "react";
import { eur0, usd0, type CardLine, type FinPayment, type MonthCard, type Movement } from "@/lib/finance";

type Actions = {
  markPaid: (m: Movement) => void;
  markInvoiced: (m: Movement) => void;
  openInvoice: (id: string) => void;
  openPayment: (p: FinPayment) => void;
  openScheduled: (id: string) => void;
};

const day = (iso: string) => Number(iso.slice(8, 10));
const amount = (l: CardLine) => (l.usd ? usd0(l.usd) : eur0(l.eur));

// "Próximos 60 días": una tarjeta por mes natural (ver monthCards)
export function UpcomingMonths({ cards, showProbable, actions }: { cards: MonthCard[]; showProbable: boolean } & { actions: Actions }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  if (!cards.length) return <div className="empty">Nada previsto en los próximos 60 días.</div>;

  return (
    <div className="fin-months">
      {cards.map((c) => (
        <div key={c.month} className="card fin-month">
          <div className="fin-month-head">
            <b>
              {c.label}
              {c.isCurrent ? " · este mes" : ""}
            </b>
            <span className={c.net < 0 ? "fin-red" : ""}>queda {eur0(c.net)}</span>
          </div>

          <div className="fin-month-block">
            <div className="fin-month-title">
              Entra <span className="fin-in">{eur0(c.inTotal)}</span>
            </div>
            {c.mensualidades.length > 0 && (
              <div className="fin-line">
                <div className="fin-line-main">
                  <span>Mensualidades</span>
                  <span className="fin-line-amount">{eur0(c.mensTotal)}</span>
                </div>
                <div className="fin-chips">
                  {c.mensualidades.map((l) => (
                    <button
                      key={l.key}
                      className={"fin-chip" + (l.done ? " is-done" : "")}
                      title={l.done ? "Cobrada · ver factura" : l.invoice || l.movement?.invoiceId ? "Facturada, pendiente de cobro" : "Pendiente · marcar como facturada"}
                      onClick={() => {
                        const invId = l.invoice?.id || l.movement?.invoiceId;
                        if (invId) actions.openInvoice(invId);
                        else if (l.movement) actions.markInvoiced(l.movement);
                      }}
                    >
                      {l.counterparty || "—"} · día {day(l.date)} · {amount(l)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {c.otherIn.map((l) => (
              <Line key={l.key} l={l} actions={actions} />
            ))}
            {c.inTotal === 0 && <div className="fin-line muted">Nada</div>}
          </div>

          <div className="fin-month-block">
            <div className="fin-month-title">
              Sale <span className="fin-out">{eur0(c.outTotal)}</span>
            </div>
            {c.singleOut.map((l) => (
              <Line key={l.key} l={l} actions={actions} />
            ))}
            {c.groups.map((g) => {
              const k = `${c.month}|${g.id}`;
              const isOpen = open.has(k);
              return (
                <div key={g.id} className="fin-line">
                  <button className="fin-line-main fin-group" onClick={() => toggle(k)} aria-expanded={isOpen}>
                    <span>
                      <span className="fin-caret">{isOpen ? "▾" : "▸"}</span> {g.label}{" "}
                      <span className="muted">· {g.lines.length}</span>
                    </span>
                    <span className="fin-line-amount">{eur0(g.total)}</span>
                  </button>
                  {isOpen && (
                    <div className="fin-group-detail">
                      {g.lines.map((l) => (
                        <Line key={l.key} l={l} actions={actions} nested />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {c.outTotal === 0 && <div className="fin-line muted">Nada</div>}
          </div>

          {showProbable && c.probable.length > 0 && (
            <div className="fin-month-block is-probable">
              <div className="fin-month-title">Probable</div>
              {c.probable.map((l) => (
                <Line key={l.key} l={l} actions={actions} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Line({ l, actions, nested }: { l: CardLine; actions: Actions; nested?: boolean }) {
  const m = l.movement;
  const out = m ? m.direction === "salida" : !!l.payment;
  return (
    <div className={"fin-line" + (nested ? " is-nested" : "")}>
      <div className="fin-line-main">
        <span>
          {l.concept || "—"}
          {l.counterparty && <span className="muted"> · {l.counterparty}</span>}
        </span>
        <span className="fin-line-amount">{amount(l)}</span>
      </div>
      <div className="fin-line-sub">
        <span>día {day(l.date)}</span>
        {l.overdue && <span className="fin-tag is-danger">vencido</span>}
        {l.done && <span className="fin-tag is-done">{out ? "pagado" : "cobrado"}</span>}
        {m?.probable && <span className="fin-tag">{m.probability}%</span>}
        {m?.source === "programado" && m.direction === "salida" && !m.probable && (
          <button className="fin-link" onClick={() => actions.markPaid(m)}>
            Marcar pagado
          </button>
        )}
        {m && m.direction === "entrada" && m.source !== "factura" && (
          <button className="fin-link" onClick={() => actions.markInvoiced(m)}>
            Facturado
          </button>
        )}
        {(l.invoice || m?.invoiceId) && (
          <button className="fin-link" onClick={() => actions.openInvoice((l.invoice?.id || m?.invoiceId)!)}>
            Ver
          </button>
        )}
        {l.payment && (
          <button className="fin-link" onClick={() => actions.openPayment(l.payment!)}>
            Ver
          </button>
        )}
        {m?.scheduledId && (
          <button className="fin-link" onClick={() => actions.openScheduled(m.scheduledId!)}>
            Editar
          </button>
        )}
      </div>
    </div>
  );
}
