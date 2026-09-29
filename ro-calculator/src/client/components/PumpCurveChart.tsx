import type { OperatingPoint } from '../../shared/engine';
import type { PumpCurvePoint } from '../../shared/types';

/** Pump curve (head, efficiency), system curve and duty point – plain SVG. */
export function PumpCurveChart({ curve, op, dutyFlow, dutyHead }: { curve: PumpCurvePoint[]; op?: OperatingPoint | null; dutyFlow?: number; dutyHead?: number }) {
  const pts = [...curve].sort((a, b) => a.flowM3h - b.flowM3h);
  if (pts.length < 2) return <p className="muted small">Enter at least two curve points to draw the curve.</p>;
  const W = 520;
  const Hh = 280;
  const L = 48;
  const R = 44;
  const T = 14;
  const B = 36;
  const qMax = Math.max(...pts.map((p) => p.flowM3h), dutyFlow ?? 0, ...(op?.systemCurve.map((s) => s.flowM3h) ?? [])) * 1.05 || 1;
  const hMax = Math.max(...pts.map((p) => p.headM), dutyHead ?? 0) * 1.1 || 1;
  const x = (q: number) => L + (q / qMax) * (W - L - R);
  const y = (h: number) => Hh - B - (h / hMax) * (Hh - T - B);
  const ye = (e: number) => Hh - B - (e / 100) * (Hh - T - B);
  const path = (arr: { q: number; v: number }[], fy: (v: number) => number) => arr.map((p, i) => `${i ? 'L' : 'M'}${x(p.q).toFixed(1)},${fy(p.v).toFixed(1)}`).join(' ');
  const headPath = path(pts.map((p) => ({ q: p.flowM3h, v: p.headM })), y);
  const effPts = pts.filter((p) => p.efficiencyPct != null).map((p) => ({ q: p.flowM3h, v: p.efficiencyPct as number }));
  const sys = op?.systemCurve.filter((s) => s.flowM3h <= qMax).map((s) => ({ q: s.flowM3h, v: s.headM })) ?? [];
  const ticks = (max: number) => Array.from({ length: 6 }, (_, i) => (max * i) / 5);
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="curve-chart" role="img" aria-label="Pump curve">
      {ticks(qMax).map((q) => (
        <g key={`q${q}`}>
          <line x1={x(q)} x2={x(q)} y1={T} y2={Hh - B} stroke="#e2e8f0" />
          <text x={x(q)} y={Hh - B + 14} fontSize={10} textAnchor="middle" fill="#64748b">
            {q.toFixed(q < 10 ? 1 : 0)}
          </text>
        </g>
      ))}
      {ticks(hMax).map((h) => (
        <g key={`h${h}`}>
          <line x1={L} x2={W - R} y1={y(h)} y2={y(h)} stroke="#e2e8f0" />
          <text x={L - 6} y={y(h) + 3} fontSize={10} textAnchor="end" fill="#64748b">
            {h.toFixed(0)}
          </text>
        </g>
      ))}
      {[0, 25, 50, 75, 100].map((e) => (
        <text key={`e${e}`} x={W - R + 6} y={ye(e) + 3} fontSize={10} fill="#16a34a">
          {e}%
        </text>
      ))}
      <text x={(L + W - R) / 2} y={Hh - 6} fontSize={11} textAnchor="middle" fill="#334155">
        Flow (m³/h)
      </text>
      <text x={12} y={(T + Hh - B) / 2} fontSize={11} textAnchor="middle" fill="#334155" transform={`rotate(-90 12 ${(T + Hh - B) / 2})`}>
        Head (m)
      </text>
      <path d={headPath} fill="none" stroke="#0e7490" strokeWidth={2.5} />
      {effPts.length > 1 && <path d={path(effPts, ye)} fill="none" stroke="#16a34a" strokeWidth={1.5} strokeDasharray="5 4" />}
      {sys.length > 1 && <path d={path(sys, y)} fill="none" stroke="#b45309" strokeWidth={1.8} />}
      {dutyFlow != null && dutyHead != null && (
        <g>
          <circle cx={x(dutyFlow)} cy={y(dutyHead)} r={5} fill="#b91c1c" />
          <text x={x(dutyFlow) + 8} y={y(dutyHead) - 6} fontSize={11} fill="#b91c1c" fontWeight={700}>
            duty {dutyFlow.toFixed(1)} m³/h @ {dutyHead.toFixed(1)} m
          </text>
        </g>
      )}
      {op?.intersectFlowM3h != null && op.intersectHeadM != null && <circle cx={x(op.intersectFlowM3h)} cy={y(op.intersectHeadM)} r={4} fill="none" stroke="#b45309" strokeWidth={2} />}
      <g fontSize={10}>
        <line x1={L + 8} x2={L + 26} y1={T + 8} y2={T + 8} stroke="#0e7490" strokeWidth={2.5} />
        <text x={L + 30} y={T + 11}>pump head</text>
        <line x1={L + 96} x2={L + 114} y1={T + 8} y2={T + 8} stroke="#16a34a" strokeDasharray="5 4" />
        <text x={L + 118} y={T + 11}>efficiency</text>
        {sys.length > 1 && (
          <>
            <line x1={L + 180} x2={L + 198} y1={T + 8} y2={T + 8} stroke="#b45309" strokeWidth={1.8} />
            <text x={L + 202} y={T + 11}>system curve (○ natural operating point)</text>
          </>
        )}
      </g>
    </svg>
  );
}
