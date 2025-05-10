import { getAdminDb, sanitizeData, getCurrentTimestamp } from './firebase-admin.mjs';
import { initLogger } from '../utils/logger.mjs';
import crypto from 'crypto';

const log = initLogger();

// コレクション名
const COLLECTION_NAME = 'rss_status';

/**
 * URLをハッシュ化してドキュメントIDにする関数
 * @param {string} url URL
 * @returns {string} ハッシュ化されたID
 */
function getSafeDocumentId(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

/**
 * 日付を標準化する関数
 * @param {string|Date} dateStr 日付文字列またはDateオブジェクト
 * @returns {Date|null} 標準化された日付
 */
function parseDate(dateStr) {
  if (!dateStr) return null;

  try {
    // 日付文字列の場合
    if (typeof dateStr === 'string') {
      const date = new Date(dateStr);
      // 有効な日付かチェック
      if (isNaN(date.getTime())) {
        log.warn(`無効な日付文字列: ${dateStr}`);
        return null;
      }
      return date;
    }

    // すでにDateオブジェクトの場合
    if (dateStr instanceof Date) {
      if (isNaN(dateStr.getTime())) {
        log.warn(`無効なDateオブジェクト`);
        return null;
      }
      return dateStr;
    }

    // Firestoreタイムスタンプの場合
    if (dateStr._seconds !== undefined) {
      return new Date(dateStr._seconds * 1000);
    }

    // それ以外の場合
    log.warn(`サポートされていない日付形式: ${typeof dateStr}`);
    return null;
  } catch (e) {
    log.error(`日付処理エラー: ${e.message}`);
    return null;
  }
}

/**
 * RSSステータスを更新する関数
 * @param {string} feedUrl フィードURL
 * @param {string} lastItemId 最後に処理したアイテムID
 * @param {string|Date} lastPublishDate 最後に処理したアイテムの公開日
 * @param {string} lastTitle 最後に処理したアイテムのタイトル
 * @returns {Promise<boolean>} 成功したかどうか
 */
export async function updateRssStatus(feedUrl, lastItemId, lastPublishDate, lastTitle) {
  if (!feedUrl) {
    log.error("更新エラー: フィードURLが指定されていません");
    return false;
  }

  try {
    const db = getAdminDb();

    // URLをハッシュ化してドキュメントIDにする
    const docId = getSafeDocumentId(feedUrl);

    // 日付の処理
    const parsedDate = parseDate(lastPublishDate);

    // データを安全な形式に整形
    const data = sanitizeData({
      feedUrl,
      lastItemId: lastItemId || null,
      lastPublishDate: parsedDate,
      lastTitle: lastTitle || null,
      updatedAt: getCurrentTimestamp()
    });

    // ドキュメント参照
    const docRef = db.collection(COLLECTION_NAME).doc(docId);

    // 既存ドキュメントの確認
    const doc = await docRef.get();
    if (doc.exists) {
      // 既存のデータがある場合は作成日を保持
      delete data.createdAt;
      await docRef.update(data);
    } else {
      // 作成日を設定
      data.createdAt = getCurrentTimestamp();
      // 新規作成
      await docRef.set(data);
    }

    log.info(`RSS ${feedUrl} のステータスを更新しました`);
    return true;
  } catch (error) {
    log.error(`RSSステータス更新エラー (${feedUrl}): ${error.message}`);
    if (error.stack) {
      log.error(`スタックトレース: ${error.stack}`);
    }
    throw error;
  }
}

/**
 * フィードURLからRSSステータスを取得する関数
 * @param {string} feedUrl フィードURL
 * @returns {Promise<Object|null>} RSSステータスまたはnull
 */
export async function getRssStatus(feedUrl) {
  if (!feedUrl) {
    log.error("取得エラー: フィードURLが指定されていません");
    return null;
  }

  try {
    const db = getAdminDb();
    const docId = getSafeDocumentId(feedUrl);
    const docRef = db.collection(COLLECTION_NAME).doc(docId);
    const doc = await docRef.get();

    if (doc.exists) {
      const data = doc.data();
      
      // 日付処理
      let lastPublishDate = parseDate(data.lastPublishDate);

      return {
        lastItemId: data.lastItemId || null,
        lastPublishDate,
        lastTitle: data.lastTitle || null
      };
    }
    return null;
  } catch (error) {
    log.error(`RSSステータス取得エラー (${feedUrl}): ${error.message}`);
    return null;
  }
}

/**
 * すべてのRSSステータスを取得する関数
 * @returns {Promise<Object>} {feedUrl: statusObject}形式のオブジェクト
 */
export async function getAllRssStatus() {
  try {
    const db = getAdminDb();
    const snapshot = await db.collection(COLLECTION_NAME).get();

    const statusObj = {};
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.feedUrl) {
        statusObj[data.feedUrl] = {
          lastItemId: data.lastItemId || null,
          lastPublishDate: data.lastPublishDate,
          lastTitle: data.lastTitle || null
        };
      }
    });

    return statusObj;
  } catch (error) {
    log.error(`全RSSステータス取得エラー: ${error.message}`);
    return {};
  }
}