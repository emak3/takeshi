import { Anthropic } from '@anthropic-ai/sdk';
import { getConfig } from '../../config/config.mjs';
import { initLogger } from '../../utils/logger.mjs';
import { processMessageImages } from './image-processor.mjs';

const log = initLogger();

// 会話履歴を保持するオブジェクト
const conversationHistory = {};

/**
 * Claudeのインスタンスを取得する
 * @returns {Anthropic} Claudeインスタンス
 */
function getClaudeInstance() {
  return new Anthropic({ apiKey: getConfig().claudeApiKey });
}

/**
 * メッセージがClaudeで処理すべきか判断する
 * @param {Message} message Discordメッセージ
 * @returns {boolean} 処理すべきかどうか
 */
function shouldProcessWithClaude(message) {
  const config = getConfig();
  
  // メッセージがスレッド内の場合、親チャンネルIDを取得
  const parentChannelId = message.channel.isThread() ? message.channel.parentId : message.channel.id;
  
  // 通常チャンネルチェック
  const isNormalChannel = config.channelIds.includes(parentChannelId);
  
  // 特別チャンネルチェック
  const isSpecialChannel = config.specialChannelIds.includes(message.channel.id);
  
  return isNormalChannel || isSpecialChannel;
}

/**
 * システムプロンプトを取得する
 * @param {Message} message Discordメッセージ
 * @returns {string} システムプロンプト
 */
function getSystemPrompt(message) {
  const config = getConfig();
  
  // 特別チャンネルの場合は特別なシステムプロンプトを使用
  if (config.specialChannelIds.includes(message.channel.id)) {
    return config.specialSystemPlan || config.systemPlan;
  }
  
  // 通常のシステムプロンプトを使用
  return config.systemPlan;
}

/**
 * モデル名を取得する
 * @returns {string} モデル名
 */
function getModelName() {
  return getConfig().model;
}

/**
 * Claudeメッセージを処理する
 * @param {Message} message Discordメッセージ
 */
export async function handleClaudeMessage(message) {
  try {
    // Claudeで処理すべきかどうかを判断
    if (!shouldProcessWithClaude(message)) {
      return;
    }
    
    const prompt = message.content.trim();
    const userId = message.author.id;
    
    // プロンプトが空の場合は処理しない
    if (!prompt && message.attachments.size === 0) {
      return;
    }
    
    // スレッド作成の準備
    let thread = message.channel;
    
    // スレッド外のメッセージの場合、新しくスレッドを作成
    if (!message.channel.isThread()) {
      const threadName = prompt.substring(0, 10) || `${message.author.username} の会話`;
      thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 60, // 60分でアーカイブ
      });
    }
    
    // 会話履歴の初期化
    if (!conversationHistory[userId]) {
      conversationHistory[userId] = [];
    }
    
    // メッセージが返信の場合は履歴に追加、そうでない場合は履歴をリセット
    if (message.reference) {
      conversationHistory[userId].push({ role: 'user', content: prompt });
    } else {
      conversationHistory[userId] = [{ role: 'user', content: prompt }];
    }
    
    // ローディングメッセージを送信
    const loadingMessage = await thread.send('🤔 生成中...');
    
    // メッセージに画像が添付されている場合
    if (message.attachments.size > 0) {
      await processMessageWithImages(message, loadingMessage, prompt);
    } 
    // テキストのみの場合
    else if (prompt) {
      await processTextMessage(userId, loadingMessage, getSystemPrompt(message));
    }
  } catch (error) {
    log.error('Claudeメッセージ処理中にエラーが発生しました:', error);
  }
}

/**
 * 画像付きメッセージを処理する
 * @param {Message} message Discordメッセージ
 * @param {Message} loadingMessage ローディングメッセージ
 * @param {string} prompt プロンプト
 */
async function processMessageWithImages(message, loadingMessage, prompt) {
  try {
    const claude = getClaudeInstance();
    const imageContents = await processMessageImages(message);
    
    // プロンプトがない場合のデフォルトテキスト
    const textContent = prompt || "これらのイメージを描写してください。";
    
    // メッセージコンテンツを構築
    const messageContent = [
      ...imageContents,
      {
        "type": "text",
        "text": textContent
      }
    ];
    
    // Claudeで処理
    const stream = claude.messages.stream({
      system: getSystemPrompt(message),
      messages: [{ role: "user", content: messageContent }],
      model: getModelName(),
      max_tokens: 4000,
    });
    
    const response = await stream.finalMessage();
    const generatedContent = response.content[0].text;
    
    // 応答を送信
    await loadingMessage.edit(generatedContent);
    
    // 会話履歴を更新
    const userId = message.author.id;
    conversationHistory[userId].push({ role: 'assistant', content: generatedContent });
  } catch (error) {
    log.error('画像付きメッセージ処理中にエラーが発生しました:', error);
    await loadingMessage.edit('回答の生成中にエラーが発生しました: ' + error.message);
  }
}

/**
 * テキストのみのメッセージを処理する
 * @param {string} userId ユーザーID
 * @param {Message} loadingMessage ローディングメッセージ
 * @param {string} systemPrompt システムプロンプト
 */
async function processTextMessage(userId, loadingMessage, systemPrompt) {
  try {
    const claude = getClaudeInstance();
    
    // Claudeで処理
    const stream = claude.messages.stream({
      system: systemPrompt,
      messages: conversationHistory[userId],
      model: getModelName(),
      max_tokens: 4000,
    });
    
    const response = await stream.finalMessage();
    const generatedContent = response.content[0].text;
    
    // 応答を送信
    await loadingMessage.edit(generatedContent);
    
    // 会話履歴を更新
    conversationHistory[userId].push({ role: 'assistant', content: generatedContent });
  } catch (error) {
    log.error('テキストメッセージ処理中にエラーが発生しました:', error);
    await loadingMessage.edit('回答の生成中にエラーが発生しました: ' + error.message);
  }
}