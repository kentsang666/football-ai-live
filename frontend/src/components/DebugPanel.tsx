/**
 * 调试面板组件
 * 
 * 功能：
 * - 测试通知按钮
 * - 启用音频按钮
 * - 请求通知权限按钮
 * - 显示当前状态
 */

import React, { useState } from 'react';
import { alertSoundManager } from '../hooks/usePredictionAlert';

interface DebugPanelProps {
  onTestNotification: () => void;
  onEnableAudio: () => void;
  onRequestPermission: () => Promise<boolean>;
  isAudioEnabled: boolean;
  isNotificationGranted: boolean;
  unreadCount: number;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
  onTestNotification,
  onEnableAudio,
  onRequestPermission,
  isAudioEnabled,
  isNotificationGranted,
  unreadCount,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<string>('未请求');

  const handleRequestPermission = async () => {
    const granted = await onRequestPermission();
    setPermissionStatus(granted ? '已授权 ✅' : '已拒绝 ❌');
  };

  const handleEnableAudio = () => {
    onEnableAudio();
    // 强制刷新状态
    setTimeout(() => {
      setPermissionStatus(prev => prev); // 触发重渲染
    }, 100);
  };

  return (
    <div className="fixed bottom-4 left-4 z-40">
      {/* 展开/收起按钮 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-2 rounded-lg text-xs flex items-center gap-2 shadow-lg transition-colors"
      >
        <span>🔧</span>
        <span>{isExpanded ? '收起调试' : '调试面板'}</span>
        {unreadCount > 0 && (
          <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full animate-pulse">
            {unreadCount}
          </span>
        )}
      </button>

      {/* 调试面板内容 */}
      {isExpanded && (
        <div className="absolute bottom-12 left-0 bg-gray-900 border border-gray-700 rounded-xl p-4 shadow-2xl min-w-[280px]">
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            <span>🛠️</span>
            <span>通知系统调试</span>
          </h3>

          {/* 状态显示 */}
          <div className="space-y-2 mb-4 text-xs">
            <div className="flex justify-between items-center text-gray-300">
              <span>音频状态:</span>
              <span className={isAudioEnabled ? 'text-green-400' : 'text-yellow-400'}>
                {isAudioEnabled ? '已启用 🔊' : '未启用 🔇'}
              </span>
            </div>
            <div className="flex justify-between items-center text-gray-300">
              <span>浏览器通知:</span>
              <span className={isNotificationGranted ? 'text-green-400' : 'text-yellow-400'}>
                {isNotificationGranted ? '已授权 ✅' : permissionStatus}
              </span>
            </div>
            <div className="flex justify-between items-center text-gray-300">
              <span>未读通知:</span>
              <span className="text-blue-400">{unreadCount}</span>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="space-y-2">
            {/* 启用音频 */}
            {!isAudioEnabled && (
              <button
                onClick={handleEnableAudio}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <span>🔊</span>
                <span>启用音频</span>
              </button>
            )}

            {/* 请求通知权限 */}
            {!isNotificationGranted && (
              <button
                onClick={handleRequestPermission}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <span>🔔</span>
                <span>请求通知权限</span>
              </button>
            )}

            {/* 测试通知 */}
            <button
              onClick={onTestNotification}
              className="w-full bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <span>🚨</span>
              <span>测试通知</span>
            </button>

            {/* 测试声音 */}
            <button
              onClick={() => alertSoundManager.playAlertSound()}
              className="w-full bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <span>🔔</span>
              <span>测试声音</span>
            </button>
          </div>

          {/* 提示信息 */}
          <div className="mt-4 text-xs text-gray-500 border-t border-gray-700 pt-3">
            <p>💡 提示：</p>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>首次需点击"启用音频"</li>
              <li>浏览器最小化时会发送系统通知</li>
              <li>标题栏会闪烁提示新推荐</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default DebugPanel;
