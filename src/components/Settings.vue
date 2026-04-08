<template>
  <div class="settings-backdrop" @click.self="$emit('close')">
    <div class="settings-panel">

      <div class="settings-header">
        <span class="settings-title">Settings</span>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>

      <div class="settings-tabs">
        <button :class="['tab-btn', { active: tab === 'players' }]" @click="tab = 'players'">Players</button>
        <button :class="['tab-btn', { active: tab === 'visualizers' }]" @click="tab = 'visualizers'">Visualizers</button>
        <button :class="['tab-btn', { active: tab === 'connection' }]" @click="tab = 'connection'">Connection</button>
      </div>

      <!-- ── Players tab ──────────────────────────────────────────────────── -->
      <div v-if="tab === 'players'" class="tab-content">
        <div v-if="!authed" class="tab-hint">
          {{ connected ? 'Authenticating…' : 'Connect to MA first (Connection tab)' }}
        </div>
        <template v-else>
          <div v-if="!visiblePlayers.length" class="tab-hint">No players found</div>
          <div v-else class="player-list">
            <button
              v-for="p in visiblePlayers"
              :key="p.player_id"
              :class="['player-item', { 'player-item--active': selectedPlayerId === p.player_id }]"
              @click="$emit('select-player', p.player_id)"
            >
              <span class="player-dot" :class="dotClass(p)"></span>
              <div class="player-info">
                <span class="player-name">{{ p.display_name || p.name }}</span>
                <span class="player-state">{{ p.state }}</span>
              </div>
              <svg v-if="selectedPlayerId === p.player_id" viewBox="0 0 24 24" fill="currentColor" class="check-icon"><path :d="mdiCheck" /></svg>
            </button>
          </div>

          <div class="divider"></div>

          <div class="sendspin-section">
            <div class="sendspin-row">
              <span class="section-label">Audio stream</span>
              <span :class="['status-pill', sendspinConnected ? 'pill--on' : 'pill--off']">
                {{ sendspinConnected ? 'Connected' : 'Disconnected' }}
              </span>
            </div>
            <p v-if="sendspinError" class="sendspin-error">{{ sendspinError }}</p>
            <p class="sendspin-hint">Sendspin streams audio directly to this browser for visualisation. Make sure MA is playing to the "MA Visualizer" player.</p>
            <div class="sendspin-actions">
              <button v-if="!sendspinConnected" class="action-btn action-btn--primary" @click="$emit('connect-sendspin')">
                Connect Sendspin
              </button>
              <button v-else class="action-btn action-btn--danger" @click="$emit('disconnect-sendspin')">
                Disconnect
              </button>
            </div>
          </div>
        </template>
      </div>

      <!-- ── Visualizers tab ─────────────────────────────────────────────── -->
      <div v-if="tab === 'visualizers'" class="tab-content">
        <div class="vis-grid">
          <button
            v-for="v in visTypes"
            :key="v.id"
            :class="['vis-card', { 'vis-card--active': props.visType === v.id }]"
            @click="$emit('set-vis-type', v.id)"
          >
            <span class="vis-card-name">{{ v.name }}</span>
            <span class="vis-card-desc">{{ v.desc }}</span>
            <svg v-if="props.visType === v.id" viewBox="0 0 24 24" fill="currentColor" class="check-icon"><path :d="mdiCheck" /></svg>
          </button>
        </div>
      </div>

      <!-- ── Connection tab ──────────────────────────────────────────────── -->
      <div v-if="tab === 'connection'" class="tab-content">
        <div class="field">
          <label class="field-label">MA Server URL</label>
          <input v-model="urlInput" type="text" placeholder="http://192.168.1.x:8095" class="field-input" @keyup.enter="save" />
        </div>
        <div class="field">
          <label class="field-label">API Token</label>
          <input v-model="tokenInput" type="password" placeholder="Your MA API token" class="field-input" @keyup.enter="save" />
        </div>
        <div class="field-row">
          <span v-if="connected && authed" class="conn-status conn-ok">● Connected</span>
          <span v-else-if="connected"      class="conn-status conn-wait">● Authenticating…</span>
          <span v-else-if="maError"        class="conn-status conn-err">● {{ maError }}</span>
          <button class="action-btn action-btn--primary" @click="save">Save & Connect</button>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { mdiCheck } from '@mdi/js';

const props = defineProps({
  players:           { type: Array,   default: () => [] },
  selectedPlayerId:  { type: String,  default: '' },
  maUrl:             { type: String,  default: '' },
  maToken:           { type: String,  default: '' },
  connected:         { type: Boolean, default: false },
  authed:            { type: Boolean, default: false },
  maError:           { type: String,  default: '' },
  sendspinConnected: { type: Boolean, default: false },
  sendspinError:     { type: String,  default: '' },
  visType:           { type: String,  default: 'radial' },
});

const emit = defineEmits(['close', 'select-player', 'save-settings', 'connect-sendspin', 'disconnect-sendspin', 'set-vis-type']);

const visTypes = [
  { id: 'radial',       name: 'Radial',       desc: 'Circular frequency bars with beat particles' },
  { id: 'itunes',       name: 'iTunes',        desc: 'Flowing kaleidoscope tendrils' },
  { id: 'spectrum',     name: 'Spectrum',      desc: 'Classic horizontal frequency bars' },
  { id: 'oscilloscope', name: 'Oscilloscope',  desc: 'Multi-layer waveform on a grid' },
  { id: 'nebula',       name: 'Nebula',        desc: 'Glowing particle cloud' },
];

