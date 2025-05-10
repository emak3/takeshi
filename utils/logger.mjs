import log4js from 'log4js';

// シングルトンパターンでロガーインスタンスを保持
let loggerInstance = null;

/**
 * ロガーを初期化する
 * @returns {Logger} ロガーインスタンス
 */
export function initLogger() {
  // 既にインスタンスが存在する場合はそれを返す
  if (loggerInstance) {
    return loggerInstance;
  }

  // ロガー設定
  log4js.configure({
    appenders: {
      stdout: { type: 'stdout' },
      app: { type: 'file', filename: 'application.log' }
    },
    categories: {
      default: { appenders: ['stdout'], level: "info" },
      release: { appenders: ['stdout', 'app'], level: "info" },
      develop: { appenders: ['stdout'], level: "debug" }
    }
  });

  // 環境に応じたカテゴリのロガーを作成
  loggerInstance = log4js.getLogger(process.env.PROFILE || 'default');
  return loggerInstance;
}