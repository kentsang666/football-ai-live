/**
 * 核心赛事精修字典 (Golden Dictionary)
 * 
 * 深度汉化策略第二步：建立本地精修字典
 * 
 * 优先级说明：
 * 1. 本地字典优先 - 确保热门赛事使用标准中文名
 * 2. API 返回名称 - 如果本地没有，使用 API 返回的名称
 * 3. 原始英文名 - 如果都没有，保留原名
 * 
 * 维护说明：
 * - ID 来自 API-Football 官方文档
 * - 中文名称使用国内主流媒体的标准译名
 */

// ===========================================
// 联赛精修字典 (League Dictionary)
// ===========================================

export const LEAGUE_TRANSLATIONS: Record<number, string> = {
    // ========== 五大联赛 ==========
    39: '英超',           // Premier League
    140: '西甲',          // La Liga
    135: '意甲',          // Serie A
    78: '德甲',           // Bundesliga
    61: '法甲',           // Ligue 1
    
    // ========== 欧洲杯赛 ==========
    2: '欧冠',            // UEFA Champions League
    3: '欧联杯',          // UEFA Europa League
    848: '欧协联',        // UEFA Europa Conference League
    4: '欧洲杯',          // UEFA European Championship
    5: '欧国联',          // UEFA Nations League
    
    // ========== 英格兰 ==========
    40: '英冠',           // Championship
    41: '英甲',           // League One
    42: '英乙',           // League Two
    45: '足总杯',         // FA Cup
    48: '联赛杯',         // EFL Cup
    
    // ========== 西班牙 ==========
    141: '西乙',          // La Liga 2
    143: '国王杯',        // Copa del Rey
    
    // ========== 意大利 ==========
    136: '意乙',          // Serie B
    137: '意大利杯',      // Coppa Italia
    
    // ========== 德国 ==========
    79: '德乙',           // 2. Bundesliga
    81: '德国杯',         // DFB Pokal
    
    // ========== 法国 ==========
    62: '法乙',           // Ligue 2
    66: '法国杯',         // Coupe de France
    65: '法联杯',         // Coupe de la Ligue
    
    // ========== 其他欧洲联赛 ==========
    88: '荷甲',           // Eredivisie
    94: '葡超',           // Primeira Liga
    144: '比甲',          // Belgian Pro League
    203: '土超',          // Super Lig
    204: '土甲',          // TFF First League
    179: '苏超',          // Scottish Premiership
    180: '苏冠',          // Scottish Championship
    197: '希超',          // Super League Greece
    207: '瑞超',          // Allsvenskan
    218: '丹超',          // Superliga
    235: '俄超',          // Russian Premier League
    119: '瑞士超',        // Swiss Super League
    113: '奥甲',          // Austrian Bundesliga
    106: '波甲',          // Ekstraklasa
    333: '乌超',          // Ukrainian Premier League
    318: '塞浦甲',        // Cyprus 1st Division
    
    // ========== 南美洲 ==========
    71: '巴甲',           // Brasileirão Serie A
    72: '巴乙',           // Brasileirão Serie B
    73: '巴西杯',         // Copa do Brasil
    128: '阿甲',          // Argentine Primera División (ID 128)
    129: '阿乙',          // Argentine Primera B Nacional
    13: '南美解放者杯',   // Copa Libertadores
    11: '南美杯',         // Copa Sudamericana
    
    // ========== 亚洲 ==========
    169: '中超',          // Chinese Super League
    170: '中甲',          // China League One
    98: '日职联',         // J1 League
    99: '日乙',           // J2 League
    292: '韩K联',         // K League 1
    293: '韩K2',          // K League 2
    17: '亚冠',           // AFC Champions League
    307: '沙特超',        // Saudi Pro League
    186: '阿尔甲',        // Algerian Ligue 1
    
    // ========== 北美洲 ==========
    253: '美职联',        // MLS
    262: '墨超',          // Liga MX
    
    // ========== 国际赛事 ==========
    1: '世界杯',          // FIFA World Cup
    15: '世预赛',         // World Cup Qualifiers
    6: '非洲杯',          // Africa Cup of Nations
    7: '亚洲杯',          // AFC Asian Cup
    9: '美洲杯',          // Copa America
    
    // ========== 大洋洲 ==========
    188: '澳超',          // A-League
    189: '澳乙',          // A-League 2
    
    // ========== 其他 ==========
    667: '友谊赛',        // Club Friendlies
    10: '友谊赛',         // International Friendlies
};

