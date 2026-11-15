#!/usr/bin/env node
/**
 * capsa-docs-mcp — zero-dependency MCP stdio proxy & workspace CLI for Capsa /mcp/docs.
 *
 * Modes:
 *   capsa-docs-mcp                     MCP stdio server (reads .env from cwd up to .git root)
 *   capsa-docs-mcp init <url_or_token> Write/update CAPSA_DOCS_TOKEN (and non-default URL) in ./.env
 *   capsa-docs-mcp check               Verify connectivity and print category document count
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const DEFAULT_DOCS_URL = 'https://memory.evan-ai.xyz/mcp/docs';
const SERVER_INFO = { name: 'capsa-docs', version: '1.0.0' };
const DEFAULT_INIT_PARAMS = {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'capsa-docs-mcp', version: '1.0.0' },
};

/** Parse KEY=VALUE lines from a .env file content. */
export function parseEnvText(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const body = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const match = body.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawVal] = match;
    let val = rawVal.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else {
      const hashIdx = val.indexOf(' #');
      if (hashIdx !== -1) val = val.slice(0, hashIdx).trim();
    }
    out[key] = val;
  }
  return out;
}

/** Walk upward from startDir to the nearest .git boundary (inclusive) to resolve .env config. */
export function loadWorkspaceConfig(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  let token = '';
  let url = '';
  let envPath = null;

  while (true) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) {
          const parsed = parseEnvText(fs.readFileSync(candidate, 'utf8'));
          if (!token && parsed.CAPSA_DOCS_TOKEN) {
            token = parsed.CAPSA_DOCS_TOKEN.trim();
            envPath ||= candidate;
          }
          if (!url && parsed.CAPSA_DOCS_URL) {
            url = parsed.CAPSA_DOCS_URL.trim();
            envPath ||= candidate;
          }
        }
      } catch {}
    }
    if (fs.existsSync(path.join(dir, '.git'))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return {
    token,
    url: url || DEFAULT_DOCS_URL,
    envPath,
  };
}

const isPrintableToken = (value) => typeof value === 'string' && value.length > 0 && /^[\x21-\x7e]+$/.test(value);

/** Parse a full /mcp/docs URL (with ?token= or ?access_token=) or a bare category access ID. */
export function parseInitInput(rawInput) {
  const input = (rawInput || '').trim();
  if (!input) throw new Error('缺少参数：请提供管理台复制的接入链接或分类访问 ID');

  if (/^https?:\/\//i.test(input)) {
    let parsed;
    try {
      parsed = new URL(input);
    } catch {
      throw new Error(`URL 格式非法：${input}`);
    }
    const token = (parsed.searchParams.get('token') || parsed.searchParams.get('access_token') || '').trim();
    if (!isPrintableToken(token)) {
      throw new Error('URL 中未找到有效的 token 查询参数（形如 ?token=capsa_doc_...）');
    }
    parsed.searchParams.delete('token');
    parsed.searchParams.delete('access_token');
    parsed.hash = '';
    let endpoint = parsed.toString();
    if (parsed.pathname !== '/' && endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);
    return {
      token,
      // null signals default URL (remove stale custom URL if present); string sets custom URL
      customUrl: endpoint === DEFAULT_DOCS_URL ? null : endpoint,
      endpoint,
    };
  }

  if (!isPrintableToken(input) || input.includes('=') || input.includes('?')) {
    throw new Error(`访问 ID 格式非法：${input}`);
  }
  return {
    token: input,
    // undefined preserves any existing CAPSA_DOCS_URL in .env when only rotating the token
    customUrl: undefined,
    endpoint: null,
  };
}

/** Update keys in ./.env in place while preserving unrelated entries and comments. */
export function upsertDotEnv(dir, { token, customUrl }) {
  const envFile = path.join(dir, '.env');
  const existed = fs.existsSync(envFile);
  const raw = existed ? fs.readFileSync(envFile, 'utf8') : '';
  const lines = raw ? raw.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  let tokenWritten = false;
  let urlWritten = false;
  const nextLines = [];

  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    const key = match ? match[1] : null;
    if (key === 'CAPSA_DOCS_TOKEN') {
      if (!tokenWritten) {
        nextLines.push(`CAPSA_DOCS_TOKEN=${token}`);
        tokenWritten = true;
      }
      continue;
    }
    if (key === 'CAPSA_DOCS_URL') {
      if (customUrl === undefined) {
        nextLines.push(line);
        urlWritten = true;
      } else if (typeof customUrl === 'string' && !urlWritten) {
        nextLines.push(`CAPSA_DOCS_URL=${customUrl}`);
        urlWritten = true;
      }
      continue;
    }
    nextLines.push(line);
  }

  if (!tokenWritten) nextLines.push(`CAPSA_DOCS_TOKEN=${token}`);
  if (typeof customUrl === 'string' && !urlWritten) nextLines.push(`CAPSA_DOCS_URL=${customUrl}`);

  fs.writeFileSync(envFile, nextLines.join('\n') + '\n', existed ? { encoding: 'utf8' } : { encoding: 'utf8', mode: 0o600 });
  return envFile;
}

