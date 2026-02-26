import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { detectFrameworkPort, checkPort, findActivePort } from '../src/utils.js';
import fs from 'fs';
import path from 'path';
import http from 'http';

describe('CLI Utils - port detection', () => {
    describe('detectFrameworkPort (File System Base)', () => {
        const testDir = path.join(__dirname, 'tmp-test');

        beforeAll(() => {
            if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);
        });

        afterAll(() => {
            if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
        });

        const writePkg = (content) => {
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(content));
        };

        it('detects Next.js (port 3000)', () => {
            writePkg({ dependencies: { next: '12.0.0' } });
            expect(detectFrameworkPort(testDir)).toBe(3000);
        });

        it('detects Vite (port 5173)', () => {
            writePkg({ devDependencies: { vite: '4.0.0' } });
            expect(detectFrameworkPort(testDir)).toBe(5173);
        });

        it('detects SvelteKit (port 5173)', () => {
            writePkg({ devDependencies: { '@sveltejs/kit': '1.0.0' } });
            expect(detectFrameworkPort(testDir)).toBe(5173);
        });

        it('defaults to 3000 if no known framework is found', () => {
            writePkg({ dependencies: { express: '4.0.0' } });
            expect(detectFrameworkPort(testDir)).toBe(3000);
        });

        it('defaults to 3000 if package.json does not exist', () => {
            fs.unlinkSync(path.join(testDir, 'package.json'));
            expect(detectFrameworkPort(testDir)).toBe(3000);
        });
    });

    describe('checkPort & findActivePort (Integration)', () => {
        let server;
        const TEST_PORT = 8111;

        beforeAll(() => {
            server = http.createServer((req, res) => res.end('ok'));
            server.listen(TEST_PORT, '127.0.0.1');
        });

        afterAll(() => {
            server.close();
        });

        it('checkPort returns alive: true for open port', async () => {
            const res = await checkPort(TEST_PORT, '127.0.0.1');
            expect(res.alive).toBe(true);
            expect(res.host).toBe('127.0.0.1');
        });

        it('checkPort returns alive: false for closed port', async () => {
            const res = await checkPort(8112); // Assuming 8112 is closed
            expect(res.alive).toBe(false);
        });

        it('findActivePort respects explicitly provided port', async () => {
            const res = await findActivePort(TEST_PORT);
            expect(res.alive).toBe(true);
            expect(res.port).toBe(TEST_PORT);
        });

        it('findActivePort handles explicitly provided offline port', async () => {
            const res = await findActivePort(8112);
            expect(res.alive).toBe(false);
            expect(res.port).toBe(8112);
        });
    });
});
