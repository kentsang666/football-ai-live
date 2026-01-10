/**
 * GoalBettingTips - 进球投注建议组件
 * 
 * 简洁版：只显示实时主盘口，带赔率变动颜色
 */

import type { GoalBettingTips as GoalBettingTipsType, LiveOdds } from '../../types/prediction';
import type { OddsChange, OddsDirection } from '../../store/matchStore';

interface GoalBettingTipsProps {
  tips: GoalBettingTipsType;
  matchStatus: 'live' | 'halftime' | 'finished' | 'not_started';
  homeTeam: string;
  awayTeam: string;
  liveOdds?: LiveOdds;
  oddsChange?: OddsChange;
}

/**
 * 格式化赔率
 */
function formatOdds(odds: number): string {
  return odds.toFixed(2);
}

/**
 * 获取赔率变动的颜色和箭头
 */
function getOddsChangeStyle(direction: OddsDirection | undefined): {
  color: string;
  arrow: string;
  bgColor: string;
} {
  switch (direction) {
    case 'up':
      return { 
        color: 'text-red-400', 
        arrow: '↑', 
        bgColor: 'bg-red-500/20 ring-1 ring-red-500/50' 
      };
    case 'down':
      return { 
        color: 'text-green-400', 
        arrow: '↓', 
        bgColor: 'bg-green-500/20 ring-1 ring-green-500/50' 
      };
    default:
      return { 
        color: 'text-white', 
        arrow: '', 
        bgColor: '' 
      };
  }
}

/**
 * 赔率显示组件（带变动指示）
 */
function OddsValue({ 
  value, 
  direction, 
  baseColor = 'text-white' 
}: { 
  value: number; 
  direction?: OddsDirection;
  baseColor?: string;
}) {
  const { color, arrow, bgColor } = getOddsChangeStyle(direction);
  const hasChange = direction === 'up' || direction === 'down';
  
  return (
    <div className={`relative inline-flex items-center justify-center gap-1 transition-all duration-300 ${hasChange ? bgColor : ''} rounded px-1`}>
      <span className={`text-lg font-bold ${hasChange ? color : baseColor} transition-colors duration-300`}>
        {formatOdds(value)}
      </span>
      {arrow && (
        <span className={`text-sm font-bold ${color} animate-pulse`}>
          {arrow}
        </span>
      )}
    </div>
  );
}

/**
 * 主组件
 */
