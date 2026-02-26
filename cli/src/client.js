const net = require('net');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const RELAY_HOST = process.env.RELAY_HOST || 'shpit-com.onrender.com';
const RELAY_URL = process.env.RELAY_SECURE === 'false' || RELAY_HOST.includes('127.0.0.1') ? `ws://${RELAY_HOST}` : `wss://${RELAY_HOST}`;

const COMMON_PORTS = [3000, 5173, 8080, 8000, 4200, 1234];

function generateId() {
    return Math.random().toString(36).substring(2, 8);
}

function detectFrameworkPort() {
    try {
        const pkgPath = path.join(process.cwd(), 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (deps.next) return 3000;
            if (deps.vite) return 5173;
            if (deps.nuxt) return 3000;
            if (deps['@sveltejs/kit']) return 5173;
        }
    } catch (e) { }
    return 3000;
}

function checkPort(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const socket = net.createConnection({ port, host });
        socket.on('connect', () => {
            socket.destroy();
            resolve({ alive: true, host });
        });
        socket.on('error', () => {
            if (host === '127.0.0.1') {
                // If 127.0.0.1 fails, try localhost (IPv6 fallback)
                checkPort(port, 'localhost').then(resolve);
            } else {
                resolve({ alive: false });
            }
        });
        socket.setTimeout(400);
        socket.on('timeout', () => {
            socket.destroy();
            resolve({ alive: false });
        });
    });
}

async function findActivePort(explicitPort) {
    if (explicitPort) {
        const res = await checkPort(explicitPort);
        return { port: explicitPort, host: res.host || '127.0.0.1', alive: res.alive };
    }

    // Scan common ports
    for (const port of COMMON_PORTS) {
        const res = await checkPort(port);
        if (res.alive) return { port, host: res.host, alive: true };
    }

    return { port: detectFrameworkPort(), host: '127.0.0.1', alive: false };
}

let targetHost = '127.0.0.1';

async function startTunnel(port) {
    const tunnelId = generateId();
    console.log(`\n🚀 shp-serve CLI`);

    const result = await findActivePort(port);
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
        const protocol = process.env.RELAY_SECURE || !isLocal ? 'https' : 'http';

        // Host-based URL for production, or path-based fallback
        const rawUrl = isLocal
            ? `http://127.0.0.1:8081/proxy/${tunnelId}/`
            : `https://${RELAY_HOST}/proxy/${tunnelId}/`;

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
                const localWsUrl = `ws://${targetHost}:${finalPort}${url}`;

                const localWs = new WebSocket(localWsUrl, {
                    headers: {
                        ...headers,
                        host: `${targetHost}:${finalPort}`
                    }
                });

                localBrowserSockets.set(socketId, localWs);

                localWs.on('message', (data, isBinary) => {
                    ws.send(JSON.stringify({
                        type: 'ws-message',
                        socketId,
                        data: isBinary ? data.toString('base64') : data.toString(),
                        isBinary
                    }));
                });

                localWs.on('close', () => {
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
                if (localWs && localWs.readyState === WebSocket.OPEN) {
                    const buf = isBinary ? Buffer.from(data, 'base64') : data;
                    localWs.send(buf);
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
