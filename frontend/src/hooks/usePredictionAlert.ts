/**
 * 全渠道强通知系统 (Omni-Channel Alert System)
 * 
 * 功能：
 * 1. 增量监听与去重 (The Watcher)
 * 2. 三重强提醒机制：视觉 (Toast) + 听觉 (Sound) + 标题栏 (Favicon/Title)
 * 3. 浏览器原生通知
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { MatchState } from '../store/matchStore';

// ===========================================
// 类型定义
// ===========================================

export interface AlertConfig {
  /** 信心度阈值 */
  confidenceThreshold: number;
  /** 价值边际阈值 */
  valueEdgeThreshold: number;
  /** Toast 显示时长 (ms) */
  toastDuration: number;
  /** 是否启用声音 */
  soundEnabled: boolean;
  /** 是否启用标题栏闪烁 */
  titleFlashEnabled: boolean;
  /** 是否启用浏览器通知 */
  browserNotificationEnabled: boolean;
}

export interface AlertData {
  id: string;
  matchId: string;
  type: 'handicap' | 'overunder' | 'high_confidence';
  title: string;
  message: string;
  team?: string;
  line?: string;
  confidence: number;
  valueEdge?: number;
  timestamp: number;
  severity: 'high' | 'medium' | 'low';
}

// ===========================================
// 默认配置
// ===========================================

const DEFAULT_CONFIG: AlertConfig = {
  confidenceThreshold: 0.80,  // 80%
  valueEdgeThreshold: 0.10,   // 10%
  toastDuration: 10000,       // 10秒
  soundEnabled: true,
  titleFlashEnabled: true,
  browserNotificationEnabled: true,
};

// ===========================================
// 音频管理
// ===========================================

class AlertSoundManager {
  private audioContext: AudioContext | null = null;
  private userInteracted = false;

  // 用户交互后启用音频
  enableAudio() {
    if (!this.userInteracted) {
      this.userInteracted = true;
      // 创建 AudioContext（需要用户交互后才能创建）
      try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        console.log('🔊 音频系统已启用');
      } catch (e) {
        console.warn('⚠️ 无法创建 AudioContext:', e);
      }
    }
  }

  // 播放提示音（Cash Register 收款音效）
  playAlertSound() {
    if (!this.userInteracted || !this.audioContext) {
      console.log('⚠️ 音频未启用，需要用户先交互');
      return;
    }

    try {
      const ctx = this.audioContext;
      const now = ctx.currentTime;

      // 创建主音调 - 清脆的 "叮" 声
      const oscillator1 = ctx.createOscillator();
      const gainNode1 = ctx.createGain();
      oscillator1.type = 'sine';
      oscillator1.frequency.setValueAtTime(1200, now);
      oscillator1.frequency.exponentialRampToValueAtTime(800, now + 0.1);
      gainNode1.gain.setValueAtTime(0.3, now);
      gainNode1.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      oscillator1.connect(gainNode1);
      gainNode1.connect(ctx.destination);
      oscillator1.start(now);
      oscillator1.stop(now + 0.3);

      // 创建第二音调 - 稍低的 "咚" 声
      const oscillator2 = ctx.createOscillator();
      const gainNode2 = ctx.createGain();
      oscillator2.type = 'sine';
      oscillator2.frequency.setValueAtTime(800, now + 0.05);
      oscillator2.frequency.exponentialRampToValueAtTime(600, now + 0.15);
      gainNode2.gain.setValueAtTime(0.2, now + 0.05);
      gainNode2.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      oscillator2.connect(gainNode2);
      gainNode2.connect(ctx.destination);
      oscillator2.start(now + 0.05);
      oscillator2.stop(now + 0.35);

      // 创建第三音调 - 高音 "铃" 声
      const oscillator3 = ctx.createOscillator();
      const gainNode3 = ctx.createGain();
      oscillator3.type = 'sine';
      oscillator3.frequency.setValueAtTime(1600, now + 0.1);
      gainNode3.gain.setValueAtTime(0.15, now + 0.1);
      gainNode3.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      oscillator3.connect(gainNode3);
      gainNode3.connect(ctx.destination);
      oscillator3.start(now + 0.1);
      oscillator3.stop(now + 0.4);

      console.log('🔔 播放提示音');
    } catch (e) {
      console.error('播放提示音失败:', e);
    }
  }

  isEnabled() {
    return this.userInteracted;
  }
}

