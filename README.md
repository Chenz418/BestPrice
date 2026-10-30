# BestPrice

BestPrice is a browser extension plus a local server that finds the current
**best total delivered price** for a single product across European online shops.
You describe a product (a name, a style code, a note, or a photo) together with
your size and delivery country; BestPrice identifies the exact product, searches
shops across countries, opens each candidate page to confirm the product, size
availability and shipping, and ranks the offers by their guaranteed total price
(item + shipping).

The project is a monorepo with three workspaces:

| Folder       | Contents                                                      |
| ------------ | ------------------------------------------------------------- |
| `extension/` | Chrome side panel, orchestrator, and page verifier (frontend) |
| `server/`    | Identify / Search / Extract / Rank HTTP APIs (holds all keys) |
| `shared/`    | Shared TypeScript types and runtime validation (zod)          |

The server exists so that **API keys never ship inside the extension**: the
extension makes no third-party calls and opens shop pages with the user's own
browser, while the server holds every credential.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer (developed on 22)
- Google Chrome (or a Chromium-based browser that supports Manifest V3 side panels)
- An LLM API key (OpenAI-compatible; DeepSeek by default)
- Optionally, a [SerpApi](https://serpapi.com/) key for live search
  (without it, the server falls back to bundled fixtures)

## Deployment

### 1. Install dependencies

```bash
git clone https://github.com/Chenz418/BestPrice.git
cd BestPrice
npm install
```

### 2. Configure credentials

Copy the example environment file and fill in your keys. **Never commit `.env`.**

```bash
cp .env.example .env
# then edit .env and set DEEPSEEK_API_KEY (and SERP_API_KEY for live search)
```

Set a spending limit on every API account before use.

### 3. Start the server

```bash
npm run serve
```

The server listens on `http://localhost:3000` (override with the `PORT` env var).

### 4. Build and load the extension

```bash
npm run build:extension      # outputs extension/dist/
# use `npm run watch:extension` to rebuild on change
```

Then load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/dist` folder.

Click the BestPrice toolbar icon to open the side panel, enter a product plus
your size and delivery country, confirm the identified product card, and run the
search.

## License

Released as open source. See `LICENSE` if present, or add one before publishing.
