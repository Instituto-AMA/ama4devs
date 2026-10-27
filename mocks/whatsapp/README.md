# WhatsApp Mock Server: a local WhatsApp Cloud API simulator

A mock of the **WhatsApp Cloud API** (Meta Graph API v23.0, WhatsApp Business
Platform) for local development, automated tests and CI: every operation of
Meta's own OpenAPI specification, with Meta's paths, validation, answers and
error codes. Messages, message templates (with their review), media upload and
download, voice calls (Calling API, real WebRTC), phone numbers and WhatsApp
Business Accounts (WABAs), webhooks signed like Meta's, and a WhatsApp Web like
panel to chat as the user.

```bash
docker run --rm -p 3010:3010 ghcr.io/instituto-ama/whatsapp-mock:latest
# panel: http://localhost:3010 · API: http://localhost:3010/v23.0/...
```

Em português: simulador local da API oficial do WhatsApp (Cloud API da Meta),
com mensagens, templates, mídia, ligações, números e webhooks, para testar a
sua integração sem número real e sem custo.

## Features

### 🚀 Mock Server Features
- **Full API Compatibility**: Mimics WhatsApp Cloud API endpoints for seamless integration testing
- **Message Sending & Receiving**: Complete message flow simulation with realistic responses
- **Webhook Simulation**: Real-time webhook events for message delivery status, read receipts, and error handling
- **🔐 HMAC-SHA256 Signatures**: Webhook requests include `x-hub-signature-256` header matching WhatsApp's authentication spec
- **Template Management API**: Full CRUD operations for WhatsApp message templates
- **Hot-Reload Templates**: Automatic template reloading when JSON files change - no server restart required
- **Schema Validation**: Ensures templates comply with WhatsApp Business API requirements
- **Zero Cost Testing**: Test without real phone numbers, API charges, or rate limits
- **Persistent Storage**: In-memory conversation and template storage for development sessions

### 🖥️ Interactive CLI Features
- **Real-time Testing Interface**: React-based CLI for interactive message and template testing
- **Template Browser**: Easy template selection and preview with category filtering
- **Variable Input System**: Guided prompts for template parameter collection with validation
- **Conversation History**: View complete message and template history with timestamps
- **Development Workflow**: Seamless integration with existing development processes
- **Hot-Reload Integration**: Instantly test template changes without restarting CLI

### 🐳 Docker & Infrastructure
- **Multi-stage Docker Build**: Optimized production and debug images
- **Self-contained Binary**: Compiled Bun executable with no runtime dependencies
- **Health Checks**: Built-in `/health` endpoint for container orchestration
- **Makefile Automation**: 40+ targets for building, testing, and deploying
- **Debug Support**: Bun Inspector on port 9229 for interactive debugging

## Quick Start

### Installation

```bash
# From the root of ama4devs
cd mocks/whatsapp

# Install dependencies
bun install
```

### Basic Usage

```bash
# Terminal 1: Start the mock server
bun whap server

# Terminal 2: Start the CLI interface
bun whap tui
```

The mock server runs on port **3010** and provides WhatsApp Cloud API compatible endpoints.

## Configuration

### Webhook URLs

Configure webhook URLs to receive WhatsApp events using any of these methods (in priority order):

#### 1. Configuration File (Recommended)

Create a `whap.json` file in your project root:

```json
{
  "$schema": "./schema/whap-config.schema.json",
  "webhookUrls": [
    "1234567890:http://localhost:4000/webhook",
    "9876543210:http://localhost:5000/webhook",
    "http://localhost:3000/fallback-webhook"
  ]
}
```

**Format Options:**
- `"phoneNumber:url"` - Phone-specific webhook mapping
- `"url"` - Fallback webhook URL (used when no phone-specific mapping exists)

#### 2. Environment Variable

```bash
# Fallback URL
export WEBHOOK_URL=http://localhost:4000/webhook
bun whap server

# Or phone-specific mapping
export WEBHOOK_URL=1234567890:http://localhost:4000/webhook
bun whap server
```

#### 3. CLI Arguments

```bash
bun whap server --port 8080
```

### Configuration Priority

