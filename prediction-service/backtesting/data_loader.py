import pandas as pd

class MatchDataLoader:
    def __init__(self, file_path):
        """
        初始化数据加载器
        :param file_path: 包含历史分钟级数据的 CSV 文件路径
        """
        self.data = pd.read_csv(file_path)
        # 预处理：确保有 minute, home_score, away_score, live_odds 等字段
        # 确保数据按比赛和时间排序
        if 'match_id' in self.data.columns and 'minute' in self.data.columns:
            self.data = self.data.sort_values(['match_id', 'minute'])
        
    def get_matches(self):
        """
        生成器：逐场比赛返回，每一场比赛包含该场的所有分钟切片数据
        """
        if 'match_id' not in self.data.columns:
            print("Error: 'match_id' column not found in data.")
            return

        match_ids = self.data['match_id'].unique()
        for mid in match_ids:
            yield self.data[self.data['match_id'] == mid].sort_values('minute')
