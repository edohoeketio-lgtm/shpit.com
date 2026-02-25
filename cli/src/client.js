const WebSocket = require('ws');
const http = require('http');

// For local testing of the Node.js Relay Server, we use localhost:8081
// In production, this would be wss://your-relay-server.com
const RELAY_HOST = process.env.RELAY_HOST || '127.0.0.1:8081';
const RELAY_URL = process.env.RELAY_SECURE ? `wss://${RELAY_HOST}` : `ws://${RELAY_HOST}`;

function generateId() {
    return Math.random().toString(36).substring(2, 8);
}

function startTunnel(port) {
    const tunnelId = generateId();
    console.log(`\n🚀 shpthis CLI`);
    console.log(`\n  ▸ Exposing: http://127.0.0.1:${port}`);
    console.log(`  ▸ Connecting to relay...`);

    const ws = new WebSocket(`${RELAY_URL}/register?id=${tunnelId}`);

    ws.on('open', () => {
        console.log(`  ✓ Tunnel active!`);
        console.log(`\n  🌍 Public URL: http://${tunnelId}.${RELAY_HOST}`);
        console.log(`  (Note: In production, this would be https://${tunnelId}.shpthis.com)\n`);
    });

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
                    hostname: '127.0.0.1',
                    port: port,
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
                    console.error(`  [!] Error connecting to local port ${port}:`, err.message);
                    ws.send(JSON.stringify({
                        type: 'response',
                        id: id,
                        status: 502,
                        headers: { 'content-type': 'text/plain' },
                        body: Buffer.from(`Bad Gateway: Could not reach 127.0.0.1:${port}`).toString('base64')
                    }));
                });

                // If the incoming request had a body, we would write it here.
                // For simplicity in this v1, we only handle GET/HEAD perfectly.
                // To handle POST, we'd need to receive the body from the worker.
                localReq.end();
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