Configuration sources are applied in this order (highest to lowest priority):
1. **CLI arguments** (`--webhook-url`)
2. **Environment variables** (`WEBHOOK_URL`)
3. **Configuration file** (`whap.json`)

Webhook URLs without phone numbers are used as fallback URLs when no phone-specific mapping exists. If multiple fallback URLs are provided, the first entry in `whap.json` is used when `WEBHOOK_URL` is not set.

### Webhook Security (HMAC Signatures)

Configure webhook signature authentication to match WhatsApp's security requirements. Webhooks will include the `X-Hub-Signature-256` header for signature verification.

#### 1. Configuration File

Add to `whap.json`:

```json
{
  "webhookSecret": "your-app-secret"
}
```

#### 2. Environment Variable

```bash
export WEBHOOK_SECRET="your-app-secret"
bun whap server
```

#### 3. CLI Arguments

```bash
bun whap server --port 8080
```

**Signature Verification:**

All outgoing webhook requests include the `x-hub-signature-256` header when a secret is configured. Verify the signature using:

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(signature, secret, body) {
  const expectedSignature = 'sha256=' +
    crypto.createHmac('sha256', secret).update(body).digest('hex');
  return signature === expectedSignature;
}
```

**Example:**
```text
Header: x-hub-signature-256: sha256=b6978b21c4467654c466607663db9b43fae44b71083568df403e0a077089208e
Secret: your-app-secret
Body: {"object":"whatsapp_business_account","entry":[...]}
```

### The Response Timer

The mock can wait before it delivers an event to the webhook, so an
application that takes time to process is visible in the panel instead of
being a race. The default is **5 seconds** and it is changed in the *Eventos*
tab of the panel or through the API:

```bash
curl -X PUT http://localhost:3010/settings/webhook-delay \
  -H 'Content-Type: application/json' \
  -d '{"delayMs":1500}'
```

The delay can also come from the environment, when the mock starts:

```bash
MOCK_WEBHOOK_RESPONSE_DELAY_MS=1500 bun whap server
```

## The Web Panel

The panel is served at `GET /`. It shows the conversations of the mock with
every message type (media, locations, templates with header, footer, buttons
and carousel), the controls to test an integration (reply as the user or the
clinic with text or a file, the user's receipts, the delivery mode, the webhook
destination), the template builder, and the **API** tab: every operation of
Meta's Cloud API specification for the served version, with a call ready to
copy and a table of contents that follows the reading.

The panel speaks Portuguese and English; the switch is in the header and the
choice is kept in the browser.

Every call that replicates Meta is the Meta resource itself, validated against
Meta's OpenAPI file (`spec/v23.0`). What only a test needs travels in optional
`X-Mock-*` headers, so the body stays what the Cloud API expects:

```bash
curl -X POST http://localhost:3010/v23.0/100000000000001/message_templates \
  -H 'Authorization: Bearer $TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'X-Mock-Template-Review: REJECTED' \
  -H 'X-Mock-Template-Review-Reason: TAG_CONTENT_MISMATCH' \
  -H 'X-Mock-Template-Review-Delay: 5000' \
  -d '{"name":"cobranca_vencida","language":"pt_BR","category":"UTILITY",
       "components":[{"type":"BODY","text":"Olá, {{1}}!","example":{"body_text":[["Mariana"]]}}]}'
```

What the mock knows (conversations, webhook calls, settings, webhooks, the
template library, uploaded media) is kept in `WHAP_DATA_DIR` (`./data`;
`/app/data` in the image, a volume), so a restart forgets nothing.

The full reference: [docs/panel.md](docs/panel.md).

## Docker Deployment

Whap includes production-ready Docker support with multi-stage builds for minimal image sizes.

### Quick Start

```bash
# Build production image
make build

# Run the server
make server

# Run the TUI interface (interactive mode)
make tui

