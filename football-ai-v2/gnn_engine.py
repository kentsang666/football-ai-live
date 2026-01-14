import numpy as np
import json
import os

class GNNEngine:
    """
    轻量级图神经网络引擎 (Graph Neural Network Engine)
    用于基于球队历史对阵关系图 (Team Interaction Graph) 学习球队的潜在实力特征。
    
    Implementation: NumPy-based Simplified GCN (Graph Convolutional Network)
    Formula: H' = ReLu(D^-0.5 * A * D^-0.5 * H * W)
    """
    def __init__(self, embedding_dim=4):
        self.teams_map = {} # Team Name -> Index
        self.index_map = {} # Index -> Team Name
        self.num_teams = 0
        self.embedding_dim = embedding_dim
        
        # Graph Matrices
        self.adj_matrix = None # A
        self.norm_adj = None   # D^-0.5 * A * D^-0.5
        self.node_features = None # H (N, Dim)
        
        # Weights (Randomly Initialized for demo, traditionally trained)
        # Layer 1: Learn relationships
        self.W1 = np.random.randn(embedding_dim, embedding_dim) * 0.1
        
        # Historical Data Storage for Graph Building
        self.match_history = [] 

    def _normalize_adj(self, adj):
        """
        GCN 核心预处理: 归一化邻接矩阵 (Renormalization Trick)
        A_hat = A + I
        D_hat = Degree Matrix of A_hat
        Return: D^-0.5 * A_hat * D^-0.5
        """
        # Add Self Loop (A + I)
        adj_hat = adj + np.eye(adj.shape[0])
        
        # Degree Matrix
        degrees = np.sum(adj_hat, axis=1)
        
        # Inverse Square Root of Degree
        # Avoid division by zero
        d_inv_sqrt = np.zeros_like(degrees, dtype=float)
        np.power(degrees, -0.5, out=d_inv_sqrt, where=degrees!=0)
        
        d_mat_inv_sqrt = np.diag(d_inv_sqrt)
        
        # Symmetric Normalization
        return np.dot(np.dot(d_mat_inv_sqrt, adj_hat), d_mat_inv_sqrt)

    def learn(self, matches):
        """
        构建图并执行信息传递
        matches: [{'home': 'Man City', 'away': 'Arsenal', 'result': 'home_win'}, ...]
        """
        # 1. Build Node Index
        unique_teams = set()
        for m in matches:
            unique_teams.add(m['home'])
            unique_teams.add(m['away'])
            
        # Update mapping if new teams appear
        new_teams = unique_teams - set(self.teams_map.keys())
        for t in new_teams:
            idx = len(self.teams_map)
            self.teams_map[t] = idx
            self.index_map[idx] = t
            
        self.num_teams = len(self.teams_map)
        
        # 2. Build Adjacency Matrix (Edges)
        # Edge Logic: If Team A played Team B, there is a connection.
        # Weight Logic:
        # - Win: Strong edge (1.0)
        # - Draw: Medium edge (0.5)
        # - Recency: More recent games have higher weight (Simulated here)
        
        adj = np.zeros((self.num_teams, self.num_teams))
        
        # Initialize basic features (Identity or Random) if not exists
        # In real GNN, this could be [Recent Goals, Recent Def, League Tier]
        if self.node_features is None or self.node_features.shape[0] != self.num_teams:
            # Re-init with correct size, keeping old embeddings if possible could be better but complex
            # For demo, random initialization
             self.node_features = np.random.rand(self.num_teams, self.embedding_dim)
        
        for m in matches:
            idx_h = self.teams_map.get(m['home'])
            idx_a = self.teams_map.get(m['away'])
            
            if idx_h is not None and idx_a is not None:
                # Undirected graph for interaction
                weight = 1.0 
                # Could adjust weight based on result, e.g. winner dominates connection
                
                adj[idx_h][idx_a] += weight
                adj[idx_a][idx_h] += weight # Symmetric
                
        # 3. Normalize
        self.adj_matrix = adj
        self.norm_adj = self._normalize_adj(adj)
        
        # 4. GCN Propagation (Forward Pass)
        # H(l+1) = ReLU( Norm_Adj * H(l) * W )
        
        # Support calculation: Z = H * W
        support = np.dot(self.node_features, self.W1)
        
        # Propagation: Out = Norm_Adj * Z
        output = np.dot(self.norm_adj, support)
        
        # Activation (ReLU)
        self.node_features = np.maximum(output, 0)
        
        return self.node_features

    def get_team_embedding(self, team_name):
        idx = self.teams_map.get(team_name)
        if idx is not None:
            return self.node_features[idx]
        return np.zeros(self.embedding_dim) # Unknown team

    def predict_match_strength(self, home_team, away_team):
        """
        基于图嵌入特征预测比赛态势
        Returns:
            home_advantage (float): >0 implies Home stronger, <0 Away stronger
            similarity (float): 0-1, style similarity (closer in graph usually means similar tier)
        """
        if home_team not in self.teams_map or away_team not in self.teams_map:
            return 0.0, 0.0 # Cold start
            
        h_vec = self.get_team_embedding(home_team)
        a_vec = self.get_team_embedding(away_team)
        
        # 1. Strength Diff (Magnitude/Norm can represent strength/centrality in graph)
        h_strength = np.linalg.norm(h_vec)
        a_strength = np.linalg.norm(a_vec)
        
        # Relative strength diff
        strength_gap = h_strength - a_strength
        
        # 2. Similarity (Cosine Similarity)
        # In Graph context, connected nodes become similar.
        # But we want to detect structure. 
        # For simple GCN, similar embeddings = structurally similar (play similar opponents).
        dot_product = np.dot(h_vec, a_vec)
        norm_product = h_strength * a_strength
        if norm_product == 0:
            similarity = 0
        else:
            similarity = dot_product / norm_product
            
        return strength_gap, similarity

# --- Demo Data Loader ---
def load_demo_graph_data():
    """
    Creates a small dataset of 'matches' to initialize the GNN
    """
    # Top Tier Cluster
    top_matches = [
        {'home': 'Man City', 'away': 'Liverpool', 'result': 'draw'},
        {'home': 'Liverpool', 'away': 'Arsenal', 'result': 'home_win'},
        {'home': 'Arsenal', 'away': 'Man City', 'result': 'away_win'},
        {'home': 'Real Madrid', 'away': 'Man City', 'result': 'draw'},
        {'home': 'Bayern Munich', 'away': 'Real Madrid', 'result': 'away_win'},
    ]
    
    # Mid Tier Cluster
    mid_matches = [
        {'home': 'Aston Villa', 'away': 'Tottenham', 'result': 'home_win'},
        {'home': 'Tottenham', 'away': 'Newcastle', 'result': 'draw'},
        {'home': 'Newcastle', 'away': 'Chelsea', 'result': 'home_win'},
        {'home': 'Chelsea', 'away': 'Aston Villa', 'result': 'away_win'},
    ]
    
    # Cross Cluster (The "Giant Killing" links)
    cross_matches = [
        {'home': 'Man City', 'away': 'Chelsea', 'result': 'draw'}, # Draws pull embeddings closer
        {'home': 'Arsenal', 'away': 'Aston Villa', 'result': 'away_win'},
    ]
    
    return top_matches + mid_matches + cross_matches
