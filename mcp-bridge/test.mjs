#!/usr/bin/env node
/**
 * Self-check for capsa-docs-mcp:
 *   1. Workspace .env upward resolution bounded by .git
 *   2. Subcommand init (full URL, custom URL, bare token, .gitignore idempotency)
 *   3. Decoupled tool discovery (no token & no remote HTTP -> initialize ok + 8 static doc_* tools; tools/call -> isError)
 *   4. Stdio lazy auth proxy (default cwd + explicit cwd override + cwd stripping, 404 session re-handshake, SSE & JSON)
 *   5. Subcommand check + end-to-end schema & call verification against real Capsa binary when built
 */

import assert from 'node:assert/strict';
import child_process from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DOCS_URL,
  DOCS_TOOLS,
  READ_ONLY_TOOLS,
  closeAgentPool,
  ensureGitignoreHasEnv,
  formatNetworkError,
  loadWorkspaceConfig,
  matchesNoProxy,
  parseInitInput,
  postRemote,
  runCheck,
  runInit,
} from './index.mjs';

const BRIDGE_ENTRY = fileURLToPath(new URL('./index.mjs', import.meta.url));
const CAPSA_ROOT = path.resolve(path.dirname(BRIDGE_ENTRY), '..');

const byId = (responses, id) => responses.find((frame) => frame && frame.id === id);

