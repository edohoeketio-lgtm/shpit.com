const net = require('net');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const RELAY_HOST = process.env.RELAY_HOST || 'shpit-com.onrender.com';
const RELAY_URL = process.env.RELAY_SECURE === 'false' || RELAY_HOST.includes('127.0.0.1') ? `ws://${RELAY_HOST}` : `wss://${RELAY_HOST}`;

const { findActivePort, checkPort } = require('./utils');

function generateId() {
    return Math.random().toString(36).substring(2, 8);
}

let targetHost = '127.0.0.1';

async function startTunnel(port) {
    const tunnelId = generateId();
    console.log(`\n🚀 shp-serve CLI`);

    let result = await findActivePort(port);

    // Handle interactive choice if multiple candidates found
    if (result.candidates && result.candidates.length > 1) {
        console.log(`\n  👀 Multiple local servers detected:`);
        result.candidates.forEach((c, i) => {
            console.log(`     ${i + 1}) ${c.process} (port ${c.port})`);
        });

        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const choice = await new Promise(resolve => {
            readline.question(`\n  👉 Select server (1-${result.candidates.length}) [default 1]: `, (input) => {
                readline.close();
                const idx = parseInt(input, 10) - 1;
                if (!isNaN(idx) && result.candidates[idx]) {
                    resolve(result.candidates[idx]);
                } else {
                    resolve(result.candidates[0]);
                }
            });
        });

        result = { port: choice.port, host: '127.0.0.1', alive: true };
    }

    targetHost = result.host;
    const finalPort = result.port;

    console.log(`\n  ▸ Exposing: http://${targetHost}:${finalPort}`);
    console.log(`  ▸ Checking local server...`);

    if (!result.alive) {
        console.log(`  ⚠️  Warning: No server detected on port ${finalPort}.`);
        console.log(`     Waiting for your server to start...`);

        // Wait loop
        let isAlive = false;
        while (!isAlive) {
            await new Promise(r => setTimeout(r, 1500));
            const check = await checkPort(finalPort);
            if (check.alive) {
                isAlive = true;
                targetHost = check.host;
                console.log(`  ✓ Local server detected on ${targetHost}.`);
            }
        }
    } else {
        console.log(`  ✓ Local server detected on ${targetHost}.`);
    }

    console.log(`  ▸ Connecting to relay...`);
    const ws = new WebSocket(`${RELAY_URL}/register?id=${tunnelId}`);

    ws.on('open', () => {
        console.log(`  ✓ Tunnel active!`);

        const isLocal = RELAY_HOST.includes('127.0.0.1') || RELAY_HOST.includes('localhost');
        const forceInsecure = process.env.RELAY_SECURE === 'false';
        const protocol = forceInsecure || isLocal ? 'http' : 'https';

        // Host-based URL for production, or path-based fallback
        const rawUrl = `${protocol}://${RELAY_HOST}/proxy/${tunnelId}/`;

        if (isLocal) {
            console.log(`\n  🌍 Public URL: ${rawUrl}\n`);
        } else {
            console.log(`  ▸ Generating short link...`);
            https.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(rawUrl)}`, (res) => {
                let shortUrl = '';
                res.on('data', chunk => shortUrl += chunk);
                res.on('end', () => {
                    console.log(`\n  🌍 Public URL: ${shortUrl.trim()}`);
                    console.log(`  (Traffic secured via shortener)`);
                    console.log(`\n  [Logs]`);
                    if (!result.alive) {
                        console.log(`  [!] Note: Incoming requests will fail until you start your server on port ${finalPort}.`);
                    }
                });
            }).on('error', () => {
                console.log(`\n  🌍 Public URL: ${rawUrl}\n`);
            });
        }
    });

    const localBrowserSockets = new Map();

    ws.on('message', async (data) => {
        try {
            const payload = JSON.parse(data.toString());

            if (payload.type === 'request') {
                const { id, method, url, headers } = payload;

                // Exclude headers that might mess up local requests
                const cleanHeaders = { ...headers };
                delete cleanHeaders['host'];
                delete cleanHeaders['cf-connecting-ip'];
                delete cleanHeaders['x-forwarded-for'];
                delete cleanHeaders['x-forwarded-proto'];

                const localReqOpts = {
                    hostname: targetHost,
                    port: finalPort,
                    path: url,
                    method: method,
                    headers: cleanHeaders,
                    timeout: 10000,
                };

                const localReq = http.request(localReqOpts, (localRes) => {
                    const chunks = [];
                    localRes.on('data', chunk => chunks.push(chunk));
                    localRes.on('end', () => {
                        const bodyBuffer = Buffer.concat(chunks);
                        const base64Body = bodyBuffer.toString('base64');

                        const responsePayload = {
                            type: 'response',
                            id: id,
                            status: localRes.statusCode,
                            headers: localRes.headers,
                            body: base64Body
                        };

                        ws.send(JSON.stringify(responsePayload));
                        console.log(`  [${new Date().toLocaleTimeString()}] ${method} ${url} - ${localRes.statusCode}`);
                    });
                });

                localReq.on('timeout', () => {
                    localReq.destroy(new Error('Local server timeout'));
                });

                localReq.on('error', (err) => {
                    let errorMessage = err.message;
                    if (err.code === 'ECONNREFUSED') {
                        errorMessage = `Connection Refused: No server found at ${targetHost}:${finalPort}. Is your dev server running?`;
                    }
                    console.error(`  [!] ${errorMessage}`);

                    ws.send(JSON.stringify({
                        type: 'response',
                        id: id,
                        status: 502,
                        headers: { 'content-type': 'text/plain' },
                        body: Buffer.from(`Bad Gateway: Could not reach ${targetHost}:${finalPort}. Ensure your local server is running.`).toString('base64')
                    }));
                });

                // If the incoming request had a body, we would write it here.
                // For simplicity in this v1, we only handle GET/HEAD perfectly.
                // To handle POST, we'd need to receive the body from the worker.
                localReq.end();
            } else if (payload.type === 'ws-connect') {
                const { socketId, url, headers } = payload;
                console.log(`[CLI] Received ws-connect for ${url}`);
                const cleanWsHeaders = { ...headers };
                delete cleanWsHeaders.host;
                delete cleanWsHeaders.connection;
                delete cleanWsHeaders.upgrade;
                delete cleanWsHeaders['sec-websocket-key'];
                delete cleanWsHeaders['sec-websocket-version'];
                delete cleanWsHeaders['sec-websocket-extensions'];
                delete cleanWsHeaders['sec-websocket-protocol'];

                const localWsUrl = `ws://${targetHost}:${finalPort}${url}`;

                const localWs = new WebSocket(localWsUrl, {
                    headers: {
                        ...cleanWsHeaders,
                        host: `${targetHost}:${finalPort}`
                    }
                });

                localBrowserSockets.set(socketId, localWs);

                localWs.on('open', () => {
                    if (localWs._msgQueue) {
                        for (const buf of localWs._msgQueue) localWs.send(buf);
                        localWs._msgQueue = null;
                    }
                });

                localWs.on('message', (data, isBinary) => {
                    console.log(`[CLI] Local WS received data: ${data.toString()}`);
                    ws.send(JSON.stringify({
                        type: 'ws-message',
                        socketId,
                        data: isBinary ? data.toString('base64') : data.toString(),
                        isBinary
                    }));
                });

                localWs.on('close', () => {
                    console.log(`[CLI] Local WS closed for ${socketId}`);
                    localBrowserSockets.delete(socketId);
                    ws.send(JSON.stringify({ type: 'ws-close', socketId }));
                });

                localWs.on('error', (err) => {
                    console.error(`  [!] Local WebSocket error (${socketId}):`, err.message);
                    localWs.close();
                });
            } else if (payload.type === 'ws-message') {
                const { socketId, data, isBinary } = payload;
                const localWs = localBrowserSockets.get(socketId);
                if (localWs) {
                    try {
                        const buf = isBinary ? Buffer.from(data, 'base64') : data;
                        if (localWs.readyState === WebSocket.OPEN) {
                            localWs.send(buf);
                        } else if (localWs.readyState === WebSocket.CONNECTING) {
                            if (!localWs._msgQueue) localWs._msgQueue = [];
                            localWs._msgQueue.push(buf);
                        }
                    } catch (err) {
                        console.error('Failed to decode local ws-message:', err);
                    }
                }
            } else if (payload.type === 'ws-close') {
                const { socketId } = payload;
                const localWs = localBrowserSockets.get(socketId);
                if (localWs) {
                    localWs.close();
                    localBrowserSockets.delete(socketId);
                }
            }
        } catch (err) {
            console.error('Failed to process message from relay:', err);
        }
    });

    ws.on('close', () => {
        console.log(`\n  ⏹ Relay connection closed.`);
        process.exit(0);
    });

    ws.on('error', (err) => {
        console.error(`\n  [!] WebSocket error:`, err.message);
    });
}

module.exports = startTunnel;
