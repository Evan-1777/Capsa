#!/usr/bin/env node
/**
 * capsa-docs-mcp — zero-dependency MCP stdio proxy & workspace CLI for Capsa /mcp/docs.
 *
 * Modes:
 *   capsa-docs-mcp                     MCP stdio server (static 8 doc_* tools; per-call .env auth via cwd)
 *   capsa-docs-mcp init <url_or_token> Write/update CAPSA_DOCS_TOKEN (and non-default URL) in ./.env
 *   capsa-docs-mcp check               Verify connectivity and print category document count
 */

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import tls from 'node:tls';

export const DEFAULT_DOCS_URL = 'https://memory.evan-ai.xyz/mcp/docs';
const REQUEST_TIMEOUT_MS = 30_000;
const IDLE_SOCKET_TIMEOUT_MS = 20_000;
const CONNECT_FAMILY_TIMEOUT_MS = 1_500;
const RETRY_DELAY_MS = 150;
const STALE_SOCKET_CODES = new Set(['ECONNRESET', 'EPIPE']);
const TRANSIENT_NET_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED']);
const SERVER_INFO = { name: 'capsa-docs', version: '1.0.0' };
const DEFAULT_INIT_PARAMS = {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'capsa-docs-mcp', version: '1.0.0' },
};

const CWD_PROPERTY = {
  type: 'string',
  description: '项目工作区目录路径（用于定位 .env 中的凭据）；省略时使用代理进程启动目录',
};

/** Static tool definitions decoupled from workspace token authentication. */
export const DOCS_TOOLS = [
  {
    name: 'doc_glob',
    description: '按路径通配或子串匹配列出文档，返回作用域、路径、字符数与更新日期。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: '路径模式：省略列出全部；不含 * ? [ 时按大小写不敏感子串匹配；含通配符时按 shell 风格匹配，不含 / 的模式也匹配文件名',
        },
        scope: {
          type: 'string',
          description: '检索范围：all（默认，公共区与当前子项目）、category（仅当前子项目）、public（仅公共区）',
        },
        cwd: CWD_PROPERTY,
      },
    },
  },
  {
    name: 'doc_grep',
    description: '在文档正文中按关键词或正则检索，返回命中行所在文档、行号与行文本（默认最多 100 行）。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: {
          type: 'string',
          description: '检索词；is_regex 为 true 时按 Go 正则表达式解释',
        },
        is_regex: {
          type: 'boolean',
          default: false,
          description: '是否按正则表达式检索，默认 false',
        },
        scope: {
          type: 'string',
          description: '检索范围：all（默认）、category、public',
        },
        path: {
          type: 'string',
          description: '只检索该路径的单篇文档；省略时检索范围内全部文档',
        },
        limit: {
          type: 'integer',
          default: 100,
          description: '返回匹配行上限，取值 1~500',
        },
        cwd: CWD_PROPERTY,
      },
    },
  },
  {
    name: 'doc_read',
    description: '读取单篇文档正文。省略 offset 与 limit 时返回完整正文（不做字符截断）；给出其一则按行号区间分段返回并标注行号。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: '文档逻辑路径',
        },
        scope: {
          type: 'string',
          description: '文档作用域：category（默认，当前子项目）或 public（所在工作区公共区）',
        },
        offset: {
          type: 'integer',
          description: '起始行号，1-based；省略表示从首行开始',
        },
        limit: {
          type: 'integer',
          description: '最多读取的行数；省略表示读到末尾',
        },
        cwd: CWD_PROPERTY,
      },
    },
  },
  {
    name: 'doc_create',
    description: '在当前子项目新建文档；路径已存在时拒绝覆盖，需改走 doc_write。公共文档区只读。',
    annotations: { destructiveHint: false },
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: {
          type: 'string',
          description: '新文档的逻辑路径，允许斜杠分层',
        },
        content: {
          type: 'string',
          description: '初始正文，允许空串',
        },
        scope: {
          type: 'string',
          description: '仅接受 category；传入 public 会被拒绝',
        },
        cwd: CWD_PROPERTY,
      },
    },
  },
  {
    name: 'doc_write',
    description: '对当前子项目下已存在的文档执行全量正文覆盖；文档不存在时不会新建。公共文档区只读。',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: {
          type: 'string',
          description: '目标文档的逻辑路径',
        },
        content: {
          type: 'string',
          description: '完整新正文，允许空串',
        },
        scope: {
          type: 'string',
          description: '仅接受 category；传入 public 会被拒绝',
        },
        cwd: CWD_PROPERTY,
      },
    },
  },
  {
    name: 'doc_edit',
    description: '在当前子项目下的文档正文中做精确文本替换，命中多处时默认拒绝。公共文档区只读。',
    annotations: { destructiveHint: false },
    inputSchema: {
      type: 'object',
      required: ['path', 'old_string', 'new_string'],
      properties: {
        path: {
          type: 'string',
          description: '目标文档的逻辑路径',
        },
        old_string: {
          type: 'string',
          description: '待替换的原文，不能为空',
        },
        new_string: {
          type: 'string',
          description: '替换后的文本，允许空串以删除片段',
        },
        replace_all: {
          type: 'boolean',
          default: false,
          description: '是否替换全部匹配，默认 false 仅替换唯一匹配',
        },
        scope: {
          type: 'string',
          description: '仅接受 category；传入 public 会被拒绝',
        },
        cwd: CWD_PROPERTY,
      },
    },
  },
  {
    name: 'doc_delete',
    description: '物理删除当前子项目下的指定文档，删除后不可恢复。公共文档区只读。',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: '目标文档的逻辑路径',
        },
        scope: {
          type: 'string',
          description: '仅接受 category；传入 public 会被拒绝',
        },
        cwd: CWD_PROPERTY,
      },
    },
  },
  {
    name: 'doc_move',
    description: '移动或重命名当前子项目下的文档（支持单篇文档或目录前缀批量移动）；目标路径已存在时默认拒绝覆盖。公共文档区只读。',
    annotations: { destructiveHint: false },
    inputSchema: {
      type: 'object',
      required: ['path', 'new_path'],
      properties: {
        path: {
          type: 'string',
          description: '源文档逻辑路径；recursive 为 true 时为源目录前缀',
        },
        new_path: {
          type: 'string',
          description: '目标文档逻辑路径；recursive 为 true 时为目标目录前缀',
        },
        overwrite: {
          type: 'boolean',
          default: false,
          description: '目标路径已存在时是否覆盖，默认 false 拒绝覆盖',
        },
        recursive: {
          type: 'boolean',
          default: false,
          description: '是否按目录前缀批量移动（匹配 path/ 下全部文档），默认 false 仅移动单篇文档',
        },
        scope: {
          type: 'string',
          description: '仅接受 category；传入 public 会被拒绝',
        },
        cwd: CWD_PROPERTY,
      },
    },
  },
];

