"use strict";

const http = require("http");
const https = require("https");
const tls = require("tls");

const HOST = "127.0.0.1";
const PORT = 4242;
const PROXY_ALLOWLIST = new Set(["calendar.google.com", "news.google.com"]);
const IMAP_ALLOWLIST = new Set(["imap.gmail.com"]);
const MAX_EMAILS = 50;
const MAX_BODY_BYTES = 1_000_000;
const MAX_IMAP_BODY_BYTES = 6000;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600"
};

function json(res, status, payload) {
  res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS));
  res.end(JSON.stringify(payload));
}
function maskEmail(value) {
  const s = String(value || "");
  const parts = s.split("@");
  return parts.length === 2 ? parts[0].slice(0, 2) + "***@" + parts[1] : "(conta)";
}
function safeLog(message) {
  console.log("[ANTENA] " + message);
}
function fetchAllowed(target, redirectsLeft) {
  if (redirectsLeft === undefined) redirectsLeft = 3;
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(target); } catch (_) { reject(new Error("URL inválida")); return; }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || !PROXY_ALLOWLIST.has(parsed.hostname.toLowerCase())) {
      reject(new Error("domínio não permitido"));
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(parsed, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "*/*"
      }
    }, res => {
      const code = res.statusCode || 502;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        const next = new URL(res.headers.location, parsed);
        res.resume();
        if (redirectsLeft <= 0) { reject(new Error("limite de redirecionamentos excedido")); return; }
        if (!PROXY_ALLOWLIST.has(next.hostname.toLowerCase())) { reject(new Error("redirecionamento para domínio não permitido")); return; }
        fetchAllowed(next.toString(), redirectsLeft - 1).then(resolve, reject);
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > 8_000_000) {
          req.destroy(new Error("resposta remota muito grande"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({
        status: code,
        type: res.headers["content-type"] || "application/octet-stream",
        body: Buffer.concat(chunks)
      }));
    });
    req.setTimeout(20000, () => req.destroy(new Error("tempo esgotado ao consultar a fonte")));
    req.on("error", reject);
    req.end();
  });
}

function decodeBytes(buffer, charset) {
  const name = String(charset || "utf-8").toLowerCase();
  try { return new TextDecoder(/utf-?8|us-ascii/.test(name) ? "utf-8" : "windows-1252").decode(buffer); }
  catch (_) { return buffer.toString("utf8"); }
}
function decodeQuotedPrintable(value, charset) {
  const input = String(value || "").replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "=" && /^[0-9a-f]{2}$/i.test(input.slice(i + 1, i + 3))) {
      bytes.push(parseInt(input.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(input[i], "utf8"));
    }
  }
  return decodeBytes(Buffer.from(bytes), charset);
}
function decodeMimeWord(value) {
  if (!value) return "";
  const joined = String(value).replace(/(\?=)\s+(?==\?)/g, "$1");
  return joined.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (whole, charset, enc, data) => {
    try {
      return enc.toUpperCase() === "B"
        ? decodeBytes(Buffer.from(data, "base64"), charset)
        : decodeQuotedPrintable(data.replace(/_/g, " "), charset);
    } catch (_) { return whole; }
  });
}
function htmlToText(value) {
  return String(value || "").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}
function parseHeaders(raw) {
  const rows = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const unfolded = [];
  for (const row of rows) {
    if (/^[ \t]/.test(row) && unfolded.length) unfolded[unfolded.length - 1] += " " + row.trim();
    else if (row.trim()) unfolded.push(row);
  }
  const result = {};
  for (const row of unfolded) {
    const colon = row.indexOf(":");
    if (colon > 0) result[row.slice(0, colon).trim().toLowerCase()] = row.slice(colon + 1).trim();
  }
  return result;
}
function extractSnippet(rawBuffer, headerBuffer) {
  if (!rawBuffer || !rawBuffer.length) return "";
  const raw = (headerBuffer ? headerBuffer.toString("latin1") + "\r\n\r\n" : "") + rawBuffer.toString("latin1");
  const boundaryMatch = raw.match(/boundary="?([^";\r\n]+)"?/i);
  let part = raw;
  if (boundaryMatch) {
    const parts = raw.split("--" + boundaryMatch[1]);
    part = parts.find(item => /Content-Type:\s*text\/plain/i.test(item)) ||
      parts.find(item => /Content-Type:\s*text\/html/i.test(item)) || raw;
  }
  const headersEnd = part.search(/\r?\n\r?\n/);
  const head = headersEnd >= 0 ? part.slice(0, headersEnd) : "";
  let body = headersEnd >= 0 ? part.slice(headersEnd).replace(/^\r?\n\r?\n/, "") : part;
  const encoding = (head.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i) || [,""])[1].trim().toLowerCase();
  const charset = (head.match(/charset="?([^";\s]+)/i) || [,"utf-8"])[1];
  let decoded;
  if (encoding === "base64") decoded = decodeBytes(Buffer.from(body.replace(/\s/g, ""), "base64"), charset);
  else if (encoding === "quoted-printable") decoded = decodeQuotedPrintable(body, charset);
  else decoded = decodeBytes(Buffer.from(body, "latin1"), charset);
  return htmlToText(decoded).slice(0, 500);
}

class ImapReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.failure = null;
    socket.on("data", chunk => { this.buffer = Buffer.concat([this.buffer, chunk]); this.pump(); });
    socket.on("error", error => { this.failure = error; this.pump(); });
    socket.on("close", () => { if (!this.failure) this.failure = new Error("conexão IMAP encerrada"); this.pump(); });
  }
  pump() {
    while (this.waiters.length) {
      const waiter = this.waiters[0];
      if (this.failure) {
        this.waiters.shift();
        waiter.reject(this.failure);
        continue;
      }
      if (waiter.kind === "line") {
        const index = this.buffer.indexOf("\r\n");
        if (index < 0) return;
        const line = this.buffer.slice(0, index).toString("latin1");
        this.buffer = this.buffer.slice(index + 2);
        this.waiters.shift();
        waiter.resolve(line);
      } else {
        if (this.buffer.length < waiter.count) return;
        const value = this.buffer.slice(0, waiter.count);
        this.buffer = this.buffer.slice(waiter.count);
        this.waiters.shift();
        waiter.resolve(value);
      }
    }
  }
  line() { return new Promise((resolve, reject) => { this.waiters.push({ kind: "line", resolve, reject }); this.pump(); }); }
  bytes(count) { return new Promise((resolve, reject) => { this.waiters.push({ kind: "bytes", count, resolve, reject }); this.pump(); }); }
  async command(tag, command) {
    this.socket.write(tag + " " + command + "\r\n");
    const lines = [];
    const fetches = [];
    let active = null;
    for (;;) {
      const line = await this.line();
      if (!line && !active) continue;
      if (/^\* \d+ FETCH \(/i.test(line)) {
        active = { text: line, literals: [] };
      } else if (active) {
        active.text += " " + line;
      } else {
        lines.push(line);
      }
      const literal = line.match(/\{(\d+)\+?\}\s*$/);
      if (literal) {
        const bytes = Number(literal[1]);
        if (bytes > 2_000_000) throw new Error("resposta IMAP grande demais");
        if (active) active.literals.push(await this.bytes(bytes));
        else await this.bytes(bytes);
        continue;
      }
      if (active && /\)\s*$/.test(line)) {
        fetches.push(active);
        active = null;
      }
      const status = line.match(new RegExp("^" + tag + " (OK|NO|BAD)\\b", "i"));
      if (status) {
        if (status[1].toUpperCase() !== "OK") {
          const detail = line.replace(new RegExp("^" + tag + " \\S+\\s*", "i"), "");
          throw new Error(status[1].toUpperCase() === "NO" ? "IMAP_LOGIN_RECUSADO: " + detail : "Comando IMAP recusado: " + detail);
        }
        return { lines, fetches };
      }
    }
  }
}
function quoteImap(value) {
  const clean = String(value || "").replace(/[\r\n\0]/g, "");
  return '"' + clean.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
async function fetchEmails(payload) {
  const host = String(payload.host || "").toLowerCase();
  if (!IMAP_ALLOWLIST.has(host)) {
    const error = new Error("host IMAP não permitido");
    error.status = 403;
    throw error;
  }
  const email = String(payload.usuario || "").trim();
  const appPassword = String(payload.senhaApp || "").replace(/\s/g, "");
  if (!email || !appPassword) {
    const error = new Error("Informe o endereço de e-mail e a senha de app.");
    error.status = 400;
    throw error;
  }
  const quantity = Math.max(1, Math.min(MAX_EMAILS, Number.parseInt(payload.quantidade, 10) || 20));
  const socket = tls.connect({ host, port: 993, servername: host });
  socket.setTimeout(25000, () => socket.destroy(new Error("tempo esgotado na conexão IMAP")));
  const reader = new ImapReader(socket);
  let tag = 0;
  const run = async command => {
    tag += 1;
    return reader.command("A" + tag, command);
  };
  try {
    const greeting = await reader.line();
    if (!/^\* OK\b/i.test(greeting)) throw new Error("servidor IMAP não aceitou a conexão");
    await run("LOGIN " + quoteImap(email) + " " + quoteImap(appPassword));
    const mailbox = await run("EXAMINE INBOX");
    const exists = mailbox.lines.map(line => line.match(/^\* (\d+) EXISTS/i)).find(Boolean);
    const total = exists ? Number(exists[1]) : 0;
    if (!total) return [];
    const count = Math.min(quantity, total);
    const start = total - count + 1;
    const result = await run("FETCH " + start + ":" + total + " (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0." + MAX_IMAP_BODY_BYTES + ">)");
    return result.fetches.reverse().map((entry, index) => {
      const headers = parseHeaders(entry.literals[0] ? entry.literals[0].toString("latin1") : "");
      const flags = (entry.text.match(/FLAGS \(([^)]*)\)/i) || [,""])[1];
      const uid = (entry.text.match(/\bUID (\d+)/i) || [,""])[1];
      return {
        id: headers["message-id"] || (uid ? "uid-" + uid : "mail-" + index),
        conta: String(payload.apelido || payload.email || email),
        remetente: decodeMimeWord(headers.from || ""),
        assunto: decodeMimeWord(headers.subject || "(sem assunto)"),
        data: headers.date && Number.isFinite(Date.parse(headers.date)) ? new Date(headers.date).toISOString() : new Date().toISOString(),
        trecho: extractSnippet(entry.literals[1], entry.literals[0]),
        lido: /\\Seen/.test(flags)
      };
    });
  } catch (error) {
    socket.destroy();
    if (error.message.startsWith("IMAP_LOGIN_RECUSADO")) throw new Error("Senha de app inválida ou verificação em 2 etapas desativada — refaça em myaccount.google.com/apppasswords");
    throw error;
  } finally {
    if (!socket.destroyed) socket.end();
  }
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on("data", chunk => {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("requisição muito grande"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (_) { reject(Object.assign(new Error("JSON inválido"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  let address;
  try { address = new URL(req.url, "http://" + HOST + ":" + PORT); }
  catch (_) { res.writeHead(400, CORS); res.end("URL inválida"); return; }
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
  if (req.method === "GET" && address.pathname === "/health") {
    res.writeHead(200, Object.assign({ "Content-Type": "application/json" }, CORS));
    res.end(JSON.stringify({ online: true }));
    return;
  }
  if (req.method === "GET" && address.pathname === "/api/agents") {
    // O repositório não define workers/agentes autônomos nem um inventário com prova de vida.
    // Rotinas de interface e polling do navegador não são reportadas como agentes do servidor.
    json(res, 200, {
      ok: true,
      now: new Date().toISOString(),
      agents: [],
      resumo: { total: 0, ok: 0, atencao: 0, off: 0, pior: null }
    });
    return;
  }
  if (req.method === "GET" && address.pathname === "/proxy") {
    const target = address.searchParams.get("url");
    if (!target) { res.writeHead(400, CORS); res.end("faltou o parâmetro url"); return; }
    try {
      const result = await fetchAllowed(target, 3);
      res.writeHead(result.status, Object.assign({ "Content-Type": result.type }, CORS));
      res.end(result.body);
    } catch (error) {
      const forbidden = /não permitido/.test(error.message);
      res.writeHead(forbidden ? 403 : 502, CORS);
      res.end(forbidden ? "domínio não permitido" : "falha ao consultar a fonte permitida");
    }
    return;
  }
  if (req.method === "POST" && address.pathname === "/emails") {
    try {
      const payload = await readJson(req);
      const email = String(payload.usuario || "");
      safeLog("busca IMAP para " + maskEmail(email) + " via " + String(payload.host || ""));
      const emails = await fetchEmails(payload);
      json(res, 200, { emails });
    } catch (error) {
      const status = error.status || (/senha de app inválida/i.test(error.message) ? 401 : 502);
      json(res, status, { erro: error.message || "não consegui consultar esta conta" });
    }
    return;
  }
  res.writeHead(404, CORS);
  res.end("não encontrado");
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error("⚠ A porta 4242 já está em uso. Feche o programa que usa essa porta e tente novamente.");
    process.exitCode = 1;
  } else {
    console.error("Erro na antena: " + error.message);
  }
});
server.listen(PORT, HOST, () => {
  console.log("⚡ ANTENA DO OTTO ONLINE — porta 4242. Pode abrir o otto.html.");
});
