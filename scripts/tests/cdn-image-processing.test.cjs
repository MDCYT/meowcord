/* SPDX-License-Identifier: AGPL-3.0-only */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const sharp = require("sharp");

const transpile = (file) =>
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;

function loadByteLru() {
    const mod = { exports: {} };
    vm.runInNewContext(transpile("src/util/util/federation/Media.ts"), {
        module: mod,
        exports: mod.exports,
        require: () => ({}),
        Buffer,
        Number,
        Math,
        Map,
        Set,
        Date,
        URLSearchParams,
    });
    return mod.exports.ByteLru;
}

const ByteLru = loadByteLru();

function loadModule(
    configMock = {
        cdn: { resizeImages: false, imageProcessing: { enabled: false, minDimension: 16, maxDimension: 4096, defaultQuality: 100, cacheMemoryBytes: 64 * 1024 * 1024 } },
    },
) {
    const imports = {
        "node:crypto": require("node:crypto"),
        express: {},
        sharp: sharp,
        "file-type": require("file-type"),
        "@spacebar/util": {
            ByteLru: ByteLru,
            Config: {
                get: () => configMock,
            },
        },
        "./responseSafety": {
            safeMediaType: (mime) => mime || "application/octet-stream",
        },
    };

    const module = { exports: {} };
    const source = fs.readFileSync("src/cdn/util/imageTransformer.ts", "utf8");
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    }).outputText;

    vm.runInNewContext(transpiled, {
        module,
        exports: module.exports,
        require: (name) => {
            if (!(name in imports)) throw new Error(`Missing mocked import: ${name}`);
            return imports[name];
        },
        console,
        Buffer,
        Number,
        Math,
        Set,
        Date,
    });

    return module.exports;
}

function createMockResponse() {
    const headers = {};
    let statusCode = 200;
    let ended = false;
    let body = null;

    const res = {
        setHeader: (name, value) => {
            headers[name.toLowerCase()] = String(value);
        },
        set: (name, value) => {
            headers[name.toLowerCase()] = String(value);
        },
        getHeader: (name) => headers[name.toLowerCase()],
        status: (code) => {
            statusCode = code;
            return res;
        },
        end: (data) => {
            ended = true;
            if (data !== undefined) body = data;
            return res;
        },
        send: (data) => {
            ended = true;
            body = data;
            return res;
        },
        get headers() {
            return headers;
        },
        get statusCode() {
            return statusCode;
        },
        get ended() {
            return ended;
        },
        get body() {
            return body;
        },
    };

    return res;
}

test("imageTransformer: returns false when resizeImages is not enabled", () => {
    const transformer = loadModule({ cdn: { resizeImages: false, imageProcessing: { enabled: false } } });
    assert.equal(transformer.isImageProcessingEnabled(), false);
});

test("imageTransformer: returns true when resizeImages is true", () => {
    const transformer = loadModule({ cdn: { resizeImages: true, imageProcessing: { enabled: false } } });
    assert.equal(transformer.isImageProcessingEnabled(), true);
});

test("imageTransformer: returns true when imageProcessing.enabled is true", () => {
    const transformer = loadModule({ cdn: { resizeImages: false, imageProcessing: { enabled: true } } });
    assert.equal(transformer.isImageProcessingEnabled(), true);
});

test("imageTransformer: returns original buffer untouched when disabled", async () => {
    const transformer = loadModule({ cdn: { resizeImages: false, imageProcessing: { enabled: false } } });
    const original = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
        .png()
        .toBuffer();

    const req = { query: { size: "44" }, originalUrl: "/emojis/123.webp?size=44", headers: {}, method: "GET" };
    const res = createMockResponse();

    await transformer.processImageResponse(req, res, original);

    assert.equal(res.ended, true);
    assert.equal(res.body, original);
    assert.equal(res.headers["content-type"], "image/png");
    assert.equal(res.headers["content-length"], String(original.length));
    assert.ok(res.headers["etag"]);
});

test("imageTransformer: supports 304 Not Modified when disabled", async () => {
    const transformer = loadModule({ cdn: { resizeImages: false, imageProcessing: { enabled: false } } });
    const original = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } })
        .png()
        .toBuffer();

    const crypto = require("node:crypto");
    const etag = `"${crypto.createHash("md5").update(original).digest("hex")}"`;

    const req = { query: {}, originalUrl: "/emojis/123.png", headers: { "if-none-match": etag }, method: "GET" };
    const res = createMockResponse();

    await transformer.processImageResponse(req, res, original);

    assert.equal(res.statusCode, 304);
    assert.equal(res.ended, true);
    assert.equal(res.body, null);
});

test("imageTransformer: resizes to 44x44 and converts to webp when ?size=44 is requested", async () => {
    const transformer = loadModule({ cdn: { resizeImages: true, imageProcessing: { enabled: true, minDimension: 16, maxDimension: 4096, defaultQuality: 100 } } });
    const original = await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 255, g: 128, b: 0, alpha: 1 } } })
        .png()
        .toBuffer();

    const req = { query: { size: "44" }, originalUrl: "/emojis/123.webp?size=44", headers: {}, method: "GET" };
    const res = createMockResponse();

    await transformer.processImageResponse(req, res, original);

    assert.equal(res.ended, true);
    assert.notEqual(res.body, original);
    assert.equal(res.headers["content-type"], "image/webp");

    const meta = await sharp(res.body).metadata();
    assert.equal(meta.width, 44);
    assert.equal(meta.height, 44);
    assert.equal(meta.format, "webp");
});

