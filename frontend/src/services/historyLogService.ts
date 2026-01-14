/**
 * AI 推荐历史记录服务 (History Log Service)
 * 
 * 功能：
 * 1. 使用 localStorage 持久化存储推荐记录
 * 2. 提供增删改查接口
 * 3. 支持导出 CSV
 */

// ===========================================
// 类型定义
// ===========================================

export interface LogEntry {
  id: string;                                    // 唯一ID (时间戳+比赛ID)
  timestamp: number;                             // 推荐时间
  matchId: string;                               // 比赛ID
  matchName: string;                             // 比赛名称 (如 曼城 vs 阿森纳)
  league: string;                                // 联赛名称
  scoreWhenTip: string;                          // 推荐时的比分 (如 1-0)
  minuteWhenTip: number;                         // 推荐时的比赛分钟
  type: 'HANDICAP' | 'OVER_UNDER';               // 推荐类型
  selection: string;                             // 推荐内容 (如 主队 -0.5)
  odds: number;                                  // 当时赔率
  confidence: number;                            // 信心度 (0-1)
  valueEdge: number;                             // 价值边际 (0-1)
  result: 'PENDING' | 'WIN' | 'LOSS' | 'PUSH';   // 结果 (默认为 PENDING)
  finalScore?: string;                           // 最终比分 (手动标记时可填写)
  notes?: string;                                // 备注
}

// ===========================================
// 常量
// ===========================================

const STORAGE_KEY = 'ai_prediction_history';
const MAX_ENTRIES = 500; // 最多保存500条记录
const TRANSLATION_CACHE_KEY = 'translation_dictionary';

// ===========================================
// 存储服务类
// ===========================================

class HistoryLogService {
  private entries: LogEntry[] = [];
  private translationDictionary: Record<string, string> = {};

  constructor() {
    this.loadFromStorage();
    this.loadTranslations();
  }