export function GoalBettingTips({ 
  tips, 
  matchStatus, 
  homeTeam, 
  awayTeam,
  liveOdds,
  oddsChange
}: GoalBettingTipsProps) {
  const isLive = matchStatus === 'live' || matchStatus === 'halftime';
  const hasLiveOdds = liveOdds && (liveOdds.overUnder?.length || liveOdds.asianHandicap?.length);

  // 获取滚球主盘口
  const mainAsianHandicap = liveOdds?.asianHandicap?.find(ah => ah.main);
  const mainOverUnder = liveOdds?.overUnder?.find(ou => ou.main);
  
  // 🟢 获取赛前原始盘口
  const preMatchAsianHandicap = liveOdds?.preMatchAsianHandicap;
  const preMatchOverUnder = liveOdds?.preMatchOverUnder;

  return (
    <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-700/50">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          ⚽ 进球投注建议
          {isLive && <span className="text-[10px] text-green-400 animate-pulse">● LIVE</span>}
        </h3>
        <div className="flex items-center gap-3">
          {liveOdds?.status && (
            <span className="text-sm text-amber-400 font-mono">
              {liveOdds.status.elapsed}'
            </span>
          )}
          {/* 显示实时大小球主盘口 */}
          {mainOverUnder ? (
            <div className="text-right bg-emerald-500/10 rounded-lg px-2 py-0.5 border border-emerald-500/30">
              <div className="text-[9px] text-emerald-400">大小球主盘</div>
              <div className="flex items-center gap-1">
                <span className="text-sm font-bold text-white">{mainOverUnder.line}</span>
                <span className="text-[10px] text-slate-400">|</span>
                <span className="text-[10px] text-green-400">大{mainOverUnder.over.toFixed(2)}</span>
                <span className="text-[10px] text-blue-400">小{mainOverUnder.under.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="text-right">
              <div className="text-[10px] text-slate-500">预期进球</div>
              <div className="text-sm font-bold text-amber-400">
                {tips.totalExpectedGoals.toFixed(1)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 实时主盘口区域 */}
      {hasLiveOdds && (
        <div className="space-y-4">
          {/* 胜平负 1x2 */}
          {liveOdds.matchWinner && (
            <div>
              <div className="text-xs text-slate-400 mb-2 font-medium flex items-center gap-2">
                胜平负 (1x2)
                {oddsChange?.matchWinner && (
                  <span className="text-[10px] text-slate-500">赔率变动中</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className={`text-center p-3 rounded-lg transition-all duration-300 ${
                  liveOdds.matchWinner.suspended 
                    ? 'bg-red-900/20 opacity-60' 
                    : oddsChange?.matchWinner?.home !== 'same' 
                      ? getOddsChangeStyle(oddsChange?.matchWinner?.home).bgColor 
                      : 'bg-blue-500/10 hover:bg-blue-500/20'
                }`}>
                  <div className="text-xs text-blue-400 mb-1">主胜</div>
                  <OddsValue 
                    value={liveOdds.matchWinner.home} 
                    direction={oddsChange?.matchWinner?.home}
                    baseColor="text-white"
                  />
                </div>
                <div className={`text-center p-3 rounded-lg transition-all duration-300 ${
                  liveOdds.matchWinner.suspended 
                    ? 'bg-red-900/20 opacity-60' 
                    : oddsChange?.matchWinner?.draw !== 'same' 
                      ? getOddsChangeStyle(oddsChange?.matchWinner?.draw).bgColor 
                      : 'bg-slate-700/30 hover:bg-slate-700/50'
                }`}>
                  <div className="text-xs text-slate-400 mb-1">平局</div>
                  <OddsValue 
                    value={liveOdds.matchWinner.draw} 
                    direction={oddsChange?.matchWinner?.draw}
                    baseColor="text-white"
                  />
                </div>
                <div className={`text-center p-3 rounded-lg transition-all duration-300 ${
                  liveOdds.matchWinner.suspended 
                    ? 'bg-red-900/20 opacity-60' 
                    : oddsChange?.matchWinner?.away !== 'same' 
                      ? getOddsChangeStyle(oddsChange?.matchWinner?.away).bgColor 
                      : 'bg-red-500/10 hover:bg-red-500/20'
                }`}>
                  <div className="text-xs text-red-400 mb-1">客胜</div>
                  <OddsValue 
                    value={liveOdds.matchWinner.away} 
                    direction={oddsChange?.matchWinner?.away}
                    baseColor="text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 🟢 AI 让球盘推荐区域 */}
          {tips.handicapRecommendation && (
            <div className="mb-3 p-3 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/50 relative overflow-hidden">
              {/* AI 推荐标签 */}
              <div className="absolute top-0 right-0 bg-amber-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-bl-md">
                🤖 AI
              </div>
              
              <div className="flex items-center gap-2 mb-2">
                <div className="text-xs font-bold text-amber-400">
                  🎯 让球盘推荐
                </div>
                <div className="text-[10px] text-slate-400">
                  置信度:{(tips.handicapRecommendation.confidence * 100).toFixed(0)}%
                </div>
                {/* 显示价值边际 */}
                {tips.handicapRecommendation.valueEdge > 0 && (
                  <div className={`text-[10px] px-1.5 py-0.5 rounded ${
                    tips.handicapRecommendation.valueEdge > 0.1 
                      ? 'bg-green-500/30 text-green-400' 
                      : 'bg-yellow-500/30 text-yellow-400'
                  }`}>
                    +{(tips.handicapRecommendation.valueEdge * 100).toFixed(1)}%
                  </div>
                )}
              </div>
              
              {/* 推荐内容 - 改为网格布局 */}
              <div className="grid grid-cols-5 gap-2 mb-2">
                {/* 推荐方向 */}
                <div className={`col-span-2 px-2 py-1.5 rounded-md font-bold text-xs text-center truncate ${
                  tips.handicapRecommendation.recommendedSide === 'HOME'
                    ? 'bg-blue-500/30 text-blue-300 ring-1 ring-blue-500'
                    : 'bg-red-500/30 text-red-300 ring-1 ring-red-500'
                }`}>
                  {tips.handicapRecommendation.recommendedSide === 'HOME' ? homeTeam : awayTeam}
                </div>
                
                {/* 盘口 */}
                <div className="text-center">
                  <div className="text-[9px] text-slate-400">盘口</div>
                  <div className="text-sm font-bold text-white">
                    {tips.handicapRecommendation.recommendedLine.startsWith('-') || tips.handicapRecommendation.recommendedLine.startsWith('+') 
                      ? tips.handicapRecommendation.recommendedLine 
                      : (parseFloat(tips.handicapRecommendation.recommendedLine) >= 0 ? '+' : '') + tips.handicapRecommendation.recommendedLine}
                  </div>
                </div>
                
                {/* 赢盘率 */}
                <div className="text-center">
                  <div className="text-[9px] text-slate-400">赢盘率</div>
                  <div className="text-sm font-bold text-green-400">
                    {(tips.handicapRecommendation.winProbability * 100).toFixed(0)}%
                  </div>
                </div>
                
                {/* 赔率 */}
                <div className="text-center">
                  <div className="text-[9px] text-slate-400">赔率</div>
                  <div className="text-sm font-bold text-amber-400">
                    {tips.handicapRecommendation.marketOdds > 0 
                      ? tips.handicapRecommendation.marketOdds.toFixed(2) 
                      : '-'}
                  </div>
                </div>
              </div>
              
              {/* 推荐理由 - 简化显示 */}
              <div className="text-[10px] text-slate-300 bg-slate-800/50 rounded-md p-2 leading-relaxed">
                💡 推荐 {tips.handicapRecommendation.recommendedSide === 'HOME' ? '主队' : '客队'} | 
                当前盘口{parseFloat(tips.handicapRecommendation.recommendedLine) < 0 ? '让' : '受让'} {Math.abs(parseFloat(tips.handicapRecommendation.recommendedLine))} 球，
                AI 预测主队剩余时间净胜 {tips.handicapRecommendation.predictedMargin.toFixed(2)} 球。
                赢盘率 {(tips.handicapRecommendation.winProbability * 100).toFixed(1)}%，
                市场赔率 {tips.handicapRecommendation.marketOdds.toFixed(2)} vs 公平赔率 {tips.handicapRecommendation.fairOdds.toFixed(2)}，
                价值边际 {(tips.handicapRecommendation.valueEdge * 100).toFixed(1)}%。
              </div>
            </div>
          )}

          {/* 🟢 赛前原始盘口 (基于 0-0 开球) */}
          {(preMatchAsianHandicap || preMatchOverUnder) && (
            <div className="mb-3">
              <div className="text-[10px] text-cyan-400 mb-2 font-medium flex items-center gap-1">
                🏁 赛前原始盘口 <span className="text-slate-500">(基于 0-0 开球)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {/* 赛前亚洲让球盘 */}
                {preMatchAsianHandicap && (
                  <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 border border-cyan-500/30">
                    <div className="text-[10px] text-cyan-400 mb-1 font-medium">🎯 让球盘</div>
                    <div className="text-center mb-1">
                      <span className="text-lg font-bold text-cyan-300">
                        {preMatchAsianHandicap.line.startsWith('-') || preMatchAsianHandicap.line.startsWith('+') ? '' : '+'}{preMatchAsianHandicap.line}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-center">
                      <div className="bg-cyan-500/10 rounded p-1">
                        <div className="text-[9px] text-cyan-400 truncate">{homeTeam}</div>
                        <div className="text-sm font-bold text-cyan-300">{preMatchAsianHandicap.home.toFixed(2)}</div>
                      </div>
                      <div className="bg-cyan-500/10 rounded p-1">
                        <div className="text-[9px] text-cyan-400 truncate">{awayTeam}</div>
                        <div className="text-sm font-bold text-cyan-300">{preMatchAsianHandicap.away.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                )}
                {/* 赛前大小球 */}
                {preMatchOverUnder && (
                  <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 border border-cyan-500/30">
                    <div className="text-[10px] text-cyan-400 mb-1 font-medium">⚽ 大小球</div>
                    <div className="text-center mb-1">
                      <span className="text-lg font-bold text-cyan-300">{preMatchOverUnder.line} 球</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-center">
                      <div className="bg-cyan-500/10 rounded p-1">
                        <div className="text-[9px] text-cyan-400">大球</div>
                        <div className="text-sm font-bold text-cyan-300">{preMatchOverUnder.over.toFixed(2)}</div>
                      </div>
                      <div className="bg-cyan-500/10 rounded p-1">
                        <div className="text-[9px] text-cyan-400">小球</div>
                        <div className="text-sm font-bold text-cyan-300">{preMatchOverUnder.under.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 滚球主盘口卡片 - 亚洲盘和大小球并排显示 */}
          <div className="grid grid-cols-2 gap-2">
            {/* 滚球亚洲盘口主盘 */}
            {mainAsianHandicap && (
              <div className={`p-2 rounded-lg bg-gradient-to-br from-purple-500/10 to-purple-600/5 border ${
                tips.handicapRecommendation 
                  ? 'border-amber-500/50 ring-1 ring-amber-500/30' 
                  : 'border-purple-500/20'
              } ${mainAsianHandicap.suspended ? 'opacity-50' : ''}`}>
                <div className="text-[10px] text-purple-400 mb-1 font-medium flex items-center gap-1">
                  🎯 滚球亚盘
                  <span className="text-amber-400">★</span>
                  {tips.handicapRecommendation && (
                    <span className="text-amber-400 text-[9px] bg-amber-500/20 px-1 rounded">←AI</span>
                  )}
                </div>
                <div className="text-center mb-1">
                  <span className="text-lg font-bold text-white">
                    {mainAsianHandicap.line.startsWith('-') || mainAsianHandicap.line.startsWith('+') ? '' : '+'}{mainAsianHandicap.line}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-center">
                  <div className={`rounded p-1 transition-all duration-300 ${
                    tips.handicapRecommendation?.recommendedSide === 'HOME'
                      ? 'bg-amber-500/30 ring-1 ring-amber-500'
                      : oddsChange?.asianHandicap?.home !== 'same' 
                        ? getOddsChangeStyle(oddsChange?.asianHandicap?.home).bgColor 
                        : 'bg-blue-500/10'
                  }`}>
                    <div className="text-[9px] text-blue-400 truncate">
                      {homeTeam}
                      {tips.handicapRecommendation?.recommendedSide === 'HOME' && (
                        <span className="text-amber-400 ml-0.5">★</span>
                      )}
                    </div>
                    <div className={`text-sm font-bold ${
                      tips.handicapRecommendation?.recommendedSide === 'HOME' ? 'text-amber-400' : 'text-blue-400'
                    }`}>
                      {mainAsianHandicap.home.toFixed(2)}
                    </div>
                  </div>
                  <div className={`rounded p-1 transition-all duration-300 ${
                    tips.handicapRecommendation?.recommendedSide === 'AWAY'
                      ? 'bg-amber-500/30 ring-1 ring-amber-500'
                      : oddsChange?.asianHandicap?.away !== 'same' 
                        ? getOddsChangeStyle(oddsChange?.asianHandicap?.away).bgColor 
                        : 'bg-red-500/10'
                  }`}>
                    <div className="text-[9px] text-red-400 truncate">
                      {awayTeam}
                      {tips.handicapRecommendation?.recommendedSide === 'AWAY' && (
                        <span className="text-amber-400 ml-0.5">★</span>
                      )}
                    </div>
                    <div className={`text-sm font-bold ${
                      tips.handicapRecommendation?.recommendedSide === 'AWAY' ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {mainAsianHandicap.away.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 滚球大小球主盘 */}
            {mainOverUnder && (
              <div className={`p-2 rounded-lg bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 ${mainOverUnder.suspended ? 'opacity-50' : ''}`}>
                <div className="text-[10px] text-emerald-400 mb-1 font-medium flex items-center gap-1">
                  ⚽ 滚球大小球
                  <span className="text-amber-400">★</span>
                </div>
                <div className="text-center mb-1">
                  <span className="text-lg font-bold text-white">
                    {mainOverUnder.line} 球
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-center">
                  <div className={`rounded p-1 transition-all duration-300 ${
                    oddsChange?.overUnder?.over !== 'same' 
                      ? getOddsChangeStyle(oddsChange?.overUnder?.over).bgColor 
                      : 'bg-green-500/10'
                  }`}>
                    <div className="text-[9px] text-green-400">大球</div>
                    <div className="text-sm font-bold text-green-400">
                      {mainOverUnder.over.toFixed(2)}
                    </div>
                  </div>
                  <div className={`rounded p-1 transition-all duration-300 ${
                    oddsChange?.overUnder?.under !== 'same' 
                      ? getOddsChangeStyle(oddsChange?.overUnder?.under).bgColor 
                      : 'bg-blue-500/10'
                  }`}>
                    <div className="text-[9px] text-blue-400">小球</div>
                    <div className="text-sm font-bold text-blue-400">
                      {mainOverUnder.under.toFixed(2)}
                    </div>
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
                      {liveOdds.asianHandicap[0].line.startsWith('-') || liveOdds.asianHandicap[0].line.startsWith('+') ? '' : '+'}{liveOdds.asianHandicap[0].line}
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

          {/* 赔率变动图例 */}
          <div className="flex items-center justify-center gap-4 text-[10px] text-slate-500 pt-2">
            <span className="flex items-center gap-1">
              <span className="text-red-400">↑</span> 赔率上升
            </span>
            <span className="flex items-center gap-1">
              <span className="text-green-400">↓</span> 赔率下降
            </span>
          </div>
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
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <div className="text-[10px] text-slate-400 mb-1.5 font-medium">🎯 下一球预测</div>
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className={`p-1.5 rounded ${tips.nextGoal.recommendation === 'HOME' ? 'bg-blue-500/20 ring-1 ring-blue-500/50' : 'bg-slate-800/50'}`}>
              <div className="text-[9px] text-blue-400 truncate">{homeTeam}</div>
              <div className="text-sm font-bold text-white">{(tips.nextGoal.homeProb * 100).toFixed(0)}%</div>
            </div>
            <div className={`p-1.5 rounded ${tips.nextGoal.recommendation === 'NO_GOAL' ? 'bg-slate-500/20 ring-1 ring-slate-500/50' : 'bg-slate-800/50'}`}>
              <div className="text-[9px] text-slate-400">无进球</div>
              <div className="text-sm font-bold text-white">{(tips.nextGoal.noGoalProb * 100).toFixed(0)}%</div>
            </div>
            <div className={`p-1.5 rounded ${tips.nextGoal.recommendation === 'AWAY' ? 'bg-red-500/20 ring-1 ring-red-500/50' : 'bg-slate-800/50'}`}>
              <div className="text-[9px] text-red-400 truncate">{awayTeam}</div>
              <div className="text-sm font-bold text-white">{(tips.nextGoal.awayProb * 100).toFixed(0)}%</div>
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
