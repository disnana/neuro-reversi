import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { StatPoint } from '../types';

interface Props {
  data: StatPoint[];
}

export const StatChart: React.FC<Props> = ({ data }) => {
  if (data.length === 0) {
    return <div className="text-gray-500 text-center p-4">No training data yet.</div>;
  }

  return (
    <div className="w-full h-64 bg-slate-900/50 rounded-lg p-4 border border-slate-700">
      <h3 className="text-sm font-display text-cyan-400 mb-2">Neural Network Performance</h3>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorWin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="game" stroke="#94a3b8" fontSize={12} />
          <YAxis stroke="#94a3b8" fontSize={12} domain={[0, 100]} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9' }}
            itemStyle={{ color: '#8884d8' }}
          />
          <Area type="monotone" dataKey="winRate" stroke="#8884d8" fillOpacity={1} fill="url(#colorWin)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};