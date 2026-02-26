<div align="center">
  <img src="https://shp.it/icon.svg" alt="shp.it logo" width="120" />
  <h1>shp.it</h1>
  <p><b>The fastest way to share your local dev server with the world.</b></p>
  
  [![npm version](https://badge.fury.io/js/shp-serve.svg)](https://badge.fury.io/js/shp-serve)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
</div>

---

**shp.it** is a zero-configuration CLI and highly-concurrent Relay backend that creates secure, multiplexed HTTP tunnels to your local development environment.

Run one command to expose your `localhost` to the internet instantly, complete with full support for Hot Module Reloading (HMR) and chunked data streaming.

## 🚀 Quick Start

No registration. No configuration files. No port specified. Just run it in any modern Javascript framework project:

```bash
npx shp-serve
```

*The CLI automatically parses your `package.json` AST, detects your framework (Next.js, Vite, SvelteKit, etc.), waits for your dev server to boot, connects a secure WebSocket tunnel to the edge relay, and generates a short `is.gd` public URL.*

---

## 🏗 Architecture & Engineering Highlights

This codebase solves several complex networking challenges to provide a completely frictionless "Zero-Config" developer experience.

### 1. Frictionless Port Auto-Scanning

Developers hate configuring ports. The `shp-serve` CLI implements a cascading port-discovery algorithm:

1. **Positional Arguments**: Explicit overrides (`npx shp-serve 5173`).
2. **Active Port Scanning**: Ping tests against standard development ports (`3000`, `5173`, `8080`).
3. **AST Framework Heuristics**: If the server isn't burning yet, it parses the `package.json` manifest to guess the expected port based on dependencies (e.g. `dependencies: { next: ... }` -> `3000`).
4. **Resilient Wait Loops**: If the dev server isn't up, the CLI doesn't crash. It drops into a highly efficient UDP/TCP wait loop, polling until the server organically boots.

### 2. High-Fidelity HTTP/WS Multiplexing via Edge Relay

The backend Relay is a multi-tenant Node.js process managing hundreds of concurrent secure WebSockets.

- **Problem**: Modern dev environments rely entirely on WebSockets for Hot Module Reloading (HMR). Standard reverse proxies slice these connections.
- **Solution**: We built a custom multiplexer over a single TCP stream. The Relay dynamically intercepts Browser `Sec-WebSocket-Key` Upgrade requests, sanitizes the headers to bypass local Node core panic, packs binary arrays into Base64 frames, and tunnels them down the primary CLI socket—reconstructing them perfectly at the edge for completely seamless HMR over the internet.

### 3. Stateful Tunnels & "Sticky" Proxy Routing

Many frameworks generate relative pathing for massive frontend bundles.

- **Problem**: A path-based proxy URL (`/proxy/<tunnel_id>/`) often breaks when the browser attempts to fetch `/styles.css` from the root.
- **Solution**: The Relay injects transient HTTP `Set-Cookie: shpit_id=<id>` tokens upon initial payload delivery. Subsequent decoupled root requests retrieve this cookie, routing them accurately back to the originating ephemeral tunnel without messy URL rewrites.

### 4. 100% Reliability Pipeline (Vitest & Playwright)

This project is fortified extensively against race conditions and memory leaks.

- **Ping/Pong Heartbeats**: Active polling prevents firewalls from severing idle tunnels.
- **Deterministic Teardown**: When a CLI disconnects, hanging promises and pending Browser WebSockets are globally purged to achieve `O(1)` memory stabilization.
- **E2E Integration Suite**: The codebase enforces standard CI/CD with `Playwright`. Every commit dynamically spins a mock dev server, boots the Relay, runs the CLI natively via child processes, and drives a Headless Chromium browser to simulate and assert full HTTP and multiplexed HMR traffic flows.

## 💻 Local Development

If you'd like to contribute or run the stack locally:

```bash
git clone https://github.com/edohoeketio-lgtm/shpit.com.git
cd shpit.com

# 1. Start the Relay Server
cd relay
npm install
npm run start # Listens on 8081

# 2. Run the CLI locally
cd ../cli
npm install

# (In another tab, start a local server like python3 -m http.server 8000)
node bin/shpthis.js 8000
```

### Running Tests

```bash
cd cli
npm run test # Executes Vitest Unit and Playwright E2E 
```

## 📝 License

MIT License. See [LICENSE](LICENSE) for details.
