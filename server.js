#!/usr/bin/env node
/*
 * ANTENA DO OTTO
 * Node puro (http, https, tls) — zero dependências, zero npm install.
 * Escuta SOMENTE em 127.0.0.1. Existe pra dar CORS a três coisas:
 *   GET  /proxy?url=...   -> agenda (iCal do Google Calendar) e notícias (RSS do Google News)
 *   POST /emails          -> caixa de entrada via IMAP (leitura, com senha de app)
 */
"use strict";

const http = require("http");
const https = require("https");
const tls = require("tls");
const { URL } = require("url");

const PORT = 4242;
const HOST = "127.0.0.1";

const PROXY_ALLOWLIST = ["calendar.google.com", "news.google.com"];
const IMAP_ALLOWLIST = ["imap.gmail.com"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function log(...args) {
  console.log("[ANTENA]", ...args);
}

// nunca loga credenciais — mascara e-mail e nunca imprime senha/links secretos
function maskEmail(email) {
  if (!email) return "(vazio)";
  const [user, domain] = String(email).split("@");
  if (!domain) return "***";
  return (user.slice(0, 2) || "*") + "***@" + domain;
}

/* ============================================================
   FETCH HTTP/HTTPS COM REDIRECTS (usado pelo /proxy)
   ============================================================ */
function fetchUrl(targetUrl, redirectsLeft) {
  if (redirectsLeft === undefined) redirectsLeft = 3;
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(new Error("URL inválida"));
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const req = lib.request(
      parsed,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "*/*"
        }
      },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          const nextUrl = new URL(res.headers.location, parsed).toString();
          res.resume();
          return resolve(fetchUrl(nextUrl, redirectsLeft - 1));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            contentType: res.headers["content-type"] || "text/plain; charset=utf-8",
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("tempo esgotado")));
    req.end();
  });
}

/* ============================================================
   CLIENTE IMAP MÍNIMO (module nativo tls, porta 993)
   Suporta: LOGIN, EXAMINE (somente leitura), FETCH com BODY.PEEK
   (nunca marca e-mail como lido), decodificação MIME básica.
   ============================================================ */
function escapeImapString(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeMimeWord(str) {
  if (!str) return "";
  return str.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (m, charset, enc, data) => {
    try {
      if (enc.toUpperCase() === "B") {
        return Buffer.from(data, "base64").toString(/utf-?8/i.test(charset) ? "utf8" : "latin1");
      }
      const s = data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (m2, hex) => String.fromCharCode(parseInt(hex, 16)));
      return s;
    } catch (e) {
      return m;
    }
  });
}

function extractPlainText(rawBody) {
  if (!rawBody) return "";
  let text = rawBody;
  const ctMatch = rawBody.match(/Content-Type:\s*multipart\/[^;]+;\s*boundary="?([^"\r\n;]+)"?/i);
  if (ctMatch) {
    const boundary = ctMatch[1];
    const parts = rawBody.split("--" + boundary);
    let plainPart = parts.find((p) => /Content-Type:\s*text\/plain/i.test(p));
    if (!plainPart) plainPart = parts.find((p) => /Content-Type:\s*text\/html/i.test(p));
    if (plainPart) {
      const encMatch = plainPart.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
      const enc = encMatch ? encMatch[1].trim().toLowerCase() : "7bit";
      const idx = plainPart.indexOf("\r\n\r\n");
      let body = idx !== -1 ? plainPart.slice(idx + 4) : plainPart;
      if (enc === "quoted-printable") body = decodeQuotedPrintable(body);
      else if (enc === "base64") {
        try {
          body = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
        } catch (e) {}
      }
      text = body;
    }
  } else {
    text = decodeQuotedPrintable(rawBody);
  }
  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = text
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function parseHeaders(headerText) {
  const lines = headerText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .reduce((acc, line) => {
      if (/^[ \t]/.test(line) && acc.length) acc[acc.length - 1] += " " + line.trim();
      else if (line.trim()) acc.push(line);
      return acc;
    }, []);
  const headers = {};
  lines.forEach((line) => {
    const idx = line.indexOf(":");
    if (idx === -1) return;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  });
  return headers;
}

