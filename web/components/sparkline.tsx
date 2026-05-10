'use client';

import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';

interface Props {
  data: { t: number; v: number }[];
  color?: string;
  height?: number;
  domain?: [number | 'auto', number | 'auto'];
}

export function Sparkline({ data, color = '#6366f1', height = 56, domain = [0, 100] }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis domain={domain as any} hide />
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.75}
          fill={`url(#grad-${color})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
