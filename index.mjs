import { startDiscordClient } from './discord/client.mjs';
import { initLogger } from './utils/logger.mjs';
import { startRssService } from './services/rss/rss-service.mjs';

// ロガーの初期化
const log = initLogger();

async function startBot() {
  try {
    log.info('ボットを起動しています...');
    
    // Discordクライアントを起動
    const client = await startDiscordClient();
    
    try {
      await startRssService(client);
      log.info('RSSサービスが有効化されました');
    } catch (error) {
      log.error('RSSサービスの起動に失敗しました:', error);
    }

    log.info('起動処理が完了しました');
  } catch (error) {
    log.error('ボットの起動に失敗しました:', error);
    process.exit(1);
  }
}

// ボットを起動
startBot();