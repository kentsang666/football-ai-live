/**
 * GoalBettingTips - 进球投注建议组件
 * 
 * 显示大小球预测和下一球预测
 * 高置信度推荐会以红色/高亮标签标注
 */

import type { GoalBettingTips as GoalBettingTipsType, GoalPrediction, NextGoalPrediction } from '../../types/prediction';

interface GoalBettingTipsProps {
  /** 进球投注建议数据 */
  tips: GoalBettingTipsType;
  /** 比赛状态 */
  matchStatus: 'live' | 'halftime' | 'finished' | 'not_started';
  /** 主队名称 */
  homeTeam: string;
  /** 客队名称 */
  awayTeam: string;
  /** 当前比分 */
  currentScore: { home: number; away: number };
  /** 当前分钟 */
  currentMinute: number;
}

/**
 * 高置信度阈值
 */
const HIGH_CONFIDENCE_THRESHOLD = 0.7;

/**
 * 格式化概率为百分比
 */
function formatPercent(prob: number): string {
  return `${(prob * 100).toFixed(1)}%`;
}

/**
 * 格式化赔率
 */
function formatOdds(odds: number): string {
  return odds.toFixed(2);
}

/**
 * 大小球预测卡片
 */
function OverUnderCard({ prediction, currentGoals }: { prediction: GoalPrediction; currentGoals: number }) {
  const isHighConfidence = prediction.confidence >= HIGH_CONFIDENCE_THRESHOLD && prediction.recommendation !== 'NEUTRAL';
  const isOver = prediction.recommendation === 'OVER';
  const isUnder = prediction.recommendation === 'UNDER';
  
  // 判断当前是否已经超过该线
  const alreadyOver = currentGoals > prediction.line;
  
  return (
    <div className={`
      relative p-3 rounded-lg border transition-all duration-300
      ${isHighConfidence 
        ? 'border-amber-500/50 bg-amber-500/10' 
        : 'border-slate-600/30 bg-slate-800/30'
      }
    `}>
      {/* 高置信度标签 */}
      {isHighConfidence && (
        <div className="absolute -top-2 -right-2">
          <span className="px-2 py-0.5 text-[10px] font-bold bg-red-500 text-white rounded-full animate-pulse">
            🔥 高信心
          </span>
        </div>
      )}
      
      {/* 盘口线 */}
      <div className="text-center mb-2">
        <span className="text-lg font-bold text-white">
          {prediction.line} 球
        </span>
        {alreadyOver && (
          <span className="ml-2 text-xs text-green-400">✓ 已大</span>
        )}
      </div>
      
      {/* 大小球概率对比 */}
      <div className="flex items-center justify-between gap-2 mb-2">
        {/* 大球 */}
        <div className={`
          flex-1 text-center p-2 rounded-lg transition-all
          ${isOver ? 'bg-green-500/20 ring-1 ring-green-500/50' : 'bg-slate-700/30'}
        `}>
          <div className="text-xs text-slate-400 mb-1">大 {prediction.line}</div>
          <div className={`text-lg font-bold ${isOver ? 'text-green-400' : 'text-slate-300'}`}>
            {formatPercent(prediction.overProb)}
          </div>
          <div className="text-xs text-slate-500">
            @ {formatOdds(prediction.overOdds)}
          </div>
        </div>
        
        {/* VS */}
        <div className="text-slate-500 text-xs">VS</div>
        
        {/* 小球 */}
        <div className={`
          flex-1 text-center p-2 rounded-lg transition-all
          ${isUnder ? 'bg-blue-500/20 ring-1 ring-blue-500/50' : 'bg-slate-700/30'}
        `}>
          <div className="text-xs text-slate-400 mb-1">小 {prediction.line}</div>
          <div className={`text-lg font-bold ${isUnder ? 'text-blue-400' : 'text-slate-300'}`}>
            {formatPercent(prediction.underProb)}
          </div>
          <div className="text-xs text-slate-500">
            @ {formatOdds(prediction.underOdds)}
          </div>
        </div>
      </div>
      
      {/* 推荐指示 */}
      {prediction.recommendation !== 'NEUTRAL' && (
        <div className={`
          text-center text-xs font-medium py-1 rounded
          ${isOver ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}
        `}>
          推荐: {isOver ? `大 ${prediction.line}` : `小 ${prediction.line}`}
        </div>
      )}
    </div>
  );
}

