"""
机器学习模型训练脚本
使用 RandomForestClassifier 训练足球比赛结果预测模型
"""

import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
import joblib


def load_data(csv_path: str) -> tuple:
    """加载并预处理数据"""
    print(f"📂 加载数据: {csv_path}")
    
    df = pd.read_csv(csv_path)
    print(f"   总样本数: {len(df)}")
    
    # 特征列
    feature_columns = [
        'home_goals',
        'away_goals', 
        'minute',
        'home_shots_on_target',
        'away_shots_on_target',
        'red_cards'
    ]
    
    X = df[feature_columns]
    y = df['result']
    
    return X, y, feature_columns


def train_model(X: pd.DataFrame, y: pd.Series) -> RandomForestClassifier:
    """训练随机森林模型"""
    print("\n🌲 开始训练 RandomForest 模型...")
    
    # 划分训练集和测试集
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    print(f"   训练集大小: {len(X_train)}")
    print(f"   测试集大小: {len(X_test)}")
    
    # 创建随机森林分类器
    model = RandomForestClassifier(
        n_estimators=100,      # 100 棵树
        max_depth=10,          # 最大深度 10
        min_samples_split=5,   # 最小分裂样本数
        min_samples_leaf=2,    # 叶节点最小样本数
        random_state=42,
        n_jobs=-1,             # 使用所有 CPU 核心
        class_weight='balanced' # 处理类别不平衡
    )
    
    # 训练模型
    print("   训练中...")
    model.fit(X_train, y_train)
    
    # 评估模型
    print("\n📊 模型评估:")
    
    # 训练集准确率
    train_pred = model.predict(X_train)
    train_acc = accuracy_score(y_train, train_pred)
    print(f"   训练集准确率: {train_acc * 100:.2f}%")
    
    # 测试集准确率
    test_pred = model.predict(X_test)
    test_acc = accuracy_score(y_test, test_pred)
    print(f"   测试集准确率: {test_acc * 100:.2f}%")
    
    # 交叉验证
    cv_scores = cross_val_score(model, X, y, cv=5)
    print(f"   5折交叉验证: {cv_scores.mean() * 100:.2f}% (+/- {cv_scores.std() * 2 * 100:.2f}%)")
    
    # 分类报告
    print("\n📋 分类报告:")
    target_names = ['主胜 (0)', '平局 (1)', '客胜 (2)']
    print(classification_report(y_test, test_pred, target_names=target_names))
    
    # 混淆矩阵
    print("🔢 混淆矩阵:")
    cm = confusion_matrix(y_test, test_pred)
    print(f"   预测 →    主胜  平局  客胜")
    print(f"   实际 ↓")
    print(f"   主胜      {cm[0][0]:4d}  {cm[0][1]:4d}  {cm[0][2]:4d}")
    print(f"   平局      {cm[1][0]:4d}  {cm[1][1]:4d}  {cm[1][2]:4d}")
    print(f"   客胜      {cm[2][0]:4d}  {cm[2][1]:4d}  {cm[2][2]:4d}")
    
    # 特征重要性
    print("\n🎯 特征重要性:")
    feature_importance = pd.DataFrame({
        'feature': X.columns,
        'importance': model.feature_importances_
    }).sort_values('importance', ascending=False)
    
    for _, row in feature_importance.iterrows():
        bar = '█' * int(row['importance'] * 50)
        print(f"   {row['feature']:25s} {row['importance']:.4f} {bar}")
    
    return model


def save_model(model: RandomForestClassifier, output_path: str, feature_columns: list):
    """保存模型和元数据"""
    print(f"\n💾 保存模型到: {output_path}")
    
    # 保存模型和特征列名
    model_data = {
        'model': model,
        'feature_columns': feature_columns,
        'version': 'v1.0',
        'classes': ['home_win', 'draw', 'away_win']
    }
    
    joblib.dump(model_data, output_path)
    
    file_size = Path(output_path).stat().st_size / 1024
    print(f"   文件大小: {file_size:.1f} KB")


def test_prediction(model: RandomForestClassifier):
    """测试模型预测"""
    print("\n🧪 测试预测:")
    
    # 测试用例
    test_cases = [
        # [home_goals, away_goals, minute, home_shots, away_shots, red_cards]
        {"name": "主队领先 2-0 (60分钟)", "features": [2, 0, 60, 8, 3, 0]},
        {"name": "客队领先 0-2 (70分钟)", "features": [0, 2, 70, 2, 9, 0]},
        {"name": "平局 1-1 (45分钟)", "features": [1, 1, 45, 5, 5, 0]},
        {"name": "平局 0-0 (80分钟)", "features": [0, 0, 80, 3, 4, 0]},
        {"name": "主队领先但少人 (红牌)", "features": [1, 0, 50, 4, 6, 1]},
    ]
    
    for case in test_cases:
        X = np.array([case['features']])
        proba = model.predict_proba(X)[0]
        pred = model.predict(X)[0]
        result_map = {0: '主胜', 1: '平局', 2: '客胜'}
        
        print(f"\n   场景: {case['name']}")
        print(f"   预测: {result_map[pred]}")
        print(f"   概率: 主胜 {proba[0]*100:.1f}% | 平局 {proba[1]*100:.1f}% | 客胜 {proba[2]*100:.1f}%")


def main():
    print("=" * 60)
    print("🤖 足球比赛结果预测模型训练")
    print("=" * 60)
    
    # 路径设置
    ml_dir = Path(__file__).parent
    csv_path = ml_dir / "historical_matches.csv"
    model_path = ml_dir / "model_v1.pkl"
    
    # 检查数据文件是否存在
    if not csv_path.exists():
        print(f"❌ 错误: 找不到数据文件 {csv_path}")
        print("   请先运行: python generate_dummy_data.py")
        return
    
    # 加载数据
    X, y, feature_columns = load_data(csv_path)
    
    # 训练模型
    model = train_model(X, y)
    
    # 保存模型
    save_model(model, model_path, feature_columns)
    
    # 测试预测
    test_prediction(model)
    
    print("\n" + "=" * 60)
    print("✅ 训练完成！模型已保存到 model_v1.pkl")
    print("=" * 60)


if __name__ == "__main__":
    main()
