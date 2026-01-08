import { Trophy } from 'lucide-react';
import type { MatchState } from '../store/matchStore';

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
  const status = statusStyles[match.status] || statusStyles.live;
  const prediction = match.prediction || { home: 0.33, draw: 0.34, away: 0.33 };

  // 判断哪队领先
  const homeLeading = match.home_score > match.away_score;
  const awayLeading = match.away_score > match.home_score;

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
      <div className="flex items-center justify-between mb-4">
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

      {/* AI 预测条 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>AI 预测</span>
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
    </div>
  );
}
