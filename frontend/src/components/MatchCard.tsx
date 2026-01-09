import { useState } from 'react';
import { Trophy, TrendingUp, ChevronDown, ChevronUp, Target } from 'lucide-react';
import type { MatchState } from '../store/matchStore';
import { MomentumGauge } from './prediction/MomentumGauge';
import WinRateChart from './prediction/WinRateChart';
import { GoalBettingTips, GoalTipBadge } from './prediction/GoalBettingTips';

interface MatchCardProps {
  match: MatchState;
}

// 状态标签样式
const statusStyles: Record<string, { bg: string; text: string; label: string }> = {
  live: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'LIVE' },
  halftime: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: '中场' },
  finished: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: '已结束' },
  not_started: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: '未开始' },
};

export function MatchCard({ match }: MatchCardProps) {
  const [showChart, setShowChart] = useState(false);
  const [showGoalTips, setShowGoalTips] = useState(false);
  
  const status = statusStyles[match.status] || statusStyles.live;
  const prediction = match.prediction || { home: 0.33, draw: 0.34, away: 0.33 };

  // 判断哪队领先
  const homeLeading = match.home_score > match.away_score;
  const awayLeading = match.away_score > match.home_score;

  // 切换图表显示
  const toggleChart = () => {
    setShowChart(!showChart);
  };

  // 切换进球建议显示
  const toggleGoalTips = () => {
    setShowGoalTips(!showGoalTips);
  };

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 hover:border-slate-600/50 transition-all">
      {/* 联赛信息 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Trophy className="w-3 h-3" />
          <span className="truncate max-w-[200px]">{match.league}</span>
        </div>
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${status.bg}`}>
          {match.status === 'live' && (
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
          )}
          <span className={`text-xs font-medium ${status.text}`}>
            {status.label} {match.status === 'live' && `${match.minute}'`}
          </span>
        </div>
      </div>

      {/* 比分区域 */}
      <div className="flex items-center justify-between mb-3">
        {/* 主队 */}
        <div className="flex-1 text-center">
          <div className={`text-sm font-medium truncate ${homeLeading ? 'text-white' : 'text-slate-300'}`}>
            {match.home_team}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">主场</div>
        </div>

        {/* 比分 */}
        <div className="flex items-center gap-2 px-4">
          <span className={`text-2xl font-bold ${homeLeading ? 'text-blue-400' : 'text-white'}`}>
            {match.home_score}
          </span>
          <span className="text-slate-500">-</span>
          <span className={`text-2xl font-bold ${awayLeading ? 'text-red-400' : 'text-white'}`}>
            {match.away_score}
          </span>
        </div>

        {/* 客队 */}
        <div className="flex-1 text-center">
          <div className={`text-sm font-medium truncate ${awayLeading ? 'text-white' : 'text-slate-300'}`}>
            {match.away_team}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">客场</div>
        </div>
      </div>

      {/* 🟢 势能对比组件 - 只有当 pressureAnalysis 存在时才渲染 */}
      {prediction.pressureAnalysis && (
        <div className="mb-3 border-t border-b border-slate-700/30 py-2">
          <MomentumGauge 
            pressure={prediction.pressureAnalysis} 
            showLabel={true}
            compact={false}
          />
        </div>
      )}

      {/* AI 预测条 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center gap-1">
            AI 预测
            {prediction.confidence !== undefined && (
              <span className="text-[10px] text-slate-500">
                ({(prediction.confidence * 100).toFixed(0)}% 置信度)
              </span>
            )}
          </span>
          <div className="flex gap-3">
            <span className="text-blue-400">{(prediction.home * 100).toFixed(0)}%</span>
            <span className="text-slate-400">{(prediction.draw * 100).toFixed(0)}%</span>
            <span className="text-red-400">{(prediction.away * 100).toFixed(0)}%</span>
          </div>
        </div>
        
        {/* 三色概率条 */}
        <div className="flex h-2 rounded-full overflow-hidden bg-slate-700/50">
          <div 
            className="bg-blue-500 transition-all duration-500"
            style={{ width: `${prediction.home * 100}%` }}
          />
          <div 
            className="bg-slate-500 transition-all duration-500"
            style={{ width: `${prediction.draw * 100}%` }}
          />
          <div 
            className="bg-red-500 transition-all duration-500"
            style={{ width: `${prediction.away * 100}%` }}
          />
        </div>
      </div>

      {/* 动量信息和进球提示（如果有） */}
      <div className="mt-2 flex items-center justify-between">
        {prediction.momentum && (
          <div className="flex gap-4 text-[10px] text-slate-500">
            <span>动量: {prediction.momentum.home.toFixed(2)}</span>
            <span>动量: {prediction.momentum.away.toFixed(2)}</span>
          </div>
        )}
        {/* 🟢 进球提示徽章 */}
        {prediction.goalBettingTips && (
          <GoalTipBadge tips={prediction.goalBettingTips} />
        )}
      </div>

      {/* 最近事件（如果有进球） */}
      {match.events.length > 0 && match.events[0].type === 'goal' && (
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-yellow-400">⚽</span>
            <span className="text-slate-300">
              进球! {match.events[0].minute}' - 
              比分 {match.events[0].home_score}-{match.events[0].away_score}
            </span>
          </div>
        </div>
      )}

      {/* 📊 趋势分析 & ⚽ 进球建议按钮 */}
      <div className="mt-3 pt-3 border-t border-slate-700/50 flex gap-2">
        {/* 趋势分析按钮 */}
        <button
          onClick={toggleChart}
          className={`
            flex-1 flex items-center justify-center gap-2 
            px-3 py-2 rounded-lg text-sm font-medium
            transition-all duration-200
            ${showChart 
              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' 
              : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white border border-transparent'
            }
          `}
        >
          <TrendingUp className="w-4 h-4" />
          <span>📊 趋势</span>
          {showChart ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {/* 🟢 进球建议按钮 */}
        {prediction.goalBettingTips && (
          <button
            onClick={toggleGoalTips}
            className={`
              flex-1 flex items-center justify-center gap-2 
              px-3 py-2 rounded-lg text-sm font-medium
              transition-all duration-200
              ${showGoalTips 
                ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30' 
                : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white border border-transparent'
              }
            `}
          >
            <Target className="w-4 h-4" />
            <span>⚽ 进球</span>
            {showGoalTips ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* 📈 胜率走势图 - 展开显示 */}
      {showChart && (
        <div className="mt-3 animate-in slide-in-from-top-2 duration-300">
          <WinRateChart 
            matchId={match.match_id}
            homeTeam={match.home_team}
            awayTeam={match.away_team}
          />
        </div>
      )}

      {/* 🟢 进球投注建议 - 展开显示 */}
      {showGoalTips && prediction.goalBettingTips && (
        <div className="mt-3 animate-in slide-in-from-top-2 duration-300">
          <GoalBettingTips
            tips={prediction.goalBettingTips}
            matchStatus={match.status}
            homeTeam={match.home_team}
            awayTeam={match.away_team}
            currentScore={{ home: match.home_score, away: match.away_score }}
            currentMinute={match.minute}
          />
        </div>
      )}
    </div>
  );
}