/** Read-only tool names derived from static tool annotations (single source of truth). */
export const READ_ONLY_TOOLS = new Set(
  DOCS_TOOLS.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name),
);

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
    try {
      const parsed = parseEnvText(fs.readFileSync(candidate, 'utf8'));
      if (!token && parsed.CAPSA_DOCS_TOKEN) {
        token = parsed.CAPSA_DOCS_TOKEN.trim();
        envPath ||= candidate;
      }
      if (!url && parsed.CAPSA_DOCS_URL) {
        url = parsed.CAPSA_DOCS_URL.trim();
        envPath ||= candidate;
      }
      if (token && url) break;
    } catch {}
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
  if (!input) throw new Error('缺少参数：请提供管理台复制的接入链接或子项目访问 ID');

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

const stripIPv6Brackets = (host) => (host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseNoProxyEntry(raw) {
  const entry = raw.trim().toLowerCase();
  if (!entry) return null;
  if (entry === '*' || entry === '<local>') return { special: entry };
  if (entry.startsWith('[')) {
    const m = entry.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (!m) return null;
    return { host: m[1], port: m[2] || '' };
  }
  const colonIdx = entry.indexOf(':');
  if (colonIdx !== -1 && entry.indexOf(':', colonIdx + 1) === -1) {
    const port = entry.slice(colonIdx + 1);
    if (/^\d+$/.test(port)) {
      return { host: entry.slice(0, colonIdx), port };
    }
  }
  return { host: entry, port: '' };
}

/** Check whether targetUrl should bypass configured HTTP(S)_PROXY via NO_PROXY/no_proxy. */
export function matchesNoProxy(targetUrl) {
  const raw = process.env.NO_PROXY || process.env.no_proxy || '';
  if (!raw.trim()) return false;
  const host = stripIPv6Brackets(targetUrl.hostname).toLowerCase();
  const port = targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80');

  for (const part of raw.split(',')) {
    const rule = parseNoProxyEntry(part);
    if (!rule) continue;
    if (rule.special === '*') return true;
    if (rule.special === '<local>') {
      if (!host.includes('.')) return true;
      continue;
    }
    if (rule.port && rule.port !== port) continue;
    if (rule.host.includes('*')) {
      const pattern = new RegExp(`^${escapeRegex(rule.host).replace(/\\\*/g, '.*')}$`);
      if (pattern.test(host)) return true;
      continue;
    }
    if (rule.host.startsWith('.')) {
      if (host === rule.host.slice(1) || host.endsWith(rule.host)) return true;
      continue;
    }
    if (host === rule.host || host.endsWith(`.${rule.host}`)) return true;
  }
  return false;
}

function resolveProxyForTarget(targetUrl) {
  if (matchesNoProxy(targetUrl)) return null;
  const env = process.env;
  const raw =
    targetUrl.protocol === 'https:'
      ? env.HTTPS_PROXY?.trim() || env.https_proxy?.trim() || env.ALL_PROXY?.trim() || env.all_proxy?.trim() || ''
      : env.HTTP_PROXY?.trim() || env.http_proxy?.trim() || env.ALL_PROXY?.trim() || env.all_proxy?.trim() || '';
  if (!raw) return null;

  let proxyUrl;
  try {
    proxyUrl = new URL(raw);
  } catch {
    throw new Error(`代理地址格式非法：${raw}`);
  }
  if (proxyUrl.protocol !== 'http:' && proxyUrl.protocol !== 'https:') {
    throw new Error(`不支持的代理协议：${proxyUrl.protocol}（仅支持 http:// 与 https:// 代理，proxy=${proxyUrl.protocol}//${proxyUrl.host}）`);
  }
  return proxyUrl;
}

function basicProxyAuth(proxyUrl) {
  if (!proxyUrl.username && !proxyUrl.password) return '';
  const creds = `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`;
  return `Basic ${Buffer.from(creds).toString('base64')}`;
}

/** HTTPS agent that establishes an HTTP CONNECT tunnel through an upstream proxy. */
class TunnelAgent extends https.Agent {
  constructor(proxyUrl) {
    super({
      keepAlive: true,
      maxSockets: 8,
      timeout: IDLE_SOCKET_TIMEOUT_MS,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: CONNECT_FAMILY_TIMEOUT_MS,
    });
    this.proxyUrl = proxyUrl;
    this.proxyLabel = `${proxyUrl.protocol}//${proxyUrl.host}`;
  }

  createConnection(options, cb) {
    const targetHost = stripIPv6Brackets(options.host || options.hostname || '');
    const targetPort = Number(options.port) || 443;
    const authority = net.isIPv6(targetHost) ? `[${targetHost}]:${targetPort}` : `${targetHost}:${targetPort}`;
    const proxyAuth = basicProxyAuth(this.proxyUrl);
    const proxyPort = Number(this.proxyUrl.port) || (this.proxyUrl.protocol === 'https:' ? 443 : 80);
    const transport = this.proxyUrl.protocol === 'https:' ? https : http;
    const connectTimeout = options.timeout || REQUEST_TIMEOUT_MS;

    let done = false;
    const finish = (err, socket) => {
      if (done) return;
      done = true;
      cb(err, socket);
    };

    const connectReq = transport.request({
      hostname: stripIPv6Brackets(this.proxyUrl.hostname),
      port: proxyPort,
      method: 'CONNECT',
      path: authority,
      headers: {
        Host: authority,
        ...(proxyAuth ? { 'Proxy-Authorization': proxyAuth } : {}),
      },
      agent: false,
      timeout: connectTimeout,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: CONNECT_FAMILY_TIMEOUT_MS,
    });

    connectReq.on('timeout', () => {
      const err = new Error(`代理 CONNECT 隧道超时 (${connectTimeout}ms)`);
      err.code = 'ETIMEDOUT';
      err.proxy = this.proxyLabel;
      connectReq.destroy(err);
    });
    connectReq.on('error', (err) => {
      if (err && typeof err === 'object' && !err.proxy) err.proxy = this.proxyLabel;
      finish(err);
    });
    connectReq.on('response', (res) => {
      res.resume();
      const err = new Error(`代理拒绝 CONNECT 隧道 (HTTP ${res.statusCode})`);
      err.proxy = this.proxyLabel;
      finish(err);
    });
    connectReq.on('connect', (res, socket, head) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        res.resume?.();
        const err = new Error(`代理 CONNECT 隧道失败 (HTTP ${res.statusCode})`);
        err.proxy = this.proxyLabel;
        finish(err);
        return;
      }
      if (head?.length) socket.unshift(head);
      const tlsOptions = {
        ...options,
        socket,
        servername: options.servername || (net.isIP(targetHost) ? undefined : targetHost),
      };
      delete tlsOptions.host;
      delete tlsOptions.port;
      delete tlsOptions.hostname;
      delete tlsOptions.path;
      const tlsSocket = tls.connect(tlsOptions);
      finish(null, tlsSocket);
    });
    connectReq.end();
  }
}

