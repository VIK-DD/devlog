const gateway = 'wss://gateway.discord.gg/?v=10&encoding=json';
const fatalCloseCodes = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const activity = { name: 'GitHub commits', type: 3 };

function resumeGateway(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'wss:' && url.hostname.endsWith('.discord.gg') && !url.username && !url.password) {
      url.search = '?v=10&encoding=json';
      return url.href;
    }
  } catch {
    return undefined;
  }
}

export function startDiscordPresence(token) {
  let socket;
  let session;
  let sequence = null;
  let failures = 0;
  let retryTimer;
  let stopped = false;

  function connect() {
    const ws = new WebSocket(session?.url ?? gateway);
    socket = ws;
    let heartbeatTimer;
    let acknowledged = true;
    const readyTimer = setTimeout(() => ws.close(4000, 'Gateway handshake timed out'), 20_000);

    function send(op, d) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d }));
    }

    function heartbeat() {
      acknowledged = false;
      send(1, sequence);
    }

    ws.addEventListener('message', ({ data }) => {
      let packet;
      try {
        packet = JSON.parse(data);
      } catch {
        return;
      }
      if (!packet || typeof packet.op !== 'number') return;
      if (Number.isSafeInteger(packet.s)) sequence = packet.s;

      switch (packet.op) {
        case 10: {
          const interval = packet.d?.heartbeat_interval;
          if (!Number.isFinite(interval) || interval <= 0) {
            ws.close(4000, 'Invalid heartbeat interval');
            break;
          }
          function tick() {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (!acknowledged) {
              ws.close(4000, 'Heartbeat not acknowledged');
              return;
            }
            heartbeat();
            heartbeatTimer = setTimeout(tick, interval);
          }
          heartbeatTimer = setTimeout(tick, Math.random() * interval);
          if (session) {
            send(6, { token, session_id: session.id, seq: sequence });
          } else {
            send(2, {
              token,
              intents: 0,
              properties: { os: process.platform, browser: 'Devlog', device: 'Devlog' },
              presence: { since: null, activities: [activity], status: 'online', afk: false },
            });
          }
          break;
        }
        case 0:
          if (packet.t === 'READY' || packet.t === 'RESUMED') {
            if (packet.t === 'READY') {
              const url = resumeGateway(packet.d.resume_gateway_url);
              session = url ? { id: packet.d.session_id, url } : undefined;
            }
            clearTimeout(readyTimer);
            failures = 0;
            console.log('Discord Gateway ready: Watching GitHub commits');
          }
          break;
        case 1:
          heartbeat();
          break;
        case 11:
          acknowledged = true;
          break;
        case 9:
          if (packet.d !== true) {
            session = undefined;
            sequence = null;
          }
          ws.close(4000, 'Invalid session');
          break;
        case 7:
          ws.close(4000, 'Reconnect requested');
          break;
      }
    });

    ws.addEventListener('close', ({ code }) => {
      clearTimeout(heartbeatTimer);
      clearTimeout(readyTimer);
      socket = undefined;
      if (stopped) return;
      if (fatalCloseCodes.has(code)) {
        console.error('Discord Gateway disconnected permanently:', code);
        return;
      }
      if ([1000, 1001, 4007, 4009].includes(code)) {
        session = undefined;
        sequence = null;
      }
      const delay = Math.min(60_000, 5000 * 2 ** failures++) + Math.random() * 1000;
      retryTimer = setTimeout(connect, delay);
    });
  }

  connect();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Service stopped');
  };
}
