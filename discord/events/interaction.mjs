import { initLogger } from '../../utils/logger.mjs';

const log = initLogger();

/**
 * InteractionCreateイベントのハンドラー
 * @param {Interaction} interaction Discordインタラクション
 */
export async function interactionEvent(interaction) {
  try {
    // 将来的に各種インタラクションハンドラーを追加可能
    
  } catch (error) {
    log.error('interactionイベント処理中にエラーが発生しました:', error);
  }
}