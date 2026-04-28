import 'dotenv/config';
import http from 'http';
import https from 'https';
import net from 'net';
import { URL } from 'url';

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  const targetUrl = req.headers['x-target-url'];

  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Wrong request');
    console.error('Missing X-Target-URL header');
    return;
  }

  const apikey = req.headers['x-api-key'];

  if (!apikey) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Wrong request');
    console.error('Missing X-API-Key');
    return;
  }

  const key = apikey.trim();

  if (!key.startsWith('ta_prod_') && !key.startsWith('mq_prod_')) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Wrong request');
    console.error('Invalid X-API-Key!!!');
    return;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Wrong request');
    console.error('Invalid X-Target-URL');
    return;
  }

  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;
  const defaultPort = isHttps ? 443 : 80;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || defaultPort,
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: parsed.host,
    },
  };

  delete options.headers['x-target-url'];

  //console.log(options.headers);

  const proxyReq = transport.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy request error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end(`Error: ${err.message}`);
  });

  req.pipe(proxyReq);
});

// HTTPS CONNECT 터널링 처리
server.on('connect', (req, clientSocket, head) => {
  const apikey = req.headers['x-api-key'];

  if (!apikey) {
    clientSocket.write('HTTP/1.1 407 Authentication Required\r\n\r\n');
    clientSocket.destroy();
    console.error('CONNECT rejected: missing X-API-Key');
    return;
  }

  const key = apikey.trim();

  if (!key.startsWith('ta_prod_') && !key.startsWith('mq_prod_')) {
    clientSocket.write('HTTP/1.1 407 Authentication Required\r\n\r\n');
    clientSocket.destroy();
    console.error('CONNECT rejected: invalid X-API-Key!!!');
    return;
  }

  const [hostname, portStr] = req.url.split(':');
  const port = parseInt(portStr, 10) || 443;

  console.log(`CONNECT tunnel: ${hostname}:${port}`);

  const serverSocket = net.connect(port, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length > 0) {
      serverSocket.write(head);
    }
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    console.error(`CONNECT tunnel error (${hostname}:${port}):`, err.message);
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.destroy();
  });

  clientSocket.on('error', (err) => {
    console.error('Client socket error:', err.message);
    serverSocket.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`Teams App proxy running on http://localhost:${PORT}`);
  console.log('Usage: set X-Target-URL header to the destination URL');
});
