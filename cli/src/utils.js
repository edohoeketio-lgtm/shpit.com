const net = require('net');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const COMMON_PORTS = [3000, 3001, 5173, 5174, 5175, 8080, 8081, 8000, 8001, 4200, 1234];

function detectFrameworkPort(cwd = process.cwd()) {
    try {
        const pkgPath = path.join(cwd, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

            // Vite defaults to 5173, but often falls back to 5174/5175
            if (deps.vite || deps['@sveltejs/kit']) return 5173;

            // Next.js and typical Node apps default to 3000, but often use 3001
            if (deps.next || deps.nuxt || deps.express) return 3000;
        }
    } catch (e) {
        // Ignore error
    }
    return 3000;
}

function findOpenPortsByLsof() {
    try {
        // -iTCP -sTCP:LISTEN: only TCP listening ports
        // -P: inhibit conversion of port numbers to port names
        // -n: inhibit conversion of network numbers to host names
        const output = execSync('lsof -iTCP -sTCP:LISTEN -P -n', { encoding: 'utf8' });
        const lines = output.split('\n');
        const ports = new Set();

        for (const line of lines) {
            // Looking for lines like: "node 1234 sk 5u IPv4 ... TCP *:5173 (LISTEN)"
            const match = line.match(/TCP (?:[\d\.]+|\*):(\d+) \(LISTEN\)/);
            if (match) {
                const port = parseInt(match[1], 10);
                // Filter out common system/utility ports
                // Focus on 3000-9999 range which covers most dev environments
                if (port >= 3000 && port <= 9999) {
                    if (![6379, 5432, 27017, 9222].includes(port)) {
                        ports.add(port);
                    }
                }
            }
        }
        return Array.from(ports);
    } catch (e) {
        return [];
    }
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

async function findActivePort(explicitPort, cwd = process.cwd()) {
    if (explicitPort) {
        const res = await checkPort(explicitPort);
        return { port: explicitPort, host: res.host || '127.0.0.1', alive: res.alive };
    }

    // 1. Try dynamic detection via lsof
    const dynamicPorts = findOpenPortsByLsof();
    if (dynamicPorts.length > 0) {
        const frameworkPort = detectFrameworkPort(cwd);
        // If the framework's default is open, use that
        if (dynamicPorts.includes(frameworkPort)) {
            return { port: frameworkPort, host: '127.0.0.1', alive: true };
        }
        // Otherwise pick the first one and return it
        return { port: dynamicPorts[0], host: '127.0.0.1', alive: true };
    }

    // 2. Scan common ports as fallback
    for (const port of COMMON_PORTS) {
        const res = await checkPort(port);
        if (res.alive) return { port, host: res.host, alive: true };
    }

    return { port: detectFrameworkPort(cwd), host: '127.0.0.1', alive: false };
}

module.exports = {
    detectFrameworkPort,
    checkPort,
    findActivePort,
    findOpenPortsByLsof,
    COMMON_PORTS
};
