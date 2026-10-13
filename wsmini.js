'use strict';
// Minimal dependency-free RFC 6455 WebSocket server (text frames, ping/pong, close).
const crypto = require('crypto');
const { EventEmitter } = require('events');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket extends EventEmitter {
  constructor(sock, maxPayload) {
    super();
    this.sock = sock; this.maxPayload = maxPayload; this.readyState = 1;
    this.buf = Buffer.alloc(0); this.frags = [];
    sock.on('data', d => this._data(d));
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }
  _closed() { if (this.closedEmitted) return; this.closedEmitted = true; this.readyState = 3; this.emit('close'); }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (!masked || len > this.maxPayload) return this.terminate();
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 8) { this._frame(8, data); return this.terminate(); }
      if (op === 9) { this._frame(10, data); continue; }
      if (op === 10) { this.emit('pong'); continue; }
      if (op === 0 || op === 1) {
        this.frags.push(data);
        if (this.frags.reduce((n, f) => n + f.length, 0) > this.maxPayload) return this.terminate();
        if (fin) { const msg = Buffer.concat(this.frags).toString('utf8'); this.frags = []; this.emit('message', msg); }
      }
    }
  }
  _frame(op, payload) {
    if (this.readyState !== 1 && op !== 8) return;
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n])
      : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255])
      : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
    this.sock.write(Buffer.concat([head, payload]));
  }
  send(str) { this._frame(1, Buffer.from(str, 'utf8')); }
  ping() { this._frame(9, Buffer.alloc(0)); }
  terminate() { this.sock.destroy(); this._closed(); }
}

class WebSocketServer extends EventEmitter {
  constructor({ server, maxPayload = 1024 }) {
    super();
    this.clients = new Set();
    server.on('upgrade', (req, sock) => {
      const key = req.headers['sec-websocket-key'];
      if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
      const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
      sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      sock.setNoDelay(true);
      const ws = new Socket(sock, maxPayload);
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      this.emit('connection', ws);
    });
  }
}
module.exports = { WebSocketServer };
