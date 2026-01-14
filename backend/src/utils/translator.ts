import axios from 'axios';
import fs from 'fs';
import path from 'path';

// 动态字典文件路径
const DICTIONARY_PATH = path.join(__dirname, '../../data/dynamic_translations.json');

// 内存缓存
let translationCache: Map<string, string> = new Map();
// 正在进行的翻译任务，避免重复请求
const pendingTranslations: Set<string> = new Set();
// 是否已加载本地缓存
let isCacheLoaded = false;

// 确保数据目录存在
const ensureDirectoryExistence = (filePath: string) => {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        return true;
    }
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
};

// 加载缓存
const loadCache = () => {
    try {
        if (fs.existsSync(DICTIONARY_PATH)) {
            const data = fs.readFileSync(DICTIONARY_PATH, 'utf-8');
            const json = JSON.parse(data);
            Object.entries(json).forEach(([key, value]) => {
                translationCache.set(key, String(value));
            });
            console.log(`[Translator] 已加载动态字典，共 ${translationCache.size} 条记录`);
        }
    } catch (error) {
        console.error('[Translator] 加载动态字典失败:', error);
    }
    isCacheLoaded = true;
};

// 保存缓存 (防抖，避免频繁写入)
let saveTimeout: NodeJS.Timeout | null = null;
const saveCache = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        try {
            ensureDirectoryExistence(DICTIONARY_PATH);
            const obj = Object.fromEntries(translationCache);
            fs.writeFileSync(DICTIONARY_PATH, JSON.stringify(obj, null, 2), 'utf-8');
            console.log(`[Translator] 动态字典已保存，共 ${translationCache.size} 条记录`);
        } catch (error) {
            console.error('[Translator] 保存动态字典失败:', error);
        }
    }, 5000); // 5秒后保存
};

/**
 * Google Translate API (Free endpoint)
 * 注意：这是非官方接口，生产环境建议使用官方 API Key 或其他付费服务
 */
const fetchTranslation = async (text: string): Promise<string | null> => {
    try {
        // 使用 Google Translate GTX 接口
        const url = `https://translate.googleapis.com/translate_a/single`;
        const params = {
            client: 'gtx',
            sl: 'auto',
            tl: 'zh-CN',
            dt: 't',
            q: text
        };

        const response = await axios.get(url, { params });
        
        // 解析返回结果: [[["中文", "English", ...]]]
        if (response.data && response.data[0] && response.data[0][0] && response.data[0][0][0]) {
            return response.data[0][0][0];
        }
        return null;
    } catch (error) {
        // 悄悄失败，不要刷屏
        return null;
    }
};

/**
 * 获取翻译
 * @param text 原文
 * @returns 译文（如果缓存中有），否则返回原文并触发后台翻译
 */
export const getTranslation = (text: string): string => {
    if (!text) return text;
    if (!isCacheLoaded) loadCache();

    // 1. 检查缓存
    if (translationCache.has(text)) {
        return translationCache.get(text)!;
    }

    // 2. 如果已经在翻译中，直接返回原文
    if (pendingTranslations.has(text)) {
        return text;
    }

    // 3. 触发后台翻译
    pendingTranslations.add(text);
    
    // 异步执行，不 await
    fetchTranslation(text).then((trans) => {
        if (trans) {
            // 简单的后处理：去除多余空格
            const cleanTrans = trans.trim();
            // 只有当翻译结果包含中文时才保存，防止翻译失败返回英文
            if (/[\u4e00-\u9fa5]/.test(cleanTrans)) {
                translationCache.set(text, cleanTrans);
                saveCache();
                console.log(`[Translator] 新增翻译: "${text}" -> "${cleanTrans}"`);
            }
        }
    }).catch(() => {
        // 忽略错误
    }).finally(() => {
        pendingTranslations.delete(text);
    });

    return text;
};

/**
 * 获取所有动态翻译记录
 */
export const getAllDynamicTranslations = (): Record<string, string> => {
    if (!isCacheLoaded) loadCache();
    return Object.fromEntries(translationCache);
};

/**
 * 预加载
 */
export const initTranslator = () => {
    loadCache();
};

export default {
    getTranslation,
    initTranslator
};
