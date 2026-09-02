'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface MonthlyChartProps {
  data: any[];
  chartType: 'revenue' | 'orders' | 'cases';
  onMonthSelect: (month: any) => void;
}

export default function MonthlyChart({ data, chartType, onMonthSelect }: MonthlyChartProps) {
  const getFormatLabel = (value: number) => {
    if (chartType === 'revenue') {
      if (value >= 1e6) return `${(value / 1e6).toFixed(1)} млн`;
      if (value >= 1e3) return `${(value / 1e3).toFixed(0)} тыс`;
      return `${value}`;
    }
    return `${value}`;
  };

  const getTooltipFormatter = (value: any) => {
    if (chartType === 'revenue') {
      return [`${Number(value).toLocaleString()} UZS`, 'Выручка'];
    }
    if (chartType === 'orders') {
      return [Number(value), 'Количество заказов'];
    }
    return [`${Number(value).toFixed(2)} кор.`, 'Объем коробок'];
  };

  const barColor = chartType === 'revenue' ? '#6366f1' : chartType === 'orders' ? '#06b6d4' : '#10b981';

  return (
    <div style={{ width: '100%', height: 350 }}>
      <ResponsiveContainer>
        <BarChart
          data={data}
          onClick={(state) => {
            if (state?.activePayload?.[0]?.payload) {
              onMonthSelect(state.activePayload[0].payload);
            }
          }}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.15} />
          <XAxis 
            dataKey="month" 
            stroke="#94a3b8" 
            fontSize={11}
            tickLine={false}
          />
          <YAxis
            stroke="#94a3b8"
            fontSize={11}
            tickLine={false}
            tickFormatter={getFormatLabel}
          />
          <Tooltip
            formatter={getTooltipFormatter}
            contentStyle={{
              backgroundColor: '#0f172a',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px',
              color: '#fff',
              fontSize: '11px'
            }}
            cursor={{ fill: 'rgba(255,255,255,0.03)', radius: 4 }}
          />
          <Bar
            dataKey={chartType}
            fill={barColor}
            barSize={data.length > 12 ? 30 : 50}
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
