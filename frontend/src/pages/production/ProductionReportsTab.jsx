import { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import DateFilterBar, { defaultDateRange } from '../../components/DateFilterBar';
import { daysBetween } from '../../utils/dateRanges';

const TYPE_LABEL = { RO_WATER: 'RO Water', BOTTLING: 'Bottling', ICE: 'Ice' };

export default function ProductionReportsTab() {
  const [dateRange, setDateRange] = useState(defaultDateRange());
  // The daily-summary endpoint has no from/to param, only year/month — so it's
  // filtered client-side against the selected range instead (it already returns
  // every day across all history when called with no filters).
  const { rows: allRows } = useApi('/reports/production');
  const rows = useMemo(
    () => (allRows || []).filter((r) => {
      const day = String(r.day).slice(0, 10);
      return day >= dateRange.from && day <= dateRange.to;
    }),
    [allRows, dateRange.from, dateRange.to]
  );

  const days = daysBetween(dateRange.from, dateRange.to);
  const { rows: trend } = useApi(`/reports/production-trend?days=${days}`, [days]);

  const chartData = (trend || []).map((r) => ({
    day: new Date(r.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    'RO Water': Number(r.ro_water), 'Bottling': Number(r.bottling), 'Ice': Number(r.ice)
  }));

  const columns = [
    { key: 'day', header: 'Date', render: (r) => new Date(r.day).toLocaleDateString() },
    { key: 'production_type', header: 'Type', render: (r) => TYPE_LABEL[r.production_type] || r.production_type },
    { key: 'total_planned', header: 'Planned' },
    { key: 'total_actual', header: 'Actual' },
    { key: 'batch_count', header: 'Batches' }
  ];

  return (
    <div>
      <div className="toolbar"><DateFilterBar value={dateRange} onChange={setDateRange} columns={columns} rows={rows} title="Production Report" /></div>

      <div className="card">
        <h3>Output Trend — {dateRange.label}</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} width={50} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="RO Water" stroke="#0b4a5c" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Bottling" stroke="#0F5E75" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Ice" stroke="#14B8A6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3>Daily Production Summary</h3>
        <Table columns={columns} rows={rows} emptyText="No production recorded in this period." searchable sortable pageSize={15} />
      </div>
    </div>
  );
}
