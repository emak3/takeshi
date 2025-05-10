import { initLogger } from '../../utils/logger.mjs';
import { handleClaudeMessage } from '../../services/claude/claude-service.mjs';
import { updateSpecialSystemPlan } from '../../config/config.mjs';

const log = initLogger();

/**
 * MessageCreateイベントのハンドラー
 * @param {Message} message Discordメッセージ
 */
export async function messageEvent(message) {
  try {
    // ボットのメッセージは無視
    if (message.author.bot) return;
    
    // 特別システムプランの更新チェック
    await updateSpecialSystemPlan(message);
    
    // Claudeメッセージ処理
    await handleClaudeMessage(message);
    
  } catch (error) {
    log.error('messageイベント処理中にエラーが発生しました:', error);
  }
}