function parseFetchLines(lines) {
  const messages = [];
  lines.forEach((entry) => {
    const { text, literals } = entry;
    if (!/FETCH \(/.test(text)) return;
    const uidMatch = text.match(/UID (\d+)/);
    const flagsMatch = text.match(/FLAGS \(([^)]*)\)/);
    const uid = uidMatch ? uidMatch[1] : String(Date.now()) + Math.random();
    const seen = flagsMatch ? /\\Seen/.test(flagsMatch[1]) : false;
    const headerBuf = literals[0];
    const bodyBuf = literals[1];
    const headerText = headerBuf ? headerBuf.toString("utf8") : "";
    const bodyTextRaw = bodyBuf ? bodyBuf.toString("utf8") : "";
    const headers = parseHeaders(headerText);
    messages.push({
      id: headers["message-id"] || "uid-" + uid,
      remetente: decodeMimeWord(headers["from"] || ""),
      assunto: decodeMimeWord(headers["subject"] || "(sem assunto)"),
      data: headers["date"] ? safeDateISO(headers["date"]) : new Date().toISOString(),
      trecho: extractPlainText(bodyTextRaw),
      lido: seen
    });
  });
  return messages;
}

function safeDateISO(dateStr) {
  const d = new Date(dateStr);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}

function fetchEmailsForAccount(host, usuario, senhaApp, quantidade) {
  return new Promise((resolve, reject) => {
    if (!IMAP_ALLOWLIST.includes(host)) return reject(new Error("host IMAP não permitido"));

    const socket = tls.connect(993, host, {}, () => {});
    let buffer = Buffer.alloc(0);
    let literalRemaining = 0;
    let lineParts = [];
    let tagCounter = 0;
    let pending = {};
    let totalExists = 0;
    let settled = false;

    function nextTag() {
      tagCounter++;
      return "A" + tagCounter;
    }
    function sendCmd(cmd) {
      return new Promise((res, rej) => {
        const tag = nextTag();
        pending[tag] = { resolve: res, reject: rej, lines: [] };
        socket.write(tag + " " + cmd + "\r\n");
      });
    }
    function finish(err, result) {
      if (settled) return;
      settled = true;
      try {
        socket.end();
      } catch (e) {}
      if (err) reject(err);
      else resolve(result);
    }

    function handleLogicalLine(parts) {
      let literals = [];
      let text = "";
      parts.forEach((p) => {
        if (p.type === "literal") literals.push(p.buf);
        else text += p.buf.toString("utf8");
      });

      const existsMatch = text.match(/^\*\s+(\d+)\s+EXISTS/);
      if (existsMatch) totalExists = parseInt(existsMatch[1], 10);

      const tagMatch = text.match(/^(A\d+)\s+(OK|NO|BAD)/);
      if (tagMatch) {
        const tag = tagMatch[1],
          status = tagMatch[2];
        const p = pending[tag];
        if (p) {
          delete pending[tag];
          if (status === "OK") p.resolve(p.lines);
          else p.reject(new Error("Comando IMAP recusado: " + text.trim()));
        }
        return;
      }
      const openTags = Object.keys(pending);
      if (openTags.length) pending[openTags[0]].lines.push({ text, literals });
    }

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (literalRemaining > 0) {
          if (buffer.length < literalRemaining) break;
          lineParts.push({ type: "literal", buf: buffer.slice(0, literalRemaining) });
          buffer = buffer.slice(literalRemaining);
          literalRemaining = 0;
          continue;
        }
        const idx = buffer.indexOf(Buffer.from("\r\n"));
        if (idx === -1) break;
        const lineBuf = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        lineParts.push({ type: "text", buf: lineBuf });
        const lineStr = lineBuf.toString("utf8");
        const litMatch = lineStr.match(/\{(\d+)\+?\}\s*$/);
        if (litMatch) {
          literalRemaining = parseInt(litMatch[1], 10);
          continue;
        }
        handleLogicalLine(lineParts);
        lineParts = [];
      }
    });

    socket.on("error", (err) => finish(err));
    socket.on("close", () => {
      if (!settled) finish(new Error("conexão IMAP encerrada inesperadamente"));
    });

    setTimeout(async () => {
      try {
        await sendCmd(`LOGIN "${escapeImapString(usuario)}" "${escapeImapString(senhaApp)}"`);
        await sendCmd("EXAMINE INBOX"); // somente leitura — nunca marca como lido
        const total = totalExists;
        if (!total) return finish(null, []);
        const n = Math.min(quantidade || 20, total);
        const start = Math.max(1, total - n + 1);
        const lines = await sendCmd(
          `FETCH ${start}:${total} (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] BODY.PEEK[TEXT]<0.2000>)`
        );
        const messages = parseFetchLines(lines).reverse(); // mais recentes primeiro
        finish(null, messages);
      } catch (err) {
        finish(err);
      }
    }, 350); // pequena espera pro greeting do servidor chegar antes do LOGIN
  });
}

