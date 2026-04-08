import { ref, watch } from 'vue';
import { SendspinPlayer } from '@sendspin/sendspin-js';

let player        = null;
let pendingBridge = null;
let OriginalWS    = null;

export const sendspinConnected = ref(false);
export const sendspinPlaying   = ref(false);
export const sendspinError     = ref('');
export const sendspinPlayerId  = ref('');

function getClientId() {
  const KEY = 'sendspin_visualizer_id';
  return localStorage.getItem(KEY) ?? (() => {
    const id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem(KEY, id);
    return id;
  })();
}

function buildSessionUrl(maUrl) {
  try {
    const u = new URL(maUrl);
    const maWs = `ws://${u.host}/sendspin`;
    return `ws://${window.location.host}/sendspin?url=${encodeURIComponent(maWs)}`;
  } catch {
    const maWs = maUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/sendspin';
    return `ws://${window.location.host}/sendspin?url=${encodeURIComponent(maWs)}`;
  }
}

function prepareSession(maUrl, maToken) {
  return new Promise((resolve, reject) => {
    const url = buildSessionUrl(maUrl);
    let ws;
    try { ws = new (OriginalWS || window.WebSocket)(url); }
    catch (e) { reject(e); return; }

    ws.binaryType = 'arraybuffer';
    let ready = false;

    ws.onopen    = () => ws.send(JSON.stringify({ type: 'auth', token: maToken, client_id: getClientId() }));
    ws.onmessage = () => { if (!ready) { ready = true; resolve(ws); } };
    ws.onerror   = () => { if (!ready) reject(new Error('Cannot reach MA')); };
    ws.onclose   = (e) => {
      if (!ready) {
        if (e.code === 4001) reject(new Error('MA rejected token — check settings'));
        else reject(new Error(`WS closed (${e.code})`));
      }
    };
    setTimeout(() => { if (!ready) { ws.close(); reject(new Error('Auth timed out')); } }, 10000);
  });
}

function makeBridge(ws) {
  const bridge = {
    _isOpen: ws.readyState === 1,
    onopen: null, onmessage: null, onerror: null, onclose: null,
    CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
    get readyState() { return ws.readyState; },
    send(data)  { if (ws.readyState === 1) ws.send(data); },
    close(c, r) { ws.close(c, r); },
    addEventListener(t, fn) {
      if (t === 'open' && typeof fn === 'function') {
        bridge.onopen = fn;
        if (bridge._isOpen) setTimeout(() => fn(new Event('open')), 0);
      } else if (t === 'message' && typeof fn === 'function') bridge.onmessage = fn;
      else if (t === 'error'    && typeof fn === 'function') bridge.onerror   = fn;
      else if (t === 'close'    && typeof fn === 'function') bridge.onclose   = fn;
    },
    removeEventListener() {},
    dispatchEvent()       { return false; },
  };
  ws.onopen    = (e) => { bridge._isOpen = true; bridge.onopen?.(e); };
  ws.onmessage = (e) => { bridge.onmessage?.(e); };
  ws.onerror   = (e) => { bridge.onerror?.(e); };
  ws.onclose   = (e) => { bridge.onclose?.(e); };
  return bridge;
}

function installInterceptor() {
  if (OriginalWS) return;
  OriginalWS = window.WebSocket;

  function Intercepted(url) {
    if (String(url).includes('/sendspin') && pendingBridge) {
      const b = pendingBridge;
      pendingBridge = null;
      const proxy = {
        binaryType: 'arraybuffer', bufferedAmount: 0, extensions: '', protocol: '', url: '',
        CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
        get readyState() { return b.readyState; },
        send(data)  { b.send(data); },
        close(c, r) { b.close(c, r); },
        addEventListener:    (...a) => b.addEventListener(...a),
        removeEventListener: ()     => {},
        dispatchEvent:       ()     => false,
      };
      for (const ev of ['onopen', 'onmessage', 'onerror', 'onclose']) {
        Object.defineProperty(proxy, ev, {
          get: ()   => b[ev],
          set: (fn) => {
            b[ev] = fn;
            if (ev === 'onopen' && fn && b._isOpen) setTimeout(() => fn(new Event('open')), 0);
          },
          configurable: true,
        });
      }
      return proxy;
    }
    return new OriginalWS(url);
  }
  Intercepted.CONNECTING = 0; Intercepted.OPEN = 1; Intercepted.CLOSING = 2; Intercepted.CLOSED = 3;
  window.WebSocket = Intercepted;
}