let directHttpAgent = null;
let directHttpsAgent = null;
const proxyAgents = new Map();

function makeAgentOptions() {
  return {
    keepAlive: true,
    maxSockets: 8,
    timeout: IDLE_SOCKET_TIMEOUT_MS,
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: CONNECT_FAMILY_TIMEOUT_MS,
  };
}

function getAgentForRequest(targetUrl, proxyUrl) {
  if (!proxyUrl) {
    if (targetUrl.protocol === 'https:') {
      directHttpsAgent ||= new https.Agent(makeAgentOptions());
      return directHttpsAgent;
    }
    directHttpAgent ||= new http.Agent(makeAgentOptions());
    return directHttpAgent;
  }
  const proxyOrigin = `${proxyUrl.protocol}//${proxyUrl.username ? `${proxyUrl.username}@` : ''}${proxyUrl.host}`;
  if (targetUrl.protocol === 'https:') {
    const key = `tunnel:${proxyOrigin}`;
    let agent = proxyAgents.get(key);
    if (!agent) {
      agent = new TunnelAgent(proxyUrl);
      proxyAgents.set(key, agent);
    }
    return agent;
  }
  const key = `forward:${proxyOrigin}`;
  let agent = proxyAgents.get(key);
  if (!agent) {
    const AgentCtor = proxyUrl.protocol === 'https:' ? https.Agent : http.Agent;
    agent = new AgentCtor(makeAgentOptions());
    proxyAgents.set(key, agent);
  }
  return agent;
}

