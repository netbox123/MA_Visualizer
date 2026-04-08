<template>
  <div class="app">
    <audio ref="audioEl" muted playsinline style="display:none"></audio>

    <!-- Full-screen visualiser -->
    <Visualiser :analyser="analyser" :type="visType" />

    <!-- Track info overlay (bottom-left) -->
    <Transition name="fade">
      <div v-if="currentItem" class="track-overlay">
        <img v-if="artSrc" :src="artSrc" class="track-art" @error="artSrc = ''" />
        <div class="track-info">
          <div class="track-name">{{ currentItem.name }}</div>
          <div class="track-artist">{{ artists }}</div>
        </div>
      </div>
    </Transition>

    <!-- Sendspin indicator (top-left) -->
    <Transition name="fade">
      <div v-if="sendspinConnected" class="stream-badge">
        <span class="stream-dot"></span> Live
      </div>
    </Transition>

    <!-- 3-dot button (top-right, appears on hover) -->
    <button
      class="menu-btn"
      :class="{ 'menu-btn--show': settingsOpen || menuHover }"
      @mouseenter="menuHover = true"
      @mouseleave="menuHover = false"
      @click="settingsOpen = true"
      title="Settings"
    >
      <svg viewBox="0 0 24 24" fill="currentColor"><path :d="mdiDotsVertical" /></svg>
    </button>

    <!-- Settings overlay -->
    <Settings
      v-if="settingsOpen"
      :players="players"
      :selectedPlayerId="selectedPlayerId"
      :maUrl="maUrl"
      :maToken="maToken"
      :connected="maConnected"
      :authed="maAuthed"
      :maError="maError"
      :sendspinConnected="sendspinConnected"
      :sendspinError="sendspinError"
      :visType="visType"
      @close="settingsOpen = false"
      @select-player="selectPlayer"
      @save-settings="saveSettings"
      @connect-sendspin="connectSendspin"
      @disconnect-sendspin="stopSendspin"
      @set-vis-type="setVisType"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { mdiDotsVertical } from '@mdi/js';
import Visualiser from './components/Visualiser.vue';
import Settings   from './components/Settings.vue';
import { useMusicAssistant }  from './composables/useMusicAssistant.js';
import { startSendspin, stopSendspin, tapSendspinAnalyser, sendspinConnected, sendspinPlaying, sendspinError, sendspinPlayerId } from './composables/useSendspin.js';

// ── Persisted settings ─────────────────────────────────────────────────────────
const MA_DEFAULT_URL   = 'http://192.168.0.20:8095';
const MA_DEFAULT_TOKEN = '';

const maUrl          = ref(localStorage.getItem('vis_ma_url')   || MA_DEFAULT_URL);
const maToken        = ref(localStorage.getItem('vis_ma_token') || MA_DEFAULT_TOKEN);
const selectedPlayerId = ref(localStorage.getItem('vis_player_id') || '');

// ── UI state ───────────────────────────────────────────────────────────────────
const settingsOpen = ref(false);
const menuHover    = ref(false);
const visType      = ref(localStorage.getItem('vis_type') || 'radial');

function setVisType(type) {
  visType.value = type;
  localStorage.setItem('vis_type', type);
}

// ── MA connection ──────────────────────────────────────────────────────────────
let maApi        = null;
const maConnected = ref(false);
const maAuthed    = ref(false);
const maError     = ref('');
const players     = ref([]);
const queues      = ref({});

function connectMA() {
  if (!maUrl.value || !maToken.value) return;
  if (maApi) maApi.disconnect();
  maApi = useMusicAssistant(maUrl.value, maToken.value);
  maApi.connect();
  // Sync reactive state from composable
  watch(maApi.connected, v => { maConnected.value = v; });
  watch(maApi.authed,    v => { maAuthed.value    = v; });
  watch(maApi.error,     v => { maError.value     = v; });
  watch(maApi.players,   v => { players.value     = v; }, { immediate: true });
  watch(maApi.queues,    v => { queues.value       = v; }, { immediate: true });
}

// ── Track info ─────────────────────────────────────────────────────────────────
const currentItem = computed(() => {
  if (!selectedPlayerId.value) return null;
  return queues.value[selectedPlayerId.value]?.current_item ?? null;
});

const artists = computed(() =>
  currentItem.value?.media_item?.artists?.map(a => a.name).join(', ') ?? ''
);

const artSrc = ref('');
watch(currentItem, (item) => {
  const imgObj = item?.metadata?.images?.[0] || item?.album?.metadata?.images?.[0];
  if (imgObj?.path) {
    const base = maUrl.value.replace(/\/$/, '');
    const maArt = `${base}/imageproxy?path=${encodeURIComponent(encodeURIComponent(imgObj.path))}&provider=${encodeURIComponent(imgObj.provider ?? '')}&checksum=&size=256`;
    artSrc.value = `/api/imageproxy?url=${encodeURIComponent(maArt)}`;
  } else {
    artSrc.value = '';
  }
});

// ── Group visualizer player with selected player ────────────────────────────────
// Grouping makes the viz player follow the selected player automatically:
// pause, resume, and track changes all propagate without extra code.
let _grouping = false;
let _groupedVizId = '';

