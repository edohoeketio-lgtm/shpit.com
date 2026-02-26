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

            if (deps.vite || deps['@sveltejs/kit']) return 5173;
            if (deps.next || deps.nuxt || deps.express) return 3000;
        }
    } catch (e) { }
    return 3000;
}

function findOpenPortsByLsof() {
    try {
        const output = execSync('lsof -iTCP -sTCP:LISTEN -P -n', { encoding: 'utf8' });
        const lines = output.split('\n');
        const results = [];
        const seenPorts = new Set();

        for (const line of lines) {
            // Updated regex to be more robust, capturing the process name and port
            const match = line.match(/^(\S+).+TCP (?:[\d\.]+|\*):(\d+) \(LISTEN\)/);
            if (match) {
                const processName = match[1];
                const port = parseInt(match[2], 10);

                // Exclude system and utility processes to focus on dev servers
                const isSystem = /ControlCe|Spotify|sharing|rapportd|identity|WindowSer|locationd|navidrome|transmiss|trustd|syslogd|distnoted/.test(processName);

                if (port >= 3000 && port <= 9999 && !seenPorts.has(port) && !isSystem) {
                    if (![6379, 5432, 27017, 9222].includes(port)) {
                        results.push({ port, process: processName });
                        seenPorts.add(port);
                    }
                }
            }
        }
        return results;
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

    const dynamicCandidates = findOpenPortsByLsof();
    if (dynamicCandidates.length > 0) {
        if (dynamicCandidates.length === 1) {
            return { port: dynamicCandidates[0].port, host: '127.0.0.1', alive: true };
        }
        return { candidates: dynamicCandidates, host: '127.0.0.1', alive: true };
    }

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
