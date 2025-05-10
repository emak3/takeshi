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
    
    // 明示的にRSSサービスを起動 - readyイベントに依存しない
    log.info('RSSサービスを起動します...');
    try {
      await startRssService(client);
      log.info('RSSサービスが有効化されました');
    } catch (error) {
      log.error('RSSサービスの起動に失敗しました:', error);
      console.error(error); // コンソールにも出力
    }

    log.info('起動処理が完了しました');
  } catch (error) {
    log.error('ボットの起動に失敗しました:', error);
    process.exit(1);
  }
}

// ボットを起動
startBot();