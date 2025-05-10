import { Events } from 'discord.js';
import { readyEvent } from './events/ready.mjs';
import { messageEvent } from './events/message.mjs';
import { interactionEvent } from './events/interaction.mjs';
import { initLogger } from '../utils/logger.mjs';

const log = initLogger();

/**
 * クライアントにイベントハンドラーをセットアップする
 * @param {Client} client Discordクライアント
 */
export function setupEvents(client) {
  try {
    // 準備完了イベント
    client.once(Events.ClientReady, async (c) => {
      await readyEvent(c);
    });
    
    // メッセージ作成イベント
    client.on(Events.MessageCreate, async (message) => {
      await messageEvent(message);
    });
    
    // インタラクション作成イベント
    client.on(Events.InteractionCreate, async (interaction) => {
      await interactionEvent(interaction);
    });
    
    log.info('イベントハンドラーをセットアップしました');
  } catch (error) {
    log.error('イベントハンドラーのセットアップに失敗しました:', error);
    throw error;
  }
}