/**
 * 下一球预测卡片
 */
function NextGoalCard({ 
  prediction, 
  homeTeam, 
  awayTeam,
  currentMinute 
}: { 
  prediction: NextGoalPrediction;
  homeTeam: string;
  awayTeam: string;
  currentMinute: number;
}) {
  const isHighConfidence = prediction.confidence >= HIGH_CONFIDENCE_THRESHOLD && prediction.recommendation !== 'NEUTRAL';
  
  const getRecommendationText = () => {
    switch (prediction.recommendation) {
      case 'HOME': return `${homeTeam} 进下一球`;
      case 'AWAY': return `${awayTeam} 进下一球`;
      case 'NO_GOAL': return '不再进球';
      default: return '无明确推荐';
    }
  };
  
  const getRecommendationColor = () => {
    switch (prediction.recommendation) {
      case 'HOME': return 'text-blue-400';
      case 'AWAY': return 'text-red-400';
      case 'NO_GOAL': return 'text-slate-400';
      default: return 'text-slate-500';
    }
  };

  return (
    <div className={`
      relative p-4 rounded-lg border transition-all duration-300
      ${isHighConfidence 
        ? 'border-amber-500/50 bg-amber-500/10' 
        : 'border-slate-600/30 bg-slate-800/30'
      }
    `}>
      {/* 高置信度标签 */}
      {isHighConfidence && (
        <div className="absolute -top-2 -right-2">
          <span className="px-2 py-0.5 text-[10px] font-bold bg-red-500 text-white rounded-full animate-pulse">
            🔥 高信心
          </span>
        </div>
      )}
      
      <div className="text-center mb-3">
        <span className="text-sm font-medium text-slate-300">下一球预测</span>
      </div>
      
      {/* 三方概率 */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {/* 主队 */}
        <div className={`
          text-center p-2 rounded-lg
          ${prediction.recommendation === 'HOME' ? 'bg-blue-500/20 ring-1 ring-blue-500/50' : 'bg-slate-700/30'}
        `}>
          <div className="text-xs text-blue-400 mb-1 truncate">{homeTeam}</div>
          <div className={`text-lg font-bold ${prediction.recommendation === 'HOME' ? 'text-blue-400' : 'text-slate-300'}`}>
            {formatPercent(prediction.homeProb)}
          </div>
        </div>
        
        {/* 不进球 */}
        <div className={`
          text-center p-2 rounded-lg
          ${prediction.recommendation === 'NO_GOAL' ? 'bg-slate-500/20 ring-1 ring-slate-500/50' : 'bg-slate-700/30'}
        `}>
          <div className="text-xs text-slate-400 mb-1">无进球</div>
          <div className={`text-lg font-bold ${prediction.recommendation === 'NO_GOAL' ? 'text-slate-300' : 'text-slate-400'}`}>
            {formatPercent(prediction.noGoalProb)}
          </div>
        </div>
        
        {/* 客队 */}
        <div className={`
          text-center p-2 rounded-lg
          ${prediction.recommendation === 'AWAY' ? 'bg-red-500/20 ring-1 ring-red-500/50' : 'bg-slate-700/30'}
        `}>
          <div className="text-xs text-red-400 mb-1 truncate">{awayTeam}</div>
          <div className={`text-lg font-bold ${prediction.recommendation === 'AWAY' ? 'text-red-400' : 'text-slate-300'}`}>
            {formatPercent(prediction.awayProb)}
          </div>
        </div>
      </div>
      
      {/* 推荐和预计时间 */}
      <div className="flex items-center justify-between text-xs">
        <span className={`font-medium ${getRecommendationColor()}`}>
          {getRecommendationText()}
        </span>
        {prediction.expectedMinutes > currentMinute && prediction.recommendation !== 'NO_GOAL' && (
          <span className="text-slate-500">
            预计 {prediction.expectedMinutes}'
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * 高置信度推荐横幅
 */
function HighConfidenceBanner({ tip, homeTeam, awayTeam }: { 
  tip: GoalBettingTipsType['highConfidenceTip'];
  homeTeam: string;
  awayTeam: string;
}) {
  if (!tip) return null;
  
  const getDescription = () => {
    switch (tip.type) {
      case 'OVER':
        return `大 ${tip.line} 球`;
      case 'UNDER':
        return `小 ${tip.line} 球`;
      case 'NEXT_GOAL_HOME':
        return `${homeTeam} 进下一球`;
      case 'NEXT_GOAL_AWAY':
        return `${awayTeam} 进下一球`;
      default:
        return tip.description;
    }
  };

  return (
    <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-red-500/20 via-amber-500/20 to-red-500/20 border border-amber-500/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl animate-bounce">🔥</span>
          <div>
            <div className="text-xs text-amber-400 font-medium">高信心推荐</div>
            <div className="text-white font-bold">{getDescription()}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-amber-400">
            {formatPercent(tip.probability)}
          </div>
          <div className="text-xs text-slate-400">
            置信度 {formatPercent(tip.confidence)}
          </div>
        </div>
      </div>
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
  currentScore,
  currentMinute
}: GoalBettingTipsProps) {
  const currentGoals = currentScore.home + currentScore.away;
  const isLive = matchStatus === 'live' || matchStatus === 'halftime';
  const isPreMatch = matchStatus === 'not_started';
  
  // 筛选显示的大小球盘口（根据当前进球数）
  const relevantLines = tips.overUnder.filter(ou => {
    // 赛前显示 2.5 为主
    if (isPreMatch) return ou.line === 2.5 || ou.line === 1.5 || ou.line === 3.5;
    // 滚球中显示当前进球数附近的盘口
    return ou.line >= currentGoals && ou.line <= currentGoals + 3;
  }).slice(0, 3);

  return (
    <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          ⚽ 进球投注建议
          {isLive && <span className="text-xs text-green-400 animate-pulse">● 滚球</span>}
          {isPreMatch && <span className="text-xs text-blue-400">赛前</span>}
        </h3>
        <div className="text-right">
          <div className="text-xs text-slate-400">预期总进球</div>
          <div className="text-lg font-bold text-amber-400">
            {tips.totalExpectedGoals.toFixed(1)}
          </div>
        </div>
      </div>
      
      {/* 高置信度推荐横幅 */}
      <HighConfidenceBanner tip={tips.highConfidenceTip} homeTeam={homeTeam} awayTeam={awayTeam} />
      
      {/* 大小球预测 */}
      <div className="mb-4">
        <div className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
          📊 大小球预测
          {isLive && (
            <span className="text-xs text-slate-500">
              (当前 {currentGoals} 球，剩余预期 +{tips.remainingExpectedGoals.toFixed(1)})
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {relevantLines.map((prediction) => (
            <OverUnderCard 
              key={prediction.line} 
              prediction={prediction} 
              currentGoals={currentGoals}
            />
          ))}
        </div>
      </div>
      
      {/* 下一球预测（仅滚球中显示） */}
      {isLive && (
        <div>
          <div className="text-sm font-medium text-slate-400 mb-2">
            🎯 下一球预测
          </div>
          <NextGoalCard 
            prediction={tips.nextGoal}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            currentMinute={currentMinute}
          />
        </div>
      )}
      
      {/* 赛前提示 */}
      {isPreMatch && (
        <div className="mt-3 p-2 rounded bg-slate-800/50 text-xs text-slate-400 text-center">
          💡 比赛开始后将显示实时下一球预测
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
      🔥 {getShortText()} {formatPercent(tip.probability)}
    </span>
  );
}

export default GoalBettingTips;
