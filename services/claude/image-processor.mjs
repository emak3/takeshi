import fetch from 'node-fetch';
import { initLogger } from '../../utils/logger.mjs';

const log = initLogger();

/**
 * 画像URLからBase64データを取得する
 * @param {string} url 画像URL
 * @returns {Promise<string|null>} Base64エンコードされた画像データ
 */
async function getBase64FromUrl(url) {
  try {
    const response = await fetch(url);
    const buffer = await response.buffer();
    return buffer.toString('base64');
  } catch (error) {
    log.error('画像データの取得に失敗しました:', error);
    return null;
  }
}

/**
 * メッセージの添付画像を処理する
 * @param {Message} message Discordメッセージ
 * @returns {Promise<Array>} 画像コンテンツの配列
 */
export async function processMessageImages(message) {
  try {
    const imageAttachments = [...message.attachments.values()].slice(0, 5); // 最大5枚まで処理
    const imageContents = [];
    
    for (const attachment of imageAttachments) {
      // 画像かどうかを確認
      if (!attachment.contentType || !attachment.contentType.startsWith('image/')) {
        continue;
      }
      
      const base64Image = await getBase64FromUrl(attachment.url);
      if (base64Image) {
        imageContents.push({
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": attachment.contentType,
            "data": base64Image,
          },
        });
      }
    }
    
    return imageContents;
  } catch (error) {
    log.error('メッセージ画像の処理に失敗しました:', error);
    return [];
  }
}