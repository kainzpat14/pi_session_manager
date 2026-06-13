import { spawn } from 'child_process';
import { join } from 'path';
import https from 'https';
import { openSync, mkdirSync } from 'fs';

const TEST_PORT = 13456;
const TEST_CONFIG_PATH = join(process.cwd(), 'test/.tmp/agent/web-config.json');
const TEST_CONFIG_DIR = join(process.cwd(), 'test/.tmp/agent');

export default async function globalSetup() {
  const logDir = join(process.cwd(), 'test-results');
  try { mkdirSync(logDir); } catch {}
  const logFd = openSync(join(logDir, 'server.log'), 'a');
  const server = spawn('node', [join(process.cwd(), 'dist', 'server.js')], {
    env: {
      ...process.env,
      PI_WEB_CONFIG_PATH: TEST_CONFIG_PATH,
      PI_WEB_AGENT_DIR: TEST_CONFIG_DIR,
      PI_PATH: join(process.cwd(), 'test', 'mock-pi.js'),
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    },
    detached: true,
    stdio: ['ignore', 'ignore', logFd],
  });

  // Store PID for teardown
  process.env._PI_WEB_TEST_PID = String(server.pid);

  // Poll until server is ready
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = https.get(
          `https://localhost:${TEST_PORT}/`,
          { rejectUnauthorized: false },
          (res) => {
            if (res.statusCode === 200) {
              resolve();
            } else {
              reject(new Error(`Status ${res.statusCode}`));
            }
          }
        );
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      console.log('Server ready on port', TEST_PORT);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  throw new Error('Server failed to start within 15s');
}
