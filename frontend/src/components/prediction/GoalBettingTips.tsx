/**
 * GoalBettingTips - 进球投注建议组件
 * 
 * 简洁版：只显示实时主盘口
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

  // 获取主盘口
  const mainAsianHandicap = liveOdds?.asianHandicap?.find(ah => ah.main);
  const mainOverUnder = liveOdds?.overUnder?.find(ou => ou.main);

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

      {/* 实时主盘口区域 */}
      {hasLiveOdds && (
        <div className="space-y-4">
          {/* 胜平负 1x2 */}
          {liveOdds.matchWinner && (
            <div>
              <div className="text-xs text-slate-400 mb-2 font-medium">胜平负 (1x2)</div>
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

          {/* 主盘口卡片 - 亚洲盘和大小球并排显示 */}
          <div className="grid grid-cols-2 gap-3">
            {/* 亚洲盘口主盘 */}
            {mainAsianHandicap && (
              <div className={`p-4 rounded-xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 ${mainAsianHandicap.suspended ? 'opacity-50' : ''}`}>
                <div className="text-xs text-purple-400 mb-2 font-medium flex items-center gap-1">
                  🎯 亚洲盘口
                  <span className="text-amber-400">★ 主盘</span>
                </div>
                <div className="text-center mb-3">
                  <span className="text-2xl font-bold text-white">
                    {mainAsianHandicap.line.startsWith('-') ? '' : '+'}{mainAsianHandicap.line}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="bg-blue-500/10 rounded-lg p-2">
                    <div className="text-[10px] text-blue-400 truncate">{homeTeam}</div>
                    <div className="text-lg font-bold text-blue-400">{formatOdds(mainAsianHandicap.home)}</div>
                  </div>
                  <div className="bg-red-500/10 rounded-lg p-2">
                    <div className="text-[10px] text-red-400 truncate">{awayTeam}</div>
                    <div className="text-lg font-bold text-red-400">{formatOdds(mainAsianHandicap.away)}</div>
                  </div>
                </div>
              </div>
            )}

            {/* 大小球主盘 */}
            {mainOverUnder && (
              <div className={`p-4 rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 ${mainOverUnder.suspended ? 'opacity-50' : ''}`}>
                <div className="text-xs text-emerald-400 mb-2 font-medium flex items-center gap-1">
                  ⚽ 大小球
                  <span className="text-amber-400">★ 主盘</span>
                </div>
                <div className="text-center mb-3">
                  <span className="text-2xl font-bold text-white">
                    {mainOverUnder.line} 球
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="bg-green-500/10 rounded-lg p-2">
                    <div className="text-[10px] text-green-400">大球</div>
                    <div className="text-lg font-bold text-green-400">{formatOdds(mainOverUnder.over)}</div>
                  </div>
                  <div className="bg-blue-500/10 rounded-lg p-2">
                    <div className="text-[10px] text-blue-400">小球</div>
                    <div className="text-lg font-bold text-blue-400">{formatOdds(mainOverUnder.under)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 如果没有主盘，显示第一个盘口 */}
          {!mainAsianHandicap && !mainOverUnder && (
            <div className="grid grid-cols-2 gap-3">
              {/* 亚洲盘口第一个 */}
              {liveOdds.asianHandicap && liveOdds.asianHandicap[0] && (
                <div className={`p-4 rounded-xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 ${liveOdds.asianHandicap[0].suspended ? 'opacity-50' : ''}`}>
                  <div className="text-xs text-purple-400 mb-2 font-medium">🎯 亚洲盘口</div>
                  <div className="text-center mb-3">
                    <span className="text-2xl font-bold text-white">
                      {liveOdds.asianHandicap[0].line.startsWith('-') ? '' : '+'}{liveOdds.asianHandicap[0].line}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-blue-500/10 rounded-lg p-2">
                      <div className="text-[10px] text-blue-400 truncate">{homeTeam}</div>
                      <div className="text-lg font-bold text-blue-400">{formatOdds(liveOdds.asianHandicap[0].home)}</div>
                    </div>
                    <div className="bg-red-500/10 rounded-lg p-2">
                      <div className="text-[10px] text-red-400 truncate">{awayTeam}</div>
                      <div className="text-lg font-bold text-red-400">{formatOdds(liveOdds.asianHandicap[0].away)}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* 大小球第一个 */}
              {liveOdds.overUnder && liveOdds.overUnder[0] && (
                <div className={`p-4 rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 ${liveOdds.overUnder[0].suspended ? 'opacity-50' : ''}`}>
                  <div className="text-xs text-emerald-400 mb-2 font-medium">⚽ 大小球</div>
                  <div className="text-center mb-3">
                    <span className="text-2xl font-bold text-white">
                      {liveOdds.overUnder[0].line} 球
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-green-500/10 rounded-lg p-2">
                      <div className="text-[10px] text-green-400">大球</div>
                      <div className="text-lg font-bold text-green-400">{formatOdds(liveOdds.overUnder[0].over)}</div>
                    </div>
                    <div className="bg-blue-500/10 rounded-lg p-2">
                      <div className="text-[10px] text-blue-400">小球</div>
                      <div className="text-lg font-bold text-blue-400">{formatOdds(liveOdds.overUnder[0].under)}</div>
                    </div>
                  </div>
                </div>
              )}
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
      {(mainAsianHandicap?.suspended || mainOverUnder?.suspended || liveOdds?.matchWinner?.suspended) && (
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
