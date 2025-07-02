import { Anthropic } from '@anthropic-ai/sdk';
import { getConfig } from '../../config/config.mjs';
import { initLogger } from '../../utils/logger.mjs';
import { processMessageImages, getImageProcessingStats } from './image-processor.mjs';
import { processMessagePdfs } from './pdf-processor.mjs';

const log = initLogger();

/**
 * Claude処理の設定
 */
const CLAUDE_CONFIG = {
  MAX_TOKENS: 4000,
  CONVERSATION_TIMEOUT: 30 * 60 * 1000, // 30分
  MAX_HISTORY_LENGTH: 20, // 最大会話履歴数

  // PDF処理設定
  PDF_PROCESSING: {
    AUTO_USE_IMAGES: true,    // テキスト抽出失敗時に自動で画像変換
    COMPRESS_IMAGES: true,    // 画像圧縮を有効化
    MAX_PDF_FILES: 3          // 最大PDF処理数
  },

  // 画像処理設定
  IMAGE_PROCESSING: {
    COMPRESS_BY_DEFAULT: true, // デフォルトで圧縮
    MAX_IMAGES: 5,            // 最大画像数
    SKIP_LARGE_FILES: true    // 大きなファイルをスキップ
  }
};

// 会話履歴を保持するオブジェクト
const conversationHistory = new Map();

// 会話タイムアウトを管理するマップ
const conversationTimeouts = new Map();

/**
 * Claudeのインスタンスを取得する
 * @returns {Anthropic} Claudeインスタンス
 */
function getClaudeInstance() {
  const apiKey = getConfig().claudeApiKey;
  if (!apiKey) {
    throw new Error('Claude API キーが設定されていません');
  }
  return new Anthropic({ apiKey });
}

/**
 * メッセージがClaudeで処理すべきか判断する
 * @param {Message} message Discordメッセージ
 * @returns {boolean} 処理すべきかどうか
 */
function shouldProcessWithClaude(message) {
  const config = getConfig();

  // ボットメッセージは処理しない
  if (message.author.bot) {
    return false;
  }

  // メッセージがスレッド内の場合、親チャンネルIDを取得
  const parentChannelId = message.channel.isThread()
    ? message.channel.parentId
    : message.channel.id;

  // 設定されたチャンネルかどうかチェック
  const isTargetChannel =
    config.channelIds?.includes(parentChannelId) ||
    config.specialChannelIds?.includes(message.channel.id);

  return isTargetChannel;
}

/**
 * システムプロンプトを取得する
 * @param {Message} message Discordメッセージ
 * @returns {string} システムプロンプト
 */
function getSystemPrompt(message) {
  const config = getConfig();

  // 特別チャンネルの場合は特別なシステムプロンプトを使用
  if (config.specialChannelIds?.includes(message.channel.id)) {
    return config.specialSystemPlan || config.systemPlan;
  }

  return config.systemPlan || 'あなたは親切で知識豊富なアシスタントです。';
}

/**
 * 会話履歴を管理する
 * @param {string} userId ユーザーID
 * @param {Object} message メッセージオブジェクト
 * @param {boolean} isReply 返信かどうか
 */
function manageConversationHistory(userId, message, isReply) {
  // タイムアウトをクリア
  if (conversationTimeouts.has(userId)) {
    clearTimeout(conversationTimeouts.get(userId));
  }

  // 履歴の初期化または取得
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }

  const history = conversationHistory.get(userId);

  // 返信でない場合は履歴をリセット
  if (!isReply) {
    history.length = 0;
  }

  // 新しいメッセージを追加
  history.push(message);

  // 履歴が長すぎる場合は古いものを削除
  if (history.length > CLAUDE_CONFIG.MAX_HISTORY_LENGTH) {
    history.splice(0, history.length - CLAUDE_CONFIG.MAX_HISTORY_LENGTH);
  }

  // タイムアウトを設定
  const timeoutId = setTimeout(() => {
    conversationHistory.delete(userId);
    conversationTimeouts.delete(userId);
    log.debug(`ユーザー ${userId} の会話履歴をタイムアウトで削除しました`);
  }, CLAUDE_CONFIG.CONVERSATION_TIMEOUT);

  conversationTimeouts.set(userId, timeoutId);
}

