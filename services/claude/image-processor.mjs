import fetch from 'node-fetch';
import { initLogger } from '../../utils/logger.mjs';
import { compressImageForTokenSaving } from './pdf-processor.mjs';

const log = initLogger();

/**
 * 画像処理の設定
 */
const IMAGE_CONFIG = {
  MAX_IMAGES: 5,              // 最大処理画像数
  SUPPORTED_TYPES: [          // サポートする画像タイプ
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp'
  ],
  COMPRESSION: {
    enabled: true,            // デフォルトで圧縮を有効化
    quality: 75,              // 圧縮品質
    maxWidth: 1024,           // 最大幅
    maxHeight: 1024           // 最大高さ
  }
};

/**
 * 画像URLからバッファデータを取得する
 * @param {string} url 画像URL
 * @returns {Promise<Buffer|null>} 画像バッファ
 */
async function getImageBuffer(url) {
  try {
    const response = await fetch(url, {
      timeout: 10000, // 10秒タイムアウト
      headers: {
        'User-Agent': 'Discord Bot Image Processor'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.buffer();
  } catch (error) {
    log.error(`画像データの取得に失敗しました (${url}):`, error.message);
    return null;
  }
}

/**
 * 画像バッファをBase64に変換する
 * @param {Buffer} buffer 画像バッファ
 * @param {string} contentType コンテンツタイプ
 * @param {boolean} compress 圧縮するかどうか
 * @returns {Promise<string|null>} Base64エンコードされた画像データ
 */
async function bufferToBase64(buffer, contentType, compress = true) {
  try {
    let processedBuffer = buffer;

    // 圧縮が有効で、対象の画像タイプの場合
    if (compress && IMAGE_CONFIG.COMPRESSION.enabled) {
      // GIFは圧縮しない（アニメーションが失われるため）
      if (contentType !== 'image/gif') {
        processedBuffer = await compressImageForTokenSaving(buffer, {
          quality: IMAGE_CONFIG.COMPRESSION.quality,
          maxWidth: IMAGE_CONFIG.COMPRESSION.maxWidth,
          maxHeight: IMAGE_CONFIG.COMPRESSION.maxHeight,
          format: contentType.includes('png') ? 'png' : 'jpeg'
        });
      }
    }

    return processedBuffer.toString('base64');
  } catch (error) {
    log.error('Base64変換エラー:', error);
    return buffer.toString('base64'); // フォールバック
  }
}

/**
 * 添付ファイルが画像かどうかを判定する
 * @param {Object} attachment Discord添付ファイル
 * @returns {boolean} 画像かどうか
 */
function isImageAttachment(attachment) {
  if (!attachment.contentType) {
    // Content-Typeがない場合は拡張子で判定
    const ext = attachment.name?.toLowerCase().split('.').pop();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
  }

  return IMAGE_CONFIG.SUPPORTED_TYPES.includes(attachment.contentType.toLowerCase());
}

/**
 * メッセージの添付画像を処理する
 * @param {Message} message Discordメッセージ
 * @param {Object} options 処理オプション
 * @returns {Promise<Array>} 画像コンテンツの配列
 */
export async function processMessageImages(message, options = {}) {
  try {
    const {
      maxImages = IMAGE_CONFIG.MAX_IMAGES,
      compress = true,
      skipLargeImages = true,
      maxFileSize = 20 * 1024 * 1024 // 20MB
    } = options;

    // 画像添付ファイルを抽出
    const imageAttachments = [...message.attachments.values()]
      .filter(attachment => {
        // サイズチェック
        if (skipLargeImages && attachment.size > maxFileSize) {
          log.warn(`画像が大きすぎるためスキップします: ${attachment.name} (${attachment.size} bytes)`);
          return false;
        }

        return isImageAttachment(attachment);
      })
      .slice(0, maxImages); // 最大数まで制限

    if (imageAttachments.length === 0) {
      log.debug('処理可能な画像添付ファイルが見つかりません');
      return [];
    }

    log.info(`${imageAttachments.length}個の画像を処理します`);

    const imageContents = [];

    for (const [index, attachment] of imageAttachments.entries()) {
      try {
        log.debug(`画像処理中: ${attachment.name} (${index + 1}/${imageAttachments.length})`);

        const imageBuffer = await getImageBuffer(attachment.url);
        if (!imageBuffer) {
          log.warn(`画像バッファの取得に失敗: ${attachment.name}`);
          continue;
        }

        const base64Image = await bufferToBase64(imageBuffer, attachment.contentType, compress);
        if (!base64Image) {
          log.warn(`Base64変換に失敗: ${attachment.name}`);
          continue;
        }

        // Claude APIに送信する形式で構築
        imageContents.push({
          type: "image",
          source: {
            type: "base64",
            media_type: attachment.contentType || "image/jpeg",
            data: base64Image,
          },
        });

        log.info(`画像処理完了: ${attachment.name}`);

      } catch (error) {
        log.error(`画像処理エラー (${attachment.name}):`, error.message);
        // エラーが発生しても他の画像の処理は続行
        continue;
      }
    }

    log.info(`画像処理結果: ${imageContents.length}/${imageAttachments.length}個の画像を正常に処理`);
    return imageContents;

  } catch (error) {
    log.error('メッセージ画像の処理に失敗しました:', error);
    return [];
  }
}

/**
 * 画像処理統計を取得する
 * @param {Array} imageContents 処理された画像コンテンツ
 * @returns {Object} 処理統計
 */
export function getImageProcessingStats(imageContents) {
  if (!Array.isArray(imageContents) || imageContents.length === 0) {
    return {
      count: 0,
      totalSize: 0,
      averageSize: 0
    };
  }

  const totalSize = imageContents.reduce((sum, content) => {
    const base64Data = content.source?.data || '';
    // Base64のサイズを概算（実際のバイト数の約75%）
    return sum + (base64Data.length * 0.75);
  }, 0);

  return {
    count: imageContents.length,
    totalSize: Math.round(totalSize),
    averageSize: Math.round(totalSize / imageContents.length)
  };
}