const tab        = ref(props.maUrl ? 'players' : 'connection');
const urlInput   = ref(props.maUrl);
const tokenInput = ref(props.maToken);

const visiblePlayers = computed(() => {
  const order = { playing: 0, paused: 1 };
  return props.players
    .filter(p => p.enabled !== false && p.name !== 'MA Visualizer' && (p.state === 'playing' || p.state === 'paused' || p.player_id === props.selectedPlayerId))
    .sort((a, b) => (order[a.state] ?? 2) - (order[b.state] ?? 2));
});

function save() {
  emit('save-settings', { url: urlInput.value.trim(), token: tokenInput.value.trim() });
  if (urlInput.value && tokenInput.value) tab.value = 'players';
}

function dotClass(p) {
  if (p.state === 'playing') return 'dot--playing';
  if (p.state === 'paused')  return 'dot--paused';
  return 'dot--idle';
}
</script>

<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  backdrop-filter: blur(6px);
}

.settings-panel {
  background: #0d1117;
  border: 1px solid #2a3150;
  border-radius: 12px;
  width: 420px;
  max-width: 95vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.8);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem 0.75rem;
  border-bottom: 1px solid #2a3150;
  flex-shrink: 0;
}

.settings-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #e2e8f0;
  letter-spacing: 0.02em;
}

.close-btn {
  background: none;
  border: none;
  color: #6b7280;
  font-size: 1rem;
  cursor: pointer;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  line-height: 1;
  transition: color 0.15s;
}
.close-btn:hover { color: #e2e8f0; }

.settings-tabs {
  display: flex;
  padding: 0.5rem 1rem 0;
  gap: 0.25rem;
  flex-shrink: 0;
}

.tab-btn {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #6b7280;
  font-size: 0.82rem;
  font-weight: 500;
  padding: 0.4rem 0.75rem;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  font-family: inherit;
}
.tab-btn:hover { color: #9aa3bc; }
.tab-btn.active { color: #60a5fa; border-bottom-color: #60a5fa; }

.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.25rem 1.25rem;
}

.tab-hint {
  color: #4b5563;
  font-size: 0.82rem;
  text-align: center;
  padding: 2rem 0;
}

/* Player list */
.player-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.player-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.6rem 0.75rem;
  background: none;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  color: #9aa3bc;
  font-family: inherit;
  transition: background 0.15s, border-color 0.15s;
  text-align: left;
}
.player-item:hover { background: #1a2035; border-color: #2a3150; }
.player-item--active { background: #1a2a4a; border-color: #3b5280; color: #e2e8f0; }

.player-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #374151;
}
.dot--playing { background: #4ade80; box-shadow: 0 0 6px #4ade80aa; animation: blink 1.5s infinite; }
.dot--paused  { background: #f59e0b; }
.dot--idle    { background: #374151; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

.player-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.player-name  { font-size: 0.85rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.player-state { font-size: 0.72rem; color: #4b5563; text-transform: capitalize; }

.check-icon { width: 15px; height: 15px; color: #60a5fa; flex-shrink: 0; }

.divider {
  margin: 1rem 0;
  border-top: 1px solid #2a3150;
}

/* Sendspin section */
.sendspin-section { display: flex; flex-direction: column; gap: 0.6rem; }

.sendspin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: #9aa3bc;
}

.status-pill {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.pill--on  { background: #052e16; color: #4ade80; }
.pill--off { background: #1f2937; color: #6b7280; }

.sendspin-error {
  font-size: 0.76rem;
  color: #f87171;
}

.sendspin-hint {
  font-size: 0.74rem;
  color: #4b5563;
  line-height: 1.5;
}

.sendspin-actions { display: flex; gap: 0.5rem; }

/* Connection tab */
.field { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 1rem; }

.field-label {
  font-size: 0.78rem;
  font-weight: 500;
  color: #9aa3bc;
}

.field-input {
  background: #080d14;
  border: 1px solid #2a3150;
  border-radius: 6px;
  color: #e2e8f0;
  font-size: 0.82rem;
  padding: 0.5rem 0.75rem;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.field-input:focus { border-color: #60a5fa; }
.field-input::placeholder { color: #374151; }

.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.conn-status { font-size: 0.76rem; }
.conn-ok   { color: #4ade80; }
.conn-wait { color: #f59e0b; }
.conn-err  { color: #f87171; }

/* Buttons */
.action-btn {
  background: none;
  border: 1px solid #2a3150;
  border-radius: 6px;
  color: #9aa3bc;
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.45rem 1rem;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.action-btn:hover { background: #1a2035; color: #e2e8f0; }
.action-btn--primary { background: #1a3a6a; border-color: #3b5280; color: #93c5fd; }
.action-btn--primary:hover { background: #1e4080; }
.action-btn--danger { border-color: #4a1515; color: #f87171; }
.action-btn--danger:hover { background: #2a1010; }

/* Visualizer picker */
.vis-grid {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.vis-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.65rem 0.75rem;
  background: none;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  color: #9aa3bc;
  font-family: inherit;
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
}
.vis-card:hover { background: #1a2035; border-color: #2a3150; }
.vis-card--active { background: #1a2a4a; border-color: #3b5280; color: #e2e8f0; }
.vis-card-name { font-size: 0.85rem; font-weight: 500; min-width: 80px; }
.vis-card-desc { font-size: 0.74rem; color: #4b5563; flex: 1; }
.vis-card--active .vis-card-desc { color: #6b7280; }
</style>