/**
 * 添付ファイルの内容を分析し、処理戦略を決定する
 * @param {Collection} attachments 添付ファイル
 * @returns {Promise<Object>} 処理戦略と結果
 */
async function analyzeAndProcessAttachments(attachments) {
  const result = {
    hasImages: false,
    hasPdfs: false,
    imageContents: [],
    pdfResults: { texts: [], images: [] },
    strategy: 'text-only'
  };

  if (!attachments || attachments.size === 0) {
    return result;
  }

  // 添付ファイルの種類を分析
  const imageFiles = [...attachments.values()].filter(att =>
    att.contentType?.startsWith('image/'));
  const pdfFiles = [...attachments.values()].filter(att =>
    att.contentType === 'application/pdf');

  result.hasImages = imageFiles.length > 0;
  result.hasPdfs = pdfFiles.length > 0;

  // 処理戦略を決定
  if (result.hasImages && result.hasPdfs) {
    result.strategy = 'mixed-media';
  } else if (result.hasImages) {
    result.strategy = 'images-only';
  } else if (result.hasPdfs) {
    result.strategy = 'pdfs-only';
  }

  // 画像処理
  if (result.hasImages) {
    log.info('画像ファイルを処理しています...');
    result.imageContents = await processMessageImages({ attachments }, {
      maxImages: CLAUDE_CONFIG.IMAGE_PROCESSING.MAX_IMAGES,
      compress: CLAUDE_CONFIG.IMAGE_PROCESSING.COMPRESS_BY_DEFAULT,
      skipLargeImages: CLAUDE_CONFIG.IMAGE_PROCESSING.SKIP_LARGE_FILES
    });

    const imageStats = getImageProcessingStats(result.imageContents);
    log.info(`画像処理完了: ${imageStats.count}個、合計サイズ: ${imageStats.totalSize} bytes`);
  }

  // PDF処理
  if (result.hasPdfs) {
    log.info('PDFファイルを処理しています...');
    result.pdfResults = await processMessagePdfs(
      attachments,
      CLAUDE_CONFIG.PDF_PROCESSING.AUTO_USE_IMAGES,
      CLAUDE_CONFIG.PDF_PROCESSING.COMPRESS_IMAGES
    );

    log.info(`PDF処理完了: テキスト ${result.pdfResults.texts.length}件、画像 ${result.pdfResults.images.length}件`);
  }

  return result;
}

/**
 * Claude用のメッセージコンテンツを構築する
 * @param {string} textPrompt テキストプロンプト
 * @param {Object} attachmentResults 添付ファイル処理結果
 * @returns {Array} Claude用メッセージコンテンツ
 */
function buildClaudeMessageContent(textPrompt, attachmentResults) {
  const messageContent = [];

  // PDFテキストを追加
  if (attachmentResults.pdfResults.texts.length > 0) {
    for (const pdfText of attachmentResults.pdfResults.texts) {
      messageContent.push({
        type: "text",
        text: `=== PDF内容: ${pdfText.filename} ===\n${pdfText.content}\n=== PDF内容終了 ===\n\n`
      });
    }
  }

  // PDF画像を追加
  if (attachmentResults.pdfResults.images.length > 0) {
    for (const pdfImage of attachmentResults.pdfResults.images) {
      messageContent.push({
        type: "text",
        text: `以下は「${pdfImage.filename}」のPDFを画像に変換したものです：`
      });

      for (const [index, imageBase64] of pdfImage.images.entries()) {
        messageContent.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: imageBase64
          }
        });
      }
    }
  }

  // 通常の画像を追加
  messageContent.push(...attachmentResults.imageContents);

  // テキストプロンプトを追加
  const finalText = textPrompt || (
    attachmentResults.hasPdfs ? "これらのPDFファイルを分析してください。" :
      attachmentResults.hasImages ? "これらの画像を説明してください。" :
        "こんにちは"
  );

  messageContent.push({
    type: "text",
    text: finalText
  });

  return messageContent;
}

/**
 * Claude APIを呼び出してレスポンスを取得する
 * @param {Array} messages メッセージ履歴
 * @param {string} systemPrompt システムプロンプト
 * @returns {Promise<string>} Claudeのレスポンス
 */
