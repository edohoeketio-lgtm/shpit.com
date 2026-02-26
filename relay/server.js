const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const tunnels = new Map();
const pendingRequests = new Map();
const tunnelBrowserSockets = new Map(); // tunnelId -> Set<socketId>
const tunnelPendingRequests = new Map(); // tunnelId -> Set<reqId>

// Accept WebSocket Connections from the CLI Tool
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const tunnelId = url.searchParams.get('id');

    if (!tunnelId) {
        ws.close(1008, 'Missing tunnel ID');
        return;
    }

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    console.log(`[+] CLI Connected: tunnel=${tunnelId}`);
    tunnels.set(tunnelId, ws);
    tunnelBrowserSockets.set(tunnelId, new Set());
    tunnelPendingRequests.set(tunnelId, new Set());

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.type === 'response' && data.id) {
                const resolveHttp = pendingRequests.get(data.id);
                if (resolveHttp) {
                    resolveHttp(data);
                    pendingRequests.delete(data.id);
                    const pendingSet = tunnelPendingRequests.get(tunnelId);
                    if (pendingSet) pendingSet.delete(data.id);
                }
            } else if (data.type === 'ws-message' && data.socketId) {
                const browserWs = browserSockets.get(data.socketId);
                if (browserWs && browserWs.readyState === WebSocket.OPEN) {
                    const buf = data.isBinary ? Buffer.from(data.data, 'base64') : data.data;
                    browserWs.send(buf);
                }
            } else if (data.type === 'ws-close' && data.socketId) {
                const browserWs = browserSockets.get(data.socketId);
                if (browserWs) {
                    browserWs.close();
                    browserSockets.delete(data.socketId);
                    const socketSet = tunnelBrowserSockets.get(tunnelId);
                    if (socketSet) socketSet.delete(data.socketId);
                }
            }
        } catch (err) {
            console.error('Error parsing CLI message:', err);
        }
    });

    ws.on('close', () => {
        console.log(`[-] CLI Disconnected: tunnel=${tunnelId}`);
        tunnels.delete(tunnelId);

        // Instantly fail pending HTTP requests (avoid 15s hang)
        const pendingSet = tunnelPendingRequests.get(tunnelId);
        if (pendingSet) {
            for (const reqId of pendingSet) {
                const resolveHttp = pendingRequests.get(reqId);
                if (resolveHttp) {
                    resolveHttp({
                        status: 502,
                        headers: { 'content-type': 'text/plain' },
                        body: Buffer.from('shpit: The secure tunnel was disconnected before the request could finish.').toString('base64')
                    });
                    pendingRequests.delete(reqId);
                }
            }
        }
        tunnelPendingRequests.delete(tunnelId);

        // Cleanup dangling browser WebSockets
        const socketSet = tunnelBrowserSockets.get(tunnelId);
        if (socketSet) {
            for (const socketId of socketSet) {
                const browserWs = browserSockets.get(socketId);
                if (browserWs) browserWs.close(1001, 'Tunnel closed');
                browserSockets.delete(socketId);
            }
        }
        tunnelBrowserSockets.delete(tunnelId);
    });
});

// Broadcast ping to keep tunnels alive every 30 seconds
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

const browserSockets = new Map();

// Helper to identify tunnel from request
function getTunnelId(req) {
    let tunnelId = null;

    // 1. Host-based routing
    const host = req.headers.host || '';
    const subdomain = host.split('.')[0];
    if (tunnels.has(subdomain)) tunnelId = subdomain;

    // 2. Path-based routing
    if (!tunnelId && req.url.startsWith('/proxy/')) {
        const parts = req.url.split('/');
        tunnelId = parts[2];
    }

    // 3. Cookie or Referer fallback
    if (!tunnelId && req.headers.cookie) {
        const value = `; ${req.headers.cookie}`;
        const parts = value.split(`; shpit_id=`);
        if (parts.length === 2) tunnelId = parts.pop().split(';').shift();
    }

    if (!tunnelId && req.headers.referer) {
        const match = req.headers.referer.match(/\/proxy\/([^/]+)/);
        if (match) tunnelId = match[1];
    }

    return (tunnelId && tunnels.has(tunnelId)) ? tunnelId : null;
}

// Handle Browser WebSocket connections (e.g. Vite HMR)
server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/register') return; // Handled by wss

    const tunnelId = getTunnelId(req);
    if (!tunnelId) {
        socket.destroy();
        return;
    }

    const browserWss = new WebSocket.Server({ noServer: true });
    browserWss.handleUpgrade(req, socket, head, (ws) => {
        const socketId = crypto.randomUUID();
        const cliWs = tunnels.get(tunnelId);

        browserSockets.set(socketId, ws);

        // Notify CLI to open local WS
        cliWs.send(JSON.stringify({
            type: 'ws-connect',
            socketId,
            url: req.url,
            headers: req.headers
        }));

        ws.on('message', (data, isBinary) => {
            try {
                cliWs.send(JSON.stringify({
                    type: 'ws-message',
                    socketId,
                    data: isBinary ? data.toString('base64') : data.toString(),
                    isBinary
                }));
            } catch (err) {
                console.error('Failed to stringify or send ws-message:', err);
            }
        });

        ws.on('close', () => {
            browserSockets.delete(socketId);
            if (tunnels.has(tunnelId)) {
                tunnels.get(tunnelId).send(JSON.stringify({ type: 'ws-close', socketId }));
            }
        });
    });
});

// Avoid express body parsing, we want raw streams ideally, 
// but for v1 GET/HEAD proxying, we don't need body parsing.
app.use((req, res, next) => {
    const tunnelId = getTunnelId(req);

    if (req.path.startsWith('/proxy/')) {
        const parts = req.path.split('/');
        const id = parts[2];
        res.cookie('shpit_id', id, { path: '/', maxAge: 3600000 });
        req.url = '/' + parts.slice(3).join('/') + (req.search || '');
    }

    if (!tunnelId) {
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
        const pendingSet = tunnelPendingRequests.get(tunnelId);
        if (pendingSet) pendingSet.delete(reqId);

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
            try {
                const buffer = Buffer.from(cliResponse.body, 'base64');
                res.send(buffer);
            } catch (err) {
                console.error('Failed to decode body:', err);
                res.status(502).send('shpit: Bad Gateway (Malformed Response)');
            }
        } else {
            res.end();
        }
    });

    const pendingSet = tunnelPendingRequests.get(tunnelId);
    if (pendingSet) pendingSet.add(reqId);
});

const PORT = process.env.PORT || 8081;
server.listen(PORT, () => {
    console.log(`🚀 shp-serve Node Relay Server running on port ${PORT}`);
});
