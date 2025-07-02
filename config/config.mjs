import { initLogger } from '../utils/logger.mjs';

const log = initLogger();

/**
 * デフォルト設定
 */
const DEFAULT_CONFIG = {
  // Claude API設定
  model: process.env.MODEL,
  systemPlan: process.env.SYSTEM_PLAN,
  
  // PDF処理設定
  pdfProcessing: {
    enabled: true,
    maxFiles: 3,
    maxPages: 10,
    autoUseImages: true,
    compressImages: true,
    textLengthLimit: 8000
  },
  
  // 画像処理設定
  imageProcessing: {
    enabled: true,
    maxImages: 5,
    compressByDefault: true,
    skipLargeFiles: true,
    maxFileSize: 20 * 1024 * 1024, // 20MB
    compression: {
      quality: 75,
      maxWidth: 1024,
      maxHeight: 1024
    }
  },
  
  // 会話設定
  conversation: {
    maxHistoryLength: 20,
    timeoutMinutes: 30
  }
};

/**
 * 環境変数から設定を構築する
 */
function buildConfigFromEnv() {
  // 必須項目のチェック
  const requiredEnvVars = ['TOKEN', 'CLIENT_ID', 'CLAUDE_API_KEY'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`必須の環境変数が設定されていません: ${missingVars.join(', ')}`);
  }
  
  // チャンネルIDの配列を構築
  const channelIds = [];
  const specialChannelIds = [];
  
  // 通常チャンネル（CHANNEL_ID_1, CHANNEL_ID_2, ...）
  for (let i = 1; i <= 10; i++) {
    const channelId = process.env[`CHANNEL_ID_${i}`];
    if (channelId) {
      channelIds.push(channelId);
    }
  }
  
  // 特別チャンネル（SPECIAL_CHANNEL_ID_1, SPECIAL_CHANNEL_ID_2, ...）
  for (let i = 1; i <= 10; i++) {
    const channelId = process.env[`SPECIAL_CHANNEL_ID_${i}`];
    if (channelId) {
      specialChannelIds.push(channelId);
    }
  }
  
  // RSS設定の構築
  const rssConfig = [];
  for (let i = 1; i <= 10; i++) {
    const url = process.env[`RSS_URL_${i}`];
    const channelId = process.env[`RSS_CHANNEL_${i}`];
    const name = process.env[`RSS_NAME_${i}`];
    
    if (url && channelId) {
      rssConfig.push({
        url,
        channels: [channelId].filter(Boolean),
        name: name || `RSS Feed ${i}`
      });
    }
  }
  
  return {
    // Discord設定
    token: process.env.TOKEN,
    clientId: process.env.CLIENT_ID,
    
    // チャンネル設定
    channelIds,
    specialChannelIds,
    
    // Claude API設定
    claudeApiKey: process.env.CLAUDE_API_KEY,
    systemPlan: process.env.SYSTEM_PLAN || DEFAULT_CONFIG.systemPlan,
    specialSystemPlanChannelId: process.env.SPECIAL_SYSTEM_PLAN_CHANNEL_ID,
    specialSystemPlan: null, // 後で更新される
    model: process.env.MODEL || DEFAULT_CONFIG.model,
    
    // RSSフィード設定
    rssConfig,
    
    // 機能設定（環境変数で上書き可能）
    pdfProcessing: {
      ...DEFAULT_CONFIG.pdfProcessing,
      enabled: process.env.PDF_PROCESSING_ENABLED !== 'false',
      maxFiles: parseInt(process.env.PDF_MAX_FILES) || DEFAULT_CONFIG.pdfProcessing.maxFiles,
      maxPages: parseInt(process.env.PDF_MAX_PAGES) || DEFAULT_CONFIG.pdfProcessing.maxPages,
      autoUseImages: process.env.PDF_AUTO_USE_IMAGES !== 'false',
      compressImages: process.env.PDF_COMPRESS_IMAGES !== 'false'
    },
    
    imageProcessing: {
      ...DEFAULT_CONFIG.imageProcessing,
      enabled: process.env.IMAGE_PROCESSING_ENABLED !== 'false',
      maxImages: parseInt(process.env.IMAGE_MAX_COUNT) || DEFAULT_CONFIG.imageProcessing.maxImages,
      compressByDefault: process.env.IMAGE_COMPRESS_BY_DEFAULT !== 'false',
      skipLargeFiles: process.env.IMAGE_SKIP_LARGE_FILES !== 'false'
    },
    
    conversation: {
      ...DEFAULT_CONFIG.conversation,
      maxHistoryLength: parseInt(process.env.CONVERSATION_MAX_HISTORY) || DEFAULT_CONFIG.conversation.maxHistoryLength,
      timeoutMinutes: parseInt(process.env.CONVERSATION_TIMEOUT_MINUTES) || DEFAULT_CONFIG.conversation.timeoutMinutes
    }
  };
}

