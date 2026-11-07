# GPT-Image-2.6-Ext Skill

This is a skill for AI coding agents (Claude Code, Codex, etc.) that enables GPT-Image-2.6-Ext image generation via the Nange AI API.

Uses the unified `gpt-image-2.6-ext` model with a `version` parameter to choose between:
- **flare** (default) — Fast generation, ideal for daily creative work and batch generation
- **sunburst** — Composition and editing precision, ideal for finished assets, in-image text and fine-tuned edits

New compared with GPT-Image-2.5-Ext: **GIF animation output** and the `complexity` parameter (SVG vector output exists in the API but is not supported upstream yet).

Supports **1k / 2k / 4k** resolutions. Billed at fixed per-resolution prices, same pricing model as GPT-Image-2 / 2.5-Ext: the price depends only on the resolution tier. Quality, output format, complexity, aspect ratio, number of reference images and version do **not** change the price.

## Limitations (read this first)

| Item | Limit |
|---|---|
| Resolution | `1k` (default) / `2k` / `4k`. At 2k / 4k, **reference images cannot be GIF / BMP** (the script rejects them locally); 2k / 4k take longer and cost more |
| `--size` | `auto` and 10 ratios only: `1:1` `3:2` `2:3` `4:3` `3:4` `5:4` `4:5` `16:9` `9:16` `21:9`. **No pixel sizes**, and no `2:1` `1:2` `3:1` `1:3` `9:21` |
| Images per request | Exactly 1 |
| Transparent background | **Not supported** (`background` has no effect). Use [images25-gen](https://github.com/xiaonan0527/images25-gen) if you need transparent PNG / WebP |
| SVG | **Not supported upstream yet** — the script and the gateway both reject it. Use images25-gen for transparent logos / icons |
| GIF | Text-to-image only, no reference images. GIF cannot take a `size` |

If you need ultra-wide ratios such as 3:1, pixel dimensions, or transparent backgrounds, use `gpt-image-2.5-ext` ([images25-gen](https://github.com/xiaonan0527/images25-gen)).

## Installation

Send this to your AI agent:

```
帮我安装 https://github.com/xiaonan0527/images26-gen/blob/main/README.md 这个 skill，并生成一张图片
```

Or manually clone:

```bash
git clone https://github.com/xiaonan0527/images26-gen.git gpt-image-26
```

## Setup Instructions (for the agent)

After installation, when the user triggers this skill for the first time, you must guide them through setup:

### Step 1: Check Node.js

Run `node -v`. If it fails, tell the user to install Node.js from https://nodejs.org/ before proceeding.

### Step 2: Check API Key

The script supports two ways to provide the API Key:

**Option A: Environment variable (recommended)**
```bash
export NANGE_API_KEY="your-api-key-here"
```

**Option B: Config file** `~/.nange-ai/config.json`

**macOS / Linux:**
```bash
mkdir -p ~/.nange-ai && echo '{"api_key":"PASTE_YOUR_KEY_HERE"}' > ~/.nange-ai/config.json
```

**Windows PowerShell:**
```powershell
mkdir -Force "$env:USERPROFILE\.nange-ai" | Out-Null; '{"api_key":"PASTE_YOUR_KEY_HERE"}' | Set-Content "$env:USERPROFILE\.nange-ai\config.json"
```

API Key creation: https://api.nange-ai.com/keys (choose **GPT-Image** group)

> GPT-Image-2.6-Ext shares the same API Key group as GPT-Image-2 and GPT-Image-2.5-Ext. No need to create a separate key.

### Step 3: Generate images

Run the generate script:

```bash
node "<skill-dir>/scripts/generate.js" --prompt "the user's prompt" --size "1:1"
```

The script submits an async task, polls until completion, downloads the file to the local path specified by `--out`, and prints the absolute file path to stdout. Progress is printed to stderr. High quality tiers can take a few minutes; if it times out, do not resubmit — the script prints the task ID.

## Trigger phrases

Activate this skill when the user says anything related to AI image generation, such as:

- "生图" / "画图" / "生成图片" / "帮我画"
- "gpt-image" / "Image2.6 生图" / "用 2.6 画" / "用 gpt 画"
- "用 flare 画" / "用 sunburst 编辑"
- "生成 SVG" / "矢量图" / "做个 GIF 动图"
- "generate an image" / "create a picture"
- "把这张图改成" / "参考这张图"

## Parameters

| Param | Default | Description |
|---|---|---|
| `--prompt` | (required) | Image generation prompt |
| `--version` | `flare` | Version: `flare` (fast) or `sunburst` (precision) |
| `--quality` | `medium` | Quality: `low`, `medium`, `high`, `xhigh`, `max`, `auto`. Does not affect price; higher tiers take longer |
| `--complexity` | (none) | `low` (simple icons / flat illustration), `medium`, `high` (rich detail). Does not affect price |
| `--size` | `1:1` | `auto`, `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `5:4`, `4:5`, `16:9`, `9:16`, `21:9`. Ignored for GIF |
| `--resolution` | `1k` | `1k`, `2k` or `4k`. Price rises with the tier; at 2k / 4k reference images cannot be GIF / BMP |
| `--output-format` | `png` | `png`, `jpeg`, `webp`, `gif` (`svg` is rejected: not supported upstream yet) |
| `--svg-model` | (none) | SVG output only: text model used to author the SVG (e.g. `gpt-4.1-mini`). Not billed separately |
| `--svg-reasoning` | (none) | SVG output only, requires `--svg-model`: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--image-url` | (none) | Reference image for image-to-image. Accepts HTTP URL, base64 data URI, or local file path (auto-converted to base64). Can be passed multiple times (max 16, ≤ 20MB each). PNG / JPEG / WebP / GIF / BMP |
| `--out` | `./output.<format>` | Local file path to save the result |
| `--dry-run` | — | Print the request body and exit without calling the API |

### Version comparison

| Version | Strengths | Best for |
|---|---|---|
| `flare` (default) | Fast generation | Social media, quick prototypes, batch generation |
| `sunburst` | Composition & editing precision | Finished assets, in-image text, ad creatives, fine-tuned edits |

Both versions currently have the same price. Choose based on speed vs. quality trade-off.

### Quality tiers

| Quality | Description |
|---|---|
| `low` | Fastest |
| `medium` | Balanced (default, recommended for daily use) |
| `high` | High quality |
| `xhigh` | Extra high quality |
| `max` | Maximum quality |
| `auto` | Upstream decides at runtime |

### Aspect ratio reference

| size | `1k` | `2k` | `4k` |
|------|------|------|------|
| 1:1 | 1024×1024 | 2048×2048 | 2880×2880 |
| 3:2 | 1536×1024 | 2048×1360 | 3520×2336 |
| 2:3 | 1024×1536 | 1360×2048 | 2336×3520 |
| 4:3 | 1024×768 | 2048×1536 | 3312×2480 |
| 3:4 | 768×1024 | 1536×2048 | 2480×3312 |
| 5:4 | 1280×1024 | 2560×2048 | 3216×2576 |
| 4:5 | 1024×1280 | 2048×2560 | 2576×3216 |
| 16:9 | 1536×864 | 2048×1152 | 3840×2160 |
| 9:16 | 864×1536 | 1152×2048 | 2160×3840 |
| 21:9 | 2016×864 | 2688×1152 | 3840×1648 |

`auto` gives a 1:1 image for text-to-image (1024² / 2048² / 2880²); for image-to-image it picks the closest supported ratio to the first readable reference image.

## How to choose parameters

- User wants fast/batch generation → default flare version
- User wants precise composition / in-image text / product images → `--version sunburst`
- User wants widescreen → `--size 16:9` (or `21:9` for ultra-wide)
- User wants portrait/phone wallpaper → `--size 9:16`
- User wants poster → `--size 2:3`
- User wants icon / logo → `--complexity low` (SVG is not supported upstream yet; use images25-gen for transparent backgrounds)
- User wants high-res / print / wallpaper → `--resolution 2k` or `--resolution 4k` (higher price, slower)
- User wants animation / sticker pack → `--output-format gif` (no `--size`)
- User says "超高质量" → `--quality xhigh` or `--quality max`
- User says "透明背景" / "像素尺寸" / "矢量图" → not supported here, suggest images25-gen
- No preference → use defaults (`flare`, `medium`, `1:1`, `1k`)

## SVG vector output

> **Currently unavailable**: the upstream does not support SVG output yet, so the script rejects `--output-format svg`. The usage below is kept for when upstream enables it (flip `SVG_SUPPORTED` in `scripts/generate.js`).

```bash
node "<skill-dir>/scripts/generate.js" \
  --prompt "A minimalist rocket icon in a single line color, flat vector style, no text" \
  --output-format svg \
  --complexity low \
  --svg-model gpt-4.1-mini \
  --out "./rocket.svg"
```

- Text-to-image only, no `--image-url`
- The result is a static SVG with a transparent background, no scripts, no external links, no embedded bitmaps
- `--svg-model` is optional; the text model that writes the SVG is not billed separately

## GIF animation output

```bash
node "<skill-dir>/scripts/generate.js" \
  --prompt "A cartoon puppy raises one paw to wave, then returns to the starting pose. White background, fixed camera, seamless loop." \
  --output-format gif \
  --quality medium \
  --out "./puppy.gif"
```

- Text-to-image only, no `--image-url`
- Do not pass `--size` (the script omits it for GIF)
- Describe the motion **and** how it loops in the prompt

## Image-to-image (图生图)

When the user provides a reference image (URL, local file, or pasted image) and asks to edit/transform it, use `--image-url`:

```bash
node "<skill-dir>/scripts/generate.js" \
  --prompt "保留商品主体和包装文字，将背景替换为柔和的米白色摄影棚" \
  --version sunburst \
  --quality xhigh \
  --image-url "./product.png" \
  --out "./product-studio.png"
```

- Pass `--image-url` multiple times for multiple reference images (max 16); refer to them as "the first image", "the second image" in the prompt
- Accepts HTTP/HTTPS URLs, base64 data URIs (`data:image/png;base64,...`), or local file paths (auto-converted to base64)
- Triggers: "把这张图改成", "参考这张图", "edit this image", "transform this photo", "change the style of"

## Differences from GPT-Image-2.5-Ext

| Feature | GPT-Image-2.5-Ext | GPT-Image-2.6-Ext |
|---|---|---|
| Model | `gpt-image-2.5-ext` | `gpt-image-2.6-ext` |
| Version selection | `--version flare` / `--version sunburst` | Same |
| Resolution | `1k` / `2k` / `4k` | Same (2k / 4k: no GIF / BMP reference images) |
| Size input | Ratios + pixel dimensions | `auto` + 10 ratios only |
| Output format | `png`, `jpeg`, `webp` | Adds `gif` (`svg` not supported upstream yet) |
| Complexity | N/A | `--complexity` |
| Transparent background | `--background transparent` | Not supported |
| Reference image formats | PNG / JPEG / WebP / GIF | Adds BMP |
| Billing | Fixed per-resolution | Fixed per-resolution (same) |
| API endpoint | `/gpt-image/v1` | `/gpt-image/v1` (same) |
| API Key group | GPT-Image | GPT-Image (same) |
