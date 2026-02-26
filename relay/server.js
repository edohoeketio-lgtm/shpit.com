const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const tunnels = new Map();
const pendingRequests = new Map();

// Accept WebSocket Connections from the CLI Tool
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const tunnelId = url.searchParams.get('id');

    if (!tunnelId) {
        ws.close(1008, 'Missing tunnel ID');
        return;
    }

    console.log(`[+] CLI Connected: tunnel=${tunnelId}`);
    tunnels.set(tunnelId, ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.type === 'response' && data.id) {
                // Resolve the pending HTTP request
                const resolveHttp = pendingRequests.get(data.id);
                if (resolveHttp) {
                    resolveHttp(data);
                    pendingRequests.delete(data.id);
                }
            }
        } catch (err) {
            console.error('Error parsing CLI message:', err);
        }
    });

    ws.on('close', () => {
        console.log(`[-] CLI Disconnected: tunnel=${tunnelId}`);
        tunnels.delete(tunnelId);
    });
});

// Avoid express body parsing, we want raw streams ideally, 
// but for v1 GET/HEAD proxying, we don't need body parsing.
app.use((req, res, next) => {
    let tunnelId = null;

    // Host-based routing (e.g., a7x3k9.shpthis.com)
    const host = req.headers.host || '';
    const subdomain = host.split('.')[0];

    if (tunnels.has(subdomain)) {
        tunnelId = subdomain;
    } else if (req.path.startsWith('/proxy/')) {
        // Path-based fallback routing for local testing
        const parts = req.path.split('/');
        tunnelId = parts[2];
        req.url = '/' + parts.slice(3).join('/') + (req.search || '');
        if (req.url === '/') {
            // Keep the trailing slash if there wasn't one explicitly requested?
            // Let's just pass it correctly.
        }
    }

    if (!tunnelId || !tunnels.has(tunnelId)) {
        return res.status(404).send('shpit: tunnel not found or offline.\\n\\nMake sure your CLI is running.');
    }

    const ws = tunnels.get(tunnelId);
    const reqId = crypto.randomUUID();

    // Forward the request to the CLI
    const payload = {
        type: 'request',
        id: reqId,
        method: req.method,
        url: req.url,
        headers: req.headers
    };

    ws.send(JSON.stringify(payload));

    // Wait for the CLI to send back exactly one response
    const timeout = setTimeout(() => {
        pendingRequests.delete(reqId);
        if (!res.headersSent) {
            res.status(504).send('shpit: Gateway Timeout. CLI did not respond in time.');
        }
    }, 15000);

    pendingRequests.set(reqId, (cliResponse) => {
        clearTimeout(timeout);
        if (res.headersSent) return;

        // Set headers
        if (cliResponse.headers) {
            for (const [key, value] of Object.entries(cliResponse.headers)) {
                // Exclude chunking headers as express handles it
                if (key.toLowerCase() !== 'transfer-encoding') {
                    res.setHeader(key, value);
                }
            }
        }

        res.status(cliResponse.status || 200);

        // Send body
        if (cliResponse.body) {
            const buffer = Buffer.from(cliResponse.body, 'base64');
            res.send(buffer);
        } else {
            res.end();
        }
    });
});

const PORT = process.env.PORT || 8081;
server.listen(PORT, () => {
    console.log(`🚀 shp-serve Node Relay Server running on port ${PORT}`);
});
