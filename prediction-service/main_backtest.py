from backtesting.data_loader import MatchDataLoader
from backtesting.portfolio import PortfolioManager
from backtesting.engine import BacktestEngine
from backtesting.analyzer import PerformanceAnalyzer
from backtesting.data_generator import generate_synthetic_matches
import os

def main():
    # 1. 准备数据
    # data_path = os.path.join('backtesting', 'data', 'synthetic_data.csv')
    
    # 使用从 API 转换来的数据 (如果存在)
    real_data_path = os.path.join('backtesting', 'data', 'real_match_data.csv')
    if os.path.exists(real_data_path):
        print(f"检测到真实比赛数据，使用: {real_data_path}")
        data_path = real_data_path
    else:
        # 强行重新生成一次，以包含新的"Pressure Index"列
        data_path = os.path.join('backtesting', 'data', 'synthetic_data.csv')
        print("未检测到真实数据，正在生成新的合成数据(含压力指数)...")
        generate_synthetic_matches(num_matches=50, output_path=data_path)

    loader = MatchDataLoader(data_path)

    # 2. 初始化账户
    portfolio = PortfolioManager(initial_capital=10000)

    # 3. 运行引擎
    # 只要传入你想测试的策略名列表
    engine = BacktestEngine(loader, portfolio, strategies=['OverUnder'])
    engine.run()

    # 4. 分析结果
    analyzer = PerformanceAnalyzer(portfolio.bets, portfolio.initial_capital)
    print(analyzer.generate_report())
    
    # 5. 生成图表
    analyzer.plot_equity_curve(os.path.join('backtesting', 'equity_curve.png'))

if __name__ == "__main__":
    main()
