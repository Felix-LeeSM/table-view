// #1077 admin-parity Stage 3 (2026-07-25) — dependency-free SVG sparkline
// for the ops dashboards' lightweight trend view. Renders nothing until at
// least two samples exist (a single point has no trend to draw).

export interface SparklineProps {
  data: number[];
  ariaLabel: string;
  width?: number;
  height?: number;
  "data-testid"?: string;
}

export function Sparkline({
  data,
  ariaLabel,
  width = 120,
  height = 24,
  "data-testid": testId,
}: SparklineProps) {
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="text-primary"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