function uninstallInterceptor() {
  if (OriginalWS) { window.WebSocket = OriginalWS; OriginalWS = null; }
}

let _lastUrl = '', _lastToken = '', _lastAudioEl = null;
let _reconnectTimer = null, _userStopped = false, _starting = false;

export async function startSendspin(maUrl, maToken, audioElement = null) {
  _userStopped  = false;
  _starting     = true;
  stopSendspin();
  _lastUrl      = maUrl;
  _lastToken    = maToken;
  _lastAudioEl  = audioElement;
  sendspinError.value     = '';
  sendspinConnected.value = false;

  installInterceptor();

  let ws;
  try {
    ws = await prepareSession(maUrl, maToken);
  } catch (e) {
    sendspinError.value = `Auth failed: ${e.message}`;
    uninstallInterceptor();
    _starting = false;
    return;
  }

  pendingBridge = makeBridge(ws);

  try {
    player = new SendspinPlayer({
      baseUrl:        'http://sendspin.local',
      clientName:     'MA Visualizer',
      correctionMode: 'quality-local',
      ...(audioElement ? { audioElement } : {}),
      onStateChange(state) {
        sendspinConnected.value = player?.isConnected ?? false;
        sendspinPlaying.value   = state.isPlaying;
      },
    });
    await player.connect();
    sendspinConnected.value = true;
    sendspinPlayerId.value  = player.playerId ?? player.id ?? player._playerId ?? '';
    sendspinError.value     = '';
  } catch (e) {
    sendspinError.value     = `Sendspin error: ${e?.message || String(e)}`;
    sendspinConnected.value = false;
  }

  _starting = false;
}

// Tap an AnalyserNode into Sendspin's audio graph (fan-out from gainNode).
// Call after sendspinPlaying becomes true — gainNode is only created when streaming starts.
let _tapCtx = null;

export function tapSendspinAnalyser(audioEl, fftSize = 2048, smoothing = 0.82) {
  // Close any previous tap context
  if (_tapCtx) { try { _tapCtx.close(); } catch {} _tapCtx = null; }

  // Primary: capture the MediaStream that Sendspin feeds into the audio element
  if (audioEl?.srcObject instanceof MediaStream) {
    try {
      const ctx = new AudioContext();
      _tapCtx = ctx;
      const source   = ctx.createMediaStreamSource(audioEl.srcObject);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = smoothing;
      // Silent sink so the graph processes without double-playback
      const silent = ctx.createGain();
      silent.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silent);
      silent.connect(ctx.destination);
      return analyser;
    } catch (e) {
      console.warn('[tap] MediaStream path failed:', e);
      _tapCtx = null;
    }
  }

  // Fallback: tap gainNode directly inside Sendspin's AudioContext
  const ap = player?.audioProcessor;
  if (!ap?.gainNode || !ap?.audioContext) return null;
  const analyser = ap.audioContext.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = smoothing;
  ap.gainNode.connect(analyser);
  analyser.connect(ap.audioContext.destination);
  return analyser;
}

export function stopSendspin() {
  _userStopped = true;
  clearTimeout(_reconnectTimer);
  if (player) { try { player.disconnect('user_request'); } catch {} player = null; }
  sendspinPlayerId.value = '';
  pendingBridge = null;
  uninstallInterceptor();
  sendspinConnected.value = false;
  sendspinPlaying.value   = false;
}

watch(sendspinConnected, (connected) => {
  if (connected || _starting || _userStopped || !_lastUrl) return;
  clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => reconnect(1), 3000);
});

async function reconnect(attempt = 1) {
  if (!_lastUrl || _userStopped || sendspinConnected.value) return;
  sendspinError.value = `Reconnecting… (attempt ${attempt})`;
  await startSendspin(_lastUrl, _lastToken, _lastAudioEl);
  if (!sendspinConnected.value && attempt < 5) {
    _reconnectTimer = setTimeout(() => reconnect(attempt + 1), attempt * 3000);
  }
}

window.addEventListener('online', () => {
  if (!_lastUrl || _userStopped || sendspinConnected.value) return;
  clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => reconnect(1), 2000);
});