// 設定オブジェクトを構築
let config;
try {
  config = buildConfigFromEnv();
  log.info('設定を正常に読み込みました');
  log.debug(`チャンネル数: 通常=${config.channelIds.length}, 特別=${config.specialChannelIds.length}`);
  log.debug(`RSS設定数: ${config.rssConfig.length}`);
  log.debug(`PDF処理: ${config.pdfProcessing.enabled ? '有効' : '無効'}`);
  log.debug(`画像処理: ${config.imageProcessing.enabled ? '有効' : '無効'}`);
} catch (error) {
  log.error('設定の読み込みに失敗しました:', error);
  throw error;
}

/**
 * 特別なシステムプランをチャンネルから読み込む
 * @param {Client} client Discordクライアント
 */
export async function loadSpecialSystemPlan(client) {
  try {
    const channelId = config.specialSystemPlanChannelId;
    if (!channelId) {
      log.debug('特別システムプランチャンネルが設定されていません');
      return;
    }
    
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      log.warn(`特別システムプランチャンネル ${channelId} が見つかりません`);
      return;
    }
    
    const messages = await channel.messages.fetch({ limit: 1 });
    const latestMessage = messages.first();
    
    if (latestMessage && latestMessage.content) {
      config.specialSystemPlan = latestMessage.content;
      const preview = config.specialSystemPlan.substring(0, 100);
      log.info(`特別システムプランを設定: ${preview}${config.specialSystemPlan.length > 100 ? '...' : ''}`);
    } else {
      log.warn('特別システムプランチャンネルにメッセージが見つかりません');
    }
  } catch (error) {
    log.error('特別システムプランの読み込みに失敗しました:', error);
  }
}

/**
 * メッセージから特別なシステムプランを更新する
 * @param {Message} message Discordメッセージ
 */
export async function updateSpecialSystemPlan(message) {
  try {
    if (message.channel.id === config.specialSystemPlanChannelId) {
      config.specialSystemPlan = message.content;
      const preview = config.specialSystemPlan.substring(0, 100);
      log.info(`特別システムプランを更新: ${preview}${config.specialSystemPlan.length > 100 ? '...' : ''}`);
      await message.react('💡');
    }
  } catch (error) {
    log.error('特別システムプランの更新に失敗しました:', error);
  }
}

/**
 * 設定を取得する
 * @returns {Object} 設定オブジェクト
 */
export function getConfig() {
  return { ...config }; // 設定のコピーを返す（意図しない変更を防ぐ）
}

/**
 * 設定の妥当性をチェックする
 * @returns {Object} チェック結果
 */
export function validateConfig() {
  const issues = [];
  const warnings = [];
  
  // 必須設定のチェック
  if (!config.token) issues.push('Discord TOKEN が設定されていません');
  if (!config.clientId) issues.push('Discord CLIENT_ID が設定されていません');
  if (!config.claudeApiKey) issues.push('CLAUDE_API_KEY が設定されていません');
  
  // チャンネル設定のチェック
  if (config.channelIds.length === 0 && config.specialChannelIds.length === 0) {
    warnings.push('Claude処理用のチャンネルが設定されていません');
  }
  
  // RSS設定のチェック
  if (config.rssConfig.length === 0) {
    warnings.push('RSS設定がありません');
  }
  
  // PDF/画像処理の依存関係チェック（実際の運用時に確認）
  if (config.pdfProcessing.enabled) {
    warnings.push('PDF処理が有効です。pdf-parse, pdf2pic, sharp がインストールされていることを確認してください');
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    warnings
  };
}