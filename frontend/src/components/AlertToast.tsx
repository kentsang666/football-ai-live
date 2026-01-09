/**
 * 悬浮提示卡组件 (Alert Toast)
 * 
 * 功能：
 * - 右上角弹出
 * - 醒目的"信号绿"或"警示红"背景
 * - 维持 10 秒
 * - 可手动关闭
 */

import React, { useEffect, useState } from 'react';
import type { AlertData } from '../hooks/usePredictionAlert';

interface AlertToastProps {
  alerts: AlertData[];
  onDismiss: (id: string) => void;
  onClearAll: () => void;
}

export const AlertToast: React.FC<AlertToastProps> = ({
  alerts,
  onDismiss,
  onClearAll,
}) => {
  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-md">
      {/* 清除全部按钮 */}
      {alerts.length > 1 && (
        <button
          onClick={onClearAll}
          className="self-end px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
        >
          清除全部 ({alerts.length})
        </button>
      )}
      
      {/* Toast 列表 */}
      {alerts.map((alert) => (
        <SingleToast
          key={alert.id}
          alert={alert}
          onDismiss={() => onDismiss(alert.id)}
        />
      ))}
    </div>
  );
};

// 单个 Toast 组件
const SingleToast: React.FC<{
  alert: AlertData;
  onDismiss: () => void;
}> = ({ alert, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(100);

  // 进度条动画
  useEffect(() => {
    const duration = 10000; // 10秒
    const interval = 100;
    const decrement = (interval / duration) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev <= 0) {
          clearInterval(timer);
          return 0;
        }
        return prev - decrement;
      });
    }, interval);

    return () => clearInterval(timer);
  }, []);

  // 退出动画
  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(onDismiss, 300);
  };

  // 根据严重程度选择颜色
  const getBgColor = () => {
    switch (alert.severity) {
      case 'high':
        return 'bg-gradient-to-r from-green-600 to-green-500'; // 信号绿
      case 'medium':
        return 'bg-gradient-to-r from-yellow-600 to-yellow-500'; // 警示黄
      case 'low':
        return 'bg-gradient-to-r from-blue-600 to-blue-500'; // 信息蓝
      default:
        return 'bg-gradient-to-r from-green-600 to-green-500';
    }
  };

  const getBorderColor = () => {
    switch (alert.severity) {
      case 'high':
        return 'border-green-400';
      case 'medium':
        return 'border-yellow-400';
      case 'low':
        return 'border-blue-400';
      default:
        return 'border-green-400';
    }
  };

  const getProgressColor = () => {
    switch (alert.severity) {
      case 'high':
        return 'bg-green-300';
      case 'medium':
        return 'bg-yellow-300';
      case 'low':
        return 'bg-blue-300';
      default:
        return 'bg-green-300';
    }
  };

  return (
    <div
      className={`
        ${getBgColor()} ${getBorderColor()}
        border-2 rounded-xl shadow-2xl overflow-hidden
        transform transition-all duration-300 ease-out
        ${isExiting ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}
        animate-slide-in
      `}
      style={{
        animation: isExiting ? 'none' : 'slideIn 0.3s ease-out',
      }}
    >
      {/* 主内容 */}
      <div className="p-4">
        {/* 标题行 */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl animate-pulse">
              {alert.severity === 'high' ? '🚨' : alert.severity === 'medium' ? '🔔' : '💡'}
            </span>
            <span className="font-bold text-white text-lg">{alert.title}</span>
          </div>
          <button
            onClick={handleDismiss}
            className="text-white/80 hover:text-white transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 消息内容 */}
        <p className="text-white/95 text-sm mb-3 leading-relaxed">
          {alert.message}
        </p>

        {/* 详细信息 */}
        <div className="flex items-center gap-4 text-xs text-white/80">
          {alert.confidence && (
            <div className="flex items-center gap-1">
              <span>📊</span>
              <span>信心度: {Math.round(alert.confidence * 100)}%</span>
            </div>
          )}
          {alert.valueEdge !== undefined && alert.valueEdge > 0 && (
            <div className="flex items-center gap-1">
              <span>💰</span>
              <span>价值边际: {Math.round(alert.valueEdge * 100)}%</span>
            </div>
          )}
          {alert.line && (
            <div className="flex items-center gap-1">
              <span>🎯</span>
              <span>盘口: {alert.line}</span>
            </div>
          )}
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-1 bg-black/20">
        <div
          className={`h-full ${getProgressColor()} transition-all duration-100 ease-linear`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

// CSS 动画（需要添加到全局样式）
const styles = `
@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.animate-slide-in {
  animation: slideIn 0.3s ease-out;
}
`;

// 注入样式
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}

export default AlertToast;
