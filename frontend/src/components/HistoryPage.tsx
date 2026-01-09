/**
 * AI 推荐历史记录页面 (History Log Page)
 * 
 * 功能：
 * 1. 显示所有 AI 推荐记录
 * 2. 统计汇总（总数、胜率、平均信心度等）
 * 3. 手动标记胜负
 * 4. 自动结算（获取完场比分）
 * 5. 导出 CSV
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { historyLogService, type LogEntry } from '../services/historyLogService';

// API 基础 URL
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ===========================================
// 类型定义
// ===========================================

interface SettlementResult {
  matchId: string;
  finalScore: string;
  homeScore: number;
  awayScore: number;
  result: 'WIN' | 'LOSS' | 'PUSH' | 'PENDING';
  reason: string;
}

// ===========================================
// 信心度徽章组件
// ===========================================

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  
  if (percent >= 90) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
        🔥 {percent}%
      </span>
    );
  } else if (percent >= 80) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
        🟢 {percent}%
      </span>
    );
  } else {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
        ⚪ {percent}%
      </span>
    );
  }
}

// ===========================================
// 结果徽章组件
// ===========================================

function ResultBadge({ result }: { result: LogEntry['result'] }) {
  switch (result) {
    case 'WIN':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500 text-white">
          ✅ WIN
        </span>
      );
    case 'LOSS':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500 text-white">
          ❌ LOSS
        </span>
      );
    case 'PUSH':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-500 text-white">
          ➖ PUSH
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-300 text-gray-700">
          ⏳ PENDING
        </span>
      );
  }
}

// ===========================================
// 主页面组件
// ===========================================

export function HistoryPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    winRate: 0,
    avgConfidence: 0,
    avgValueEdge: 0,
  });
  const [isSettling, setIsSettling] = useState(false);
  const [settleProgress, setSettleProgress] = useState({ current: 0, total: 0 });
  const [settleMessage, setSettleMessage] = useState('');

  // 加载数据
  const loadData = useCallback(() => {
    setEntries(historyLogService.getAllEntries());
    setStats(historyLogService.getStatistics());
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 标记结果
  const handleMarkResult = (id: string, result: 'WIN' | 'LOSS' | 'PUSH', finalScore?: string) => {
    historyLogService.updateResult(id, result, finalScore);
    loadData();
  };

  // 清空历史
  const handleClearAll = () => {
    if (window.confirm('确定要清空所有历史记录吗？此操作不可恢复。')) {
      historyLogService.clearAll();
      loadData();
    }
  };

  // 导出 CSV
  const handleExportCSV = () => {
    historyLogService.downloadCSV();
  };

  // 删除单条记录
  const handleDelete = (id: string) => {
    if (window.confirm('确定要删除这条记录吗？')) {
      historyLogService.deleteEntry(id);
      loadData();
    }
  };

  // 🟢 自动结算所有待定记录
  const handleAutoSettle = async () => {
    const pendingEntries = entries.filter(e => e.result === 'PENDING');
    
    if (pendingEntries.length === 0) {
      setSettleMessage('没有待结算的记录');
      setTimeout(() => setSettleMessage(''), 3000);
      return;
    }

    setIsSettling(true);
    setSettleProgress({ current: 0, total: pendingEntries.length });
    setSettleMessage('正在获取比赛结果...');

    try {
      // 准备结算请求
      const recommendations = pendingEntries.map(entry => ({
        matchId: entry.matchId,
        type: entry.type,
        selection: entry.selection,
        scoreWhenTip: entry.scoreWhenTip,
      }));

      // 调用批量结算 API
      const response = await fetch(`${API_BASE_URL}/api/settlement/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recommendations }),
      });

      if (!response.ok) {
        throw new Error(`API 请求失败: ${response.status}`);
      }

      const data = await response.json();
      const results: SettlementResult[] = data.results;

      // 更新每条记录
      let settledCount = 0;
      let pendingCount = 0;

      results.forEach((result, index) => {
        const entry = pendingEntries[index];
        if (entry && result.result !== 'PENDING') {
          historyLogService.updateResult(entry.id, result.result, result.finalScore);
          settledCount++;
        } else {
          pendingCount++;
        }
        setSettleProgress({ current: index + 1, total: pendingEntries.length });
      });

      // 重新加载数据
      loadData();

      // 显示结果
      setSettleMessage(
        `结算完成！已结算 ${settledCount} 条，${pendingCount} 条比赛未结束`
      );

      // 显示详细统计
      if (data.stats) {
        console.log('结算统计:', data.stats);
      }

    } catch (error: any) {
      console.error('自动结算失败:', error);
      setSettleMessage(`结算失败: ${error.message}`);
    } finally {
      setIsSettling(false);
      setTimeout(() => setSettleMessage(''), 5000);
    }
  };

  // 🟢 结算单条记录
  const handleSettleSingle = async (entry: LogEntry) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/settlement/single`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matchId: entry.matchId,
          type: entry.type,
          selection: entry.selection,
          scoreWhenTip: entry.scoreWhenTip,
        }),
      });

      if (!response.ok) {
        throw new Error(`API 请求失败: ${response.status}`);
      }

      const result: SettlementResult = await response.json();

      if (result.result !== 'PENDING') {
        historyLogService.updateResult(entry.id, result.result, result.finalScore);
        loadData();
        setSettleMessage(`${entry.matchName}: ${result.result} (${result.finalScore})`);
      } else {
        setSettleMessage(`${entry.matchName}: 比赛未结束`);
      }

      setTimeout(() => setSettleMessage(''), 3000);

    } catch (error: any) {
      console.error('结算失败:', error);
      setSettleMessage(`结算失败: ${error.message}`);
      setTimeout(() => setSettleMessage(''), 3000);
    }
  };

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* 导航栏 */}
      <nav className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <Link to="/" className="text-gray-300 hover:text-white transition-colors">
              ⚽ 实时比赛
            </Link>
            <span className="text-white font-semibold">
              📜 历史记录
            </span>
          </div>
          <div className="text-sm text-gray-400">
            QuantPredict AI
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 页面标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">📜 AI 历史推荐记录</h1>
          <p className="text-gray-400 mt-1">追踪 AI 推荐的历史表现，复盘分析准确率</p>
        </div>

        {/* 结算消息提示 */}
        {settleMessage && (
          <div className={`mb-4 p-3 rounded-lg ${
            settleMessage.includes('失败') ? 'bg-red-900 text-red-200' : 
            settleMessage.includes('完成') ? 'bg-green-900 text-green-200' : 
            'bg-blue-900 text-blue-200'
          }`}>
            {isSettling && (
              <span className="mr-2">
                ⏳ {settleProgress.current}/{settleProgress.total}
              </span>
            )}
            {settleMessage}
          </div>
        )}

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="text-gray-400 text-sm">总推荐数</div>
            <div className="text-2xl font-bold text-white">{stats.total}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="text-gray-400 text-sm">待定</div>
            <div className="text-2xl font-bold text-yellow-400">{stats.pending}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="text-gray-400 text-sm">胜</div>
            <div className="text-2xl font-bold text-green-400">{stats.wins}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="text-gray-400 text-sm">负</div>
            <div className="text-2xl font-bold text-red-400">{stats.losses}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="text-gray-400 text-sm">胜率</div>
            <div className="text-2xl font-bold text-blue-400">
              {stats.wins + stats.losses > 0 
                ? `${Math.round(stats.winRate * 100)}%` 
                : '-'}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="text-gray-400 text-sm">平均信心</div>
            <div className="text-2xl font-bold text-purple-400">
              {stats.total > 0 ? `${Math.round(stats.avgConfidence * 100)}%` : '-'}
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-gray-400 text-sm">
            共 {entries.length} 条记录
          </div>
          <div className="flex items-center space-x-3">
            {/* 🟢 自动结算按钮 */}
            <button
              onClick={handleAutoSettle}
              disabled={isSettling || stats.pending === 0}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors flex items-center"
            >
              {isSettling ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  结算中...
                </>
              ) : (
                <>🔄 自动结算 ({stats.pending})</>
              )}
            </button>
            <button
              onClick={handleExportCSV}
              disabled={entries.length === 0}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              📥 导出 CSV
            </button>
            <button
              onClick={handleClearAll}
              disabled={entries.length === 0}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              🗑️ 清空记录
            </button>
          </div>
        </div>

        {/* 数据表格 */}
        {entries.length === 0 ? (
          <div className="bg-gray-800 rounded-lg p-12 text-center border border-gray-700">
            <div className="text-6xl mb-4">📭</div>
            <div className="text-xl font-medium text-gray-300 mb-2">暂无 AI 推荐记录</div>
            <div className="text-gray-500">请等待比赛触发 AI 推荐</div>
            <Link 
              to="/" 
              className="inline-block mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
            >
              返回实时比赛
            </Link>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      时间
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      比赛
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      推荐内容
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">
                      赔率
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">
                      信心度
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">
                      价值
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">
                      完场
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">
                      结果
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-750">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm text-white">{formatTime(entry.timestamp)}</div>
                        <div className="text-xs text-gray-500">{entry.minuteWhenTip}'</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-white">{entry.matchName}</div>
                        <div className="text-xs text-gray-500">
                          {entry.league} | 推荐时: {entry.scoreWhenTip}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-sm font-medium bg-blue-900 text-blue-200 border border-blue-700">
                          {entry.selection}
                        </span>
                        <div className="text-xs text-gray-500 mt-1">
                          {entry.type === 'HANDICAP' ? '让球盘' : '大小球'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-medium text-yellow-400">
                          {entry.odds.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ConfidenceBadge confidence={entry.confidence} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-medium ${
                          entry.valueEdge >= 0.15 ? 'text-green-400' : 
                          entry.valueEdge >= 0.10 ? 'text-yellow-400' : 'text-gray-400'
                        }`}>
                          +{Math.round(entry.valueEdge * 100)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {entry.finalScore ? (
                          <span className="text-sm font-bold text-white bg-gray-700 px-2 py-1 rounded">
                            {entry.finalScore}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ResultBadge result={entry.result} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {entry.result === 'PENDING' ? (
                          <div className="flex items-center justify-center space-x-1">
                            {/* 🟢 单条结算按钮 */}
                            <button
                              onClick={() => handleSettleSingle(entry)}
                              className="p-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs transition-colors"
                              title="自动结算"
                            >
                              🔄
                            </button>
                            <button
                              onClick={() => handleMarkResult(entry.id, 'WIN')}
                              className="p-1.5 bg-green-600 hover:bg-green-700 rounded text-xs transition-colors"
                              title="标记为赢"
                            >
                              ✅
                            </button>
                            <button
                              onClick={() => handleMarkResult(entry.id, 'LOSS')}
                              className="p-1.5 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors"
                              title="标记为输"
                            >
                              ❌
                            </button>
                            <button
                              onClick={() => handleMarkResult(entry.id, 'PUSH')}
                              className="p-1.5 bg-yellow-600 hover:bg-yellow-700 rounded text-xs transition-colors"
                              title="标记为走盘"
                            >
                              ➖
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className="p-1.5 bg-gray-600 hover:bg-gray-500 rounded text-xs transition-colors"
                            title="删除记录"
                          >
                            🗑️
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 底部说明 */}
        <div className="mt-6 text-center text-gray-500 text-sm">
          <p>💡 提示：点击 🔄 自动获取完场比分并结算，或手动点击 ✅ ❌ ➖ 标记结果</p>
        </div>
      </div>
    </div>
  );
}

export default HistoryPage;
