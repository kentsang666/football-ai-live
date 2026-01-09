/**
 * MomentumGauge - 势能对比组件
 * 
 * 显示主客队的场上压力对比，使用横向条形图展示
 * 当某方压力值 > 80 时，显示进球预警动画
 */

import type { PressureAnalysis } from '../../types/prediction';

interface MomentumGaugeProps {
  /** 压力分析数据 */
  pressure: PressureAnalysis;
  /** 是否显示标签 */
  showLabel?: boolean;
  /** 是否紧凑模式 */
  compact?: boolean;
}

/**
 * 进球预警阈值
 */
const GOAL_ALERT_THRESHOLD = 80;

export function MomentumGauge({ 
  pressure, 
  showLabel = true,
  compact = false 
}: MomentumGaugeProps) {
  const { homeNormalized, awayNormalized, dominantTeam } = pressure;
  
  // 判断是否显示进球预警
  const homeAlert = homeNormalized > GOAL_ALERT_THRESHOLD;
  const awayAlert = awayNormalized > GOAL_ALERT_THRESHOLD;
  
  // 根据主导方确定高亮颜色
  const getDominantStyle = () => {
    switch (dominantTeam) {
      case 'HOME':
        return 'text-blue-400';
      case 'AWAY':
        return 'text-red-400';
      default:
        return 'text-slate-400';
    }
  };

  return (
    <div className={`${compact ? 'py-1' : 'py-2'}`}>
      {/* 进球预警 */}
      {(homeAlert || awayAlert) && (
        <div className="flex justify-center mb-1.5">
          <div className={`
            flex items-center gap-1.5 px-2.5 py-1 rounded-full
            ${homeAlert ? 'bg-blue-500/20' : 'bg-red-500/20'}
            animate-pulse
          `}>
            <span className="text-base animate-bounce">🔥</span>
            <span className={`text-xs font-medium ${homeAlert ? 'text-blue-400' : 'text-red-400'}`}>
              {homeAlert ? '主队' : '客队'}进球预警！
            </span>
            <span className="text-base animate-bounce">🔥</span>
          </div>
        </div>
      )}

      {/* 标签行 */}
      {showLabel && (
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-blue-400 font-medium">
            {homeNormalized.toFixed(0)}%
          </span>
          <span className={`${getDominantStyle()} font-medium`}>
            势能对比
          </span>
          <span className="text-red-400 font-medium">
            {awayNormalized.toFixed(0)}%
          </span>
        </div>
      )}

      {/* 势能条 */}
      <div className="relative flex h-3 rounded-full overflow-hidden bg-slate-700/30">
        {/* 主队压力条 (蓝色，从左向右) */}
        <div 
          className={`
            transition-all duration-700 ease-out
            ${homeAlert 
              ? 'bg-gradient-to-r from-blue-600 to-blue-400 animate-pulse' 
              : 'bg-gradient-to-r from-blue-600 to-blue-500'
            }
          `}
          style={{ width: `${homeNormalized}%` }}
        >
          {/* 高亮边缘效果 */}
          {homeNormalized > 50 && (
            <div className="absolute right-0 top-0 bottom-0 w-1 bg-white/30" 
                 style={{ left: `${homeNormalized - 1}%` }} 
            />
          )}
        </div>
        
        {/* 客队压力条 (红色，从右向左) */}
        <div 
          className={`
            transition-all duration-700 ease-out
            ${awayAlert 
              ? 'bg-gradient-to-l from-red-600 to-red-400 animate-pulse' 
              : 'bg-gradient-to-l from-red-600 to-red-500'
            }
          `}
          style={{ width: `${awayNormalized}%` }}
        />

        {/* 中心分隔线 */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-500/50 transform -translate-x-1/2" />
        
        {/* 主导方指示器 */}
        {dominantTeam !== 'BALANCED' && (
          <div 
            className={`
              absolute top-1/2 transform -translate-y-1/2
              w-0 h-0 border-t-[4px] border-b-[4px] border-transparent
              ${dominantTeam === 'HOME' 
                ? 'border-r-[6px] border-r-blue-300 left-[48%]' 
                : 'border-l-[6px] border-l-red-300 right-[48%]'
              }
              transition-all duration-500
            `}
          />
        )}
      </div>

      {/* 底部状态文字 */}
      {!compact && (
        <div className="flex justify-center mt-1.5">
          <span className={`text-[10px] ${getDominantStyle()}`}>
            {dominantTeam === 'HOME' && '⬅ 主队主导'}
            {dominantTeam === 'AWAY' && '客队主导 ➡'}
            {dominantTeam === 'BALANCED' && '势均力敌'}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * 迷你版势能指示器（用于列表视图）
 */
export function MomentumIndicator({ pressure }: { pressure: PressureAnalysis }) {
  const { homeNormalized, awayNormalized } = pressure;
  const homeAlert = homeNormalized > GOAL_ALERT_THRESHOLD;
  const awayAlert = awayNormalized > GOAL_ALERT_THRESHOLD;

  return (
    <div className="flex items-center gap-1">
      {/* 主队指示 */}
      <div className={`
        w-2 h-2 rounded-full
        ${homeAlert ? 'bg-blue-400 animate-pulse' : 'bg-blue-600'}
      `} />
      
      {/* 势能条 */}
      <div className="flex w-16 h-1.5 rounded-full overflow-hidden bg-slate-700/30">
        <div 
          className={`bg-blue-500 ${homeAlert ? 'animate-pulse' : ''}`}
          style={{ width: `${homeNormalized}%` }}
        />
        <div 
          className={`bg-red-500 ${awayAlert ? 'animate-pulse' : ''}`}
          style={{ width: `${awayNormalized}%` }}
        />
      </div>
      
      {/* 客队指示 */}
      <div className={`
        w-2 h-2 rounded-full
        ${awayAlert ? 'bg-red-400 animate-pulse' : 'bg-red-600'}
      `} />
      
      {/* 进球预警图标 */}
      {(homeAlert || awayAlert) && (
        <span className="text-xs animate-bounce">🔥</span>
      )}
    </div>
  );
}

export default MomentumGauge;