// ===========================================
// 球队精修字典 (Team Dictionary)
// ===========================================

export const TEAM_TRANSLATIONS: Record<number, string> = {
    // ========== 英超豪门 ==========
    33: '曼联',           // Manchester United
    40: '利物浦',         // Liverpool
    50: '曼城',           // Manchester City
    42: '阿森纳',         // Arsenal
    49: '切尔西',         // Chelsea
    47: '热刺',           // Tottenham Hotspur
    34: '纽卡斯尔',       // Newcastle United
    66: '阿斯顿维拉',     // Aston Villa
    48: '西汉姆',         // West Ham United
    51: '布莱顿',         // Brighton & Hove Albion
    39: '狼队',           // Wolverhampton Wanderers
    52: '水晶宫',         // Crystal Palace
    55: '布伦特福德',     // Brentford
    36: '富勒姆',         // Fulham
    65: '诺丁汉森林',     // Nottingham Forest
    35: '伯恩茅斯',       // AFC Bournemouth
    45: '埃弗顿',         // Everton
    46: '莱斯特城',       // Leicester City
    57: '伊普斯维奇',     // Ipswich Town
    41: '南安普顿',       // Southampton
    
    // ========== 西甲豪门 ==========
    529: '巴塞罗那',      // FC Barcelona
    541: '皇家马德里',    // Real Madrid
    530: '马德里竞技',    // Atletico Madrid
    536: '塞维利亚',      // Sevilla FC
    533: '比利亚雷亚尔',  // Villarreal CF
    548: '皇家社会',      // Real Sociedad
    531: '毕尔巴鄂竞技',  // Athletic Club
    532: '瓦伦西亚',      // Valencia CF
    543: '皇家贝蒂斯',    // Real Betis
    727: '奥萨苏纳',      // CA Osasuna
    728: '赫塔费',        // Getafe CF
    546: '塞尔塔',        // RC Celta de Vigo
    
    // ========== 意甲豪门 ==========
    505: '国际米兰',      // Inter Milan (ID 505)
    489: 'AC米兰',        // AC Milan (ID 489)
    496: '尤文图斯',      // Juventus
    497: '罗马',          // AS Roma
    487: '拉齐奥',        // SS Lazio
    492: '那不勒斯',      // SSC Napoli (ID 492)
    499: '亚特兰大',      // Atalanta BC
    502: '佛罗伦萨',      // ACF Fiorentina
    503: '都灵',          // Torino FC
    500: '博洛尼亚',      // Bologna FC
    
    // ========== 德甲豪门 ==========
    157: '拜仁慕尼黑',    // Bayern Munich
    165: '多特蒙德',      // Borussia Dortmund
    173: '莱比锡红牛',    // RB Leipzig
    168: '勒沃库森',      // Bayer Leverkusen
    169: '法兰克福',      // Eintracht Frankfurt
    163: '门兴格拉德巴赫', // Borussia Mönchengladbach
    172: '沃尔夫斯堡',    // VfL Wolfsburg
    170: '弗莱堡',        // SC Freiburg
    167: '霍芬海姆',      // TSG Hoffenheim
    160: '斯图加特',      // VfB Stuttgart
    162: '柏林联合',      // Union Berlin
    
    // ========== 法甲豪门 ==========
    85: '巴黎圣日耳曼',   // Paris Saint-Germain
    91: '摩纳哥',         // AS Monaco
    80: '里昂',           // Olympique Lyonnais
    81: '马赛',           // Olympique de Marseille
    79: '里尔',           // LOSC Lille
    84: '尼斯',           // OGC Nice
    94: '雷恩',           // Stade Rennais FC
    93: '朗斯',           // RC Lens
    
    // ========== 其他欧洲豪门 ==========
    194: '阿贾克斯',      // Ajax
    197: 'PSV埃因霍温',   // PSV Eindhoven
    211: '本菲卡',        // SL Benfica
    212: '波尔图',        // FC Porto
    228: '里斯本竞技',    // Sporting CP
    645: '加拉塔萨雷',    // Galatasaray
    611: '费内巴切',      // Fenerbahce
    
    // ========== 南美豪门 ==========
    121: '帕尔梅拉斯',    // SE Palmeiras
    127: '弗拉门戈',      // CR Flamengo
    124: '科林蒂安',      // SC Corinthians
    126: '圣保罗',        // São Paulo FC
    131: '格雷米奥',      // Grêmio
    435: '博卡青年',      // Boca Juniors
    434: '河床',          // River Plate
    
    // ========== 亚洲球队 ==========
    // 中超
    1583: '上海海港',     // Shanghai Port
    1584: '上海申花',     // Shanghai Shenhua
    1586: '北京国安',     // Beijing Guoan
    1587: '广州队',       // Guangzhou FC
    1588: '山东泰山',     // Shandong Taishan
    
    // 日职联
    285: '浦和红钻',      // Urawa Red Diamonds
    286: '�的横滨水手',   // Yokohama F. Marinos
    287: '川崎前锋',      // Kawasaki Frontale
    288: '神户胜利船',    // Vissel Kobe
    
    // 韩K联
    2752: '全北现代',     // Jeonbuk Hyundai Motors
    2754: '蔚山现代',     // Ulsan Hyundai
    
    // 沙特超
    2932: '利雅得胜利',   // Al Nassr
    2934: '利雅得新月',   // Al Hilal
    2930: '吉达联合',     // Al Ittihad
    2939: '利雅得青年',   // Al Shabab
    2940: '阿尔塔瓦恩',   // Al Taawon
    2936: '阿尔阿赫利',   // Al Ahli
    2933: '阿尔韦达',     // Al Wehda
    2937: '达马克',       // Damac FC
    10270: '阿尔库鲁德', // Al Kholood
    10269: '阿尔卡迪西亚', // Al Qadsiah
    
    // 澳超
    939: '墨尔本胜利',   // Melbourne Victory
    941: '西悉尼流浪者', // Western Sydney Wanderers
    940: '墨尔本城',     // Melbourne City
    942: '悉尼 FC',        // Sydney FC
    944: '布里斯班狮吼', // Brisbane Roar
    943: '阿德莱德联', // Adelaide United
    945: '珀斯光荣',     // Perth Glory
    946: '惠灵顿凤凰', // Wellington Phoenix
    15036: '奥克兰城',   // Auckland FC
    2027: '中央海岸水手', // Central Coast Mariners
    10272: '西部联',       // Western United
    2028: '马卡纳公牛', // Macarthur FC
};