// 全局音频管理器
export const alertSoundManager = new AlertSoundManager();

// ===========================================
// 标题栏闪烁管理
// ===========================================

class TitleFlashManager {
  private originalTitle = '';
  private flashInterval: ReturnType<typeof setInterval> | null = null;
  private isFlashing = false;
  private alertCount = 0;

  startFlash(alertCount: number) {
    if (this.isFlashing) {
      this.alertCount = alertCount;
      return;
    }

    this.originalTitle = document.title;
    this.alertCount = alertCount;
    this.isFlashing = true;

    let showAlert = true;
    this.flashInterval = setInterval(() => {
      if (showAlert) {
        document.title = `【🔔 新推荐! (${this.alertCount})】`;
      } else {
        document.title = '【QuantPredict】';
      }
      showAlert = !showAlert;
    }, 1000);

    console.log('📢 开始标题栏闪烁');
  }

  stopFlash() {
    if (this.flashInterval) {
      clearInterval(this.flashInterval);
      this.flashInterval = null;
    }
    if (this.originalTitle) {
      document.title = this.originalTitle;
    }
    this.isFlashing = false;
    this.alertCount = 0;
    console.log('📢 停止标题栏闪烁');
  }

  isActive() {
    return this.isFlashing;
  }
}

// 全局标题闪烁管理器
export const titleFlashManager = new TitleFlashManager();

// ===========================================
// 浏览器通知管理
// ===========================================

