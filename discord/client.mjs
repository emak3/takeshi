import { Client, GatewayIntentBits, Partials, ActivityType } from 'discord.js';
import { getConfig, loadSpecialSystemPlan } from '../config/config.mjs';
import { initLogger } from '../utils/logger.mjs';
import { setupEvents } from './event-handler.mjs';
import '../utils/username-system.mjs';

const log = initLogger();

/**
 * Discordクライアントを設定して起動する
 * @returns {Promise<Client>} 設定されたDiscordクライアント
 */
export async function startDiscordClient() {
  try {
    // クライアントの初期化
    const client = new Client({ 
      intents: [
        ...Object.values(GatewayIntentBits),
        GatewayIntentBits.GuildWebhooks
      ], 
      allowedMentions: { parse: ["users", "roles"] }, 
      partials: [Partials.Message, Partials.Channel, Partials.Reaction] 
    });

    // グローバル未処理例外ハンドラー
    process.on("uncaughtException", (error) => {
      log.error('未処理の例外が発生しました:', error);
    });

    // イベントハンドラーのセットアップ
    setupEvents(client);

    // クライアントログイン
    await client.login(getConfig().token);
    
    // 特別システムプランの読み込み
    await loadSpecialSystemPlan(client);
    
    // ステータス設定
    client.user.setActivity({
      name: `Claude AI Bot`,
      type: ActivityType.Playing
    });
    
    return client;
  } catch (error) {
    log.error('Discordクライアントの起動に失敗しました:', error);
    throw error;
  }
}