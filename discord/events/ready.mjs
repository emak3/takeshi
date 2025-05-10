import { initLogger } from '../../utils/logger.mjs';

const log = initLogger();

/**
 * ClientReadyイベントのハンドラー
 * @param {Client} client Discordクライアント
 */
export async function readyEvent(client) {
  try {
    log.info(`準備完了: ${client.user.tag} としてログインしました`);
  } catch (error) {
    log.error('readyイベント処理中にエラーが発生しました:', error);
  }
}