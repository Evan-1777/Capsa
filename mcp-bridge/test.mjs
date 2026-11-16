#!/usr/bin/env node
/**
 * Self-check for capsa-docs-mcp:
 *   1. Workspace .env upward resolution bounded by .git
 *   2. Subcommand init (full URL, custom URL, bare token, .gitignore idempotency)
 *   3. Decoupled tool discovery (no token & no remote HTTP -> initialize ok + 7 static doc_* tools; tools/call -> isError)
 *   4. Stdio lazy auth proxy (default cwd + explicit cwd override + cwd stripping, 404 session re-handshake, SSE & JSON)
 *   5. Subcommand check + end-to-end schema & call verification against real Capsa binary when built
 */

import assert from 'node:assert/strict';
import child_process from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DOCS_URL,
  DOCS_TOOLS,
  ensureGitignoreHasEnv,
  loadWorkspaceConfig,
  parseInitInput,
  runCheck,
  runInit,
} from './index.mjs';

const BRIDGE_ENTRY = fileURLToPath(new URL('./index.mjs', import.meta.url));
const CAPSA_ROOT = path.resolve(path.dirname(BRIDGE_ENTRY), '..');

function runStdioSession(cwd, frames, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const proc = child_process.spawn(process.execPath, [BRIDGE_ENTRY], {
      cwd,
      env: {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        ...envOverrides,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      const parsed = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      resolve({ code, responses: parsed, stderr });
    });

    // Write frames and close stdin after allowing async queue to drain.
    for (const frame of frames) {
      proc.stdin.write(JSON.stringify(frame) + '\n');
    }
    setTimeout(() => proc.stdin.end(), 250);
  });
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'capsa-docs-mcp-test-'));

  try {
    // 1. .git boundary & upward .env lookup
    const outerDir = path.join(tmpRoot, 'outer');
    const repoDir = path.join(outerDir, 'repo');
    const subDir = path.join(repoDir, 'packages', 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    fs.mkdirSync(path.join(repoDir, '.git'));
    fs.writeFileSync(path.join(outerDir, '.env'), 'CAPSA_DOCS_TOKEN=capsa_doc_outer_leak\n');

    // Without .env inside repo, lookup stops at repo/.git and must NOT read outer/.env
    const emptyCfg = loadWorkspaceConfig(subDir);
    assert.equal(emptyCfg.token, '');
    assert.equal(emptyCfg.url, DEFAULT_DOCS_URL);

    // With .env at repo root, subDir resolves repo/.env
    fs.writeFileSync(path.join(repoDir, '.env'), 'CAPSA_DOCS_TOKEN=capsa_doc_repo_token\n');
    const subCfg = loadWorkspaceConfig(subDir);
    assert.equal(subCfg.token, 'capsa_doc_repo_token');

    // 2. init subcommand parsing & file mutations
    const initDir = path.join(tmpRoot, 'init-proj');
    fs.mkdirSync(initDir, { recursive: true });
    fs.writeFileSync(path.join(initDir, '.env'), '# project config\nPORT=3000\n');
    fs.writeFileSync(path.join(initDir, '.gitignore'), 'node_modules/\n');

    const customParsed = parseInitInput('http://127.0.0.1:9100/mcp/docs?token=capsa_doc_1234567890abcdef1234567890abcdef');
    assert.equal(customParsed.token, 'capsa_doc_1234567890abcdef1234567890abcdef');
    assert.equal(customParsed.customUrl, 'http://127.0.0.1:9100/mcp/docs');

    runInit('http://127.0.0.1:9100/mcp/docs?token=capsa_doc_1234567890abcdef1234567890abcdef', initDir);
    let envContent = fs.readFileSync(path.join(initDir, '.env'), 'utf8');
    assert.match(envContent, /PORT=3000/);
    assert.match(envContent, /CAPSA_DOCS_TOKEN=capsa_doc_1234567890abcdef1234567890abcdef/);
    assert.ok(envContent.includes('CAPSA_DOCS_URL=http://127.0.0.1:9100/mcp/docs'));
    assert.match(fs.readFileSync(path.join(initDir, '.gitignore'), 'utf8'), /^\.env$/m);

    // Rotating bare token keeps existing custom URL and does not duplicate .env in .gitignore
    runInit('capsa_doc_rotated000000000000000000000000', initDir);
    assert.equal(ensureGitignoreHasEnv(initDir).updated, false);
    envContent = fs.readFileSync(path.join(initDir, '.env'), 'utf8');
    assert.match(envContent, /CAPSA_DOCS_TOKEN=capsa_doc_rotated000000000000000000000000/);
    assert.ok(envContent.includes('CAPSA_DOCS_URL=http://127.0.0.1:9100/mcp/docs'));

    // Switching to default URL strips custom CAPSA_DOCS_URL
    runInit('https://memory.evan-ai.xyz/mcp/docs?token=capsa_doc_default000000000000000000000000', initDir);
    envContent = fs.readFileSync(path.join(initDir, '.env'), 'utf8');
    assert.doesNotMatch(envContent, /CAPSA_DOCS_URL=/);
    assert.match(envContent, /CAPSA_DOCS_TOKEN=capsa_doc_default000000000000000000000000/);

    // 3. Decoupled tool discovery without CAPSA_DOCS_TOKEN
    const noTokenDir = path.join(tmpRoot, 'no-token');
    fs.mkdirSync(path.join(noTokenDir, '.git'), { recursive: true });
    const unauthSession = await runStdioSession(noTokenDir, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'doc_glob', arguments: {} } },
    ]);
    assert.equal(unauthSession.responses.length, 3);
    assert.equal(unauthSession.responses[0].id, 1);
    assert.equal(unauthSession.responses[0].result.serverInfo.name, 'capsa-docs');
    assert.equal(unauthSession.responses[1].id, 2);
    assert.equal(unauthSession.responses[1].result.tools.length, 7);
    assert.deepEqual(
      unauthSession.responses[1].result.tools.map((t) => t.name),
      ['doc_glob', 'doc_grep', 'doc_read', 'doc_create', 'doc_write', 'doc_edit', 'doc_delete'],
    );
    assert.equal(DOCS_TOOLS.length, 7);
    assert.equal(unauthSession.responses[2].id, 3);
    assert.equal(unauthSession.responses[2].result.isError, true);
    assert.match(unauthSession.responses[2].result.content[0].text, /未检测到 CAPSA_DOCS_TOKEN/);

    // 4. Mock Streamable HTTP MCP server: lazy auth on tools/call, cwd override & stripping, 404 re-handshake, SSE
    const VALID_TOKEN = 'capsa_doc_mockvalidtoken000000000000000000';
    let sessionSeq = 0;
    let currentValidSession = '';
    let expiredOnce = false;
    let initializedNotifications = 0;
    let receivedRequests = 0;
    const forwardedArgs = [];

    const server = http.createServer((req, res) => {
      receivedRequests++;
      if (req.method !== 'POST' || req.url !== '/mcp/docs') {
        res.writeHead(404).end('not found');
        return;
      }
      if (req.headers.authorization !== `Bearer ${VALID_TOKEN}`) {
        res.writeHead(401).end('unauthorized');
        return;
      }
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const msg = JSON.parse(raw);
        if (msg.method === 'initialize') {
          currentValidSession = `sess-${++sessionSeq}`;
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Mcp-Session-Id': currentValidSession,
          });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'capsa-docs', version: '1.0.0' },
            },
          }));
          return;
        }

        if (req.headers['mcp-session-id'] !== currentValidSession) {
          res.writeHead(404).end('Invalid session ID');
          return;
        }

        if (!Object.prototype.hasOwnProperty.call(msg, 'id')) {
          if (msg.method === 'notifications/initialized') initializedNotifications++;
          res.writeHead(202).end();
          return;
        }

        if (msg.method === 'tools/call' && msg.params?.name === 'doc_glob') {
          forwardedArgs.push(msg.params.arguments);
          // Simulate server restart / session expiry once on second call
          if (!expiredOnce && forwardedArgs.length === 2) {
            expiredOnce = true;
            currentValidSession = 'invalidated';
            res.writeHead(404).end('Session terminated');
            return;
          }
          // Respond using SSE framing to verify SSE parser
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.end(`event: message\ndata: ${JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [{
                type: 'text',
                text: '# 文档匹配: "" | 范围: category | 命中 3 篇\n- [category] SCOPE.md | 120 字符 | 更新 2026-11-15\n- [category] Project.md | 800 字符 | 更新 2026-11-15\n- [category] Plan.md | 450 字符 | 更新 2026-11-15',
              }],
            },
          })}\n\n`);
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const mockEndpoint = `http://127.0.0.1:${port}/mcp/docs`;

    try {
      const activeDir = path.join(tmpRoot, 'active-proj');
      fs.mkdirSync(path.join(activeDir, '.git'), { recursive: true });
      runInit(`${mockEndpoint}?token=${VALID_TOKEN}`, activeDir);

      // Verify check subcommand
      const checkCode = await runCheck(activeDir);
      assert.equal(checkCode, 0);

      // Discovery-only session must make ZERO remote HTTP requests even when .env has a token
      const reqsBeforeDiscovery = receivedRequests;
      const discoveryOnly = await runStdioSession(
        activeDir,
        [
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cli', version: '1.0' } } },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        ],
        { HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' },
      );
      assert.equal(discoveryOnly.responses.length, 2);
      assert.equal(discoveryOnly.responses[1].result.tools.length, 7);
      assert.equal(receivedRequests, reqsBeforeDiscovery, 'initialize + tools/list must not hit remote server');

      // Global daemon mode: start proxy in unrelated host directory (no .env), pass cwd per call
      const daemonHome = path.join(tmpRoot, 'daemon-home');
      fs.mkdirSync(path.join(daemonHome, '.git'), { recursive: true });
      expiredOnce = false;
      initializedNotifications = 0;
      forwardedArgs.length = 0;

      const daemonProxied = await runStdioSession(
        daemonHome,
        [
          { jsonrpc: '2.0', id: 10, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh', version: '1.0' } } },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 11, method: 'tools/list', params: {} },
          { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'doc_glob', arguments: { scope: 'category', cwd: activeDir } } },
          { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'doc_glob', arguments: { scope: 'category', cwd: activeDir } } },
        ],
        { HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' },
      );

      assert.equal(daemonProxied.responses.length, 4);
      assert.equal(daemonProxied.responses[0].id, 10);
      assert.equal(daemonProxied.responses[1].id, 11);
      assert.equal(daemonProxied.responses[1].result.tools.length, 7);
      assert.equal(daemonProxied.responses[2].id, 12);
      assert.match(daemonProxied.responses[2].result.content[0].text, /命中 3 篇/);
      assert.equal(daemonProxied.responses[3].id, 13);
      assert.match(daemonProxied.responses[3].result.content[0].text, /命中 3 篇/);
      assert.ok(initializedNotifications >= 2, 'initial lazy handshake + 404 re-handshake must both send notifications/initialized');
      for (const argObj of forwardedArgs) {
        assert.equal(Object.prototype.hasOwnProperty.call(argObj, 'cwd'), false, 'cwd must be stripped before forwarding to remote');
        assert.equal(argObj.scope, 'category');
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    // 5. Optional end-to-end verification against real Go Capsa binary if present
    const capsaBin = path.join(CAPSA_ROOT, 'bin', 'capsa');
    if (fs.existsSync(capsaBin)) {
      const dbPath = path.join(tmpRoot, 'real-capsa.db');
      const adminToken = 'test_admin_secret_token';
      const initDb = child_process.spawnSync(capsaBin, ['init'], {
        env: { ...process.env, CAPSA_DB_PATH: dbPath },
        encoding: 'utf8',
      });
      assert.equal(initDb.status, 0, `capsa init failed: ${initDb.stderr}`);

      // Pick a free loopback port
      const probe = http.createServer();
      await new Promise((r) => probe.listen(0, '127.0.0.1', r));
      const realPort = probe.address().port;
      await new Promise((r) => probe.close(r));

      const srvProc = child_process.spawn(capsaBin, ['serve', '--host', '127.0.0.1', '--port', String(realPort)], {
        env: {
          PATH: process.env.PATH || '',
          CAPSA_DB_PATH: dbPath,
          CAPSA_ADMIN_TOKEN: adminToken,
        },
        stdio: 'ignore',
      });

      try {
        const base = `http://127.0.0.1:${realPort}`;
        // Wait for /healthz
        for (let i = 0; i < 30; i++) {
          try {
            const h = await fetch(`${base}/healthz`);
            if (h.status === 200) break;
          } catch {}
          await new Promise((r) => setTimeout(r, 50));
        }

        const wsRes = await fetch(`${base}/api/workspaces`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'A-Code Docs', description: '', mode: 'docs' }),
        });
        const wsId = (await wsRes.json()).data.id;

        const catRes = await fetch(`${base}/api/workspaces/${wsId}/categories`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test-proj', description: '' }),
        });
        const accessId = (await catRes.json()).data.access_id;

        const realProjDir = path.join(tmpRoot, 'real-proj');
        fs.mkdirSync(path.join(realProjDir, '.git'), { recursive: true });
        runInit(`${base}/mcp/docs?token=${accessId}`, realProjDir);

        const realStdio = await runStdioSession(realProjDir, [
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1.0' } } },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
          { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'doc_create', arguments: { path: 'SCOPE.md', content: '# Scope\n' } } },
        ], { HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' });
        assert.equal(realStdio.responses.length, 3);
        assert.equal(realStdio.responses[1].result.tools.length, 7);
        assert.ok(realStdio.responses[2].result.content[0].text.includes('已新建文档：SCOPE.md'));

        const realCheckCode = await runCheck(realProjDir);
        assert.equal(realCheckCode, 0);
      } finally {
        srvProc.kill('SIGTERM');
      }
    }

    console.log('capsa-docs-mcp self-test passed');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