async function callClaudeApi(messages, systemPrompt) {
  const claude = getClaudeInstance();
  const model = getConfig().model || "claude-3-haiku-20240307";

  try {
    log.debug(`Claude API呼び出し: モデル=${model}, メッセージ数=${messages.length}`);

    const stream = claude.messages.stream({
      system: systemPrompt,
      messages: messages,
      model: model,
      max_tokens: CLAUDE_CONFIG.MAX_TOKENS,
    });

    const response = await stream.finalMessage();

    if (!response?.content?.[0]?.text) {
      throw new Error('Claudeからの応答が空です');
    }

    return response.content[0].text;

  } catch (error) {
    log.error('Claude API呼び出しエラー:', error);

    // エラーの種類に応じてメッセージを分ける
    if (error.message?.includes('rate_limit')) {
      return 'レート制限に達しました。しばらく待ってから再試行してください。';
    } else if (error.message?.includes('invalid_request')) {
      return 'リクエストの形式に問題があります。添付ファイルのサイズや形式を確認してください。';
    } else {
      return `回答の生成中にエラーが発生しました: ${error.message}`;
    }
  }
}

/**
 * ローディングメッセージを更新する
 * @param {Message} loadingMessage ローディングメッセージ
 * @param {string} content 新しい内容
 */
async function updateLoadingMessage(loadingMessage, content) {
  try {
    // Discordの2000文字制限に対応
    const maxLength = 2000;
    let finalContent = content;

    if (content.length > maxLength) {
      finalContent = content.substring(0, maxLength - 50) + '\n\n...(メッセージが長いため省略されました)';
    }

    await loadingMessage.edit(finalContent);
  } catch (error) {
    log.error('ローディングメッセージの更新に失敗しました:', error);

    // 編集に失敗した場合は新しいメッセージを送信
    try {
      await loadingMessage.channel.send('応答の送信中にエラーが発生しました。');
    } catch (sendError) {
      log.error('メッセージ送信にも失敗しました:', sendError);
    }
  }
}

/**
 * Claudeメッセージを処理する（メイン関数）
 * @param {Message} message Discordメッセージ
 */
export async function handleClaudeMessage(message) {
  try {
    // 処理対象かどうかを判断
    if (!shouldProcessWithClaude(message)) {
      return;
    }

    const textPrompt = message.content?.trim() || '';
    const userId = message.author.id;
    const isReply = Boolean(message.reference);

    // 空のメッセージで添付ファイルもない場合はスキップ
    if (!textPrompt && message.attachments.size === 0) {
      return;
    }

    log.info(`Claude処理開始: ユーザー=${userId}, 返信=${isReply}, 添付ファイル=${message.attachments.size}個`);

    // ローディングメッセージを送信
    const loadingMessage = await message.channel.send('🤔 処理中...');

    try {
      // 添付ファイルを分析・処理
      const attachmentResults = await analyzeAndProcessAttachments(message.attachments);

      // メッセージコンテンツを構築
      const messageContent = buildClaudeMessageContent(textPrompt, attachmentResults);

      // 会話履歴を管理
      const userMessage = { role: 'user', content: messageContent };
      manageConversationHistory(userId, userMessage, isReply);

      // Claude APIを呼び出し
      const systemPrompt = getSystemPrompt(message);
      const conversationMessages = conversationHistory.get(userId);
      const generatedContent = await callClaudeApi(conversationMessages, systemPrompt);

      // レスポンスを送信
      await updateLoadingMessage(loadingMessage, generatedContent);

      // 会話履歴にアシスタントの応答を追加
      const assistantMessage = { role: 'assistant', content: generatedContent };
      manageConversationHistory(userId, assistantMessage, true);

      log.info(`Claude処理完了: ユーザー=${userId}`);

    } catch (error) {
      log.error('Claude処理中にエラーが発生しました:', error);
      await updateLoadingMessage(loadingMessage, '申し訳ありませんが、処理中にエラーが発生しました。');
    }

  } catch (error) {
    log.error('Claudeメッセージ処理の初期化に失敗しました:', error);
  }
}

/**
 * 会話履歴の統計を取得する（デバッグ用）
 * @returns {Object} 統計情報
 */
export function getConversationStats() {
  return {
    activeConversations: conversationHistory.size,
    totalMessages: Array.from(conversationHistory.values())
      .reduce((sum, history) => sum + history.length, 0)
  };
}