class BrowserNotificationManager {
  private permission: NotificationPermission = 'default';

  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('⚠️ 浏览器不支持通知');
      return false;
    }

    if (Notification.permission === 'granted') {
      this.permission = 'granted';
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      this.permission = permission;
      return permission === 'granted';
    }

    return false;
  }

  sendNotification(title: string, body: string, icon?: string) {
    if (this.permission !== 'granted') {
      console.log('⚠️ 浏览器通知未授权');
      return;
    }

    try {
      const notification = new Notification(title, {
        body,
        icon: icon || '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'prediction-alert',
        requireInteraction: false,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      // 5秒后自动关闭
      setTimeout(() => notification.close(), 5000);

      console.log('📬 发送浏览器通知:', title);
    } catch (e) {
      console.error('发送浏览器通知失败:', e);
    }
  }

  isGranted() {
    return this.permission === 'granted';
  }
}

// 全局浏览器通知管理器
export const browserNotificationManager = new BrowserNotificationManager();

// ===========================================
// 主 Hook: usePredictionAlert
// ===========================================

export function usePredictionAlert(
  matches: MatchState[],
  config: Partial<AlertConfig> = {}
) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  
  // 已通知的推荐集合：格式为 "matchId_type_direction"
  const notifiedSet = useRef<Set<string>>(new Set());
  
  // 当前活跃的 Toast 列表
  const [activeToasts, setActiveToasts] = useState<AlertData[]>([]);
  
  // 未读通知计数
  const [unreadCount, setUnreadCount] = useState(0);
  
  // 页面是否可见
  const isPageVisible = useRef(true);

  // 监听页面可见性变化
  useEffect(() => {
    const handleVisibilityChange = () => {
      isPageVisible.current = !document.hidden;
      if (isPageVisible.current) {
        // 用户回到页面，停止标题闪烁
        titleFlashManager.stopFlash();
        setUnreadCount(0);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // 触发通知的核心函数
  const triggerAlert = useCallback((alert: AlertData) => {
    console.log('🚨 触发通知:', alert);

    // 1. 添加 Toast
    setActiveToasts(prev => [...prev, alert]);
    
    // 设置自动移除
    setTimeout(() => {
      setActiveToasts(prev => prev.filter(t => t.id !== alert.id));
    }, mergedConfig.toastDuration);

    // 2. 播放声音
    if (mergedConfig.soundEnabled) {
      alertSoundManager.playAlertSound();
    }

    // 3. 标题栏闪烁（仅当页面不可见时）
    if (mergedConfig.titleFlashEnabled && !isPageVisible.current) {
      setUnreadCount(prev => {
        const newCount = prev + 1;
        titleFlashManager.startFlash(newCount);
        return newCount;
      });
    }

    // 4. 浏览器原生通知（仅当页面不可见时）
    if (mergedConfig.browserNotificationEnabled && !isPageVisible.current) {
      browserNotificationManager.sendNotification(
        alert.title,
        alert.message
      );
    }
  }, [mergedConfig]);

  // 手动触发测试通知
  const triggerTestAlert = useCallback(() => {
    const testAlert: AlertData = {
      id: `test-${Date.now()}`,
      matchId: 'test',
      type: 'handicap',
      title: '🚨 测试通知',
      message: '这是一条测试通知，确认声音和弹窗工作正常。主队 -0.5 (信心 88%)',
      team: '测试队',
      line: '-0.5',
      confidence: 0.88,
      valueEdge: 0.15,
      timestamp: Date.now(),
      severity: 'high',
    };
    triggerAlert(testAlert);
  }, [triggerAlert]);

  // 移除 Toast
  const dismissToast = useCallback((alertId: string) => {
    setActiveToasts(prev => prev.filter(t => t.id !== alertId));
  }, []);

  // 清除所有通知
  const clearAllToasts = useCallback(() => {
    setActiveToasts([]);
    titleFlashManager.stopFlash();
    setUnreadCount(0);
  }, []);

  // 监听比赛数据变化，检测新推荐
  useEffect(() => {
    matches.forEach(match => {
      const tips = match.prediction?.goalBettingTips;
      if (!tips) return;

      // 检查让球盘推荐
      const handicapRec = tips.handicapRecommendation;
      if (handicapRec) {
        const meetsThreshold = 
          handicapRec.confidence >= mergedConfig.confidenceThreshold ||
          handicapRec.valueEdge >= mergedConfig.valueEdgeThreshold;

        if (meetsThreshold) {
          // 生成唯一指纹：matchId_handicap_direction
          const key = `${match.match_id}_handicap_${handicapRec.recommendedSide}`;
          
          if (!notifiedSet.current.has(key)) {
            // 新推荐！触发通知
            const teamName = handicapRec.recommendedSide === 'HOME' 
              ? match.home_team 
              : match.away_team;

            const alert: AlertData = {
              id: `${key}_${Date.now()}`,
              matchId: match.match_id,
              type: 'handicap',
              title: '🚨 AI 发现价值!',
              message: `${match.home_team} vs ${match.away_team}: ${teamName} ${handicapRec.recommendedLine} (信心 ${Math.round(handicapRec.confidence * 100)}%)`,
              team: teamName,
              line: handicapRec.recommendedLine,
              confidence: handicapRec.confidence,
              valueEdge: handicapRec.valueEdge,
              timestamp: Date.now(),
              severity: handicapRec.confidence >= 0.85 ? 'high' : 'medium',
            };

            triggerAlert(alert);
            notifiedSet.current.add(key);
          }
        }
      }

      // 检查高置信度推荐
      const highTip = tips.highConfidenceTip;
      if (highTip && highTip.type !== 'NONE') {
        const meetsThreshold = highTip.confidence >= mergedConfig.confidenceThreshold;

        if (meetsThreshold) {
          // 生成唯一指纹：matchId_type_line
          const key = `${match.match_id}_${highTip.type}_${highTip.line || 'none'}`;
          
          if (!notifiedSet.current.has(key)) {
            const alert: AlertData = {
              id: `${key}_${Date.now()}`,
              matchId: match.match_id,
              type: 'high_confidence',
              title: '🔥 高置信度推荐!',
              message: `${match.home_team} vs ${match.away_team}: ${highTip.description}`,
              confidence: highTip.confidence,
              timestamp: Date.now(),
              severity: highTip.confidence >= 0.85 ? 'high' : 'medium',
            };

            triggerAlert(alert);
            notifiedSet.current.add(key);
          }
        }
      }
    });
  }, [matches, mergedConfig, triggerAlert]);

  return {
    activeToasts,
    unreadCount,
    dismissToast,
    clearAllToasts,
    triggerTestAlert,
    isAudioEnabled: alertSoundManager.isEnabled(),
    enableAudio: () => alertSoundManager.enableAudio(),
    requestNotificationPermission: () => browserNotificationManager.requestPermission(),
    isNotificationGranted: browserNotificationManager.isGranted(),
  };
}
