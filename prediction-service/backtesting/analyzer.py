import numpy as np
import pandas as pd

class PerformanceAnalyzer:
    def __init__(self, bets_history, initial_capital):
        self.df = pd.DataFrame(bets_history)
        self.initial_capital = initial_capital

    def generate_report(self):
        if self.df.empty:
            return "无交易记录"
            
        total_bets = len(self.df)
        wins = len(self.df[self.df['status'] == 'WON'])
        
        hit_rate = (wins / total_bets) * 100
        total_profit = self.df['profit'].sum()
        final_capital = self.initial_capital + total_profit
        
        total_staked = self.df['stake'].sum()
        roi = (total_profit / total_staked) * 100 if total_staked > 0 else 0
        
        # 最大回撤 (Max Drawdown) 计算
        # 构造权益曲线（包含初始资金）
        # 注意：这里简化了，假设每笔注单只有在最后结算。
        # 如果是逐日回撤，应该按时间排序。这里按注单顺序。
        equity_curve = [self.initial_capital]
        current = self.initial_capital
        
        # 为了更准确，可以累加 profit
        profits = self.df['profit'].values
        equity_values = np.cumsum(np.insert(profits, 0, self.initial_capital)) # 这不对，初始资金加和cumsum
        
        # 重新计算权益曲线
        equity = []
        running_capital = self.initial_capital
        equity.append(running_capital)
        for p in self.df['profit']:
            running_capital += p
            equity.append(running_capital)
            
        equity_array = np.array(equity)
        peak = np.maximum.accumulate(equity_array)
        drawdown = (peak - equity_array) / peak
        max_dd = drawdown.max() * 100

        report = f"""
        ====== 回测性能报告 ======
        初始资金: {self.initial_capital:.2f}
        最终资金: {final_capital:.2f}
        总交易数: {total_bets}
        胜率 (Hit Rate): {hit_rate:.2f}%
        总收益: {total_profit:.2f}
        投资回报率 (ROI): {roi:.2f}%
        最大回撤 (Max DD): {max_dd:.2f}%
        =========================
        """
        return report

    def plot_equity_curve(self, save_path='equity_curve.png'):
        try:
            import matplotlib.pyplot as plt
        except ImportError:
            print("Matplotlib not installed. Skipping plot.")
            return

        times = range(len(self.df))
        # Reconstruct Equity
        equity = [self.initial_capital]
        curr = self.initial_capital
        for p in self.df['profit']:
            curr += p
            equity.append(curr)
        
        plt.figure(figsize=(10, 6))
        plt.plot(equity, marker='o', label='Portfolio Equity')
        plt.axhline(y=self.initial_capital, color='r', linestyle='--', label='Initial Capital')
        plt.title('Backtest Equity Curve')
        plt.xlabel('Trade #')
        plt.ylabel('Capital')
        plt.legend()
        plt.grid(True)
        plt.savefig(save_path)
        print(f"权益曲线图已保存至: {save_path}")
        plt.close()