// ===========================================
// 常见球队名称别名映射 (Alias Mapping)
// ===========================================

export const TEAM_ALIASES: Record<string, string> = {
    // 英超
    'Manchester United': '曼联',
    'Man United': '曼联',
    'Man Utd': '曼联',
    'Liverpool': '利物浦',
    'Manchester City': '曼城',
    'Man City': '曼城',
    'Arsenal': '阿森纳',
    'Chelsea': '切尔西',
    'Tottenham': '热刺',
    'Tottenham Hotspur': '热刺',
    'Spurs': '热刺',
    'Newcastle': '纽卡斯尔',
    'Newcastle United': '纽卡斯尔',
    'Aston Villa': '阿斯顿维拉',
    'West Ham': '西汉姆',
    'West Ham United': '西汉姆',
    'Brighton': '布莱顿',
    'Brighton & Hove Albion': '布莱顿',
    'Wolves': '狼队',
    'Wolverhampton': '狼队',
    'Wolverhampton Wanderers': '狼队',
    'Crystal Palace': '水晶宫',
    'Brentford': '布伦特福德',
    'Fulham': '富勒姆',
    'Nottingham Forest': '诺丁汉森林',
    "Nott'm Forest": '诺丁汉森林',
    'Bournemouth': '伯恩茅斯',
    'AFC Bournemouth': '伯恩茅斯',
    'Everton': '埃弗顿',
    'Leicester': '莱斯特城',
    'Leicester City': '莱斯特城',
    'Ipswich': '伊普斯维奇',
    'Ipswich Town': '伊普斯维奇',
    'Southampton': '南安普顿',
    
    // 西甲
    'Barcelona': '巴塞罗那',
    'FC Barcelona': '巴塞罗那',
    'Barca': '巴塞罗那',
    'Real Madrid': '皇家马德里',
    'Atletico Madrid': '马德里竞技',
    'Atlético Madrid': '马德里竞技',
    'Atletico': '马德里竞技',
    'Sevilla': '塞维利亚',
    'Sevilla FC': '塞维利亚',
    'Villarreal': '比利亚雷亚尔',
    'Villarreal CF': '比利亚雷亚尔',
    'Real Sociedad': '皇家社会',
    'Athletic Bilbao': '毕尔巴鄂竞技',
    'Athletic Club': '毕尔巴鄂竞技',
    'Valencia': '瓦伦西亚',
    'Valencia CF': '瓦伦西亚',
    'Real Betis': '皇家贝蒂斯',
    'Betis': '皇家贝蒂斯',
    
    // 意甲
    'Inter': '国际米兰',
    'Inter Milan': '国际米兰',
    'Internazionale': '国际米兰',
    'AC Milan': 'AC米兰',
    'Milan': 'AC米兰',
    'Juventus': '尤文图斯',
    'Juve': '尤文图斯',
    'Roma': '罗马',
    'AS Roma': '罗马',
    'Lazio': '拉齐奥',
    'SS Lazio': '拉齐奥',
    'Napoli': '那不勒斯',
    'SSC Napoli': '那不勒斯',
    'Atalanta': '亚特兰大',
    'Fiorentina': '佛罗伦萨',
    'ACF Fiorentina': '佛罗伦萨',
    'Torino': '都灵',
    'Bologna': '博洛尼亚',
    
    // 德甲
    'Bayern Munich': '拜仁慕尼黑',
    'Bayern': '拜仁慕尼黑',
    'Bayern Munchen': '拜仁慕尼黑',
    'Borussia Dortmund': '多特蒙德',
    'Dortmund': '多特蒙德',
    'BVB': '多特蒙德',
    'RB Leipzig': '莱比锡红牛',
    'Leipzig': '莱比锡红牛',
    'Bayer Leverkusen': '勒沃库森',
    'Leverkusen': '勒沃库森',
    'Eintracht Frankfurt': '法兰克福',
    'Frankfurt': '法兰克福',
    'Wolfsburg': '沃尔夫斯堡',
    'VfL Wolfsburg': '沃尔夫斯堡',
    'Freiburg': '弗莱堡',
    'SC Freiburg': '弗莱堡',
    'Hoffenheim': '霍芬海姆',
    'Stuttgart': '斯图加特',
    'VfB Stuttgart': '斯图加特',
    'Union Berlin': '柏林联合',
    
    // 法甲
    'Paris Saint-Germain': '巴黎圣日耳曼',
    'PSG': '巴黎圣日耳曼',
    'Paris Saint Germain': '巴黎圣日耳曼',
    'Monaco': '摩纳哥',
    'AS Monaco': '摩纳哥',
    'Lyon': '里昂',
    'Olympique Lyon': '里昂',
    'Olympique Lyonnais': '里昂',
    'Marseille': '马赛',
    'Olympique Marseille': '马赛',
    'Olympique de Marseille': '马赛',
    'OM': '马赛',
    'Lille': '里尔',
    'LOSC Lille': '里尔',
    'Nice': '尼斯',
    'OGC Nice': '尼斯',
    'Rennes': '雷恩',
    'Stade Rennais': '雷恩',
    'Lens': '朗斯',
    'RC Lens': '朗斯',
    
    // 其他欧洲
    'Ajax': '阿贾克斯',
    'AFC Ajax': '阿贾克斯',
    'PSV': 'PSV埃因霍温',
    'PSV Eindhoven': 'PSV埃因霍温',
    'Benfica': '本菲卡',
    'SL Benfica': '本菲卡',
    'Porto': '波尔图',
    'FC Porto': '波尔图',
    'Sporting CP': '里斯本竞技',
    'Sporting Lisbon': '里斯本竞技',
    'Galatasaray': '加拉塔萨雷',
    'Fenerbahce': '费内巴切',
    'Fenerbahçe': '费内巴切',
    
    // 南美
    'Palmeiras': '帕尔梅拉斯',
    'SE Palmeiras': '帕尔梅拉斯',
    'Flamengo': '弗拉门戈',
    'CR Flamengo': '弗拉门戈',
    'Corinthians': '科林蒂安',
    'SC Corinthians': '科林蒂安',
    'Sao Paulo': '圣保罗',
    'São Paulo': '圣保罗',
    'Gremio': '格雷米奥',
    'Grêmio': '格雷米奥',
    'Boca Juniors': '博卡青年',
    'River Plate': '河床',
    
    // 沙特超
    'Al Nassr': '利雅得胜利',
    'Al-Nassr': '利雅得胜利',
    'Al Hilal': '利雅得新月',
    'Al-Hilal': '利雅得新月',
    'Al Ittihad': '吉达联合',
    'Al-Ittihad': '吉达联合',
    'Al-Ittihad FC': '吉达联合',
    'Al Shabab': '利雅得青年',
    'Al-Shabab': '利雅得青年',
    'Al Taawon': '阿尔塔瓦恩',
    'Al-Taawon': '阿尔塔瓦恩',
    'Al Ahli': '阿尔阿赫利',
    'Al-Ahli': '阿尔阿赫利',
    'Al Wehda': '阿尔韦达',
    'Al-Wehda': '阿尔韦达',
    'Damac': '达马克',
    'Damac FC': '达马克',
    'Al Kholood': '阿尔库鲁德',
    'Al-Kholood': '阿尔库鲁德',
    'Al Qadsiah': '阿尔卡迪西亚',
    'Al-Qadsiah': '阿尔卡迪西亚',
    'Al Fateh': '法特赫',
    'Al-Fateh': '法特赫',
    'Al Raed': '阿尔拉伊德',
    'Al-Raed': '阿尔拉伊德',
    'Al Khaleej': '阿尔哈利杰',
    'Al-Khaleej': '阿尔哈利杰',
    'Al Ettifaq': '阿尔伊蒂法克',
    'Al-Ettifaq': '阿尔伊蒂法克',
    'Al Fayha': '阿尔费哈',
    'Al-Fayha': '阿尔费哈',
    'Abha': '阿布哈',
    'Abha Club': '阿布哈',
    
    // 塞浦甲
    'AEL': 'AEL利马索尔',
    'AEL Limassol': 'AEL利马索尔',
    'Omonia': '尼科西亚奥莫尼亚',
    'Omonia Nicosia': '尼科西亚奥莫尼亚',
    'APOEL': '尼科西亚希腊人竞技',
    'APOEL Nicosia': '尼科西亚希腊人竞技',
    'Anorthosis': '阿诺索西斯',
    'Anorthosis Famagusta': '阿诺索西斯',
    
    // 土甲
    'Amed': '阿梅德',
    'Amedspor': '阿梅德',
    'Yeni Malatyaspor': '新马拉蒂亚体育',
    
    // 阿尔甲
    'CR Belouizdad': '贝洛伊兹达德',
    'JS Kabylie': '卡比利',
    'MC Alger': '阿尔及尔',
    'USM Alger': 'USM阿尔及尔',
    
    // 非洲杯国家队
    'Mali': '马里',
    'Senegal': '塞内加尔',
    'Nigeria': '尼日利亚',
    'Egypt': '埃及',
    'Morocco': '摩洛哥',
    'Algeria': '阿尔及利亚',
    'Tunisia': '突尼斯',
    'Cameroon': '喀麦隆',
    'Ghana': '加纳',
    'Ivory Coast': '科特迪瓦',
    "Cote D'Ivoire": '科特迪瓦',
    'South Africa': '南非',
    
    // 常见国家队
    'England': '英格兰',
    'Germany': '德国',
    'France': '法国',
    'Spain': '西班牙',
    'Italy': '意大利',
    'Brazil': '巴西',
    'Argentina': '阿根廷',
    'Portugal': '葡萄牙',
    'Netherlands': '荷兰',
    'Belgium': '比利时',
    'Croatia': '克罗地亚',
    'Japan': '日本',
    'South Korea': '韩国',
    'China': '中国',
    'Saudi Arabia': '沙特阿拉伯',
    
    // 澳超
    'Melbourne Victory': '墨尔本胜利',
    'Western Sydney Wanderers': '西悉尼流浪者',
    'Western Sydney': '西悉尼流浪者',
    'WS Wanderers': '西悉尼流浪者',
    'Melbourne City': '墨尔本城',
    'Sydney FC': '悉尼 FC',
    'Sydney': '悉尼 FC',
    'Brisbane Roar': '布里斯班狮吼',
    'Brisbane': '布里斯班狮吼',
    'Adelaide United': '阿德莱德联',
    'Adelaide': '阿德莱德联',
    'Perth Glory': '珀斯光荣',
    'Perth': '珀斯光荣',
    'Wellington Phoenix': '惠灵顿凤凰',
    'Wellington': '惠灵顿凤凰',
    'Auckland FC': '奥克兰城',
    'Auckland': '奥克兰城',
    'Central Coast Mariners': '中央海岸水手',
    'Central Coast': '中央海岸水手',
    'CC Mariners': '中央海岸水手',
    'Western United': '西部联',
    'Macarthur FC': '马卡纳公牛',
    'Macarthur': '马卡纳公牛',
};

