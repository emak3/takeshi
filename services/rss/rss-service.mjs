import { MessageFlags } from 'discord.js';
import { getConfig } from '../../config/config.mjs';
import { initLogger } from '../../utils/logger.mjs';
import { getWebhookInChannel } from '../../discord/webhook-utils.mjs';
import { getFavicon } from './favicon-utils.mjs';
import { createRssItemContainer, safeCompareDate, getImageFromItem } from './feed-formatter.mjs';
import { getRssStatus, updateRssStatus, getAllRssStatus } from '../../database/rss-database.mjs';

import Parser from 'rss-parser';
import cron from 'node-cron';
import axios from 'axios';

const log = initLogger();

// RSSパーサーの設定
const parser = new Parser({
  customFields: {
    item: [
      ['media:thumbnail', 'mediaThumbnail'],
      ['media:content', 'mediaContent'],
      ['enclosure', 'enclosure'],
      ['image', 'image']
    ]
  }
});

/**
 * URLからドメインを抽出する関数
 * @param {string} url URL
 * @returns {string|null} ドメイン
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return null;
  }
}

/**
 * RSSアイテムをWebhookに送信する
 * @param {Webhook} webhook Webhook
 * @param {Object} item RSSアイテム
 * @param {Object} feed フィード
 * @param {string} faviconUrl ファビコンURL
 * @param {string} feedLink フィードのリンク
 */
async function sendRssToWebhook(webhook, item, feed, faviconUrl, feedLink) {
  try {
    // コンテナを作成
    const container = await createRssItemContainer(item, feed, faviconUrl);

    // Webhookの送信オプション
    const webhookOptions = {
      username: feed.name,
      content: '',
      components: [container],
      flags: MessageFlags.IsComponentsV2
    };

    // アイコンURLがある場合は設定
    if (faviconUrl) {
      try {
        // ファビコンのURLが有効かチェック
        const faviconCheck = await axios.head(faviconUrl);
        if (faviconCheck.status === 200 && 
            faviconCheck.headers['content-type'] && 
            faviconCheck.headers['content-type'].startsWith('image/')) {
          webhookOptions.avatarURL = faviconUrl;
        } else {
          // Google Faviconサービスを代替として使用
          const domain = extractDomain(feed.url) || extractDomain(feedLink);
          webhookOptions.avatarURL = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
        }
      } catch (faviconError) {
        // エラー時は代替アイコンを使用
        const domain = extractDomain(feed.url) || extractDomain(feedLink);
        if (domain) {
          webhookOptions.avatarURL = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
        }
      }
    }

    // メッセージ送信
    await webhook.send(webhookOptions);
    log.info(`RSS送信成功: ${item.title}`);

  } catch (error) {
    log.error(`RSS送信エラー: ${error.message}`);

    // エラー時のフォールバック: シンプルなメッセージ
    try {
      await webhook.send({
        username: feed.name,
        content: `**${item.title}**\n${item.link || ''}`,
      });
    } catch (fallbackError) {
      log.error(`フォールバックメッセージ送信エラー: ${fallbackError.message}`);
    }
  }
}

/**
 * RSSフィードを取得して処理する
 * @param {Client} client Discordクライアント
 */
