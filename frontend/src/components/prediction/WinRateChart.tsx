import React, { useEffect, useState, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { format } from 'date-fns';

// 历史预测数据点接口
interface PredictionHistoryPoint {
  id: number;
  match_id: string;
  minute: number;
  home_score: number;
  away_score: number;
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  confidence: number;
  features_snapshot: {
    momentum?: {
      home: number;
      away: number;
    };
    pressureAnalysis?: {
      homeNormalized: number;
      awayNormalized: number;
      dominantTeam: 'HOME' | 'AWAY' | 'BALANCED';
    };
  };
  created_at: string;
}

// 图表数据点接口
interface ChartDataPoint {
  minute: number;
  timestamp: string;
  homeWin: number;
  draw: number;
  awayWin: number;
  homeScore: number;
  awayScore: number;
  homePressure: number;
  awayPressure: number;
  confidence: number;
  isGoal?: boolean;
}

// 组件 Props
interface WinRateChartProps {
  matchId: string;
  homeTeam?: string;
  awayTeam?: string;
}

// 自定义 Tooltip 组件
const CustomTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    payload: ChartDataPoint;
  }>;
  label?: number;
  homeTeam?: string;
  awayTeam?: string;
}> = ({ active, payload, label, homeTeam, awayTeam }) => {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload;
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-lg">
        <p className="text-white font-semibold mb-2">
          ⏱️ 第 {label} 分钟
          <span className="ml-2 text-gray-400">
            ({data.homeScore} - {data.awayScore})
          </span>
        </p>
        <div className="space-y-1 text-sm">
          <p className="text-blue-400">
            🔵 {homeTeam || '主队'}胜: <span className="font-bold">{data.homeWin.toFixed(1)}%</span>
          </p>
          <p className="text-gray-400">
            ⚪ 平局: <span className="font-bold">{data.draw.toFixed(1)}%</span>
          </p>
          <p className="text-red-400">
            🔴 {awayTeam || '客队'}胜: <span className="font-bold">{data.awayWin.toFixed(1)}%</span>
          </p>
        </div>
        <div className="mt-2 pt-2 border-t border-gray-700">
          <p className="text-xs text-gray-500">
            📊 压力指数: 
            <span className="text-blue-400 ml-1">{data.homePressure.toFixed(0)}</span>
            <span className="text-gray-500 mx-1">vs</span>
            <span className="text-red-400">{data.awayPressure.toFixed(0)}</span>
          </p>
          <p className="text-xs text-gray-500">
            🎯 置信度: {data.confidence.toFixed(0)}%
          </p>
        </div>
        {data.isGoal && (
          <p className="mt-1 text-yellow-400 text-xs animate-pulse">
            ⚽ 进球时刻
          </p>
        )}
      </div>
    );
  }
  return null;
};

// 获取 API URL
const getApiUrl = (): string => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';
    return isProduction
      ? 'https://football-ai-live-production.up.railway.app'
      : 'http://localhost:4000';
  }
  return 'http://localhost:4000';
};

