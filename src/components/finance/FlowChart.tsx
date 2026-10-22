"use client";

import { useEffect, useRef, useState } from "react";
import { eur0, type MonthFlow } from "@/lib/finance";

// Línea del tiempo de Finanzas: meses reales y previstos en un solo eje.
// Entradas hacia arriba, salidas hacia abajo, neto como línea. Lo probable va
// rayado y aparte (ponderado), y su neto en otra línea discontinua: la línea
// continua (la que decide si se puede gastar) es solo lo confirmado.
const W = 780;
const H = 300;
const PAD = { l: 52, r: 14, t: 26, b: 34 };

const niceStep = (max: number) => {
  const raw = max / 3;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || raw;
};
const kLabel = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })}k€` : `${v}€`);

export function FlowChart({ rows, showProbable }: { rows: MonthFlow[]; showProbable: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const curIdx = rows.findIndex((r) => r.isCurrent);

  // En móvil el gráfico se desplaza en horizontal: arranca en el mes actual
  useEffect(() => {
    const el = wrap.current;
    if (el && curIdx > 0 && el.scrollWidth > el.clientWidth) el.scrollLeft = (el.scrollWidth * (curIdx - 1)) / rows.length;
  }, [curIdx, rows.length]);

  if (!rows.length) return null;

  const up = Math.max(1, ...rows.map((r) => r.inConfirmed + (showProbable ? r.inProbable : 0)), ...rows.map((r) => r.net));
  const down = Math.max(1, ...rows.map((r) => r.outConfirmed + (showProbable ? r.outProbable : 0)), ...rows.map((r) => -r.net));
  const step = niceStep(Math.max(up, down));
  const top = Math.ceil(up / step) * step;
  const bottom = -Math.ceil(down / step) * step;
  const y = (v: number) => PAD.t + ((top - v) / (top - bottom)) * (H - PAD.t - PAD.b);
  const n = rows.length;
  const cw = (W - PAD.l - PAD.r) / n;
  const bw = Math.min(18, cw * 0.28);
  const cx = (i: number) => PAD.l + cw * i + cw / 2;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + 0.001; v += step) ticks.push(Math.round(v));

  const line = (key: "net" | "netWithProbable") => rows.map((r, i) => `${cx(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(" ");
  const h = hover != null ? rows[hover] : null;

  return (
    <div className="flow-wrap" ref={wrap}>
      <div className="flow">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Entradas, salidas y neto por mes, reales y previstos">
          <defs>
            <pattern id="flow-hatch-in" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" className="flow-in-soft" />
              <line x1="0" y1="0" x2="0" y2="5" className="flow-in-stroke" strokeWidth="2" />
            </pattern>
            <pattern id="flow-hatch-out" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" className="flow-out-soft" />
              <line x1="0" y1="0" x2="0" y2="5" className="flow-out-stroke" strokeWidth="2" />
            </pattern>
          </defs>

          {/* Zona de previsión */}
          {curIdx >= 0 && (
            <>
              <rect x={PAD.l + cw * curIdx} y={PAD.t - 18} width={W - PAD.r - (PAD.l + cw * curIdx)} height={H - PAD.t - PAD.b + 18} className="flow-future" />
              <text x={PAD.l + cw * curIdx + 6} y={PAD.t - 6} className="flow-axis">
                Previsión →
              </text>
              {curIdx > 0 && (
                <text x={PAD.l + cw * curIdx - 6} y={PAD.t - 6} className="flow-axis" textAnchor="end">
                  ← Real
                </text>
              )}
            </>
          )}

          {/* Rejilla */}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={v === 0 ? "flow-zero" : "flow-grid"} />
              <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="flow-axis">
                {kLabel(v)}
              </text>
            </g>
          ))}

          {/* Barras */}
          {rows.map((r, i) => {
            const xi = cx(i) - bw - 1;
            const xo = cx(i) + 1;
            const inTop = y(r.inConfirmed);
            const outBottom = y(-r.outConfirmed);
            return (
              <g key={r.month} opacity={hover == null || hover === i ? 1 : 0.55}>
                {r.inConfirmed > 0 && <rect x={xi} y={inTop} width={bw} height={y(0) - inTop} rx={3} className="flow-in" />}
                {showProbable && r.inProbable > 0 && (
                  <rect x={xi} y={y(r.inConfirmed + r.inProbable)} width={bw} height={Math.max(0, inTop - y(r.inConfirmed + r.inProbable) - 2)} rx={3} fill="url(#flow-hatch-in)" />
                )}
                {r.outConfirmed > 0 && <rect x={xo} y={y(0)} width={bw} height={outBottom - y(0)} rx={3} className="flow-out" />}
                {showProbable && r.outProbable > 0 && (
                  <rect x={xo} y={outBottom + 2} width={bw} height={Math.max(0, y(-(r.outConfirmed + r.outProbable)) - outBottom - 2)} rx={3} fill="url(#flow-hatch-out)" />
                )}
                <text x={cx(i)} y={H - PAD.b + 18} textAnchor="middle" className={"flow-axis" + (r.isCurrent ? " is-current" : "")}>
                  {r.label.slice(0, 3)}
                  {r.month.slice(5) === "01" || i === 0 ? ` ${r.month.slice(2, 4)}` : ""}
                </text>
              </g>
            );
          })}

          {/* Neto confirmado (y, si se pide, con probable) */}
          {showProbable && <polyline points={line("netWithProbable")} className="flow-net-prob" />}
          <polyline points={line("net")} className="flow-net" />
          {rows.map((r, i) => (
            <circle key={r.month} cx={cx(i)} cy={y(r.net)} r={4.5} className={r.net < 0 ? "flow-dot is-neg" : "flow-dot"} />
          ))}

          {/* Zonas de detalle al pasar el ratón */}
          {rows.map((r, i) => (
            <rect
              key={r.month}
              x={PAD.l + cw * i}
              y={PAD.t - 18}
              width={cw}
              height={H - PAD.t - PAD.b + 18}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover(hover === i ? null : i)}
            />
          ))}
        </svg>

        {h && hover != null && (
          <div className="flow-tip" style={{ left: `${(cx(hover) / W) * 100}%` }}>
            <b>
              {h.label}
              {h.isCurrent ? " · este mes" : h.isPast ? " · real" : " · previsto"}
            </b>
            <div>
              <span className="flow-key is-in" /> Entra <span>{eur0(h.inConfirmed)}</span>
            </div>
            <div>
              <span className="flow-key is-out" /> Sale <span>{eur0(h.outConfirmed)}</span>
            </div>
            <div className={h.net < 0 ? "is-neg" : ""}>
              Neto <span>{eur0(h.net)}</span>
            </div>
            {showProbable && (h.inProbable > 0 || h.outProbable > 0) && (
              <div className="muted">
                Con probable (ponderado) <span>{eur0(h.netWithProbable)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
