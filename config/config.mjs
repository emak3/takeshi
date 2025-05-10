import { initLogger } from '../utils/logger.mjs';

const log = initLogger();

// 設定オブジェクト
let config = {
  // Discord設定
  "token": process.env.TOKEN,
  "clientId": process.env.CLIENT_ID,
  
  // チャンネル設定
  "channelIds": [process.env.CHANNEL_ID_1],
  "specialChannelIds": [process.env.SPECIAL_CHANNEL_ID_1],
  
  // Claude API設定
  "claudeApiKey": process.env.CLAUDE_API_KEY,
  "systemPlan": process.env.SYSTEM_PLAN,
  "specialSystemPlanChannelId": process.env.SPECIAL_SYSTEM_PLAN_CHANNEL_ID,
  "specialSystemPlan": null, // 初期値はnull、後で更新される
  "model": process.env.MODEL || "claude-3-haiku-20240307",
  
  // RSSフィード設定
  "rssConfig": [
    {
      "url": process.env.RSS_URL_1,
      "channels": [process.env.RSS_CHANNEL_1].filter(Boolean),
      "name": "Netkeiba 国内最大級の競馬情報サイト"
    },
    {
      "url": process.env.RSS_URL_2,
      "channels": [process.env.RSS_CHANNEL_2].filter(Boolean),
      "name": "競馬 - nikkansports.com"
    },
  ]
};

/**
 * 特別なシステムプランをチャンネルから読み込む
 * @param {Client} client Discordクライアント
 */
export async function loadSpecialSystemPlan(client) {
  try {
    const channelId = config.specialSystemPlanChannelId;
    if (!channelId) return;
    
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    
    const messages = await channel.messages.fetch({ limit: 1 });
    const latestMessage = messages.first();
    
    if (latestMessage && latestMessage.content) {
      config.specialSystemPlan = latestMessage.content;
      log.info(`特別システムプランを設定: ${config.specialSystemPlan.substring(0, 50)}...`);
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
  if (message.channel.id === config.specialSystemPlanChannelId) {
    config.specialSystemPlan = message.content;
    log.info(`特別システムプランを更新: ${config.specialSystemPlan.substring(0, 50)}...`);
    await message.react('💡');
  }
}

/**
 * 設定を取得する
 * @returns {Object} 設定オブジェクト
 */
export function getConfig() {
  return config;
}