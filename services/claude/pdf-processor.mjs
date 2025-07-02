import fetch from 'node-fetch';
import pdfParse from 'pdf-parse';
import { convert } from 'pdf2pic';
import sharp from 'sharp';
import { initLogger } from '../../utils/logger.mjs';

const log = initLogger();

/**
 * PDF処理の設定
 */
const PDF_CONFIG = {
    // 最大ページ数（トークン節約のため）
    MAX_PAGES: 10,
    // 画像変換時の設定
    IMAGE_OPTIONS: {
        density: 150,           // DPI
        saveFilename: "page",
        savePath: "/tmp",
        format: "png",
        width: 1024,           // 最大幅
        height: 1448           // 最大高さ（A4比率）
    },
    // 圧縮設定
    COMPRESSION: {
        quality: 80,           // JPEG品質
        maxWidth: 1024,        // 最大幅
        maxHeight: 1448        // 最大高さ
    }
};

/**
 * PDFファイルのバッファを取得する
 * @param {string} url PDF URL
 * @returns {Promise<Buffer|null>} PDFバッファ
 */
async function getPdfBuffer(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.buffer();
    } catch (error) {
        log.error('PDFバッファの取得に失敗しました:', error);
        return null;
    }
}

/**
 * PDFからテキストを抽出する
 * @param {Buffer} pdfBuffer PDFバッファ
 * @returns {Promise<string|null>} 抽出されたテキスト
 */
async function extractTextFromPdf(pdfBuffer) {
    try {
        const data = await pdfParse(pdfBuffer);

        if (!data.text || data.text.trim().length === 0) {
            log.warn('PDFからテキストを抽出できませんでした');
            return null;
        }

        log.info(`PDFからテキストを抽出しました（${data.numpages}ページ、${data.text.length}文字）`);

        // トークン節約のためテキストを制限
        const maxLength = 8000; // 約2000トークン相当
        if (data.text.length > maxLength) {
            const truncatedText = data.text.substring(0, maxLength) + '\n\n...(テキストが長いため省略されました)';
            log.info(`テキストが長いため${maxLength}文字で切り詰めました`);
            return truncatedText;
        }

        return data.text;
    } catch (error) {
        log.error('PDFテキスト抽出エラー:', error);
        return null;
    }
}

/**
 * PDFを画像に変換する
 * @param {Buffer} pdfBuffer PDFバッファ
 * @param {boolean} compress 圧縮するかどうか
 * @returns {Promise<Array<string>|null>} Base64画像の配列
 */
async function convertPdfToImages(pdfBuffer, compress = true) {
    try {
        // 一時ファイルとしてPDFを保存
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');

        const tempDir = os.tmpdir();
        const tempPdfPath = path.join(tempDir, `temp_${Date.now()}.pdf`);

        fs.writeFileSync(tempPdfPath, pdfBuffer);

        try {
            // PDF2PICの設定
            const options = {
                ...PDF_CONFIG.IMAGE_OPTIONS,
                savePath: tempDir
            };

            const convertOptions = convert.fromPath(tempPdfPath, options);

            // 最大ページ数まで変換
            const pages = Math.min(PDF_CONFIG.MAX_PAGES, 10); // 安全のため10ページまで
            const imageBuffers = [];

            for (let pageNum = 1; pageNum <= pages; pageNum++) {
                try {
                    const result = await convertOptions(pageNum, { responseType: 'buffer' });
                    if (result.buffer) {
                        let processedBuffer = result.buffer;

                        // 圧縮処理
                        if (compress) {
                            processedBuffer = await compressImage(result.buffer);
                        }

                        const base64 = processedBuffer.toString('base64');
                        imageBuffers.push(base64);

                        log.debug(`PDFページ${pageNum}を画像に変換しました`);
                    }
                } catch (pageError) {
                    log.warn(`PDFページ${pageNum}の変換に失敗しました:`, pageError.message);
                    break; // ページが存在しない場合は終了
                }
            }

            log.info(`PDFから${imageBuffers.length}ページの画像を生成しました`);
            return imageBuffers.length > 0 ? imageBuffers : null;

        } finally {
            // 一時ファイルを削除
            try {
                fs.unlinkSync(tempPdfPath);
            } catch (cleanupError) {
                log.warn('一時ファイルの削除に失敗しました:', cleanupError.message);
            }
        }

    } catch (error) {
        log.error('PDF画像変換エラー:', error);
        return null;
    }
}

