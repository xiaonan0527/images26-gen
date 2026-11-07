#!/usr/bin/env node
/**
 * GPT-Image-2.6-Ext 图片生成脚本
 * 使用 gpt-image-2.6-ext 模型，通过 version 参数选择 flare (快速出图) 或 sunburst (构图/编辑精度优先)
 * 支持 png / jpeg / webp / gif 输出（svg 上游暂不支持），支持 1k / 2k / 4k 分辨率。
 * 提交生成任务 → 轮询任务状态 → 下载文件到本地
 */

const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.nange-ai', 'config.json');
const BASE_URL = (process.env.GPT_IMAGE_BASE_URL || 'https://api.nange-ai.com/gpt-image/v1').replace(/\/+$/, '');
const MODEL = 'gpt-image-2.6-ext';

const VALID_VERSIONS = ['flare', 'sunburst'];
const VALID_QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max', 'auto'];
const VALID_COMPLEXITIES = ['low', 'medium', 'high'];
const VALID_RESOLUTIONS = ['1k', '2k', '4k'];
const VALID_OUTPUT_FORMATS = ['png', 'jpeg', 'jpg', 'webp', 'svg', 'gif'];
// 上游文档目前标注"暂不支持 SVG 输出"。上游开放后改为 true 即可，服务端同步放行。
const SVG_SUPPORTED = false;
// 2.6-ext 只接受 auto 和这 10 种比例，不接受像素尺寸，也不接受 2:1 / 3:1 / 9:21 等
const VALID_SIZES = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9'];
const MAX_REFERENCE_IMAGES = 16;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 读取 API Key（优先级：环境变量 > 配置文件）
 */
function loadApiKey() {
  const envKey = process.env.NANGE_API_KEY || process.env.GPT_IMAGE_API_KEY;
  if (envKey && envKey.trim()) {
    return envKey.trim();
  }

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (config.api_key && config.api_key !== 'YOUR_KEY' && config.api_key.trim()) {
        return config.api_key.trim();
      }
    } catch (_) { /* ignore parse errors */ }
  }

  console.error('错误：未找到 API Key');
  console.error('');
  console.error('请选择以下任一方式配置：');
  console.error('');
  console.error('  方式 A（环境变量）：');
  console.error('    export NANGE_API_KEY="your-api-key"');
  console.error('');
  console.error('  方式 B（配置文件）：');
  if (process.platform === 'win32') {
    console.error(`    mkdir "%USERPROFILE%\\.nange-ai" && echo {"api_key":"YOUR_KEY"} > "%USERPROFILE%\\.nange-ai\\config.json"`);
  } else {
    console.error(`    mkdir -p ~/.nange-ai && echo '{"api_key":"YOUR_KEY"}' > ~/.nange-ai/config.json`);
  }
  console.error('');
  console.error('API Key 创建地址：https://api.nange-ai.com/keys（选择 GPT-Image 分组）');
  process.exit(1);
}