/** Ensure .gitignore in dir ignores .env. */
export function ensureGitignoreHasEnv(dir) {
  const ignoreFile = path.join(dir, '.gitignore');
  if (!fs.existsSync(ignoreFile)) {
    fs.writeFileSync(ignoreFile, '.env\n', 'utf8');
    return { path: ignoreFile, updated: true };
  }
  const content = fs.readFileSync(ignoreFile, 'utf8');
  const hasEnv = content.split(/\r?\n/).some((line) => {
    const t = line.trim();
    return t === '.env' || t === '/.env';
  });
  if (hasEnv) return { path: ignoreFile, updated: false };
  const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(ignoreFile, `${content}${prefix}.env\n`, 'utf8');
  return { path: ignoreFile, updated: true };
}

/** Parse SSE data payloads from a text/event-stream response body. */
function parseSSEPayloads(rawText) {
  const frames = [];
  let dataLines = [];
  const flush = () => {
    if (!dataLines.length) return;
    const joined = dataLines.join('\n').trim();
    dataLines = [];
    if (!joined) return;
    try {
      frames.push(JSON.parse(joined));
    } catch {}
  };
  for (const line of rawText.split(/\r?\n/)) {
    if (line === '') {
      flush();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  flush();
  return frames;
}

/** Forward a single JSON-RPC payload to the remote Streamable HTTP endpoint. */
async function postRemote(url, token, sessionId, payload) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const nextSession = res.headers.get('mcp-session-id') || '';
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const rawBody = await res.text();
  return { status: res.status, nextSession, contentType, rawBody };
}

/** Run CLI subcommand: init. */
export function runInit(rawArg, cwd = process.cwd()) {
  const parsed = parseInitInput(rawArg);
  const envFile = upsertDotEnv(cwd, parsed);
  const ignoreRes = ensureGitignoreHasEnv(cwd);
  const effectiveCfg = loadWorkspaceConfig(cwd);
  console.log(`已写入配置：${envFile}`);
  console.log(`服务端点：${effectiveCfg.url}`);
  if (ignoreRes.updated) console.log(`已补充 .env 至 ${ignoreRes.path}`);
}

/** Run CLI subcommand: check. */
export async function runCheck(cwd = process.cwd()) {
  const cfg = loadWorkspaceConfig(cwd);
  if (!cfg.token) {
    console.error('未检测到 CAPSA_DOCS_TOKEN（当前目录至 .git 根均无有效 .env 配置）');
    return 1;
  }

  try {
    const initRes = await postRemote(cfg.url, cfg.token, '', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: DEFAULT_INIT_PARAMS,
    });
    if (initRes.status !== 200) {
      console.error(`握手失败：HTTP ${initRes.status}${initRes.rawBody ? ' — ' + initRes.rawBody.trim() : ''}`);
      return 1;
    }
    const initJson = contentTypeToFrames(initRes.contentType, initRes.rawBody)[0];
    if (!initJson || initJson.error || !initJson.result) {
      console.error(`握手响应异常：${initRes.rawBody.trim()}`);
      return 1;
    }
    const sessionId = initRes.nextSession;

    await postRemote(cfg.url, cfg.token, sessionId, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    const globRes = await postRemote(cfg.url, cfg.token, sessionId, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'doc_glob', arguments: { scope: 'category' } },
    });
    if (globRes.status !== 200) {
      console.error(`文档枚举失败：HTTP ${globRes.status}${globRes.rawBody ? ' — ' + globRes.rawBody.trim() : ''}`);
      return 1;
    }
    const globJson = contentTypeToFrames(globRes.contentType, globRes.rawBody).find((f) => f && f.id === 2);
    const text = globJson?.result?.content?.[0]?.text || '';
    if (globJson?.error || globJson?.result?.isError) {
      console.error(`文档枚举返回错误：${globJson?.error?.message || text}`);
      return 1;
    }
    const countMatch = text.match(/命中\s+(\d+)\s+篇/);
    const docCount = countMatch
      ? Number(countMatch[1])
      : text.split('\n').filter((line) => line.startsWith('- [category]')).length;

    console.log(`连通正常 | 端点: ${cfg.url} | 当前分类文档数: ${docCount}`);
    return 0;
  } catch (err) {
    console.error(`连接异常：${err?.message || String(err)}`);
    return 1;
  }
}

