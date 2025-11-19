import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert
} from '@mui/material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { apiClient } from '@/lib/api-client';

interface Pairing {
  id: number;
  creditCardVendor: string;
  creditCardAccountNumber: string | null;
  bankVendor: string;
  bankAccountNumber: string | null;
  matchPatterns?: string[];
}

interface WeeklyStats {
  weekStart: string;
  weekEnd: string;
  bank: {
    total: number;
    matched: number;
    unmatched: number;
  };
  cc: {
    total: number;
    matched: number;
    unmatched: number;
  };
}

interface ChartDataPoint {
  weekLabel: string;
  bankMatched: number;
  bankUnmatched: number;
  ccMatched: number;
  ccUnmatched: number;
}

interface MatchingTimeSeriesChartProps {
  pairing: Pairing;
  compact?: boolean;
}

interface WeeklyStatsResponse {
  weeklyStats: WeeklyStats[];
}

export default function MatchingTimeSeriesChart({ pairing, compact = false }: MatchingTimeSeriesChartProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);

  useEffect(() => {
    if (pairing) {
      fetchWeeklyStats();
    }
  }, [pairing]);

  const fetchWeeklyStats = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        creditCardAccountNumber: pairing.creditCardAccountNumber || '',
        creditCardVendor: pairing.creditCardVendor,
        bankVendor: pairing.bankVendor,
        bankAccountNumber: pairing.bankAccountNumber || ''
      });

      if (pairing.matchPatterns && pairing.matchPatterns.length > 0) {
        params.append('matchPatterns', JSON.stringify(pairing.matchPatterns));
      }

      const response = await apiClient.get<WeeklyStatsResponse>(
        `/api/investments/manual-matching/weekly-stats?${params.toString()}`
      );

      if (response.ok) {
        const weeklyStats: WeeklyStats[] = response.data?.weeklyStats || [];

        // Transform data for chart
        const transformed = weeklyStats.map((week) => {
          const weekStart = new Date(week.weekStart);
          const weekEnd = new Date(week.weekEnd);

          // Format week label (e.g., "Aug 5-11" or "W32")
          const monthName = weekStart.toLocaleDateString('en-US', { month: 'short' });
          const startDay = weekStart.getDate();
          const endDay = weekEnd.getDate();
          const weekLabel = compact
            ? `${monthName} ${startDay}`
            : `${monthName} ${startDay}-${endDay}`;

          return {
            weekLabel,
            bankMatched: week.bank.matched,
            bankUnmatched: week.bank.unmatched,
            ccMatched: week.cc.matched,
            ccUnmatched: week.cc.unmatched
          };
        });

        setChartData(transformed);
      } else {
        setError('Failed to load weekly statistics');
      }
    } catch (err) {
      console.error('Error fetching weekly stats:', err);
      setError('Error loading chart data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={compact ? 24 : 40} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ my: compact ? 1 : 2 }}>
        {error}
      </Alert>
    );
  }

  if (chartData.length === 0) {
    return (
      <Alert severity="info" sx={{ my: compact ? 1 : 2 }}>
        No data available for the selected period
      </Alert>
    );
  }

  const chartHeight = compact ? 200 : 300;

  return (
    <Box sx={{ width: '100%', mt: compact ? 1 : 2 }}>
      <Typography variant={compact ? 'caption' : 'subtitle2'} color="text.secondary" gutterBottom>
        Weekly Matching Progress
      </Typography>

      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="weekLabel"
            tick={{ fontSize: compact ? 10 : 12 }}
            angle={compact ? -45 : 0}
            textAnchor={compact ? 'end' : 'middle'}
            height={compact ? 60 : 30}
          />
          <YAxis
            label={{ value: 'Transactions', angle: -90, position: 'insideLeft', fontSize: compact ? 10 : 12 }}
            tick={{ fontSize: compact ? 10 : 12 }}
          />
          <Tooltip
            contentStyle={{ fontSize: compact ? 11 : 13 }}
            formatter={(value: number, name: string) => {
              const labels: { [key: string]: string } = {
                bankMatched: 'Bank Matched',
                bankUnmatched: 'Bank Unmatched',
                ccMatched: 'CC Matched',
                ccUnmatched: 'CC Unmatched'
              };
              return [value, labels[name] || name];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: compact ? 10 : 12 }}
            formatter={(value: string) => {
              const labels: { [key: string]: string } = {
                bankMatched: 'Bank Matched',
                bankUnmatched: 'Bank Unmatched',
                ccMatched: 'CC Matched',
                ccUnmatched: 'CC Unmatched'
              };
              return labels[value] || value;
            }}
          />

          {/* Bank bars */}
          <Bar dataKey="bankMatched" stackId="bank" fill="#2e7d32" name="Bank Matched" />
          <Bar dataKey="bankUnmatched" stackId="bank" fill="#c62828" name="Bank Unmatched" />

          {/* CC bars */}
          <Bar dataKey="ccMatched" stackId="cc" fill="#66bb6a" name="CC Matched" />
          <Bar dataKey="ccUnmatched" stackId="cc" fill="#ef5350" name="CC Unmatched" />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