const WinRateChart: React.FC<WinRateChartProps> = ({ matchId, homeTeam, awayTeam }) => {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [goalMinutes, setGoalMinutes] = useState<number[]>([]);

  // 获取历史数据
  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/predictions/${matchId}/history`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: PredictionHistoryPoint[] = await response.json();
      
      if (!data || data.length === 0) {
        setChartData([]);
        setLoading(false);
        return;
      }
      
      // 转换数据格式
      const goals: number[] = [];
      let lastScore = { home: 0, away: 0 };
      
      const formattedData: ChartDataPoint[] = data.map((point) => {
        // 检测进球
        const isGoal = 
          point.home_score !== lastScore.home || 
          point.away_score !== lastScore.away;
        
        if (isGoal && point.minute > 0) {
          goals.push(point.minute);
        }
        
        lastScore = { home: point.home_score, away: point.away_score };
        
        return {
          minute: point.minute,
          timestamp: format(new Date(point.created_at), 'HH:mm:ss'),
          homeWin: point.home_win_prob * 100,
          draw: point.draw_prob * 100,
          awayWin: point.away_win_prob * 100,
          homeScore: point.home_score,
          awayScore: point.away_score,
          homePressure: point.features_snapshot?.pressureAnalysis?.homeNormalized || 50,
          awayPressure: point.features_snapshot?.pressureAnalysis?.awayNormalized || 50,
          confidence: point.confidence * 100,
          isGoal,
        };
      });
      
      setChartData(formattedData);
      setGoalMinutes(goals);
    } catch (err) {
      console.error('Failed to fetch prediction history:', err);
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    fetchHistory();
    
    // 每 30 秒自动刷新
    const interval = setInterval(fetchHistory, 30000);
    return () => clearInterval(interval);
  }, [fetchHistory]);

  // 加载状态
  if (loading && chartData.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 mt-3">
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-400">加载趋势数据...</span>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 mt-3">
        <div className="flex items-center justify-center h-48 text-red-400">
          <span>❌ {error}</span>
          <button 
            onClick={fetchHistory}
            className="ml-3 px-3 py-1 bg-red-600 rounded text-white text-sm hover:bg-red-700"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  // 无数据状态
  if (chartData.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 mt-3">
        <div className="flex items-center justify-center h-48 text-gray-400">
          <span>📊 暂无历史数据，比赛进行中将自动记录</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 mt-3">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-white font-semibold flex items-center">
          📈 胜率走势图
          <span className="ml-2 text-xs text-gray-500">
            ({chartData.length} 个数据点)
          </span>
        </h4>
        <button
          onClick={fetchHistory}
          className="text-xs text-blue-400 hover:text-blue-300 flex items-center"
        >
          🔄 刷新
        </button>
      </div>

      {/* 图表 */}
      <ResponsiveContainer width="100%" height={250}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          
          {/* X轴 - 比赛时间 */}
          <XAxis
            dataKey="minute"
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF', fontSize: 11 }}
            tickFormatter={(value) => `${value}'`}
            domain={[0, 'dataMax']}
          />
          
          {/* Y轴 - 概率 */}
          <YAxis
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF', fontSize: 11 }}
            tickFormatter={(value) => `${value}%`}
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
          />
          
          {/* 自定义 Tooltip */}
          <Tooltip
            content={<CustomTooltip homeTeam={homeTeam} awayTeam={awayTeam} />}
          />
          
          {/* 图例 */}
          <Legend
            wrapperStyle={{ paddingTop: '10px' }}
            formatter={(value) => {
              const labels: Record<string, string> = {
                homeWin: homeTeam ? `${homeTeam}胜` : '主胜',
                draw: '平局',
                awayWin: awayTeam ? `${awayTeam}胜` : '客胜',
              };
              return <span className="text-xs">{labels[value] || value}</span>;
            }}
          />
          
          {/* 进球时刻参考线 */}
          {goalMinutes.map((minute, index) => (
            <ReferenceLine
              key={`goal-${index}`}
              x={minute}
              stroke="#FBBF24"
              strokeDasharray="5 5"
              label={{
                value: '⚽',
                position: 'top',
                fill: '#FBBF24',
                fontSize: 12,
              }}
            />
          ))}
          
          {/* 50% 参考线 */}
          <ReferenceLine
            y={50}
            stroke="#6B7280"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          
          {/* 主胜曲线 - 蓝色 */}
          <Line
            type="monotone"
            dataKey="homeWin"
            name="homeWin"
            stroke="#3B82F6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 6, fill: '#3B82F6' }}
          />
          
          {/* 平局曲线 - 灰色虚线 */}
          <Line
            type="monotone"
            dataKey="draw"
            name="draw"
            stroke="#9CA3AF"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            activeDot={{ r: 6, fill: '#9CA3AF' }}
          />
          
          {/* 客胜曲线 - 红色 */}
          <Line
            type="monotone"
            dataKey="awayWin"
            name="awayWin"
            stroke="#EF4444"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 6, fill: '#EF4444' }}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* 底部说明 */}
      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
        <span>⚽ 黄色虚线表示进球时刻</span>
        <span>数据每 30 秒自动更新</span>
      </div>
    </div>
  );
};

export default WinRateChart;