/**
 * 画像を圧縮する
 * @param {Buffer} imageBuffer 画像バッファ
 * @returns {Promise<Buffer>} 圧縮された画像バッファ
 */
async function compressImage(imageBuffer) {
    try {
        const { quality, maxWidth, maxHeight } = PDF_CONFIG.COMPRESSION;

        return await sharp(imageBuffer)
            .resize(maxWidth, maxHeight, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality })
            .toBuffer();

    } catch (error) {
        log.error('画像圧縮エラー:', error);
        return imageBuffer; // 圧縮失敗時は元のバッファを返す
    }
}

/**
 * Discord添付ファイルからPDFを処理する
 * @param {Collection} attachments Discord添付ファイル
 * @param {boolean} useImages 画像変換を使用するかどうか
 * @param {boolean} compress 圧縮するかどうか
 * @returns {Promise<Object>} 処理結果
 */
export async function processMessagePdfs(attachments, useImages = false, compress = true) {
    try {
        const pdfAttachments = [...attachments.values()].filter(
            attachment => attachment.contentType === 'application/pdf'
        );

        if (pdfAttachments.length === 0) {
            return { texts: [], images: [] };
        }

        log.info(`${pdfAttachments.length}個のPDFファイルを処理します`);

        const results = { texts: [], images: [] };

        for (const attachment of pdfAttachments.slice(0, 3)) { // 最大3ファイルまで処理
            const pdfBuffer = await getPdfBuffer(attachment.url);
            if (!pdfBuffer) {
                continue;
            }

            // まずテキスト抽出を試行
            const extractedText = await extractTextFromPdf(pdfBuffer);

            if (extractedText && extractedText.trim().length > 100) {
                // 十分なテキストが抽出できた場合
                results.texts.push({
                    filename: attachment.name,
                    content: extractedText
                });
                log.info(`PDFからテキストを抽出しました: ${attachment.name}`);
            } else if (useImages) {
                // テキスト抽出が不十分な場合は画像変換
                log.info(`テキスト抽出が不十分なため画像変換を実行します: ${attachment.name}`);
                const images = await convertPdfToImages(pdfBuffer, compress);

                if (images && images.length > 0) {
                    results.images.push({
                        filename: attachment.name,
                        images: images
                    });
                    log.info(`PDFを${images.length}ページの画像に変換しました: ${attachment.name}`);
                }
            }
        }

        return results;

    } catch (error) {
        log.error('PDF処理エラー:', error);
        return { texts: [], images: [] };
    }
}

/**
 * 画像を圧縮してトークンを節約する
 * @param {Buffer} imageBuffer 画像バッファ
 * @param {Object} options 圧縮オプション
 * @returns {Promise<Buffer>} 圧縮された画像バッファ
 */
export async function compressImageForTokenSaving(imageBuffer, options = {}) {
    try {
        const config = {
            quality: options.quality || 70,
            maxWidth: options.maxWidth || 1024,
            maxHeight: options.maxHeight || 1024,
            format: options.format || 'jpeg'
        };

        let processor = sharp(imageBuffer)
            .resize(config.maxWidth, config.maxHeight, {
                fit: 'inside',
                withoutEnlargement: true
            });

        if (config.format === 'jpeg') {
            processor = processor.jpeg({ quality: config.quality });
        } else if (config.format === 'webp') {
            processor = processor.webp({ quality: config.quality });
        } else {
            processor = processor.png({ compressionLevel: 9 });
        }

        const compressedBuffer = await processor.toBuffer();

        const originalSize = imageBuffer.length;
        const compressedSize = compressedBuffer.length;
        const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);

        log.info(`画像を圧縮しました: ${originalSize} → ${compressedSize} bytes (${compressionRatio}% 削減)`);

        return compressedBuffer;

    } catch (error) {
        log.error('画像圧縮エラー:', error);
        return imageBuffer;
    }
}