#!/usr/bin/env bun
/**
 * OpenCode Zen v2 BoringSSL TLS Transport Sidecar (zen-bun-sidecar.mjs)
 *
 * Provides 100% authentic Bun / BoringSSL TLS ClientHello fingerprint parity
 * (17 cipher suites and 12 TLS extensions in exact CLI order) for OpenCode Zen
 * free-tier requests when the main gateway runs under Node.js.
 */

const port = Number(process.env.ZEN_BUN_PORT || 0);

// Monitor parent process liveness or stdin closure to prevent orphan sidecar processes
if (process.stdin) {
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/__zen_sidecar_health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          runtime: 'bun',
          version: typeof Bun !== 'undefined' ? Bun.version : 'unknown'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    const targetUrl = req.headers.get('x-zen-target-url');
    if (!targetUrl) {
      return new Response(
        JSON.stringify({ error: { message: 'Missing x-zen-target-url header', type: 'sidecar_error' } }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    const proxyUrl = req.headers.get('x-zen-proxy-url') || '';
    const outHeaders = new Headers();
    req.headers.forEach((val, key) => {
      const k = key.toLowerCase();
      if (
        k === 'host' ||
        k === 'connection' ||
        k === 'content-length' ||
        k === 'x-zen-target-url' ||
        k === 'x-zen-proxy-url'
      ) {
        return;
      }
      outHeaders.set(key, val);
    });

    if (!outHeaders.has('accept-encoding')) {
      outHeaders.set('accept-encoding', 'gzip, deflate, br, zstd');
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const bodyBuf = hasBody ? await req.arrayBuffer() : undefined;

    const fetchOpts = {
      method: req.method,
      headers: outHeaders,
      body: bodyBuf,
      redirect: 'manual',
      signal: req.signal
    };
    if (proxyUrl && proxyUrl.trim()) {
      const trimmedProxy = proxyUrl.trim();
      fetchOpts.proxy = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmedProxy) ? trimmedProxy : `http://${trimmedProxy}`;
    }

    try {
      const upstreamRes = await fetch(targetUrl, fetchOpts);
      const respHeaders = new Headers();
      upstreamRes.headers.forEach((val, key) => {
        const k = key.toLowerCase();
        // Bun fetch transparently decompresses response streams; strip encoding/length headers
        if (k === 'content-encoding' || k === 'content-length' || k === 'transfer-encoding' || k === 'connection') {
          return;
        }
        respHeaders.set(key, val);
      });

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: respHeaders
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: {
            message: `Zen Bun TLS Sidecar upstream fetch failed: ${err && err.message ? err.message : String(err)}`,
            type: 'upstream_connection_error'
          }
        }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }
  }
});

process.stdout.write(`ZEN_BUN_SIDECAR_PORT=${server.port}\n`);