# View all available commands
make help
```

### Docker Images

- **Production image** (`whap:latest`): Minimal runtime image (~150MB)
  - Self-contained Bun binary
  - No source code or node_modules
  - Health checks enabled

- **Debug image** (`whap:debug`): Full development image (~800MB)
  - Bun Inspector support (port 9229)
  - Full source code
  - Development dependencies

### Makefile Targets

**Build:**
- `make build` - Build production image
- `make build_debug` - Build debug image with source and Inspector

**Run:**
- `make server` - Start mock server (port 3010)
- `make tui` - Start interactive CLI (with TTY)
- `make run CMD="..."` - Run arbitrary whap command

**Development:**
- `make test` - Run test suite
- `make typecheck` - TypeScript type checking
- `make lint` - Run Biome linter
- `make format` - Run Biome formatter

**Management:**
- `make clean` - Remove containers and images
- `make rm_containers` - Stop and remove containers
- `make rmi` - Remove images

**Inspection:**
- `make images` - List whap images
- `make ps` - List running containers

### Live Source Mounting

For development, mount your source directory to reflect changes without rebuilding:

```bash
# Run tests against live source
SRC_DIR=./src make test

# Type-check live source
SRC_DIR=./src make typecheck

# Lint live source
SRC_DIR=./src make lint

# Format and write back to host
SRC_DIR=./src make format
```

### Custom Configuration

```bash
# Change image tag
IMAGE_TAG=1.0.0 make build

# Change server port
SERVER_PORT=8080 make server

# Run with webhook secret
docker run -p 3010:3010 \
  -e WEBHOOK_SECRET="your-secret" \
  whap:latest server
```

## Template System

### Quick Template Setup

1. **Create template files** in the `templates/` directory:
   ```json
   // templates/welcome.json
   {
     "name": "welcome_message",
     "category": "UTILITY",
     "language": "en_US",
     "components": [
       {
         "type": "BODY",
         "text": "Welcome {{1}}! Your account has been created successfully.",
         "example": {
           "body_text": [["John Doe"]]
         }
       }
     ]
   }
   ```

2. **Templates auto-load** - no restart required!
3. **Test via CLI** - select templates and enter variables interactively
4. **Send via API** - use standard WhatsApp Business API format

### Template Development Workflow

```bash
# 1. Create/modify template files in templates/
# 2. A changed file is imported into the library automatically
# 3. Test immediately in CLI interface
# 4. Send via API for integration testing
```

### API Example

```bash
curl -X POST http://localhost:3010/v23.0/123456789/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "1234567890",
    "type": "template",
    "template": {
      "name": "welcome_message",
      "language": { "code": "en_US" },
      "components": [
        {
          "type": "body",
          "parameters": [
            { "type": "text", "text": "John Doe" }
          ]
        }
      ]
    }
  }'
```

📚 **[Complete Template Documentation →](docs/templates.md)**

## Development

### Available Scripts

```bash
# Development
bun whap server           # Start mock server (port 3010)
bun whap tui              # Start interactive CLI
bun run dev:server        # Start server in watch mode

# Testing
bun test                  # Run test suite
bun run test:watch        # Run tests in watch mode

# Building
bun run build             # Build for production
```

### Docker & Make Commands

```bash
# Build
make build                # Build production Docker image
make build_debug          # Build debug image with Inspector

# Run
make server               # Run mock server in container
make tui                  # Run CLI interface in container
make test                 # Run tests in container

# Development with live source
SRC_DIR=./src make test           # Run tests against live source
SRC_DIR=./src make typecheck      # Type-check live source
SRC_DIR=./src make format         # Format code and write back
```

### Project Structure

```
whap/
├── templates/                    # Template JSON files
├── src/
│   ├── server/                   # Mock server implementation
│   │   ├── routes/
│   │   │   ├── messages.ts       # Message sending (includes templates)
│   │   │   └── templates.ts      # Template management API
│   │   └── stores/
│   │       └── template-store.ts # Template storage & validation
│   └── components/               # CLI interface
│       └── SimplifiedChatInterface.tsx
├── docs/
│   └── templates.md              # Complete template documentation
└── package.json
```

## Key Features

- **Zero Configuration**: Works out-of-the-box with no setup required
- **Hot-Reload**: Templates update instantly during development
- **Full API Compatibility**: Drop-in replacement for WhatsApp Cloud API
- **Interactive Testing**: CLI-based template and message testing
- **Schema Validation**: Ensures templates meet WhatsApp requirements
- **Webhook Simulation**: Complete delivery status event simulation

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.
