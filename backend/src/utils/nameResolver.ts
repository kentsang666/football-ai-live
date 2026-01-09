/**
 * 智能名称解析器 (Smart Name Resolver)
 * 
 * 深度汉化策略第三步：按优先级解析名称
 * 
 * 解析优先级：
 * 1. 本地精修字典 (ID 精确匹配) - 确保热门赛事使用标准中文名
 * 2. 本地别名字典 (名称模糊匹配) - 处理各种英文变体
 * 3. API 返回名称 - 如果本地没有，使用 API 返回的名称
 * 4. 原始名称 - 如果都没有，保留原名
 */

import {
    LEAGUE_TRANSLATIONS,
    TEAM_TRANSLATIONS,
    TEAM_ALIASES,
    LEAGUE_ALIASES,
} from '../data/translationData';

// 类型定义
type NameType = 'team' | 'league';

/**
 * 检查字符串是否包含中文字符
 */
function containsChinese(str: string): boolean {
    return /[\u4e00-\u9fa5]/.test(str);
}

/**
 * 标准化名称（去除多余空格、统一大小写等）
 */
function normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
}

/**
 * 智能名称解析器
 * 
 * @param originalName - API 返回的原始名称
 * @param id - 实体 ID（球队 ID 或联赛 ID）
 * @param type - 类型：'team' 或 'league'
 * @returns 解析后的中文名称
 */
export function getChineseName(
    originalName: string,
    id: number | undefined,
    type: NameType
): string {
    const normalizedName = normalizeName(originalName);
    
    // ========== 优先级 1：本地精修字典 (ID 精确匹配) ==========
    if (id !== undefined) {
        if (type === 'team' && TEAM_TRANSLATIONS[id]) {
            return TEAM_TRANSLATIONS[id];
        }
        if (type === 'league' && LEAGUE_TRANSLATIONS[id]) {
            return LEAGUE_TRANSLATIONS[id];
        }
    }
    
    // ========== 优先级 2：本地别名字典 (名称模糊匹配) ==========
    if (type === 'team') {
        // 精确匹配
        if (TEAM_ALIASES[normalizedName]) {
            return TEAM_ALIASES[normalizedName];
        }
        // 尝试不同的名称变体
        const variants = generateNameVariants(normalizedName);
        for (const variant of variants) {
            if (TEAM_ALIASES[variant]) {
                return TEAM_ALIASES[variant];
            }
        }
    }
    
    if (type === 'league') {
        // 精确匹配
        if (LEAGUE_ALIASES[normalizedName]) {
            return LEAGUE_ALIASES[normalizedName];
        }
        // 尝试不同的名称变体
        const variants = generateNameVariants(normalizedName);
        for (const variant of variants) {
            if (LEAGUE_ALIASES[variant]) {
                return LEAGUE_ALIASES[variant];
            }
        }
    }
    
    // ========== 优先级 3：检查 API 返回名称是否已是中文 ==========
    if (containsChinese(normalizedName)) {
        return normalizedName;
    }
    
    // ========== 优先级 4：返回原始名称 ==========
    return normalizedName;
}

/**
 * 生成名称变体（用于模糊匹配）
 */
function generateNameVariants(name: string): string[] {
    const variants: string[] = [];
    
    // 原始名称
    variants.push(name);
    
    // 去除 FC, SC, CF 等后缀
    const withoutSuffix = name
        .replace(/\s+(FC|SC|CF|AC|AS|SS|RC|CD|SD|UD|CA|SE|CR|US|CS)$/i, '')
        .trim();
    if (withoutSuffix !== name) {
        variants.push(withoutSuffix);
    }
    
    // 去除 FC, SC 等前缀
    const withoutPrefix = name
        .replace(/^(FC|SC|CF|AC|AS|SS|RC|CD|SD|UD|CA|SE|CR|US|CS)\s+/i, '')
        .trim();
    if (withoutPrefix !== name) {
        variants.push(withoutPrefix);
    }
    
    // 处理 "Al-" 和 "Al " 的变体
    if (name.startsWith('Al-')) {
        variants.push(name.replace('Al-', 'Al '));
    }
    if (name.startsWith('Al ')) {
        variants.push(name.replace('Al ', 'Al-'));
    }
    
    // 处理带括号的名称，如 "Brighton (Hove Albion)"
    const withoutParens = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (withoutParens !== name) {
        variants.push(withoutParens);
    }
    
    // 处理 "&" 和 "and"
    if (name.includes(' & ')) {
        variants.push(name.replace(' & ', ' and '));
    }
    if (name.includes(' and ')) {
        variants.push(name.replace(' and ', ' & '));
    }
    
    return [...new Set(variants)]; // 去重
}

/**
 * 批量解析球队名称
 */
export function getTeamChineseNameSmart(originalName: string, teamId?: number): string {
    return getChineseName(originalName, teamId, 'team');
}

/**
 * 批量解析联赛名称
 */
export function getLeagueChineseNameSmart(originalName: string, leagueId?: number): string {
    return getChineseName(originalName, leagueId, 'league');
}

/**
 * 格式化联赛显示名称
 * 将 "Country - League Name" 格式转换为中文
 */
export function formatLeagueDisplayName(country: string, leagueName: string, leagueId?: number): string {
    // 先尝试用 ID 查找
    const chineseLeagueName = getLeagueChineseNameSmart(leagueName, leagueId);
    
    // 如果联赛名已经是中文，直接返回
    if (containsChinese(chineseLeagueName)) {
        // 检查是否需要添加国家前缀
        const countryMap: Record<string, string> = {
            'England': '英格兰',
            'Spain': '西班牙',
            'Italy': '意大利',
            'Germany': '德国',
            'France': '法国',
            'Netherlands': '荷兰',
            'Portugal': '葡萄牙',
            'Turkey': '土耳其',
            'Saudi Arabia': '沙特阿拉伯',
            'Cyprus': '塞浦路斯',
            'Algeria': '阿尔及利亚',
            'Scotland': '苏格兰',
            'China': '中国',
            'Japan': '日本',
            'South Korea': '韩国',
            'Brazil': '巴西',
            'Argentina': '阿根廷',
            'USA': '美国',
            'World': '国际',
        };
        
        const chineseCountry = countryMap[country] || country;
        
        // 如果联赛名已经包含国家信息（如"英超"），不需要添加国家前缀
        const leaguesWithoutCountryPrefix = [
            '英超', '西甲', '意甲', '德甲', '法甲', '荷甲', '葡超', '土超',
            '欧冠', '欧联杯', '欧协联', '欧洲杯', '欧国联',
            '世界杯', '非洲杯', '亚洲杯', '美洲杯',
            '中超', '日职联', '韩K联', '美职联', '沙特超',
        ];
        
        if (leaguesWithoutCountryPrefix.includes(chineseLeagueName)) {
            return chineseLeagueName;
        }
        
        // 对于其他联赛，添加国家前缀
        return `${chineseCountry} - ${chineseLeagueName}`;
    }
    
    // 如果联赛名不是中文，保持原格式
    return `${country} - ${leagueName}`;
}

export default {
    getChineseName,
    getTeamChineseNameSmart,
    getLeagueChineseNameSmart,
    formatLeagueDisplayName,
    containsChinese,
};
