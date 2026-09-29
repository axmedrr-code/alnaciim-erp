import type { PfdNode } from '../../shared/engine';

const KIND_STYLE: Record<PfdNode['kind'], { fill: string; stroke: string; icon: string }> = {
  source: { fill: '#e0f2fe', stroke: '#0369a1', icon: '⛲' },
  pump: { fill: '#ede9fe', stroke: '#6d28d9', icon: '⚙' },
  tank: { fill: '#dbeafe', stroke: '#1d4ed8', icon: '▭' },
  filter: { fill: '#fef3c7', stroke: '#b45309', icon: '▥' },
  membrane: { fill: '#ccfbf1', stroke: '#0f766e', icon: '≣' },
  uv: { fill: '#fae8ff', stroke: '#a21caf', icon: '☀' },
  product: { fill: '#dcfce7', stroke: '#15803d', icon: '💧' },
  drain: { fill: '#fee2e2', stroke: '#b91c1c', icon: '⤓' },
};

const CELL_W = 210;
const BOX_W = 164;
const BOX_H = 66;
const CELL_H = 170;
const TAG_H = 17;
const PAD_X = 40;
const PAD_Y = 16;

/** Process flow diagram generated from the design configuration (serpentine layout). */
export function PfdDiagram({ main, reject, perRow = 5 }: { main: PfdNode[]; reject: PfdNode; perRow?: number }) {
  const rows = Math.ceil(main.length / perRow);
  const width = PAD_X * 2 + perRow * CELL_W;
  const laneY = PAD_Y + rows * CELL_H;
  const height = laneY + 120;

  const pos = main.map((_, i) => {
    const r = Math.floor(i / perRow);
    const c0 = i % perRow;
    const c = r % 2 === 0 ? c0 : perRow - 1 - c0;
    const x = PAD_X + c * CELL_W + (CELL_W - BOX_W) / 2;
    const y = PAD_Y + r * CELL_H + 58;
    return { x, y, r, c };
  });

  const arrows: string[] = [];
  for (let i = 0; i < main.length - 1; i++) {
    const a = pos[i];
    const b = pos[i + 1];
    const my = a.y + BOX_H / 2;
    if (a.r === b.r) {
      if (b.x > a.x) arrows.push(`M${a.x + BOX_W},${my} L${b.x - 4},${my}`);
      else arrows.push(`M${a.x},${my} L${b.x + BOX_W + 4},${my}`);
    } else {
      // drop down on the outer side of the row
      const right = a.c === perRow - 1 && a.r % 2 === 0;
      const sx = right ? a.x + BOX_W : a.x;
      const ox = right ? sx + 22 : sx - 22;
      const ny = b.y + BOX_H / 2;
      arrows.push(`M${sx},${my} L${ox},${my} L${ox},${ny} L${right ? b.x + BOX_W + 4 : b.x - 4},${ny}`);
    }
  }

  const roIdx = main.findIndex((n) => n.id === 'ro');
  const ro = roIdx >= 0 ? pos[roIdx] : null;
  let rejectPath = '';
  let rejectBox = { x: PAD_X, y: laneY + 30 };
  if (ro) {
    rejectBox = { x: ro.x, y: laneY + 30 };
    const sx = ro.x + BOX_W * 0.7;
    const gx = ro.x + BOX_W + (CELL_W - BOX_W) / 2;
    const gxOk = ro.c < perRow - 1 ? gx : ro.x - (CELL_W - BOX_W) / 2;
    rejectPath = `M${sx},${ro.y + BOX_H} L${sx},${ro.y + BOX_H + 26} L${gxOk},${ro.y + BOX_H + 26} L${gxOk},${rejectBox.y + BOX_H / 2} L${gxOk < ro.x ? rejectBox.x - 4 : rejectBox.x + BOX_W + 4},${rejectBox.y + BOX_H / 2}`;
  }

  const renderBox = (n: PfdNode, x: number, y: number, key: string) => {
    const st = KIND_STYLE[n.kind];
    return (
      <g key={key}>
        <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={n.kind === 'tank' ? 4 : 10} fill={st.fill} stroke={st.stroke} strokeWidth={1.6} />
        <text x={x + 8} y={y + 21} fontSize={n.label.length > 16 ? 11.5 : 13} fontWeight={700} fill="#0f172a">
          <tspan>{st.icon} </tspan>
          <tspan>{n.label}</tspan>
        </text>
        <foreignObject x={x + 6} y={y + 30} width={BOX_W - 12} height={BOX_H - 32}>
          <div className="pfd-sub">{n.sub}</div>
        </foreignObject>
        {n.chemicals.map((c, j) => {
          const ty = y - 10 - (n.chemicals.length - j) * (TAG_H + 3);
          return (
            <g key={c}>
              <rect x={x + 8} y={ty} width={BOX_W - 16} height={TAG_H} rx={8} fill="#fff7ed" stroke="#ea580c" strokeWidth={1} />
              <text x={x + BOX_W / 2} y={ty + 12} fontSize={10} textAnchor="middle" fill="#9a3412">
                ⇣ {c}
              </text>
            </g>
          );
        })}
        {n.chemicals.length > 0 && <path d={`M${x + BOX_W / 2},${y - 10} L${x + BOX_W / 2},${y - 2}`} stroke="#ea580c" strokeWidth={1.4} markerEnd="url(#arrOrange)" />}
      </g>
    );
  };

  return (
    <div className="pfd-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="pfd" role="img" aria-label="Process flow diagram">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#334155" />
          </marker>
          <marker id="arrRed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#b91c1c" />
          </marker>
          <marker id="arrOrange" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#ea580c" />
          </marker>
        </defs>
        {arrows.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#334155" strokeWidth={2} markerEnd="url(#arr)" />
        ))}
        {rejectPath && <path d={rejectPath} fill="none" stroke="#b91c1c" strokeWidth={2} strokeDasharray="7 5" markerEnd="url(#arrRed)" />}
        {ro && (
          <text x={ro.x + BOX_W * 0.7 + 6} y={ro.y + BOX_H + 20} fontSize={11} fill="#b91c1c" fontWeight={600}>
            Reject
          </text>
        )}
        {main.map((n, i) => renderBox(n, pos[i].x, pos[i].y, n.id))}
        {renderBox(reject, rejectBox.x, rejectBox.y, 'reject')}
      </svg>
      <div className="pfd-legend">
        {(Object.keys(KIND_STYLE) as PfdNode['kind'][]).map((k) => (
          <span key={k}>
            <i style={{ background: KIND_STYLE[k].fill, borderColor: KIND_STYLE[k].stroke }} /> {k}
          </span>
        ))}
        <span>
          <i style={{ background: '#fff7ed', borderColor: '#ea580c' }} /> chemical injection
        </span>
      </div>
    </div>
  );
}
