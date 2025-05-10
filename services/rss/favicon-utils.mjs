import axios from 'axios';
import { initLogger } from '../../utils/logger.mjs';

const log = initLogger();

/**
 * ドメインからサブドメインを削除する関数
 * @param {string} domain ドメイン
 * @returns {string} メインドメイン
 */
function removeSubdomain(domain) {
  try {
    // IPアドレスの場合はそのまま返す
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
      return domain;
    }

    // ドメイン部分を分割
    const parts = domain.split('.');
    
    // 2つ以下の部分しかない場合はそのまま返す (example.com など)
    if (parts.length <= 2) {
      return domain;
    }
    
    // 特殊なTLDを考慮（co.jp, com.au など）
    const specialTlds = ['co.jp', 'co.uk', 'com.au', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'org.uk', 'net.uk', 'ac.uk'];
    
    // 特殊なTLDをチェック
    const lastTwoParts = parts.slice(-2).join('.');
    if (specialTlds.includes(lastTwoParts)) {
      // 特殊なTLDの場合は最後の3つの部分を保持 (example.co.jp など)
      return parts.slice(-3).join('.');
    } else {
      // 通常のTLDの場合は最後の2つの部分を保持 (example.com など)
      return parts.slice(-2).join('.');
    }
  } catch (error) {
    log.error(`ドメイン処理エラー(${domain}):`, error);
    return domain; // エラーの場合は元のドメインを返す
  }
}

/**
 * ドメインからファビコンURLを取得する関数
 * @param {string} domain ドメイン
 * @returns {Promise<string>} ファビコンURL
 */
export async function getFavicon(domain) {
  try {
    // サブドメインを削除してメインドメインを取得
    const mainDomain = removeSubdomain(domain);
    log.debug(`ドメイン変換: ${domain} → ${mainDomain}`);
    
    // Clearbitのロゴ取得を最初に試みる（最も高品質）
    try {
      const clearbitUrl = `https://logo.clearbit.com/${mainDomain}?size=128`;
      const response = await axios.head(clearbitUrl, { timeout: 3000 });
      if (response.status === 200) {
        log.debug(`Clearbitからロゴを取得: ${clearbitUrl}`);
        return clearbitUrl;
      }
    } catch (clearbitError) {
      log.debug(`Clearbitロゴ取得エラー: ${clearbitError.message}`);
    }
    
    // Googleのファビコンサービスを使用（サイズとフォーマットを指定）
    // サイズを128pxに、フォーマットをPNGに指定
    const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${mainDomain}&sz=128&ext=png`;
    log.debug(`Google Faviconサービス使用: ${googleFaviconUrl}`);
    return googleFaviconUrl;
    
    /* 以下の従来のファビコン取得方法は信頼性が低いため省略 */
  } catch (error) {
    log.error(`ファビコン取得エラー(${domain}):`, error);
    // エラーでもGoogle Faviconサービスは返す
    const mainDomain = removeSubdomain(domain);
    return `https://www.google.com/s2/favicons?domain=${mainDomain}&sz=128&ext=png`;
  }
}