/** Destroy all pooled HTTP/HTTPS/Tunnel agents and release idle sockets. */
export function closeAgentPool() {
  directHttpAgent?.destroy();
  directHttpAgent = null;
  directHttpsAgent?.destroy();
  directHttpsAgent = null;
  for (const agent of proxyAgents.values()) {
    agent.destroy();
  }
  proxyAgents.clear();
}

/** Recursively format err.cause and AggregateError.errors into a diagnostic chain. */
export function formatNetworkError(err) {
  if (!err) return '未知错误';
  const seen = new Set();
  const parts = [];

  const describe = (node) => {
    if (!node || typeof node !== 'object') {
      const text = String(node || '').trim();
      if (text && !parts.includes(text)) parts.push(text);
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);

    const msg = typeof node.message === 'string' ? node.message.trim() : '';
    const code = typeof node.code === 'string' ? node.code : '';
    const syscall = typeof node.syscall === 'string' ? node.syscall : '';
    const addr = typeof node.address === 'string' ? node.address : '';
    const port = node.port !== undefined && node.port !== null ? String(node.port) : '';
    const proxy = typeof node.proxy === 'string' ? node.proxy : '';

    const meta = [];
    if (code && !msg.includes(code)) meta.push(code);
    if (syscall && !msg.includes(syscall)) meta.push(syscall);
    if (addr) {
      const endpoint = port ? `${addr}:${port}` : addr;
      if (!msg.includes(endpoint)) meta.push(endpoint);
    } else if (port && !msg.includes(`:${port}`)) {
      meta.push(`port=${port}`);
    }
    if (proxy && !msg.includes(proxy)) meta.push(`proxy=${proxy}`);

    let segment = msg;
    if (meta.length) {
      segment = segment ? `${segment} (${meta.join(' ')})` : meta.join(' ');
    }
    if (segment && !parts.includes(segment)) {
      parts.push(segment);
    }

    if (Array.isArray(node.errors)) {
      for (const inner of node.errors) describe(inner);
    }
    if (node.cause) {
      describe(node.cause);
    }
  };

  describe(err);
  return parts.join(' <- ') || String(err);
}

