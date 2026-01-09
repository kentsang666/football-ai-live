/**
 * GoalBettingTips - 进球投注建议组件
 * 
 * 优化版：更清晰的布局，突出实时赔率
 */

import type { GoalBettingTips as GoalBettingTipsType, LiveOdds } from '../../types/prediction';

interface GoalBettingTipsProps {
  tips: GoalBettingTipsType;
  matchStatus: 'live' | 'halftime' | 'finished' | 'not_started';
  homeTeam: string;
  awayTeam: string;
  liveOdds?: LiveOdds;
}

/**
 * 格式化赔率
 */
function formatOdds(odds: number): string {
  return odds.toFixed(2);
}

/**
 * 主组件
 */
export function GoalBettingTips({ 
  tips, 
  matchStatus, 
  homeTeam, 
  awayTeam,
  liveOdds
}: GoalBettingTipsProps) {
  const isLive = matchStatus === 'live' || matchStatus === 'halftime';
  const hasLiveOdds = liveOdds && (liveOdds.overUnder?.length || liveOdds.asianHandicap?.length);

  return (
    <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-700/50">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          ⚽ 进球投注建议
          {isLive && <span className="text-xs text-green-400 animate-pulse">● LIVE</span>}
        </h3>
        <div className="flex items-center gap-3">
          {liveOdds?.status && (
            <span className="text-sm text-amber-400 font-mono">
              {liveOdds.status.elapsed}'
            </span>
          )}
          <div className="text-right">
            <div className="text-xs text-slate-500">预期进球</div>
            <div className="text-lg font-bold text-amber-400">
              {tips.totalExpectedGoals.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      {/* 实时赔率区域 - 主要显示 */}
      {hasLiveOdds && (
        <div className="space-y-4">
          {/* 胜平负 1x2 */}
          {liveOdds.matchWinner && (
            <div>
              <div className="text-xs text-slate-400 mb-2 font-medium">胜平负</div>
              <div className="grid grid-cols-3 gap-2">
                <div className={`text-center p-3 rounded-lg ${liveOdds.matchWinner.suspended ? 'bg-red-900/20 opacity-60' : 'bg-blue-500/10 hover:bg-blue-500/20'} transition-colors`}>
                  <div className="text-xs text-blue-400 mb-1">主胜</div>
                  <div className="text-xl font-bold text-white">{formatOdds(liveOdds.matchWinner.home)}</div>
                </div>
                <div className={`text-center p-3 rounded-lg ${liveOdds.matchWinner.suspended ? 'bg-red-900/20 opacity-60' : 'bg-slate-700/30 hover:bg-slate-700/50'} transition-colors`}>
                  <div className="text-xs text-slate-400 mb-1">平局</div>
                  <div className="text-xl font-bold text-white">{formatOdds(liveOdds.matchWinner.draw)}</div>
                </div>
                <div className={`text-center p-3 rounded-lg ${liveOdds.matchWinner.suspended ? 'bg-red-900/20 opacity-60' : 'bg-red-500/10 hover:bg-red-500/20'} transition-colors`}>
                  <div className="text-xs text-red-400 mb-1">客胜</div>
                  <div className="text-xl font-bold text-white">{formatOdds(liveOdds.matchWinner.away)}</div>
                </div>
              </div>
            </div>
          )}

          {/* 亚洲盘口 */}
          {liveOdds.asianHandicap && liveOdds.asianHandicap.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-2 font-medium">亚洲盘口</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500">
                      <th className="text-left py-1 px-2">盘口</th>
                      <th className="text-center py-1 px-2 text-blue-400">{homeTeam.slice(0, 6)}</th>
                      <th className="text-center py-1 px-2 text-red-400">{awayTeam.slice(0, 6)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveOdds.asianHandicap.slice(0, 5).map((ah, idx) => (
                      <tr 
                        key={idx} 
                        className={`
                          border-t border-slate-700/30
                          ${ah.main ? 'bg-amber-500/10' : ''}
                          ${ah.suspended ? 'opacity-50' : ''}
                        `}
                      >
                        <td className="py-2 px-2">
                          <span className={`font-mono ${ah.main ? 'text-amber-400 font-bold' : 'text-slate-300'}`}>
                            {ah.line.startsWith('-') ? '' : '+'}{ah.line}
                          </span>
                          {ah.main && <span className="ml-1 text-[10px] text-amber-400">★</span>}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className="text-blue-400 font-bold">{formatOdds(ah.home)}</span>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className="text-red-400 font-bold">{formatOdds(ah.away)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 大小球 */}
          {liveOdds.overUnder && liveOdds.overUnder.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-2 font-medium">大小球</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500">
                      <th className="text-left py-1 px-2">盘口</th>
                      <th className="text-center py-1 px-2 text-green-400">大球</th>
                      <th className="text-center py-1 px-2 text-blue-400">小球</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveOdds.overUnder.slice(0, 5).map((ou, idx) => (
                      <tr 
                        key={idx} 
                        className={`
                          border-t border-slate-700/30
                          ${ou.main ? 'bg-amber-500/10' : ''}
                          ${ou.suspended ? 'opacity-50' : ''}
                        `}
                      >
                        <td className="py-2 px-2">
                          <span className={`font-mono ${ou.main ? 'text-amber-400 font-bold' : 'text-slate-300'}`}>
                            {ou.line}球
                          </span>
                          {ou.main && <span className="ml-1 text-[10px] text-amber-400">★</span>}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className="text-green-400 font-bold">{formatOdds(ou.over)}</span>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className="text-blue-400 font-bold">{formatOdds(ou.under)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 无实时赔率时显示 AI 预测 */}
      {!hasLiveOdds && (
        <div className="text-center py-8">
          <div className="text-slate-500 mb-2">暂无实时赔率数据</div>
          <div className="text-xs text-slate-600">
            AI 预测：预期总进球 {tips.totalExpectedGoals.toFixed(1)} 球
          </div>
        </div>
      )}

      {/* 下一球预测 - 简化版 */}
      {isLive && tips.nextGoal && (
        <div className="mt-4 pt-4 border-t border-slate-700/50">
          <div className="text-xs text-slate-400 mb-2 font-medium">🎯 下一球预测</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className={`p-2 rounded ${tips.nextGoal.recommendation === 'HOME' ? 'bg-blue-500/20 ring-1 ring-blue-500/50' : 'bg-slate-800/50'}`}>
              <div className="text-xs text-blue-400 truncate">{homeTeam}</div>
              <div className="text-lg font-bold text-white">{(tips.nextGoal.homeProb * 100).toFixed(0)}%</div>
            </div>
            <div className={`p-2 rounded ${tips.nextGoal.recommendation === 'NO_GOAL' ? 'bg-slate-500/20 ring-1 ring-slate-500/50' : 'bg-slate-800/50'}`}>
              <div className="text-xs text-slate-400">无进球</div>
              <div className="text-lg font-bold text-white">{(tips.nextGoal.noGoalProb * 100).toFixed(0)}%</div>
            </div>
            <div className={`p-2 rounded ${tips.nextGoal.recommendation === 'AWAY' ? 'bg-red-500/20 ring-1 ring-red-500/50' : 'bg-slate-800/50'}`}>
              <div className="text-xs text-red-400 truncate">{awayTeam}</div>
              <div className="text-lg font-bold text-white">{(tips.nextGoal.awayProb * 100).toFixed(0)}%</div>
            </div>
          </div>
        </div>
      )}

      {/* 暂停投注提示 */}
      {liveOdds?.matchWinner?.suspended && (
        <div className="mt-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400 text-center">
          ⚠️ 赔率暂停更新中
        </div>
      )}
    </div>
  );
}

/**
 * 迷你版进球提示（用于列表视图）
 */
export function GoalTipBadge({ tips }: { tips: GoalBettingTipsType }) {
  const tip = tips.highConfidenceTip;
  if (!tip) return null;
  
  const getBadgeColor = () => {
    switch (tip.type) {
      case 'OVER': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'UNDER': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'NEXT_GOAL_HOME': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'NEXT_GOAL_AWAY': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };
  
  const getShortText = () => {
    switch (tip.type) {
      case 'OVER': return `大${tip.line}`;
      case 'UNDER': return `小${tip.line}`;
      case 'NEXT_GOAL_HOME': return '主进';
      case 'NEXT_GOAL_AWAY': return '客进';
      default: return '';
    }
  };

  return (
    <span className={`
      inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border
      ${getBadgeColor()}
    `}>
      🔥 {getShortText()} {(tip.probability * 100).toFixed(0)}%
    </span>
  );
}

export default GoalBettingTips;
