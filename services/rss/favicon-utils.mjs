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
    
    // 複数の候補からファビコンを見つける
    const candidates = [
      `https://${mainDomain}/favicon.ico`,
      `https://${mainDomain}/favicon.png`,
      `https://${mainDomain}/apple-touch-icon.png`,
      `https://${mainDomain}/apple-touch-icon-precomposed.png`
    ];
    
    // 各候補を順番に試す
    for (const url of candidates) {
      try {
        const response = await axios.head(url);
        if (response.status === 200 && 
            response.headers['content-type'] && 
            response.headers['content-type'].startsWith('image/')) {
          return url;
        }
      } catch (error) {
        // この候補は失敗、次へ
        continue;
      }
    }
    
    // HTMLからファビコンリンクを検索
    try {
      const response = await axios.get(`https://${mainDomain}`);
      const html = response.data;
      
      // link要素からファビコンを検索
      const linkRegex = /<link[^>]*rel=["'](?:shortcut icon|icon|apple-touch-icon|apple-touch-icon-precomposed)["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        let iconUrl = match[1];
        
        // 相対URLを絶対URLに変換
        if (iconUrl.startsWith('/')) {
          iconUrl = `https://${mainDomain}${iconUrl}`;
        } else if (!iconUrl.startsWith('http')) {
          iconUrl = `https://${mainDomain}/${iconUrl}`;
        }
        
        // 取得したURLが有効かチェック
        try {
          const iconCheck = await axios.head(iconUrl);
          if (iconCheck.status === 200 && 
              iconCheck.headers['content-type'] && 
              iconCheck.headers['content-type'].startsWith('image/')) {
            return iconUrl;
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      log.debug(`HTMLからのファビコン検索失敗: ${mainDomain}`);
    }
    
    // すべての候補が失敗した場合はGoogleのサービスを使用
    return `https://www.google.com/s2/favicons?domain=${mainDomain}&sz=128`;
    
  } catch (error) {
    log.error(`ファビコン取得エラー(${domain}):`, error);
    // エラーでもGoogle Faviconサービスは返す
    const mainDomain = removeSubdomain(domain);
    return `https://www.google.com/s2/favicons?domain=${mainDomain}&sz=128`;
  }
}