/* ============================================================
   SERVIDOR HTTP
   ============================================================ */
const server = http.createServer((req, res) => {
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${HOST}:${PORT}`);
  } catch (e) {
    res.writeHead(400, CORS_HEADERS);
    return res.end("URL inválida");
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  // ---- GET /proxy?url=... ----
  if (req.method === "GET" && parsedUrl.pathname === "/proxy") {
    const target = parsedUrl.searchParams.get("url");
    if (!target) {
      res.writeHead(400, CORS_HEADERS);
      return res.end("faltou o parâmetro url");
    }
    let targetHost;
    try {
      targetHost = new URL(target).hostname;
    } catch (e) {
      res.writeHead(400, CORS_HEADERS);
      return res.end("url inválida");
    }
    if (!PROXY_ALLOWLIST.includes(targetHost)) {
      log("bloqueado (fora da allowlist):", targetHost);
      res.writeHead(403, CORS_HEADERS);
      return res.end("domínio não permitido");
    }
    log("proxy ->", targetHost);
    fetchUrl(target)
      .then((result) => {
        res.writeHead(result.statusCode || 200, Object.assign({ "Content-Type": result.contentType }, CORS_HEADERS));
        res.end(result.body);
      })
      .catch((err) => {
        log("erro no proxy:", err.message);
        res.writeHead(502, CORS_HEADERS);
        res.end("falha ao buscar: " + err.message);
      });
    return;
  }

  // ---- POST /emails ----
  if (req.method === "POST" && parsedUrl.pathname === "/emails") {
    let body = "";
    let tooBig = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on("end", async () => {
      if (tooBig) return;
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS));
        return res.end(JSON.stringify({ erro: "JSON inválido" }));
      }
      const { host, usuario, senhaApp, quantidade } = payload || {};
      log("pedido de e-mails:", maskEmail(usuario), "via", host, "· senha: ••••••••");

      if (!host || !IMAP_ALLOWLIST.includes(host)) {
        res.writeHead(403, Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS));
        return res.end(JSON.stringify({ erro: "host IMAP não permitido" }));
      }
      if (!usuario || !senhaApp) {
        res.writeHead(400, Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS));
        return res.end(JSON.stringify({ erro: "usuário ou senha de app ausentes" }));
      }
      try {
        const emails = await fetchEmailsForAccount(host, usuario, senhaApp, quantidade || 20);
        res.writeHead(200, Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS));
        res.end(JSON.stringify({ emails }));
      } catch (err) {
        log("erro IMAP:", err.message);
        res.writeHead(502, Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS));
        res.end(
          JSON.stringify({
            erro:
              "Senha de app inválida ou verificação em 2 etapas desativada — refaça em myaccount.google.com/apppasswords"
          })
        );
      }
    });
    return;
  }

  res.writeHead(404, CORS_HEADERS);
  res.end("não encontrado");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`⚠ A porta ${PORT} já está em uso, senhor. Feche o outro programa usando essa porta e tente de novo.`);
    process.exit(1);
  } else {
    console.error("Erro na antena:", err.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`⚡ ANTENA DO OTTO ONLINE — porta ${PORT}. Pode abrir o otto.html.`);
});
