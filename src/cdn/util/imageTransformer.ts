/* SPDX-License-Identifier: AGPL-3.0-only */
import crypto from "node:crypto";
import { Request, Response } from "express";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { ByteLru, Config } from "@spacebar/util";
import { safeMediaType } from "./responseSafety";

export type ImageOutputFormat = "webp" | "png" | "jpeg" | "gif" | "avif";
export type ImageFit = "inside" | "cover" | "contain" | "fill" | "outside";

export interface ImageTransformOptions {
    size?: number;
    width?: number;
    height?: number;
    quality?: number;
    format?: ImageOutputFormat;
    animated?: boolean;
    fit?: ImageFit;
}

export interface CachedImage {
    buffer: Buffer;
    contentType: string;
    etag: string;
    size: number;
}

const FORMAT_TO_MIME: Record<ImageOutputFormat, string> = {
    webp: "image/webp",
    png: "image/png",
    jpeg: "image/jpeg",
    gif: "image/gif",
    avif: "image/avif",
};

const MIME_TO_FORMAT: Record<string, ImageOutputFormat> = {
    "image/webp": "webp",
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/apng": "png",
};

const VALID_FORMATS = new Set<string>(["webp", "png", "jpeg", "jpg", "gif", "avif"]);
const VALID_FITS = new Set<string>(["inside", "cover", "contain", "fill", "outside"]);

const clampNumber = (value: unknown, min: number, max: number): number | undefined => {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
    if (!Number.isSafeInteger(parsed)) return undefined;
    return Math.max(min, Math.min(max, parsed));
};

const parseFormat = (requested: unknown): ImageOutputFormat | undefined => {
    if (typeof requested !== "string") return undefined;
    const normalized = requested.trim().toLowerCase();
    if (!VALID_FORMATS.has(normalized)) return undefined;
    return normalized === "jpg" ? "jpeg" : (normalized as ImageOutputFormat);
};

const parseFormatFromRequest = (req: Request): ImageOutputFormat | undefined => {
    const queryFormat = parseFormat(req.query.format);
    if (queryFormat) return queryFormat;
    const urlPath = req.originalUrl?.split("?")[0] || req.path || "";
    const match = /\.([a-zA-Z0-9]+)$/.exec(urlPath);
    return match ? parseFormat(match[1]) : undefined;
};

const parseFit = (requested: unknown): ImageFit | undefined => {
    if (typeof requested !== "string") return undefined;
    const normalized = requested.trim().toLowerCase();
    return VALID_FITS.has(normalized) ? (normalized as ImageFit) : undefined;
};

const parseAnimated = (requested: unknown): boolean | undefined => {
    if (typeof requested === "boolean") return requested;
    if (typeof requested !== "string") return undefined;
    const normalized = requested.trim().toLowerCase();
    if (normalized === "false" || normalized === "0") return false;
    if (normalized === "true" || normalized === "1") return true;
    return undefined;
};

export const parseTransformOptions = (req: Request): ImageTransformOptions => {
    const cdnConfig = Config.get().cdn;
    const limits = cdnConfig?.imageProcessing ?? {
        minDimension: 16,
        maxDimension: 4096,
        defaultQuality: 100,
    };
    const min = limits.minDimension ?? 16;
    const max = limits.maxDimension ?? 4096;

    const size = clampNumber(req.query.size, min, max);
    let width = clampNumber(req.query.width, min, max);
    let height = clampNumber(req.query.height, min, max);

    if (size !== undefined && width === undefined && height === undefined) {
        width = size;
        height = size;
    }

    const quality = clampNumber(req.query.quality, 1, 100);
    const fit = parseFit(req.query.fit) ?? (req.query.keep_aspect_ratio === "false" ? "fill" : "inside");
    const format = parseFormatFromRequest(req);
    const animated = parseAnimated(req.query.animated);

    return {
        size,
        width,
        height,
        quality,
        format,
        animated: format === "jpeg" ? false : animated,
        fit,
    };
};

export const isImageProcessingEnabled = (): boolean => {
    const config = Config.get().cdn;
    return Boolean(config?.resizeImages || config?.imageProcessing?.enabled);
};

export const requiresTransformation = (options: ImageTransformOptions, sourceFormat?: ImageOutputFormat, isAnimatedSource = false): boolean => {
    if (options.width !== undefined || options.height !== undefined) return true;
    if (options.format !== undefined && options.format !== sourceFormat) return true;
    if (options.quality !== undefined) return true;
    if (options.animated === false && isAnimatedSource) return true;
    return false;
};

const cache = new ByteLru<CachedImage>(() => {
    const config = Config.get().cdn;
    return config?.imageProcessing?.cacheMemoryBytes || 64 * 1024 * 1024;
});

export const clearImageTransformCache = (): void => {
    cache.trim(0);
};

const createHashKey = (buffer: Buffer, options: ImageTransformOptions, targetFormat: ImageOutputFormat): string => {
    const digest = crypto.createHash("md5").update(buffer).digest("hex");
    return `${digest}:${targetFormat}:${options.width ?? 0}x${options.height ?? 0}:${options.fit ?? "inside"}:${options.quality ?? "def"}:${options.animated ?? "auto"}`;
};