  // 加载翻译字典
  private async loadTranslations() {
    try {
      // 1. 先加载本地缓存
      const cached = localStorage.getItem(TRANSLATION_CACHE_KEY);
      if (cached) {
        this.translationDictionary = JSON.parse(cached);
      }

      // 2. 从后端获取最新字典
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const response = await fetch(`${API_BASE_URL}/api/translations`);
      if (response.ok) {
        const remoteDict = await response.json();
        // 合并
        this.translationDictionary = { ...this.translationDictionary, ...remoteDict };
        // 保存
        localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(this.translationDictionary));
        console.log(`🌐 [History] 翻译字典已更新，共 ${Object.keys(this.translationDictionary).length} 条`);
      }
    } catch (e) {
      console.warn('⚠️ 获取翻译字典失败，使用本地缓存或原文');
    }
  }

  // 翻译辅助函数
  public translate(text: string): string {
    if (!text) return text;
    // 1. 直接匹配
    if (this.translationDictionary[text]) return this.translationDictionary[text];
    
    // 2. 去空格匹配
    const trimmed = text.trim();
    if (this.translationDictionary[trimmed]) return this.translationDictionary[trimmed];

    // 3. 尝试智能匹配 (简单处理 FC / 后缀等)
    const simple = trimmed.replace(/\s+(FC|SC|CF)$/i, '');
    if (this.translationDictionary[simple]) return this.translationDictionary[simple];

    return text;
  }
  
  // 从 localStorage 加载数据
  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        this.entries = JSON.parse(data);
        console.log(`📜 加载了 ${this.entries.length} 条历史记录`);
      }
    } catch (e) {
      console.error('加载历史记录失败:', e);
      this.entries = [];
    }
  }

  // 保存到 localStorage
  private saveToStorage(): void {
    try {
      // 限制最大条目数
      if (this.entries.length > MAX_ENTRIES) {
        this.entries = this.entries.slice(-MAX_ENTRIES);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch (e) {
      console.error('保存历史记录失败:', e);
    }
  }

  // 添加新记录
  addEntry(entry: Omit<LogEntry, 'id' | 'result'>): LogEntry {
    const newEntry: LogEntry = {
      ...entry,
      id: `${entry.timestamp}_${entry.matchId}_${entry.type}`,
      result: 'PENDING',
    };

    // 检查是否已存在相同记录（避免重复）
    const existingIndex = this.entries.findIndex(e => 
      e.matchId === entry.matchId && 
      e.type === entry.type && 
      e.selection === entry.selection
    );

    if (existingIndex === -1) {
      this.entries.push(newEntry);
      this.saveToStorage();
      console.log('📝 新增推荐记录:', newEntry.matchName, newEntry.selection);
    } else {
      console.log('⚠️ 推荐记录已存在，跳过:', entry.matchName, entry.selection);
      return this.entries[existingIndex];
    }

    return newEntry;
  }

  // 获取所有记录（按时间倒序）
  getAllEntries(): LogEntry[] {
    return [...this.entries].sort((a, b) => b.timestamp - a.timestamp);
  }

  // 获取待定记录
  getPendingEntries(): LogEntry[] {
    return this.getAllEntries().filter(e => e.result === 'PENDING');
  }

  // 更新记录结果
  updateResult(id: string, result: 'WIN' | 'LOSS' | 'PUSH', finalScore?: string): boolean {
    const index = this.entries.findIndex(e => e.id === id);
    if (index !== -1) {
      this.entries[index].result = result;
      if (finalScore) {
        this.entries[index].finalScore = finalScore;
      }
      this.saveToStorage();
      console.log('✅ 更新记录结果:', this.entries[index].matchName, result);
      return true;
    }
    return false;
  }

  // 删除单条记录
  deleteEntry(id: string): boolean {
    const index = this.entries.findIndex(e => e.id === id);
    if (index !== -1) {
      this.entries.splice(index, 1);
      this.saveToStorage();
      return true;
    }
    return false;
  }

  // 清空所有记录
  clearAll(): void {
    this.entries = [];
    this.saveToStorage();
    console.log('🗑️ 已清空所有历史记录');
  }

  // 获取统计数据
  getStatistics(): {
    total: number;
    pending: number;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number;
    avgConfidence: number;
    avgValueEdge: number;
    // 让球盘统计
    handicap: {
      total: number;
      pending: number;
      wins: number;
      losses: number;
      pushes: number;
      winRate: number;
    };
    // 大小球统计
    overUnder: {
      total: number;
      pending: number;
      wins: number;
      losses: number;
      pushes: number;
      winRate: number;
    };
  } {
    const total = this.entries.length;
    const pending = this.entries.filter(e => e.result === 'PENDING').length;
    const wins = this.entries.filter(e => e.result === 'WIN').length;
    const losses = this.entries.filter(e => e.result === 'LOSS').length;
    const pushes = this.entries.filter(e => e.result === 'PUSH').length;
    
    const settled = wins + losses;
    const winRate = settled > 0 ? wins / settled : 0;
    
    const avgConfidence = total > 0 
      ? this.entries.reduce((sum, e) => sum + e.confidence, 0) / total 
      : 0;
    
    const avgValueEdge = total > 0 
      ? this.entries.reduce((sum, e) => sum + e.valueEdge, 0) / total 
      : 0;

    // 让球盘统计
    const handicapEntries = this.entries.filter(e => e.type === 'HANDICAP');
    const handicapWins = handicapEntries.filter(e => e.result === 'WIN').length;
    const handicapLosses = handicapEntries.filter(e => e.result === 'LOSS').length;
    const handicapPushes = handicapEntries.filter(e => e.result === 'PUSH').length;
    const handicapPending = handicapEntries.filter(e => e.result === 'PENDING').length;
    const handicapSettled = handicapWins + handicapLosses;

    // 大小球统计
    const overUnderEntries = this.entries.filter(e => e.type === 'OVER_UNDER');
    const overUnderWins = overUnderEntries.filter(e => e.result === 'WIN').length;
    const overUnderLosses = overUnderEntries.filter(e => e.result === 'LOSS').length;
    const overUnderPushes = overUnderEntries.filter(e => e.result === 'PUSH').length;
    const overUnderPending = overUnderEntries.filter(e => e.result === 'PENDING').length;
    const overUnderSettled = overUnderWins + overUnderLosses;

    return {
      total,
      pending,
      wins,
      losses,
      pushes,
      winRate,
      avgConfidence,
      avgValueEdge,
      handicap: {
        total: handicapEntries.length,
        pending: handicapPending,
        wins: handicapWins,
        losses: handicapLosses,
        pushes: handicapPushes,
        winRate: handicapSettled > 0 ? handicapWins / handicapSettled : 0,
      },
      overUnder: {
        total: overUnderEntries.length,
        pending: overUnderPending,
        wins: overUnderWins,
        losses: overUnderLosses,
        pushes: overUnderPushes,
        winRate: overUnderSettled > 0 ? overUnderWins / overUnderSettled : 0,
      },
    };
  }

  // 导出为 CSV
  exportToCSV(): string {
    const headers = [
      '时间',
      '比赛',
      '联赛',
      '推荐时比分',
      '推荐时分钟',
      '类型',
      '推荐内容',
      '赔率',
      '信心度',
      '价值边际',
      '结果',
      '最终比分',
    ];

    const rows = this.getAllEntries().map(e => [
      new Date(e.timestamp).toLocaleString('zh-CN'),
      e.matchName,
      e.league || '',
      e.scoreWhenTip,
      e.minuteWhenTip.toString(),
      e.type,
      e.selection,
      e.odds.toFixed(2),
      (e.confidence * 100).toFixed(1) + '%',
      (e.valueEdge * 100).toFixed(1) + '%',
      e.result,
      e.finalScore || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  }

  // 下载 CSV 文件
  downloadCSV(): void {
    const csv = this.exportToCSV();
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `AI推荐历史_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    console.log('📥 CSV 文件已下载');
  }
}

// 全局单例
export const historyLogService = new HistoryLogService();

export default historyLogService;