function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (_) {
          reject(new Error(`无法解析响应: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const MIME_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
};

function resolveImageArg(arg) {
  if (arg.startsWith('http://') || arg.startsWith('https://') || arg.startsWith('data:')) {
    return arg;
  }
  const absPath = path.resolve(arg);
  if (!fs.existsSync(absPath)) {
    console.error(`错误：图片文件不存在 → ${absPath}`);
    process.exit(1);
  }
  const ext = path.extname(absPath).toLowerCase();
  const mime = MIME_TYPES[ext];
  if (!mime) {
    console.error(`错误：不支持的参考图格式 "${ext}"，支持 PNG / JPEG / WebP / GIF / BMP → ${absPath}`);
    process.exit(1);
  }
  const buf = fs.readFileSync(absPath);
  if (buf.length > MAX_REFERENCE_BYTES) {
    console.error(`错误：参考图超过 20 MB 限制 → ${absPath}`);
    process.exit(1);
  }
  process.stderr.write(`已读取本地图片: ${absPath} (${mime})\n`);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode >= 400) {
        res.resume();
        reject(new Error(`下载失败 HTTP ${res.statusCode}`));
        return;
      }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => { ws.close(); resolve(); });
      ws.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * 构造请求体。导出给 --dry-run 使用，便于在不调用接口的情况下检查参数。
 */
function buildRequestBody(opts) {
  const body = {
    model: MODEL,
    version: opts.version,
    prompt: opts.prompt,
    n: 1,
    resolution: opts.resolution,
  };

  // GIF 的 size 只能省略或 auto，传比例会被拒绝
  if (opts.outputFormat !== 'gif') {
    body.size = opts.size;
  }
  if (opts.quality) body.quality = opts.quality;
  if (opts.complexity) body.complexity = opts.complexity;
  if (opts.outputFormat) body.output_format = opts.outputFormat;
  if (opts.outputFormat === 'svg' && opts.svgModel) {
    body.svg = { model: opts.svgModel };
    if (opts.svgReasoning) body.svg.reasoning = { effort: opts.svgReasoning };
  }
  if (opts.imageUrls && opts.imageUrls.length > 0) {
    body.image_urls = opts.imageUrls;
  }
  return body;
}

async function submitTask(apiKey, body) {
  const result = await request(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
  }, JSON.stringify(body));

  // 兼容 data 为数组 / 单个任务对象两种提交响应
  const data = result.data;
  const first = Array.isArray(data) ? data[0] : data;
  const taskId = first && (first.task_id || first.id);
  if (!taskId) {
    throw new Error(`提交响应中没有 task_id: ${JSON.stringify(result).slice(0, 300)}`);
  }
  return taskId;
}

/**
 * 取任务对象：有 {code, data} 外壳时读 data，否则响应本身就是任务对象。
 */
function unwrapTask(result) {
  if (result && result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    return result.data;
  }
  return result;
}

function firstImageUrl(task) {
  const image = task.result && task.result.images && task.result.images[0];
  if (!image) return null;
  return Array.isArray(image.url) ? image.url[0] : image.url;
}

async function pollTask(apiKey, taskId) {
  const start = Date.now();

  while (true) {
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new Error(`任务超时（超过 ${POLL_TIMEOUT_MS / 60000} 分钟），任务 ID: ${taskId}，可稍后继续查询，请勿重复提交`);
    }

    const result = await request(`${BASE_URL}/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const task = unwrapTask(result);
    const { status, progress, error } = task;

    if (status === 'completed') {
      const url = firstImageUrl(task);
      if (!url) throw new Error('任务已完成但响应中没有图片链接');
      return url;
    }
    if (status === 'failed') {
      throw new Error((error && error.message) || '任务失败');
    }

    process.stderr.write(`生成中... ${progress || 0}%\n`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

function printUsage() {
  console.error('用法: node generate.js --prompt "提示词" [选项]');
  console.error('');
  console.error('选项:');
  console.error('  --version <version>      版本 (默认: flare)');
  console.error('                           可选: flare (快速出图), sunburst (构图/编辑精度优先)');
  console.error('  --quality <quality>      质量 (默认: medium)，不影响价格');
  console.error('                           可选: low, medium, high, xhigh, max, auto');
  console.error('  --complexity <level>     画面复杂度 (可选: low, medium, high)，不影响价格');
  console.error('  --size <ratio>           比例 (默认: 1:1)');
  console.error('                           可选: auto, 1:1, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 16:9, 9:16, 21:9');
  console.error('                           不支持像素尺寸；GIF 会忽略该参数');
  console.error('  --resolution <res>       分辨率 (默认: 1k)  可选: 1k, 2k, 4k；2k/4k 时参考图不能是 GIF/BMP');
  console.error('  --output-format <fmt>    输出格式 (默认: png)  可选: png, jpeg, webp, gif（svg 上游暂不支持）');
  console.error('                           gif 仅支持文生图，不能带 --image-url');
  console.error('  --svg-model <model>      SVG 输出时编写 SVG 的文本模型 (可选, 如 gpt-4.1-mini)');
  console.error('  --svg-reasoning <effort> SVG 推理档位 (可选: none, minimal, low, medium, high, xhigh, max)');
  console.error('  --image-url <path|url>   参考图 (可多次指定, 最多 16 张, 每张 ≤ 20MB)');
  console.error('  --out <path>             输出路径 (默认: ./output.<格式>)');
  console.error('  --dry-run                只打印请求体，不调用接口');
}

function parseArgs(argv) {
  const parsed = {
    version: 'flare',
    quality: 'medium',
    size: '1:1',
    resolution: '1k',
    imageUrls: [],
    outputFormat: 'png',
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--prompt': parsed.prompt = argv[++i]; break;
      case '--version': parsed.version = argv[++i]; break;
      case '--quality': parsed.quality = argv[++i]; break;
      case '--complexity': parsed.complexity = argv[++i]; break;
      case '--size': parsed.size = argv[++i]; break;
      case '--resolution': parsed.resolution = argv[++i]; break;
      case '--output-format': parsed.outputFormat = argv[++i]; break;
      case '--svg-model': parsed.svgModel = argv[++i]; break;
      case '--svg-reasoning': parsed.svgReasoning = argv[++i]; break;
      case '--image-url': parsed.imageUrls.push(argv[++i]); break;
      case '--out': parsed.out = argv[++i]; break;
      case '--dry-run': parsed.dryRun = true; break;
      default:
        console.error(`错误：未知参数 "${argv[i]}"`);
        printUsage();
        process.exit(1);
    }
  }

  if (!parsed.prompt) {
    printUsage();
    process.exit(1);
  }

  // 枚举值不区分大小写，统一转小写
  for (const key of ['version', 'quality', 'complexity', 'size', 'resolution', 'outputFormat']) {
    if (typeof parsed[key] === 'string') parsed[key] = parsed[key].trim().toLowerCase();
  }
  if (parsed.outputFormat === 'jpg') parsed.outputFormat = 'jpeg';

  const fail = (msg) => { console.error(`错误：${msg}`); process.exit(1); };

  if (!VALID_VERSIONS.includes(parsed.version)) {
    fail(`不支持的版本 "${parsed.version}"，可选: ${VALID_VERSIONS.join(', ')}`);
  }
  if (parsed.quality && !VALID_QUALITIES.includes(parsed.quality)) {
    fail(`不支持的质量档位 "${parsed.quality}"，可选: ${VALID_QUALITIES.join(', ')}`);
  }
  if (parsed.complexity && !VALID_COMPLEXITIES.includes(parsed.complexity)) {
    fail(`不支持的复杂度 "${parsed.complexity}"，可选: ${VALID_COMPLEXITIES.join(', ')}`);
  }
  if (!VALID_RESOLUTIONS.includes(parsed.resolution)) {
    fail(`不支持的分辨率 "${parsed.resolution}"，可选: ${VALID_RESOLUTIONS.join(', ')}`);
  }
  if (!VALID_OUTPUT_FORMATS.includes(parsed.outputFormat)) {
    fail(`不支持的输出格式 "${parsed.outputFormat}"，可选: png, jpeg, webp, gif`);
  }
  if (parsed.outputFormat === 'svg' && !SVG_SUPPORTED) {
    fail('gpt-image-2.6-ext 上游暂不支持 SVG 输出，请改用 png / jpeg / webp / gif。需要透明背景的 Logo / 图标请改用 gpt-image-2.5-ext（images25-gen，--background transparent）');
  }
  // 2k / 4k 时上游不接受 GIF / BMP 参考图；URL 看路径扩展名，本地文件看文件扩展名
  if (parsed.resolution !== '1k') {
    for (const ref of parsed.imageUrls) {
      let refPath = String(ref);
      try { refPath = new URL(refPath).pathname; } catch (_) { /* 本地路径，直接用 */ }
      if (/\.(gif|bmp)$/i.test(refPath)) {
        fail(`resolution=${parsed.resolution} 时参考图不能是 GIF / BMP（${ref}），请改用 PNG / JPEG / WebP，或改回 --resolution 1k`);
      }
    }
  }
  if (!VALID_SIZES.includes(parsed.size)) {
    fail(`不支持的 size "${parsed.size}"。gpt-image-2.6-ext 仅支持: ${VALID_SIZES.join(', ')}（不支持像素尺寸、2:1、1:2、3:1、1:3、9:21）`);
  }
  if ((parsed.outputFormat === 'svg' || parsed.outputFormat === 'gif') && parsed.imageUrls.length > 0) {
    fail(`${parsed.outputFormat} 输出仅支持文生图，不能同时使用 --image-url`);
  }
  if (parsed.imageUrls.length > MAX_REFERENCE_IMAGES) {
    fail(`参考图最多 ${MAX_REFERENCE_IMAGES} 张`);
  }
  if ((parsed.svgModel || parsed.svgReasoning) && parsed.outputFormat !== 'svg') {
    fail('--svg-model / --svg-reasoning 仅能用于 --output-format svg');
  }
  if (parsed.svgReasoning && !parsed.svgModel) {
    fail('使用 --svg-reasoning 时必须同时指定 --svg-model');
  }

  if (!parsed.out) {
    parsed.out = `./output.${parsed.outputFormat === 'jpeg' ? 'jpg' : parsed.outputFormat}`;
  }
  return parsed;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.dryRun) {
    // 不读取本地文件内容，避免在 dry-run 时输出巨大的 base64
    const preview = { ...opts, imageUrls: opts.imageUrls.map((u) => (u.startsWith('http') || u.startsWith('data:') ? u : `<local:${u}>`)) };
    console.log(JSON.stringify(buildRequestBody(preview), null, 2));
    return;
  }

  const apiKey = loadApiKey();
  opts.imageUrls = opts.imageUrls.map(resolveImageArg);

  const mode = opts.imageUrls.length > 0 ? '图生图' : '文生图';
  process.stderr.write(`正在提交${mode}任务: model=${MODEL}, version=${opts.version}, quality=${opts.quality}, size=${opts.outputFormat === 'gif' ? '(gif 忽略)' : opts.size}, resolution=${opts.resolution}, format=${opts.outputFormat}\n`);
  if (opts.complexity) process.stderr.write(`画面复杂度: ${opts.complexity}\n`);
  if (opts.imageUrls.length > 0) process.stderr.write(`参考图片: ${opts.imageUrls.length} 张\n`);

  const taskId = await submitTask(apiKey, buildRequestBody(opts));
  process.stderr.write(`任务已提交: ${taskId}\n`);

  const fileUrl = await pollTask(apiKey, taskId);

  const outPath = path.resolve(opts.out);
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  process.stderr.write(`正在下载到 ${outPath} ...\n`);
  await downloadFile(fileUrl, outPath);
  process.stderr.write('下载完成\n');
  console.log(outPath);
}

main().catch((err) => {
  console.error(`错误：${err.message}`);
  process.exit(1);
});