export const transformImage = async (buffer: Buffer, mime: string, options: ImageTransformOptions): Promise<{ buffer: Buffer; contentType: string }> => {
    const sourceFormat = MIME_TO_FORMAT[mime];
    const targetFormat = options.format || sourceFormat || "webp";
    const isSvg = mime === "image/svg+xml" || mime === "image/svg";

    if (isSvg && !options.format && options.width === undefined && options.height === undefined) {
        return { buffer, contentType: "image/svg+xml" };
    }

    const preserveAnimation = options.animated !== false && targetFormat !== "jpeg" && (targetFormat === "gif" || targetFormat === "webp");
    let pipeline = sharp(buffer, {
        animated: preserveAnimation,
        failOn: "none",
    });

    if (options.width !== undefined || options.height !== undefined) {
        pipeline = pipeline.resize({
            width: options.width,
            height: options.height,
            fit: options.fit ?? "inside",
            withoutEnlargement: false,
        });
    }

    const quality = options.quality ?? Config.get().cdn?.imageProcessing?.defaultQuality ?? 100;

    if (targetFormat === "webp") {
        pipeline = pipeline.webp({ quality, effort: 4 });
    } else if (targetFormat === "png") {
        pipeline = pipeline.png({ quality, compressionLevel: 6 });
    } else if (targetFormat === "jpeg") {
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    } else if (targetFormat === "gif") {
        pipeline = pipeline.gif({ effort: 4 });
    } else if (targetFormat === "avif") {
        pipeline = pipeline.avif({ quality, effort: 4 });
    }

    const transformed = await pipeline.toBuffer();
    return {
        buffer: transformed,
        contentType: FORMAT_TO_MIME[targetFormat] ?? "image/webp",
    };
};

export const processImageResponse = async (req: Request, res: Response, buffer: Buffer, fallbackContentType?: string): Promise<Response | void> => {
    let contentType = fallbackContentType;
    if (!contentType) {
        const sniffed = await fileTypeFromBuffer(buffer).catch(() => undefined);
        contentType = sniffed?.mime ?? (buffer.subarray(0, 100).includes(Buffer.from("<svg")) ? "image/svg+xml" : "application/octet-stream");
    }

    const isSvg = contentType === "image/svg+xml" || contentType === "image/svg";
    const isImage = contentType.startsWith("image/") || isSvg;

    if (!isImage || !isImageProcessingEnabled()) {
        const etag = `"${crypto.createHash("md5").update(buffer).digest("hex")}"`;
        res.setHeader("Content-Type", isSvg ? "image/svg+xml" : safeMediaType(contentType));
        res.setHeader("Content-Length", String(buffer.length));
        res.setHeader("ETag", etag);
        if (req.headers["if-none-match"] === etag) return res.status(304).end();
        return req.method === "HEAD" ? res.end() : res.end(buffer);
    }

    const options = parseTransformOptions(req);
    const sourceFormat = MIME_TO_FORMAT[contentType];
    const isAnimatedSource = contentType === "image/gif" || contentType === "image/webp" || contentType === "image/apng";

    if (!requiresTransformation(options, sourceFormat, isAnimatedSource) && !isSvg) {
        const etag = `"${crypto.createHash("md5").update(buffer).digest("hex")}"`;
        res.setHeader("Content-Type", safeMediaType(contentType));
        res.setHeader("Content-Length", String(buffer.length));
        res.setHeader("ETag", etag);
        if (req.headers["if-none-match"] === etag) return res.status(304).end();
        return req.method === "HEAD" ? res.end() : res.end(buffer);
    }

    const targetFormat = options.format || sourceFormat || (isSvg ? "png" : "webp");
    const cacheKey = createHashKey(buffer, options, targetFormat);
    const cached = cache.get(cacheKey);

    if (cached) {
        res.setHeader("Content-Type", cached.contentType);
        res.setHeader("Content-Length", String(cached.size));
        res.setHeader("ETag", cached.etag);
        if (req.headers["if-none-match"] === cached.etag) return res.status(304).end();
        return req.method === "HEAD" ? res.end() : res.end(cached.buffer);
    }

    let transformedBuffer = buffer;
    let outputContentType = isSvg ? "image/svg+xml" : safeMediaType(contentType);

    try {
        const result = await transformImage(buffer, contentType, options);
        transformedBuffer = result.buffer;
        outputContentType = result.contentType;
    } catch (error) {
        console.warn("[CDN/ImageTransformer] Failed to transform image:", error);
    }

    const etag = `"${crypto.createHash("md5").update(transformedBuffer).digest("hex")}"`;

    if (transformedBuffer !== buffer) {
        cache.set(
            cacheKey,
            {
                buffer: transformedBuffer,
                contentType: outputContentType,
                etag,
                size: transformedBuffer.length,
            },
            24 * 60 * 60 * 1000,
        );
    }

    res.setHeader("Content-Type", outputContentType);
    res.setHeader("Content-Length", String(transformedBuffer.length));
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    return req.method === "HEAD" ? res.end() : res.end(transformedBuffer);
};