// ===========================================
// 联赛名称别名映射 (League Alias Mapping)
// ===========================================

export const LEAGUE_ALIASES: Record<string, string> = {
    'Premier League': '英超',
    'La Liga': '西甲',
    'Serie A': '意甲',
    'Bundesliga': '德甲',
    'Ligue 1': '法甲',
    'UEFA Champions League': '欧冠',
    'Champions League': '欧冠',
    'UEFA Europa League': '欧联杯',
    'Europa League': '欧联杯',
    'Chinese Super League': '中超',
    'J1 League': '日职联',
    'K League 1': '韩K联',
    'Saudi Pro League': '沙特超',
    'Pro League': '沙特超',
    'MLS': '美职联',
    'Africa Cup of Nations': '非洲杯',
    'AFCON': '非洲杯',
    'Cyprus 1st Division': '塞浦甲',
    'Cypriot First Division': '塞浦甲',
    'TFF First League': '土甲',
    'Turkish 1. Lig': '土甲',
    'Algerian Ligue 1': '阿尔甲',
    'Scottish Championship': '苏冠',
    'A-League': '澳超',
    'A-League Men': '澳超',
    'Australian A-League': '澳超',
};

export default {
    LEAGUE_TRANSLATIONS,
    TEAM_TRANSLATIONS,
    TEAM_ALIASES,
    LEAGUE_ALIASES,
};