function runStdioSession(cwd, frames, envOverrides = {}, { sequential = false } = {}) {
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
    let lineBuf = '';
    const parsed = [];
    let waiter = null;

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
      lineBuf += chunk;
      let nl;
      while ((nl = lineBuf.indexOf('\n')) !== -1) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        parsed.push(msg);
        if (waiter && msg.id === waiter.id) {
          const done = waiter.resolve;
          waiter = null;
          done(msg);
        }
      }
    });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (lineBuf.trim()) parsed.push(JSON.parse(lineBuf.trim()));
      resolve({ code, responses: parsed, stderr });
    });

    if (!sequential) {
      // Write frames and close stdin after allowing async queue to drain.
      for (const frame of frames) {
        proc.stdin.write(JSON.stringify(frame) + '\n');
      }
      setTimeout(() => proc.stdin.end(), 250);
      return;
    }

    (async () => {
      for (const frame of frames) {
        const hasId = Object.prototype.hasOwnProperty.call(frame, 'id');
        const pending = hasId
          ? new Promise((res) => { waiter = { id: frame.id, resolve: res }; })
          : null;
        proc.stdin.write(JSON.stringify(frame) + '\n');
        if (pending) await pending;
      }
      proc.stdin.end();
    })().catch(reject);
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
    assert.equal(byId(unauthSession.responses, 1)?.result.serverInfo.name, 'capsa-docs');
    const unauthTools = byId(unauthSession.responses, 2);
    assert.equal(unauthTools?.result.tools.length, 8);
    assert.deepEqual(
      unauthTools.result.tools.map((t) => t.name),
      ['doc_glob', 'doc_grep', 'doc_read', 'doc_create', 'doc_write', 'doc_edit', 'doc_delete', 'doc_move'],
    );
    assert.equal(DOCS_TOOLS.length, 8);
    assert.deepEqual([...READ_ONLY_TOOLS].sort(), ['doc_glob', 'doc_grep', 'doc_read']);
    const unauthCall = byId(unauthSession.responses, 3);
    assert.equal(unauthCall?.result.isError, true);
    assert.match(unauthCall.result.content[0].text, /未检测到 CAPSA_DOCS_TOKEN/);

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
      assert.equal(byId(discoveryOnly.responses, 2)?.result.tools.length, 8);
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
      assert.ok(byId(daemonProxied.responses, 10)?.result?.serverInfo);
      assert.equal(byId(daemonProxied.responses, 11)?.result.tools.length, 8);
      assert.match(byId(daemonProxied.responses, 12)?.result.content[0].text || '', /命中 3 篇/);
      assert.match(byId(daemonProxied.responses, 13)?.result.content[0].text || '', /命中 3 篇/);
      assert.ok(initializedNotifications >= 2, 'initial lazy handshake + 404 re-handshake must both send notifications/initialized');
      for (const argObj of forwardedArgs) {
        assert.equal(Object.prototype.hasOwnProperty.call(argObj, 'cwd'), false, 'cwd must be stripped before forwarding to remote');
        assert.equal(argObj.scope, 'category');
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    // 4b. Proxy routing (HTTP_PROXY + HTTPS CONNECT tunnel), NO_PROXY bypass, timeout & error cause chain
    {
      const prevNoProxy = process.env.NO_PROXY;
      try {
        process.env.NO_PROXY = 'localhost,127.*,example.com:8443,.internal.local,<local>';
        assert.equal(matchesNoProxy(new URL('http://127.0.0.1:8000/mcp/docs')), true);
        assert.equal(matchesNoProxy(new URL('http://intranet:8000/mcp/docs')), true);
        assert.equal(matchesNoProxy(new URL('https://example.com:8443/mcp/docs')), true);
        assert.equal(matchesNoProxy(new URL('https://example.com:9443/mcp/docs')), false);
        assert.equal(matchesNoProxy(new URL('https://sub.internal.local/mcp/docs')), true);
        assert.equal(matchesNoProxy(new URL('https://public.remote.org/mcp/docs')), false);
      } finally {
        if (prevNoProxy === undefined) delete process.env.NO_PROXY;
        else process.env.NO_PROXY = prevNoProxy;
      }

      const aggErr = new AggregateError(
        [
          Object.assign(new Error('connect ECONNREFUSED ::1:9999'), { code: 'ECONNREFUSED', syscall: 'connect', address: '::1', port: 9999 }),
          Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9999'), { code: 'ECONNREFUSED', syscall: 'connect', address: '127.0.0.1', port: 9999 }),
        ],
        '',
      );
      const formattedAgg = formatNetworkError(new Error('fetch failed', { cause: aggErr }));
      assert.match(formattedAgg, /ECONNREFUSED/);
      assert.match(formattedAgg, /127\.0\.0\.1:9999/);
      assert.match(formattedAgg, /::1:9999/);

      const savedProxyEnv = {};
      for (const k of ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']) {
        savedProxyEnv[k] = process.env[k];
        delete process.env[k];
      }
      try {
        process.env.ALL_PROXY = 'socks5://127.0.0.1:1080';
        await assert.rejects(
          () => postRemote('http://remote.invalid:8000/mcp/docs', 't', '', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'doc_create' } }),
          /不支持的代理协议：socks5:/,
        );
      } finally {
        for (const [k, v] of Object.entries(savedProxyEnv)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
        closeAgentPool();
      }

      // Generate ephemeral self-signed cert for HTTPS CONNECT tunnel test
      const certDir = path.join(tmpRoot, 'certs');
      fs.mkdirSync(certDir, { recursive: true });
      const keyFile = path.join(certDir, 'key.pem');
      const certFile = path.join(certDir, 'cert.pem');
      const genCert = child_process.spawnSync(
        'openssl',
        [
          'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
          '-keyout', keyFile, '-out', certFile, '-days', '1',
          '-subj', '/CN=127.0.0.1',
          '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
        ],
        { encoding: 'utf8' },
      );
      assert.equal(genCert.status, 0, `openssl failed: ${genCert.stderr}`);

      let httpTargetHits = 0;
      let httpsTargetHits = 0;
      let proxyForwardHits = 0;
      let proxyConnectHits = 0;
      const proxyAuthSeen = [];

      const httpTarget = http.createServer((req, res) => {
        httpTargetHits++;
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const msg = JSON.parse(body);
          if (msg.method === 'initialize') {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'p-http-1' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'capsa-docs', version: '1.0.0' } } }));
            return;
          }
          if (!Object.prototype.hasOwnProperty.call(msg, 'id')) {
            res.writeHead(202).end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'via-http-ok' }] } }));
        });
      });

      const httpsTarget = https.createServer(
        { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
        (req, res) => {
          httpsTargetHits++;
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', () => {
            const msg = JSON.parse(body);
            if (msg.method === 'initialize') {
              res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'p-https-1' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'capsa-docs', version: '1.0.0' } } }));
              return;
            }
            if (!Object.prototype.hasOwnProperty.call(msg, 'id')) {
              res.writeHead(202).end();
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'via-https-tunnel-ok' }] } }));
          });
        },
      );

      const proxyServer = http.createServer((req, res) => {
        proxyForwardHits++;
        if (req.headers['proxy-authorization']) proxyAuthSeen.push(req.headers['proxy-authorization']);
        const target = new URL(req.url);
        const upstream = http.request(
          {
            hostname: target.hostname,
            port: target.port,
            path: `${target.pathname}${target.search}`,
            method: req.method,
            headers: req.headers,
          },
          (upRes) => {
            res.writeHead(upRes.statusCode || 502, upRes.headers);
            upRes.pipe(res);
          },
        );
        req.pipe(upstream);
      });
      proxyServer.on('connect', (req, clientSocket, head) => {
        proxyConnectHits++;
        if (req.headers['proxy-authorization']) proxyAuthSeen.push(req.headers['proxy-authorization']);
        const [host, portStr] = req.url.split(':');
        const serverSocket = net.connect(Number(portStr) || 443, host, () => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head?.length) serverSocket.write(head);
          serverSocket.pipe(clientSocket);
          clientSocket.pipe(serverSocket);
        });
        serverSocket.on('error', () => clientSocket.destroy());
      });

      await Promise.all([
        new Promise((r) => httpTarget.listen(0, '127.0.0.1', r)),
        new Promise((r) => httpsTarget.listen(0, '127.0.0.1', r)),
        new Promise((r) => proxyServer.listen(0, '127.0.0.1', r)),
      ]);

      try {
        const proxyUrl = `http://alice:s3cr3t@127.0.0.1:${proxyServer.address().port}`;
        const httpProj = path.join(tmpRoot, 'proxy-http-proj');
        fs.mkdirSync(path.join(httpProj, '.git'), { recursive: true });
        runInit(`http://127.0.0.1:${httpTarget.address().port}/mcp/docs?token=capsa_doc_proxyhttp00000000000000000000000`, httpProj);

        const proxiedHttpSession = await runStdioSession(
          httpProj,
          [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'doc_glob', arguments: {} } }],
          { HTTP_PROXY: proxyUrl, NO_PROXY: '' },
        );
        assert.match(byId(proxiedHttpSession.responses, 1)?.result.content[0].text || '', /via-http-ok/);
        assert.ok(proxyForwardHits >= 3, 'HTTP_PROXY should forward initialize + initialized + tool call');
        assert.ok(httpTargetHits >= 3);

        // NO_PROXY bypasses proxy completely
        const hitsBeforeBypass = proxyForwardHits;
        const bypassedSession = await runStdioSession(
          httpProj,
          [{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'doc_glob', arguments: {} } }],
          { HTTP_PROXY: proxyUrl, NO_PROXY: '127.*' },
        );
        assert.match(byId(bypassedSession.responses, 2)?.result.content[0].text || '', /via-http-ok/);
        assert.equal(proxyForwardHits, hitsBeforeBypass, 'NO_PROXY=127.* must bypass HTTP_PROXY');

        // HTTPS via CONNECT tunnel + Basic Proxy-Authorization
        const httpsProj = path.join(tmpRoot, 'proxy-https-proj');
        fs.mkdirSync(path.join(httpsProj, '.git'), { recursive: true });
        runInit(`https://127.0.0.1:${httpsTarget.address().port}/mcp/docs?token=capsa_doc_proxyhttps0000000000000000000000`, httpsProj);

        const proxiedHttpsSession = await runStdioSession(
          httpsProj,
          [{ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'doc_glob', arguments: {} } }],
          { HTTPS_PROXY: proxyUrl, NO_PROXY: '', NODE_EXTRA_CA_CERTS: certFile },
        );
        assert.match(byId(proxiedHttpsSession.responses, 3)?.result.content[0].text || '', /via-https-tunnel-ok/);
        assert.ok(proxyConnectHits >= 1, 'HTTPS_PROXY should establish CONNECT tunnel');
        assert.ok(httpsTargetHits >= 3);
        const expectedBasic = `Basic ${Buffer.from('alice:s3cr3t').toString('base64')}`;
        assert.ok(proxyAuthSeen.includes(expectedBasic), 'Proxy-Authorization Basic header must be sent');
      } finally {
        await Promise.all([
          new Promise((r) => httpTarget.close(r)),
          new Promise((r) => httpsTarget.close(r)),
          new Promise((r) => proxyServer.close(r)),
        ]);
      }

      // Timeout enforcement on stalled endpoint
      const stallServer = http.createServer(() => { /* intentionally never respond */ });
      await new Promise((r) => stallServer.listen(0, '127.0.0.1', r));
      try {
        await assert.rejects(
          () => postRemote(
            `http://127.0.0.1:${stallServer.address().port}/mcp/docs`,
            'capsa_doc_t',
            '',
            { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'doc_create', arguments: {} } },
            { timeoutMs: 80 },
          ),
          (err) => err?.code === 'ETIMEDOUT',
        );
      } finally {
        closeAgentPool();
        await new Promise((r) => stallServer.close(r));
      }
    }

    // 4c. Stale reused socket recovery, non-idempotent safety, concurrent handshake dedup, empty 200 fallback, ECONNREFUSED chain
    {
      let initCalls = 0;
      let globCalls = 0;
      let createCalls = 0;
      let firstKeepAliveSocket = null;
      let resetDone = false;

      const flakyServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const msg = JSON.parse(body);
          if (msg.method === 'initialize') {
            initCalls++;
            setTimeout(() => {
              res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'flaky-sess-1' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'capsa-docs', version: '1.0.0' } } }));
            }, 40);
            return;
          }
          if (!Object.prototype.hasOwnProperty.call(msg, 'id')) {
            res.writeHead(202).end();
            return;
          }
          if (msg.method === 'tools/call' && msg.params?.name === 'doc_glob') {
            globCalls++;
            if (msg.params.arguments?.pattern === 'empty-200') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end('');
              return;
            }
            if (msg.params.arguments?.pattern === 'stale-test') {
              if (!resetDone && req.socket === firstKeepAliveSocket) {
                resetDone = true;
                req.socket.resetAndDestroy();
                return;
              }
              firstKeepAliveSocket ||= req.socket;
            }
            const delay = msg.params.arguments?.pattern === 'slow' ? 50 : msg.params.arguments?.pattern === 'fast' ? 10 : 25;
            setTimeout(() => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                result: { content: [{ type: 'text', text: `glob:${msg.params.arguments?.pattern || ''}` }] },
              }));
            }, delay);
            return;
          }
          if (msg.method === 'tools/call' && msg.params?.name === 'doc_create') {
            createCalls++;
            if (msg.params.arguments?.path === 'stale-write.md') {
              if (!resetDone && req.socket === firstKeepAliveSocket) {
                resetDone = true;
                req.socket.resetAndDestroy();
                return;
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'created-after-reset' }] } }));
              return;
            }
            req.socket.resetAndDestroy();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
        });
      });
      flakyServer.keepAliveTimeout = 60_000;
      await new Promise((r) => flakyServer.listen(0, '127.0.0.1', r));

      try {
        const flakyUrl = `http://127.0.0.1:${flakyServer.address().port}/mcp/docs`;

        // Stale reused Keep-Alive socket ECONNRESET triggers transparent retry even for non-idempotent doc_create
        const r1 = await postRemote(flakyUrl, 'tok', 's', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'doc_glob', arguments: { pattern: 'stale-test' } } });
        assert.equal(r1.status, 200);
        assert.ok(firstKeepAliveSocket !== null);
        // Second call reuses the socket and server resets it before response; retry recovers on fresh socket
        const r2 = await postRemote(flakyUrl, 'tok', 's', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'doc_create', arguments: { path: 'stale-write.md', content: 'x' } } });
        assert.equal(r2.status, 200);
        assert.match(r2.rawBody, /created-after-reset/);
        assert.equal(resetDone, true);
        assert.equal(createCalls, 2, 'failed reused-socket write + 1 transparent retry');
        closeAgentPool();

        // Non-idempotent doc_create on a fresh socket must NOT retry on reset
        createCalls = 0;
        await assert.rejects(
          () => postRemote(flakyUrl, 'tok', 's', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'doc_create', arguments: { path: 'fresh-write.md', content: 'x' } } }),
        );
        assert.equal(createCalls, 1, 'non-idempotent write on fresh socket must not retry');
        closeAgentPool();

        // Concurrent tools/call in single stdio session: 3 concurrent calls trigger only 1 initialize + out-of-order ID safety
        initCalls = 0;
        const concurrentDir = path.join(tmpRoot, 'concurrent-proj');
        fs.mkdirSync(path.join(concurrentDir, '.git'), { recursive: true });
        runInit(`${flakyUrl}?token=capsa_doc_concur000000000000000000000000`, concurrentDir);

        const concurrentSession = await runStdioSession(
          concurrentDir,
          [
            { jsonrpc: '2.0', id: 101, method: 'tools/call', params: { name: 'doc_glob', arguments: { pattern: 'slow' } } },
            { jsonrpc: '2.0', id: 102, method: 'tools/call', params: { name: 'doc_glob', arguments: { pattern: 'fast' } } },
            { jsonrpc: '2.0', id: 103, method: 'tools/call', params: { name: 'doc_glob', arguments: { pattern: 'mid' } } },
            { jsonrpc: '2.0', id: 104, method: 'tools/call', params: { name: 'doc_glob', arguments: { pattern: 'empty-200' } } },
          ],
          { HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' },
        );
        assert.equal(initCalls, 1, 'concurrent tools/call without cached session must deduplicate initialize to 1');
        assert.match(byId(concurrentSession.responses, 101)?.result.content[0].text || '', /glob:slow/);
        assert.match(byId(concurrentSession.responses, 102)?.result.content[0].text || '', /glob:fast/);
        assert.match(byId(concurrentSession.responses, 103)?.result.content[0].text || '', /glob:mid/);
        assert.equal(byId(concurrentSession.responses, 104)?.error?.code, -32000, 'HTTP 200 empty body must emit -32000 error frame');
      } finally {
        closeAgentPool();
        await new Promise((r) => flakyServer.close(r));
      }

      // Unreachable port error preserves ECONNREFUSED + port in diagnostic message
      const probePortSrv = http.createServer();
      await new Promise((r) => probePortSrv.listen(0, '127.0.0.1', r));
      const deadPort = probePortSrv.address().port;
      await new Promise((r) => probePortSrv.close(r));

      const deadDir = path.join(tmpRoot, 'dead-proj');
      fs.mkdirSync(path.join(deadDir, '.git'), { recursive: true });
      runInit(`http://127.0.0.1:${deadPort}/mcp/docs?token=capsa_doc_dead00000000000000000000000000`, deadDir);
      const deadSession = await runStdioSession(
        deadDir,
        [{ jsonrpc: '2.0', id: 201, method: 'tools/call', params: { name: 'doc_glob', arguments: {} } }],
        { HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' },
      );
      const deadErr = byId(deadSession.responses, 201)?.error;
      assert.equal(deadErr?.code, -32000);
      assert.match(deadErr?.message || '', /ECONNREFUSED/);
      assert.ok((deadErr?.message || '').includes(String(deadPort)), `error message should contain port ${deadPort}: ${deadErr?.message}`);
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
          { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'doc_move', arguments: { path: 'SCOPE.md', new_path: 'docs/SCOPE.md' } } },
          { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'doc_read', arguments: { path: 'docs/SCOPE.md' } } },
        ], { HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' }, { sequential: true });
        assert.equal(realStdio.responses.length, 5);
        assert.equal(byId(realStdio.responses, 2)?.result.tools.length, 8);
        assert.ok((byId(realStdio.responses, 3)?.result.content[0].text || '').includes('已新建文档：SCOPE.md'));
        assert.ok((byId(realStdio.responses, 4)?.result.content[0].text || '').includes('已移动文档：SCOPE.md -> docs/SCOPE.md'));
        assert.ok((byId(realStdio.responses, 5)?.result.content[0].text || '').includes('# Scope'));

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