async function processRssFeeds(client) {
  log.info('RSSフィードの処理を開始します');

  try {
    // 現在のRSSステータスを読み込み (Firestoreから)
    const rssStatus = await getAllRssStatus();
    
    const config = getConfig();
    const rssConfig = config.rssConfig || [];

    if (rssConfig.length === 0) {
      log.info('RSSフィードが設定されていません');
      return;
    }

    // 各RSSフィードを処理
    for (const feed of rssConfig) {
      try {
        log.info(`フィード処理: ${feed.name} (${feed.url})`);

        // RSSフィードを取得
        const feedData = await parser.parseURL(feed.url);
        log.debug(`フィード ${feed.url} から ${feedData.items.length}件のアイテムを取得`);

        // このフィードの最後に処理したアイテムのIDまたは日付を取得
        const lastProcessed = await getRssStatus(feed.url) || {
          lastItemId: null,
          lastPublishDate: null,
          lastTitle: null
        };

        // 新しいアイテムをフィルタリング
        const newItems = [];

        for (const item of feedData.items) {
          let isNew = false;

          // まず、IDによる比較
          if (item.guid && lastProcessed.lastItemId) {
            isNew = item.guid !== lastProcessed.lastItemId;
          }
          // 次に日付による比較
          else if (item.pubDate && lastProcessed.lastPublishDate) {
            // 安全な日付比較関数を使用
            isNew = safeCompareDate(item.pubDate, lastProcessed.lastPublishDate);
          }
          // 最後にタイトルによる比較
          else if (item.title && lastProcessed.lastTitle) {
            isNew = item.title !== lastProcessed.lastTitle;
          }
          // どれも比較できない場合は新規とみなす
          else {
            isNew = true;
          }

          if (isNew) {
            newItems.push(item);
          }
        }

        // 新しいアイテムを日付順（古い順）にソート
        newItems.sort((a, b) => {
          try {
            const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0;
            const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0;

            // 無効な日付をチェック
            if (isNaN(dateA) || isNaN(dateB)) {
              return 0; // 日付が無効な場合は並び順を変更しない
            }

            return dateA - dateB;
          } catch (e) {
            log.error(`日付ソートエラー: ${e.message}`);
            return 0;
          }
        });

        log.info(`フィード ${feed.url} の新しいアイテム数: ${newItems.length}`);

        // フィードのwebサイトドメインを取得してファビコンを取得
        const domain = extractDomain(feed.url) || extractDomain(feedData.link);
        let faviconUrl = null;

        if (domain) {
          try {
            faviconUrl = await getFavicon(domain);
            log.debug(`ファビコン取得成功: ${faviconUrl}`);
          } catch (faviconError) {
            log.error(`ファビコン取得エラー: ${faviconError}`);
          }
        }

        // 新しいアイテムをチャンネルに送信
        for (const item of newItems) {
          log.debug(`新しいアイテムを送信: ${item.title}`);

          // 設定されたすべてのチャンネルに送信
          for (const channelId of feed.channels) {
            try {
              const channel = await client.channels.fetch(channelId);
              if (channel) {
                // webhookを取得または作成
                const webhook = await getWebhookInChannel(channel);
                if (webhook) {
                  await sendRssToWebhook(webhook, item, feed, faviconUrl, feedData.link);
                  log.info(`チャンネル ${channelId} にアイテム "${item.title}" を送信しました`);
                } else {
                  log.error(`チャンネル ${channelId} のWebhook取得に失敗しました`);
                }
              }
            } catch (channelError) {
              log.error(`チャンネル ${channelId} へのメッセージ送信エラー: ${channelError.message}`);
            }
          }
        }

        // 最後に処理したアイテムの情報を更新
        if (newItems.length > 0) {
          const lastItem = newItems[newItems.length - 1];

          // 保存前にデータのフォーマットを確認
          const lastItemId = lastItem.guid || null;
          const lastPublishDate = lastItem.pubDate ? new Date(lastItem.pubDate) : null;
          const lastTitle = lastItem.title || null;

          try {
            await updateRssStatus(
              feed.url,
              lastItemId,
              lastPublishDate,
              lastTitle
            );
            log.info(`フィード ${feed.url} のステータスを更新しました (最新アイテム: ${lastItem.title})`);
          } catch (updateError) {
            log.error(`フィード ${feed.url} のステータス更新エラー: ${updateError.message}`);
          }
        } else {
          log.info(`フィード ${feed.url} に新しいアイテムはありませんでした`);
        }
      } catch (error) {
        log.error(`フィード ${feed.name} (${feed.url}) の処理中にエラーが発生しました: ${error.message}`);
        if (error.stack) {
          log.error(`スタックトレース: ${error.stack}`);
        }
      }
    }
  } catch (error) {
    log.error(`RSSフィード処理中にエラーが発生しました: ${error.message}`);
    if (error.stack) {
      log.error(`スタックトレース: ${error.stack}`);
    }
  }
}

/**
 * RSSサービスを起動する
 * @param {Client} client Discordクライアント
 * @returns {Promise<boolean>} 成功したかどうか
 */
export async function startRssService(client) {
  log.info('RSSサービスを起動します');
  
  try {
    // RSSの設定を出力してデバッグ
    const config = getConfig();
    
    if (!config.rssConfig || config.rssConfig.length === 0) {
      log.warn('RSS設定が見つかりません');
      return false;
    }
    
    // 各チャンネルのアクセス権限チェック
    for (const feed of config.rssConfig) {
      if (!feed.channels || feed.channels.length === 0) {
        log.warn(`フィード ${feed.name} (${feed.url}) にチャンネルが設定されていません`);
        continue;
      }
      
      for (const channelId of feed.channels) {
        try {
          const channel = await client.channels.fetch(channelId);
          if (!channel) {
            log.warn(`チャンネル ${channelId} が見つかりませんでした`);
          } else {
            log.info(`チャンネル ${channelId} (${channel.name}) へのアクセスが確認されました`);
          }
        } catch (error) {
          log.error(`チャンネル ${channelId} へのアクセスエラー: ${error.message}`);
        }
      }
    }

    // 初回のRSS処理を実行
    await processRssFeeds(client);

    // 定期実行のスケジュール設定 (10分ごとに実行)
    cron.schedule('*/10 * * * *', async () => {
      log.info('定期実行: RSSフィードを処理します');
      await processRssFeeds(client);
    });

    log.info('RSSサービスが正常に起動しました');
    return true;
  } catch (error) {
    log.error(`RSSサービス起動エラー: ${error.message}`);
    return false;
  }
}