import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';

const RELAY_PORT = 8555;
const DEV_PORT = 3555;
let relayProcess;
let cliProcess;
let devServer;
let devWss;
let browser;
let page;
let publicUrl;

describe('End-to-End Tunnel Pipeline', () => {
    beforeAll(async () => {
        // 1. Start Dev HTTP + WS Server
        devServer = http.createServer((req, res) => {
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>shpit e2e success</h1>');
            } else if (req.url === '/chunked') {
                res.writeHead(200, { 'Content-Type': 'text/plain', 'Transfer-Encoding': 'chunked' });
                res.write('chunk 1\n');
                setTimeout(() => {
                    res.end('chunk 2\n');
                }, 100);
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        devWss = new WebSocketServer({ server: devServer });
        devWss.on('connection', (ws) => {
            console.log('DEV WSS CONNECTION');
            ws.send('welcome');
            ws.on('message', (msg) => {
                if (msg.toString() === 'ping') ws.send('pong');
            });
        });

        await new Promise(r => devServer.listen(DEV_PORT, '127.0.0.1', r));

        // 2. Start Local Relay Server
        relayProcess = spawn('node', [path.join(__dirname, '../../relay/server.js')], {
            env: { ...process.env, PORT: RELAY_PORT },
            stdio: 'pipe'
        });

        await new Promise((resolve) => {
            relayProcess.stdout.on('data', data => {
                if (data.toString().includes('running on port')) resolve();
            });
        });

        // 3. Start CLI connecting to Local Relay
        cliProcess = spawn('node', [path.join(__dirname, '../bin/shpthis.js'), String(DEV_PORT)], {
            env: { ...process.env, RELAY_HOST: `127.0.0.1:${RELAY_PORT}`, RELAY_SECURE: 'false' },
            stdio: 'pipe'
        });

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('CLI timeout')), 10000);
            cliProcess.stdout.on('data', data => {
                const output = data.toString();
                console.log('CLI:', output);
                const match = output.match(/Public URL:\s+(http[^\s\\]+)/);
                if (match) {
                    clearTimeout(timeout);
                    publicUrl = match[1].trim();
                    resolve();
                }
            });
            cliProcess.stderr.on('data', data => console.error('CLI ERR:', data.toString()));
        });

        // 4. Launch Playwright
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage();
        page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    }, 20000); // 20s timeout for setup

    afterAll(async () => {
        if (browser) await browser.close();
        if (cliProcess) cliProcess.kill();
        if (relayProcess) relayProcess.kill();
        if (devServer) {
            devServer.close();
            devWss.close();
        }
    });

    it('successfully tunnels HTTP traffic', async () => {
        expect(publicUrl).toBeDefined();
        await page.goto(publicUrl);
        const heading = await page.textContent('h1');
        expect(heading).toBe('shpit e2e success');
    });

    it('successfully tunnels chunked HTTP responses', async () => {
        const response = await page.goto(`${publicUrl}chunked`);
        const text = await response.text();
        expect(text).toBe('chunk 1\nchunk 2\n');
    });

    it('successfully multiplexes WebSockets (HMR simulation)', async () => {
        // Convert http:// to ws:// for proxy URL
        const wsUrl = publicUrl.replace('http://', 'ws://');

        // Use browser context to evaluate WS connection and test
        const wsResult = await page.evaluate(async (url) => {
            return new Promise((resolve, reject) => {
                const ws = new WebSocket(url);
                const messages = [];
                ws.onopen = () => {
                    console.log('BROWSER WS OPEN');
                    ws.send('ping');
                };
                ws.onmessage = (event) => {
                    console.log('BROWSER WS MESSAGE:', event.data);
                    messages.push(event.data);
                    if (messages.length === 2) {
                        ws.close();
                        resolve(messages);
                    }
                };
                ws.onclose = () => console.log('BROWSER WS CLOSE');
                ws.onerror = (e) => {
                    console.error('BROWSER WS ERROR');
                    reject('WS Error');
                };
                setTimeout(() => reject('WS Timeout'), 3000);
            });
        }, wsUrl);

        expect(wsResult).toContain('welcome');
        expect(wsResult).toContain('pong');
    });
});