function contentTypeToFrames(contentType, rawBody) {
  if (!rawBody || !rawBody.trim()) return [];
  if (contentType.includes('text/event-stream')) return parseSSEPayloads(rawBody);
  try {
    const parsed = JSON.parse(rawBody);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/** Handle one JSON-RPC message when no CAPSA_DOCS_TOKEN is configured. */
function handleDegradedMessage(msg, emit) {
  const hasId = msg && typeof msg === 'object' && Object.prototype.hasOwnProperty.call(msg, 'id');
  if (!hasId || !msg.method) return;

  switch (msg.method) {
    case 'initialize':
      emit({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: msg.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      });
      return;
    case 'ping':
      emit({ jsonrpc: '2.0', id: msg.id, result: {} });
      return;
    case 'tools/list':
      emit({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } });
      return;
    case 'resources/list':
      emit({ jsonrpc: '2.0', id: msg.id, result: { resources: [] } });
      return;
    case 'resources/templates/list':
      emit({ jsonrpc: '2.0', id: msg.id, result: { resourceTemplates: [] } });
      return;
    case 'prompts/list':
      emit({ jsonrpc: '2.0', id: msg.id, result: { prompts: [] } });
      return;
    default:
      emit({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: '当前工作区未配置 CAPSA_DOCS_TOKEN，capsa-docs 已降级为空服务' },
      });
  }
}

/** Start the MCP stdio proxy loop. */
export function startStdioProxy(cwd = process.cwd()) {
  const cfg = loadWorkspaceConfig(cwd);
  let sessionId = '';
  let lastInitParams = DEFAULT_INIT_PARAMS;

  const emit = (frame) => {
    process.stdout.write(JSON.stringify(frame) + '\n');
  };

  const rehandshake = async () => {
    const initRes = await postRemote(cfg.url, cfg.token, '', {
      jsonrpc: '2.0',
      id: '__capsa_reinit__',
      method: 'initialize',
      params: lastInitParams,
    });
    if (initRes.status !== 200) return false;
    sessionId = initRes.nextSession || '';
    await postRemote(cfg.url, cfg.token, sessionId, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }).catch(() => {});
    return Boolean(sessionId);
  };

  const handleRemoteMessage = async (msg) => {
    const hasId = msg && typeof msg === 'object' && Object.prototype.hasOwnProperty.call(msg, 'id');
    const isNotification = !hasId;

    if (msg.method === 'initialize' && msg.params && typeof msg.params === 'object') {
      lastInitParams = msg.params;
    }

    try {
      const targetSession = msg.method === 'initialize' ? '' : sessionId;
      let res = await postRemote(cfg.url, cfg.token, targetSession, msg);

      // Re-handshake transparently if remote session expired or server restarted (HTTP 404).
      if (msg.method !== 'initialize' && (res.status === 404 || (!targetSession && res.status === 400))) {
        const ok = await rehandshake();
        if (ok) {
          res = await postRemote(cfg.url, cfg.token, sessionId, msg);
        }
      }

      if (res.nextSession) sessionId = res.nextSession;

      // Notifications and client-to-server empty responses never write back to stdout.
      if (isNotification || !msg.method) return;

      if (res.status >= 400) {
        const errFrames = contentTypeToFrames(res.contentType, res.rawBody);
        if (errFrames.length && errFrames[0]?.error) {
          emit({ jsonrpc: '2.0', id: msg.id, error: errFrames[0].error });
        } else {
          const detail = res.rawBody ? `: ${res.rawBody.trim().slice(0, 200)}` : '';
          emit({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32000, message: `Capsa 远端请求失败 (HTTP ${res.status})${detail}` },
          });
        }
        return;
      }

      const frames = contentTypeToFrames(res.contentType, res.rawBody);
      for (const frame of frames) emit(frame);
    } catch (err) {
      if (isNotification || !msg.method) return;
      emit({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32000, message: `Capsa 远端不可达：${err?.message || String(err)}` },
      });
    }
  };

  let queue = Promise.resolve();
  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let nlIdx;
    while ((nlIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nlIdx).trim();
      buffer = buffer.slice(nlIdx + 1);
      if (!line) continue;
      queue = queue.then(async () => {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          emit({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
          return;
        }
        if (!cfg.token) {
          handleDegradedMessage(msg, emit);
        } else {
          await handleRemoteMessage(msg);
        }
      });
    }
  });
}

function printUsage(stream = process.stdout) {
  stream.write(
    [
      'Usage:',
      '  capsa-docs-mcp                       启动 MCP Stdio 代理（自动读取工作区 .env）',
      '  capsa-docs-mcp init <url_or_token>   写入当前目录 .env 并确保 .gitignore 忽略 .env',
      '  capsa-docs-mcp check                 校验当前工作区 .env 与远端连通性及分类文档数',
      '',
    ].join('\n'),
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    startStdioProxy();
    return;
  }
  const [cmd, ...rest] = args;
  if (cmd === '-h' || cmd === '--help' || cmd === 'help') {
    printUsage(process.stdout);
    return;
  }
  if (cmd === 'init') {
    try {
      runInit(rest[0]);
    } catch (err) {
      console.error(err?.message || String(err));
      process.exit(1);
    }
    return;
  }
  if (cmd === 'check') {
    const code = await runCheck();
    process.exit(code);
    return;
  }
  console.error(`未知子命令：${cmd}`);
  printUsage(process.stderr);
  process.exit(1);
}

const isDirectRun = (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main();
}