function hasAnyErrorCode(err, codeSet) {
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    if (typeof node.code === 'string' && codeSet.has(node.code)) return true;
    if (Array.isArray(node.errors) && node.errors.some(walk)) return true;
    return node.cause ? walk(node.cause) : false;
  };
  return walk(err);
}

function isSafeIdempotentPayload(payload) {
  const method = payload?.method;
  if (method === 'initialize' || method === 'notifications/initialized' || method === 'tools/list') {
    return true;
  }
  if (method === 'tools/call') {
    return READ_ONLY_TOOLS.has(payload?.params?.name);
  }
  return false;
}

function shouldRetryRequest(err, payload) {
  if (err?.reusedSocket === true && err?.beforeResponse !== false && hasAnyErrorCode(err, STALE_SOCKET_CODES)) {
    return true;
  }
  if (isSafeIdempotentPayload(payload) && hasAnyErrorCode(err, TRANSIENT_NET_CODES)) {
    return true;
  }
  return false;
}

function postRemoteOnce(url, token, sessionId, payload, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(url);
    const proxyUrl = resolveProxyForTarget(targetUrl);
    const proxyLabel = proxyUrl ? `${proxyUrl.protocol}//${proxyUrl.host}` : '';
    const agent = getAgentForRequest(targetUrl, proxyUrl);
    const body = JSON.stringify(payload);

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(body),
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;

    const isHttpViaProxy = Boolean(proxyUrl && targetUrl.protocol === 'http:');
    const transport = isHttpViaProxy
      ? (proxyUrl.protocol === 'https:' ? https : http)
      : (targetUrl.protocol === 'https:' ? https : http);

    const reqOptions = isHttpViaProxy
      ? {
          hostname: stripIPv6Brackets(proxyUrl.hostname),
          port: Number(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80),
          method: 'POST',
          path: targetUrl.toString(),
          headers: {
            ...headers,
            Host: targetUrl.host,
            ...(basicProxyAuth(proxyUrl) ? { 'Proxy-Authorization': basicProxyAuth(proxyUrl) } : {}),
          },
          agent,
          timeout: timeoutMs,
          autoSelectFamily: true,
          autoSelectFamilyAttemptTimeout: CONNECT_FAMILY_TIMEOUT_MS,
        }
      : {
          hostname: stripIPv6Brackets(targetUrl.hostname),
          port: Number(targetUrl.port) || (targetUrl.protocol === 'https:' ? 443 : 80),
          method: 'POST',
          path: `${targetUrl.pathname}${targetUrl.search}`,
          headers,
          agent,
          timeout: timeoutMs,
          autoSelectFamily: true,
          autoSelectFamilyAttemptTimeout: CONNECT_FAMILY_TIMEOUT_MS,
        };

    let settled = false;
    let responseStarted = false;
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const req = transport.request(reqOptions, (res) => {
      responseStarted = true;
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const nextSession = typeof res.headers['mcp-session-id'] === 'string' ? res.headers['mcp-session-id'] : '';
        const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'].toLowerCase() : '';
        const rawBody = Buffer.concat(chunks).toString('utf8');
        resolveOnce({ status: res.statusCode || 0, nextSession, contentType, rawBody });
      });
      res.on('error', (err) => {
        if (err && typeof err === 'object') {
          err.reusedSocket = Boolean(req.reusedSocket);
          err.beforeResponse = false;
          if (proxyLabel && !err.proxy) err.proxy = proxyLabel;
        }
        rejectOnce(err);
      });
      res.on('close', () => {
        if (!settled && !res.complete) {
          const err = new Error('远端响应流提前中断');
          err.code = 'ECONNRESET';
          err.reusedSocket = Boolean(req.reusedSocket);
          err.beforeResponse = false;
          if (proxyLabel) err.proxy = proxyLabel;
          rejectOnce(err);
        }
      });
    });

    req.on('timeout', () => {
      const err = new Error(`请求超时 (${timeoutMs}ms)`);
      err.code = 'ETIMEDOUT';
      err.reusedSocket = Boolean(req.reusedSocket);
      err.beforeResponse = !responseStarted;
      if (proxyLabel) err.proxy = proxyLabel;
      req.destroy(err);
    });

    req.on('error', (err) => {
      if (err && typeof err === 'object') {
        if (err.reusedSocket === undefined) err.reusedSocket = Boolean(req.reusedSocket);
        if (err.beforeResponse === undefined) err.beforeResponse = !responseStarted;
        if (proxyLabel && !err.proxy) err.proxy = proxyLabel;
      }
      rejectOnce(err);
    });

    req.end(body);
  });
}

