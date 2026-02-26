const net = require('net');
const fs = require('fs');
const path = require('path');

const COMMON_PORTS = [3000, 5173, 8080, 8000, 4200, 1234];

function detectFrameworkPort(cwd = process.cwd()) {
    try {
        const pkgPath = path.join(cwd, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            if (deps.next) return 3000;
            if (deps.vite) return 5173;
            if (deps.nuxt) return 3000;
            if (deps['@sveltejs/kit']) return 5173;
        }
    } catch (e) {
        console.error('DETECT PORT ERROR:', e);
    }
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

async function findActivePort(explicitPort, cwd = process.cwd()) {
    if (explicitPort) {
        const res = await checkPort(explicitPort);
        return { port: explicitPort, host: res.host || '127.0.0.1', alive: res.alive };
    }

    // Scan common ports
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
    COMMON_PORTS
};