test("imageTransformer: handles custom width and height queries", async () => {
    const transformer = loadModule({ cdn: { resizeImages: true, imageProcessing: { enabled: true, minDimension: 16, maxDimension: 4096, defaultQuality: 100 } } });
    const original = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } })
        .png()
        .toBuffer();

    const req = { query: { width: "64", height: "32", format: "jpeg" }, originalUrl: "/banners/guild/banner?width=64&height=32&format=jpeg", headers: {}, method: "GET" };
    const res = createMockResponse();

    await transformer.processImageResponse(req, res, original);

    assert.equal(res.ended, true);
    assert.equal(res.headers["content-type"], "image/jpeg");

    const meta = await sharp(res.body).metadata();
    assert.equal(meta.format, "jpeg");
    assert.ok(meta.width <= 64);
    assert.ok(meta.height <= 32);
});

test("imageTransformer: clamps dimensions between minDimension and maxDimension", async () => {
    const transformer = loadModule({ cdn: { resizeImages: true, imageProcessing: { enabled: true, minDimension: 16, maxDimension: 512, defaultQuality: 100 } } });
    const original = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } } })
        .png()
        .toBuffer();

    const optionsSmall = transformer.parseTransformOptions({ query: { size: "4" }, originalUrl: "/emojis/1.png" });
    assert.equal(optionsSmall.width, 16);
    assert.equal(optionsSmall.height, 16);

    const optionsLarge = transformer.parseTransformOptions({ query: { size: "8000" }, originalUrl: "/emojis/1.png" });
    assert.equal(optionsLarge.width, 512);
    assert.equal(optionsLarge.height, 512);
});

test("imageTransformer: serves subsequent identical requests from in-memory cache", async () => {
    const transformer = loadModule({
        cdn: { resizeImages: true, imageProcessing: { enabled: true, minDimension: 16, maxDimension: 4096, defaultQuality: 100, cacheMemoryBytes: 64 * 1024 * 1024 } },
    });
    transformer.clearImageTransformCache();

    const original = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 50, g: 100, b: 150, alpha: 1 } } })
        .png()
        .toBuffer();

    const req = { query: { size: "32" }, originalUrl: "/avatars/user/hash.png?size=32", headers: {}, method: "GET" };
    const res1 = createMockResponse();
    await transformer.processImageResponse(req, res1, original);

    const res2 = createMockResponse();
    await transformer.processImageResponse(req, res2, original);

    assert.equal(res1.headers["etag"], res2.headers["etag"]);
    assert.deepEqual(res1.body, res2.body);
});

test("imageTransformer: extracts static frame when animated=false", async () => {
    const transformer = loadModule({ cdn: { resizeImages: true, imageProcessing: { enabled: true, minDimension: 16, maxDimension: 4096, defaultQuality: 100 } } });
    const gif = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 255, g: 255, b: 0, alpha: 1 } } })
        .gif()
        .toBuffer();

    const req = { query: { animated: "false", format: "png", size: "32" }, originalUrl: "/avatars/user/a_gif.png?animated=false&size=32", headers: {}, method: "GET" };
    const res = createMockResponse();

    await transformer.processImageResponse(req, res, gif, "image/gif");

    assert.equal(res.headers["content-type"], "image/png");
    const meta = await sharp(res.body).metadata();
    assert.equal(meta.format, "png");
    assert.equal(meta.pages || 1, 1);
});

test("imageTransformer: rasterizes SVG to PNG when format=png requested", async () => {
    const transformer = loadModule({ cdn: { resizeImages: true, imageProcessing: { enabled: true, minDimension: 16, maxDimension: 4096, defaultQuality: 100 } } });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>');

    const req = { query: { size: "64", format: "png" }, originalUrl: "/badge-icons/badge.png?size=64", headers: {}, method: "GET" };
    const res = createMockResponse();

    await transformer.processImageResponse(req, res, svg, "image/svg+xml");

    assert.equal(res.headers["content-type"], "image/png");
    const meta = await sharp(res.body).metadata();
    assert.equal(meta.format, "png");
    assert.equal(meta.width, 64);
    assert.equal(meta.height, 64);
});

test("imageTransformer: passes non-image binaries through untouched", async () => {
    const transformer = loadModule({ cdn: { resizeImages: true, imageProcessing: { enabled: true } } });
    const textBuffer = Buffer.from("Hello world, this is a plain text attachment");

    const req = { query: { size: "64" }, originalUrl: "/attachments/test.txt?size=64", headers: {}, method: "GET" };
    const res = createMockResponse();

    await transformer.processImageResponse(req, res, textBuffer, "text/plain");

    assert.equal(res.body, textBuffer);
    assert.equal(res.headers["content-type"], "text/plain");
});

test("imageTransformer: recovers and sends original buffer if sharp throws on corrupt image", async () => {
    const transformer = loadModule({ cdn: { resizeImages: true, imageProcessing: { enabled: true } } });
    const corruptBuffer = Buffer.from("not-a-valid-image-data-at-all");

    const req = { query: { size: "64" }, originalUrl: "/emojis/bad.webp?size=64", headers: {}, method: "GET" };
    const res = createMockResponse();

    await transformer.processImageResponse(req, res, corruptBuffer, "image/webp");

    assert.equal(res.ended, true);
    assert.equal(res.body, corruptBuffer);
});
