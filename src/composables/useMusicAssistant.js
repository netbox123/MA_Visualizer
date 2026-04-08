import { ref, shallowRef, readonly } from 'vue';

const instances = new Map();

export function useMusicAssistant(maUrl, maToken) {
  const key = `${maUrl}||${maToken}`;
  if (instances.has(key)) return instances.get(key);

  const connected = ref(false);
  const authed    = ref(false);
  const players   = ref([]);
  const queues    = shallowRef({});
  const error     = ref('');

  let ws             = null;
  let msgId          = 1;
  const pending      = new Map();
  let reconnectTimer = null;
  let pollTimer      = null;

  function send(command, args = {}) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error('Not connected')); return; }
      const id = String(msgId++);
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ message_id: id, command, args }));
    });
  }

  async function fetchAll() {
    const [ps, qs] = await Promise.all([
      send('players/all'),
      send('player_queues/all'),
    ]);
    if (ps) players.value = ps;
    if (qs) {
      const qmap = {};
      for (const q of qs) qmap[q.queue_id] = q;
      queues.value = qmap;
    }
  }

  async function init() {
    try {
      await fetchAll();
      clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        try { await fetchAll(); } catch { /* ignore */ }
      }, 5000);
    } catch (e) {
      error.value = `Init failed: ${e.message}`;
    }
  }

  function handleEvent(event) {
    const { data } = event;
    switch (event.event) {
      case 'player_updated':
      case 'player_added': {
        const idx = players.value.findIndex(p => p.player_id === data.player_id);
        if (idx >= 0) { const u = [...players.value]; u[idx] = data; players.value = u; }
        else players.value = [...players.value, data];
        break;
      }
      case 'player_removed':
        players.value = players.value.filter(p => p.player_id !== data);
        break;
      case 'queue_updated':
      case 'queue_added':
        queues.value = { ...queues.value, [data.queue_id]: data };
        break;
      case 'queue_time_updated': {
        const q = queues.value[data.queue_id];
        if (q) queues.value = { ...queues.value, [data.queue_id]: { ...q, elapsed_time: data.elapsed_time } };
        break;
      }
    }
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (ws) { try { ws.close(); } catch {} }
    if (!maUrl || !maToken) return;

    const wsUrl = maUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => { connected.value = true; error.value = ''; };

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      if ('server_id' in msg) {
        try {
          await send('auth', { token: maToken });
          authed.value = true;
          await init();
        } catch (err) {
          error.value = `Auth failed: ${err.message}`;
        }
        return;
      }
      if ('event' in msg) { handleEvent(msg); return; }
      if ('message_id' in msg && pending.has(msg.message_id)) {
        const { resolve, reject } = pending.get(msg.message_id);
        pending.delete(msg.message_id);
        if ('error_code' in msg) reject(new Error(msg.details ?? 'Command failed'));
        else resolve(msg.result);
      }
    };

    ws.onclose = () => {
      connected.value = false;
      authed.value = false;
      clearInterval(pollTimer);
      reconnectTimer = setTimeout(connect, 5000);
    };

    ws.onerror = () => { error.value = 'WebSocket error'; };
  }

  function disconnect() {
    clearTimeout(reconnectTimer);
    clearInterval(pollTimer);
    if (ws) { try { ws.close(); } catch {} ws = null; }
    connected.value = false;
    authed.value    = false;
    instances.delete(key);
  }

  async function playMedia(queueId, mediaUri) {
    await send('player_queues/play_media', { queue_id: queueId, media: mediaUri, option: 'play' });
  }

  async function pausePlayer(playerId) {
    await send('players/cmd/pause', { player_id: playerId });
  }

  async function resumePlayer(playerId) {
    await send('players/cmd/play', { player_id: playerId });
  }

  async function groupPlayer(playerId, targetPlayerId) {
    await send('players/cmd/group', { player_id: playerId, target_player: targetPlayerId });
  }

  async function ungroupPlayer(playerId) {
    await send('players/cmd/ungroup', { player_id: playerId });
  }

  const api = {
    connected: readonly(connected),
    authed:    readonly(authed),
    players:   readonly(players),
    queues:    readonly(queues),
    error:     readonly(error),
    connect,
    disconnect,
    playMedia,
    pausePlayer,
    resumePlayer,
    groupPlayer,
    ungroupPlayer,
  };

  instances.set(key, api);
  return api;
}