/** Forward a single JSON-RPC payload to the remote Streamable HTTP endpoint with bounded safe retry. */
export async function postRemote(url, token, sessionId, payload, options = {}) {
  try {
    return await postRemoteOnce(url, token, sessionId, payload, options);
  } catch (err) {
    if (!shouldRetryRequest(err, payload)) throw err;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return postRemoteOnce(url, token, sessionId, payload, options);
  }
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

    console.log(`连通正常 | 端点: ${cfg.url} | 当前子项目文档数: ${docCount}`);
    return 0;
  } catch (err) {
    console.error(`连接异常：${formatNetworkError(err)}`);
    return 1;
  } finally {
    closeAgentPool();
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

/** Start the MCP stdio server: local static tool discovery + per-call workspace token auth. */
export function startStdioProxy(defaultCwd = process.cwd()) {
  const sessions = new Map();
  const inflightHandshakes = new Map();
  let lastInitParams = DEFAULT_INIT_PARAMS;

  const emit = (frame) => {
    process.stdout.write(JSON.stringify(frame) + '\n');
  };

  const emitRemoteFailure = (id, res) => {
    const errFrames = contentTypeToFrames(res.contentType, res.rawBody);
    if (errFrames.length && errFrames[0]?.error) {
      emit({ jsonrpc: '2.0', id, error: errFrames[0].error });
      return;
    }
    const detail = res.rawBody ? `: ${res.rawBody.trim().slice(0, 200)}` : '';
    emit({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: `Capsa 远端请求失败 (HTTP ${res.status})${detail}` },
    });
  };

  const handshakeRemote = async (url, token, sessionKey) => {
    const initRes = await postRemote(url, token, '', {
      jsonrpc: '2.0',
      id: '__capsa_init__',
      method: 'initialize',
      params: lastInitParams,
    });
    if (initRes.status !== 200) return { ok: false, res: initRes };
    const initFrame = contentTypeToFrames(initRes.contentType, initRes.rawBody)[0];
    if (!initFrame || initFrame.error || !initFrame.result) {
      return { ok: false, res: initRes };
    }
    const nextSession = initRes.nextSession || '';
    sessions.set(sessionKey, nextSession);
    await postRemote(url, token, nextSession, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }).catch(() => {});
    return { ok: true, sessionId: nextSession };
  };

  // Deduplicate concurrent handshakes / re-handshakes for the same credential + failed session ID.
  const ensureSession = async (url, token, sessionKey, failedSessionId = null) => {
    if (failedSessionId === null) {
      if (sessions.has(sessionKey)) {
        return { ok: true, sessionId: sessions.get(sessionKey) || '' };
      }
    } else {
      const current = sessions.get(sessionKey);
      if (current && current !== failedSessionId) {
        return { ok: true, sessionId: current };
      }
      if (sessions.get(sessionKey) === failedSessionId) {
        sessions.delete(sessionKey);
      }
    }

    const existing = inflightHandshakes.get(sessionKey);
    if (existing && (failedSessionId === null || existing.failedSessionId === failedSessionId || existing.failedSessionId === null)) {
      return existing.promise;
    }

    const promise = handshakeRemote(url, token, sessionKey).finally(() => {
      if (inflightHandshakes.get(sessionKey)?.promise === promise) {
        inflightHandshakes.delete(sessionKey);
      }
    });
    inflightHandshakes.set(sessionKey, { failedSessionId, promise });
    return promise;
  };

  const handleToolCall = async (msg) => {
    const rawArgs =
      msg.params?.arguments && typeof msg.params.arguments === 'object' && !Array.isArray(msg.params.arguments)
        ? msg.params.arguments
        : {};
    const argCwd = typeof rawArgs.cwd === 'string' ? rawArgs.cwd.trim() : '';
    const targetCwd = argCwd || defaultCwd;
    const cfg = loadWorkspaceConfig(targetCwd);

    if (!cfg.token) {
      emit({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [
            {
              type: 'text',
              text: `未检测到 CAPSA_DOCS_TOKEN（检索起点：${path.resolve(targetCwd)}）：请在目标项目根目录配置 .env，或在调用参数 cwd 中传入项目目录`,
            },
          ],
          isError: true,
        },
      });
      return;
    }

    const { cwd: _strippedCwd, ...remoteArgs } = rawArgs;
    const forwardMsg = {
      ...msg,
      params: { ...msg.params, arguments: remoteArgs },
    };
    const sessionKey = `${cfg.url}\n${cfg.token}`;

    try {
      let sessionId = sessions.get(sessionKey);
      if (!sessions.has(sessionKey)) {
        const hs = await ensureSession(cfg.url, cfg.token, sessionKey, null);
        if (!hs.ok) {
          emitRemoteFailure(msg.id, hs.res);
          return;
        }
        sessionId = hs.sessionId;
      } else {
        sessionId = sessionId || '';
      }

      let res = await postRemote(cfg.url, cfg.token, sessionId, forwardMsg);

      // Re-handshake transparently if remote session expired or server restarted (HTTP 404).
      if (res.status === 404 || (!sessionId && res.status === 400)) {
        const hs = await ensureSession(cfg.url, cfg.token, sessionKey, sessionId);
        if (!hs.ok) {
          emitRemoteFailure(msg.id, hs.res);
          return;
        }
        res = await postRemote(cfg.url, cfg.token, hs.sessionId, forwardMsg);
      }

      if (res.nextSession) sessions.set(sessionKey, res.nextSession);

      if (res.status >= 400) {
        emitRemoteFailure(msg.id, res);
        return;
      }

      const frames = contentTypeToFrames(res.contentType, res.rawBody);
      let matched = false;
      for (const frame of frames) {
        if (frame && typeof frame === 'object' && Object.prototype.hasOwnProperty.call(frame, 'id') && frame.id === msg.id) {
          matched = true;
        }
        emit(frame);
      }
      if (!matched) {
        const preview = res.rawBody ? `: ${res.rawBody.trim().slice(0, 200)}` : '（响应体为空）';
        emit({
          jsonrpc: '2.0',
          id: msg.id,
          error: {
            code: -32000,
            message: `Capsa 远端返回无效响应 (HTTP ${res.status})${preview}`,
          },
        });
      }
    } catch (err) {
      emit({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32000, message: `Capsa 远端不可达：${formatNetworkError(err)}` },
      });
    }
  };

  const handleMessage = async (msg) => {
    const hasId = msg && typeof msg === 'object' && Object.prototype.hasOwnProperty.call(msg, 'id');
    if (!hasId || !msg.method) return;

    switch (msg.method) {
      case 'initialize':
        if (msg.params && typeof msg.params === 'object') {
          lastInitParams = msg.params;
        }
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
        emit({ jsonrpc: '2.0', id: msg.id, result: { tools: DOCS_TOOLS } });
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
      case 'tools/call':
        await handleToolCall(msg);
        return;
      default:
        emit({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: `Method not found: ${msg.method}` },
        });
    }
  };

  const inflight = new Set();
  let stdinEnded = false;
  let buffer = '';

  const maybeClosePool = () => {
    if (stdinEnded && inflight.size === 0) {
      closeAgentPool();
    }
  };

  const dispatchLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      emit({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const task = Promise.resolve()
      .then(() => handleMessage(msg))
      .catch((err) => {
        if (msg && typeof msg === 'object' && Object.prototype.hasOwnProperty.call(msg, 'id')) {
          emit({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32000, message: `Capsa 代理异常：${formatNetworkError(err)}` },
          });
        }
      })
      .finally(() => {
        inflight.delete(task);
        maybeClosePool();
      });
    inflight.add(task);
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let nlIdx;
    while ((nlIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nlIdx);
      buffer = buffer.slice(nlIdx + 1);
      dispatchLine(line);
    }
  });
  process.stdin.on('end', () => {
    if (buffer.trim()) {
      const tail = buffer;
      buffer = '';
      dispatchLine(tail);
    }
    stdinEnded = true;
    maybeClosePool();
  });
}

function printUsage(stream = process.stdout) {
  stream.write(
    [
      'Usage:',
      '  capsa-docs-mcp                       启动 MCP Stdio 代理（自动读取工作区 .env）',
      '  capsa-docs-mcp init <url_or_token>   写入当前目录 .env 并确保 .gitignore 忽略 .env',
      '  capsa-docs-mcp check                 校验当前工作区 .env 与远端连通性及子项目文档数',
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