async function groupVizPlayer() {
  if (_grouping) return;
  _grouping = true;
  try {
    if (!sendspinConnected.value || !selectedPlayerId.value || !maApi) return;

    // Wait for the current Sendspin player to appear in MA's player list
    let vizPlayer = null;
    for (let i = 0; i < 20; i++) {
      if (sendspinPlayerId.value) {
        vizPlayer = players.value.find(p => p.player_id === sendspinPlayerId.value);
      } else {
        vizPlayer = players.value.find(p => p.provider === 'sendspin' && p.name === 'MA Visualizer');
      }
      if (vizPlayer) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!vizPlayer || vizPlayer.player_id === selectedPlayerId.value) return;

    await maApi.groupPlayer(vizPlayer.player_id, selectedPlayerId.value);
    await new Promise(r => setTimeout(r, 300));
    maApi.resumePlayer(vizPlayer.player_id).catch(() => {}); // fire-and-forget: MA may not ack
    _groupedVizId = vizPlayer.player_id;
  } catch (e) {
    console.warn('[group] failed:', e.message);
  } finally {
    _grouping = false;
  }
}

// ── Mirror selected player pause/resume to viz player ──────────────────────────
const selectedPlayerState = computed(() =>
  players.value.find(p => p.player_id === selectedPlayerId.value)?.state ?? null
);

watch(selectedPlayerState, async (state, prevState) => {
  if (!_groupedVizId || !maApi) return;
  if ((state === 'paused' || state === 'idle') && prevState === 'playing') {
    maApi.pausePlayer(_groupedVizId).catch(() => {});
  } else if (state === 'playing' && (prevState === 'paused' || prevState === 'idle')) {
    maApi.resumePlayer(_groupedVizId).catch(() => {});
  }
});

watch(sendspinConnected, async (connected) => {
  if (connected) {
    groupVizPlayer();
  } else {
    if (_groupedVizId && maApi) {
      try { await maApi.ungroupPlayer(_groupedVizId); } catch {}
    }
    _groupedVizId = '';
  }
});

// ── Audio / Analyser ───────────────────────────────────────────────────────────
const audioEl  = ref(null);
const analyser = ref(null);

// When Sendspin starts playing, its AudioContext and gainNode are initialized.
// Fan-out an AnalyserNode from gainNode inside Sendspin's own context.
watch(sendspinPlaying, async (playing) => {
  if (playing && !analyser.value) {
    for (let i = 0; i < 10; i++) {
      if (audioEl.value?.srcObject) break;
      await new Promise(r => setTimeout(r, 200));
    }
    const node = tapSendspinAnalyser(audioEl.value);
    if (node) analyser.value = node;
  }
  if (!playing) {
    // Only clear analyser if Sendspin fully disconnects — not on normal pause
    await new Promise(r => setTimeout(r, 1500));
    if (!sendspinPlaying.value && !sendspinConnected.value) analyser.value = null;
  }
});

// ── Actions ────────────────────────────────────────────────────────────────────
function saveSettings({ url, token }) {
  maUrl.value   = url;
  maToken.value = token;
  localStorage.setItem('vis_ma_url',   url);
  localStorage.setItem('vis_ma_token', token);
  connectMA();
}

function selectPlayer(id) {
  selectedPlayerId.value = id;
  localStorage.setItem('vis_player_id', id);
}

async function connectSendspin() {
  analyser.value = null;
  await startSendspin(maUrl.value, maToken.value, audioEl.value);
  if (sendspinConnected.value) settingsOpen.value = false;
}

onMounted(() => {
  // Persist defaults so settings panel shows them on first open
  if (!localStorage.getItem('vis_ma_url'))   localStorage.setItem('vis_ma_url',   maUrl.value);
  if (!localStorage.getItem('vis_ma_token')) localStorage.setItem('vis_ma_token', maToken.value);
  connectMA();
});
</script>

<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app {
  width: 100vw; height: 100vh;
  overflow: hidden;
  background: #000;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
}
</style>

<style scoped>
.app {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* ── 3-dot menu button ─────────────────────────────────────────────────────── */
.menu-btn {
  position: fixed;
  top: 1rem;
  right: 1rem;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  opacity: 1;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}
.menu-btn:hover,
.menu-btn--show {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(255, 255, 255, 0.3);
}
.menu-btn svg { width: 18px; height: 18px; }

/* ── Stream badge ──────────────────────────────────────────────────────────── */
.stream-badge {
  position: fixed;
  top: 1rem;
  left: 1rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(74, 222, 128, 0.8);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  z-index: 100;
  pointer-events: none;
}
.stream-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #4ade80;
  animation: pulse 1.5s infinite;
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

/* ── Track overlay ─────────────────────────────────────────────────────────── */
.track-overlay {
  position: fixed;
  bottom: 1.75rem;
  left: 1.75rem;
  display: flex;
  align-items: center;
  gap: 0.85rem;
  z-index: 50;
  pointer-events: none;
}
.track-art {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  object-fit: cover;
  opacity: 0.88;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
}
.track-info { display: flex; flex-direction: column; gap: 0.2rem; }
.track-name {
  font-size: 0.92rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.9);
}
.track-artist {
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.55);
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.9);
}

/* ── Transitions ───────────────────────────────────────────────────────────── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.6s ease; }
.fade-enter-from,   .fade-leave-to     { opacity: 0; }
</style>
