import { useEffect, useState } from 'react';

/**
 * 六维雷达图 — 纯 SVG 实现，无额外依赖
 * 维度顺序: 上方开始顺时针 — 狼性/鹰眼/戏骨/磁场/铁皮/手气
 */

interface DimensionConfig {
  key: string;
  name: string;
  emoji: string;
}

const DIMENSIONS: DimensionConfig[] = [
  { key: 'wolfHeart', name: '狼性', emoji: '⚔️' },
  { key: 'eagleEye', name: '鹰眼', emoji: '👁️' },
  { key: 'dramaBone', name: '戏骨', emoji: '🎭' },
  { key: 'magnetism', name: '磁场', emoji: '🧲' },
  { key: 'ironSkin', name: '铁皮', emoji: '🛡️' },
  { key: 'luck', name: '手气', emoji: '🎰' },
];

interface RadarChartProps {
  dimensions: Record<string, number>;
  nickname?: string;
  size?: number;
}

/** 将极坐标转为直角坐标 */
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

/** 生成六边形各顶点坐标 */
function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = -90 + i * 60;
    const p = polarToCartesian(cx, cy, r, angle);
    return `${p.x},${p.y}`;
  }).join(' ');
}

/** 根据维度值生成多边形顶点 */
function valuePoints(
  cx: number,
  cy: number,
  maxR: number,
  values: number[],
): string {
  return values
    .map((val, i) => {
      const angle = -90 + i * 60;
      const r = (val / 100) * maxR;
      const p = polarToCartesian(cx, cy, r, angle);
      return `${p.x},${p.y}`;
    })
    .join(' ');
}

export default function RadarChart({ dimensions, size = 300 }: RadarChartProps) {
  const [animate, setAnimate] = useState(false);

  // 值改变时触发动画
  useEffect(() => {
    setAnimate(false);
    const timer = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(timer);
  }, [dimensions]);

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.38; // 留边距给标签

  // 按维度顺序取值
  const values = DIMENSIONS.map((d) => dimensions[d.key] ?? 0);

  // 动画：从 0 缩放到实际值
  const animValues = animate ? values : values.map(() => 0);
  const animPoints = valuePoints(cx, cy, maxR, animValues);

  return (
    <div className="flex flex-col items-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="select-none"
      >
        {/* 背景网格 — 5 层同心六边形 */}
        {[20, 40, 60, 80, 100].map((level) => (
          <polygon
            key={level}
            points={hexPoints(cx, cy, maxR * (level / 100))}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={1}
          />
        ))}

        {/* 轴线 — 从中心到各顶点 */}
        {Array.from({ length: 6 }, (_, i) => {
          const angle = -90 + i * 60;
          const p = polarToCartesian(cx, cy, maxR, angle);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={p.x}
              y2={p.y}
              stroke="#e5e7eb"
              strokeWidth={1}
            />
          );
        })}

        {/* 数据多边形 — 填充 + 描边 */}
        <polygon
          points={animPoints}
          fill="rgba(124, 58, 237, 0.2)"
          stroke="#7c3aed"
          strokeWidth={2}
          style={{
            transition: animate ? 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
          }}
        />

        {/* 数据顶点圆点 */}
        {animValues.map((val, i) => {
          const angle = -90 + i * 60;
          const r = (val / 100) * maxR;
          const p = polarToCartesian(cx, cy, r, angle);
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={4}
              fill="#7c3aed"
              style={{
                transition: animate ? 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
              }}
            />
          );
        })}

        {/* 维度标签 — 放在六边形外侧 */}
        {DIMENSIONS.map((dim, i) => {
          const angle = -90 + i * 60;
          const labelR = maxR + 28;
          const p = polarToCartesian(cx, cy, labelR, angle);
          // 根据角度调整文字对齐
          let textAnchor: 'middle' | 'start' | 'end' = 'middle';
          if (angle > -60 && angle < 60) textAnchor = 'start';
          if (angle > 120 || angle < -120) textAnchor = 'end';
          return (
            <g key={dim.key}>
              <text
                x={p.x}
                y={p.y - 6}
                textAnchor={textAnchor}
                fontSize={14}
                dominantBaseline="auto"
              >
                {dim.emoji}
              </text>
              <text
                x={p.x}
                y={p.y + 10}
                textAnchor={textAnchor}
                fontSize={12}
                fill="#6b7280"
                dominantBaseline="auto"
              >
                {dim.name}
              </text>
            </g>
          );
        })}

        {/* 数值标签 — 在数据点内侧 */}
        {animValues.map((val, i) => {
          const angle = -90 + i * 60;
          const labelR = Math.max(((val / 100) * maxR) - 16, 12);
          const p = polarToCartesian(cx, cy, labelR, angle);
          return (
            <text
              key={i}
              x={p.x}
              y={p.y + 4}
              textAnchor="middle"
              fontSize={10}
              fill="#7c3aed"
              fontWeight="bold"
              style={{
                transition: animate ? 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
                opacity: animate ? 1 : 0,
              }}
            >
              {Math.round(val)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
