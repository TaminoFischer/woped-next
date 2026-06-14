<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePetriNetStore } from '@/stores/petriNet'
import { useConfigStore } from '@/stores/config'
import { OperatorType, OPERATOR_INFO } from '@/types/petri-net'
import FileMenu from '@/components/file/FileMenu.vue'
import SettingsDialog from '@/components/settings/SettingsDialog.vue'
import { useHelpStore } from '@/stores/help'

const { t } = useI18n()
const store = usePetriNetStore()
const configStore = useConfigStore()
const helpStore = useHelpStore()
const { tool, canUndo, canRedo, viewport, selectedOperatorType } = storeToRefs(store)

const DISCORD_INVITE_URL = 'https://discord.gg/7v9EA9dRK'

// Settings dialog state
const showSettings = ref(false)

// Operator dropdown state
const showOperatorMenu = ref(false)

// Tool definitions
const tools = computed(() => [
  { id: 'select', label: t('toolbar.select'), shortcut: 'V', icon: '↖' },
  { id: 'place', label: t('toolbar.place'), shortcut: 'P', icon: '○' },
  { id: 'transition', label: t('toolbar.transition'), shortcut: 'T', icon: '□' },
  { id: 'operator', label: t('operators.title'), shortcut: 'O', icon: '◇', hasDropdown: true },
  { id: 'subprocess', label: t('subprocess.title'), shortcut: 'S', icon: '⊞' },
  { id: 'arc', label: t('toolbar.arc'), shortcut: 'A', icon: '→' },
  { id: 'delete', label: t('toolbar.delete'), shortcut: 'D', icon: '✕' },
])

// Operator types for dropdown
const operatorTypes = computed(() => [
  { type: OperatorType.AND_SPLIT, label: t('operators.andSplit'), icon: '◇→' },
  { type: OperatorType.AND_JOIN, label: t('operators.andJoin'), icon: '→◇' },
  { type: OperatorType.XOR_SPLIT, label: t('operators.xorSplit'), icon: '⊗→' },
  { type: OperatorType.XOR_JOIN, label: t('operators.xorJoin'), icon: '→⊗' },
  { type: OperatorType.AND_SPLIT_JOIN, label: 'AND-Split-Join', icon: '◇◇' },
  { type: OperatorType.XOR_SPLIT_JOIN, label: 'XOR-Split-Join', icon: '⊗⊗' },
  { type: OperatorType.AND_JOIN_XOR_SPLIT, label: 'AND-Join/XOR-Split', icon: '◇⊗' },
  { type: OperatorType.XOR_JOIN_AND_SPLIT, label: 'XOR-Join/AND-Split', icon: '⊗◇' },
])

// Get current operator info
const currentOperatorInfo = () => OPERATOR_INFO[selectedOperatorType.value]

// Handle tool click
const handleToolClick = (toolId) => {
  if (toolId === 'operator') {
    showOperatorMenu.value = !showOperatorMenu.value
    store.setTool('operator')
  } else {
    showOperatorMenu.value = false
    store.setTool(toolId)
  }
}

// Handle operator type selection
const selectOperatorType = (type) => {
  store.setSelectedOperatorType(type)
  store.setTool('operator')
  showOperatorMenu.value = false
}

// Close dropdown when clicking outside
const handleClickOutside = (e) => {
  if (!e.target.closest('.operator-dropdown')) {
    showOperatorMenu.value = false
  }
}

// Handle keyboard shortcuts
const handleKeydown = (e) => {
  // Ignore if typing in input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    return
  }

  // Tool shortcuts
  switch (e.key.toLowerCase()) {
    case 'v':
      store.setTool('select')
      showOperatorMenu.value = false
      break
    case 'p':
      store.setTool('place')
      showOperatorMenu.value = false
      break
    case 't':
      store.setTool('transition')
      showOperatorMenu.value = false
      break
    case 'o':
      store.setTool('operator')
      showOperatorMenu.value = !showOperatorMenu.value
      break
    case 's':
      store.setTool('subprocess')
      showOperatorMenu.value = false
      break
    case 'a':
      store.setTool('arc')
      showOperatorMenu.value = false
      break
    case 'd':
      store.setTool('delete')
      showOperatorMenu.value = false
      break
    case 'delete':
    case 'backspace':
      store.deleteSelected()
      break
    case 'z':
      if (e.metaKey || e.ctrlKey) {
        if (e.shiftKey) {
          store.redo()
        } else {
          store.undo()
        }
        e.preventDefault()
      }
      break
    case 'y':
      if (e.metaKey || e.ctrlKey) {
        store.redo()
        e.preventDefault()
      }
      break
    case 'escape':
      store.cancelArcCreation()
      store.clearSelection()
      showOperatorMenu.value = false
      break
    case 'f1':
      e.preventDefault()
      helpStore.openDialog()
      break
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('click', handleClickOutside)
})

// Format zoom percentage
const zoomPercent = () => Math.round(viewport.value.scale * 100)
</script>

<template>
  <div class="editor-toolbar">
    <!-- File menu -->
    <FileMenu />

    <!-- Separator -->
    <div class="toolbar-separator"></div>

    <!-- Tool buttons -->
    <div class="toolbar-group">
      <template v-for="t in tools" :key="t.id">
        <!-- Regular tool button -->
        <button
          v-if="!t.hasDropdown"
          :class="['tool-btn', { active: tool === t.id }]"
          :title="`${t.label} (${t.shortcut})`"
          @click="handleToolClick(t.id)"
        >
          <span class="tool-icon">{{ t.icon }}</span>
          <span class="tool-label">{{ t.label }}</span>
        </button>

        <!-- Operator button with dropdown -->
        <div v-else class="operator-dropdown">
          <button
            :class="['tool-btn', { active: tool === 'operator' }]"
            :title="`${t.label} (${t.shortcut})`"
            @click.stop="handleToolClick('operator')"
          >
            <span class="tool-icon">{{ currentOperatorInfo()?.symbol || t.icon }}</span>
            <span class="tool-label">{{ currentOperatorInfo()?.label || t.label }}</span>
            <span class="dropdown-arrow">▾</span>
          </button>

          <!-- Dropdown menu -->
          <div v-if="showOperatorMenu" class="operator-menu">
            <div class="operator-menu-header">{{ $t('operators.selectType') }}</div>
            <button
              v-for="op in operatorTypes"
              :key="op.type"
              :class="['operator-option', { selected: selectedOperatorType === op.type }]"
              @click="selectOperatorType(op.type)"
            >
              <span class="op-icon">{{ op.icon }}</span>
              <span class="op-label">{{ op.label }}</span>
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- Separator -->
    <div class="toolbar-separator"></div>

    <!-- History buttons -->
    <div class="toolbar-group">
      <button
        class="tool-btn"
        :disabled="!canUndo"
        :title="$t('toolbar.undo') + ' (Ctrl+Z)'"
        @click="store.undo()"
      >
        <span class="tool-icon">↩</span>
        <span class="tool-label">{{ $t('toolbar.undo') }}</span>
      </button>
      <button
        class="tool-btn"
        :disabled="!canRedo"
        :title="$t('toolbar.redo') + ' (Ctrl+Y)'"
        @click="store.redo()"
      >
        <span class="tool-icon">↪</span>
        <span class="tool-label">{{ $t('toolbar.redo') }}</span>
      </button>
    </div>

    <!-- Separator -->
    <div class="toolbar-separator"></div>

    <!-- Zoom controls -->
    <div class="toolbar-group">
      <button
        class="tool-btn"
        :title="$t('toolbar.zoomOut')"
        @click="store.zoomOut()"
      >
        <span class="tool-icon">−</span>
      </button>
      <span class="zoom-display">{{ zoomPercent() }}%</span>
      <button
        class="tool-btn"
        :title="$t('toolbar.zoomIn')"
        @click="store.zoomIn()"
      >
        <span class="tool-icon">+</span>
      </button>
      <button
        class="tool-btn"
        :title="$t('toolbar.zoomReset')"
        @click="store.resetZoom()"
      >
        <span class="tool-icon">⟲</span>
      </button>
    </div>

    <!-- Spacer -->
    <div class="toolbar-spacer"></div>

    <!-- Net info -->
    <div class="toolbar-info">
      <span>{{ store.net.name }}</span>
    </div>

    <!-- Discord community -->
    <a
      class="tool-btn discord-btn"
      :href="DISCORD_INVITE_URL"
      target="_blank"
      rel="noopener noreferrer"
      :title="$t('toolbar.discord')"
      :aria-label="$t('toolbar.discord')"
    >
      <svg class="discord-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
        />
      </svg>
    </a>

    <!-- Help button -->
    <button
      class="tool-btn help-btn"
      title="Help (F1)"
      @click="helpStore.openDialog()"
    >
      <span class="tool-icon">?</span>
    </button>

    <!-- Settings button -->
    <button
      class="tool-btn settings-btn"
      :title="$t('settings.title')"
      @click="showSettings = true"
    >
      <span class="tool-icon">⚙</span>
    </button>

    <!-- Settings Dialog -->
    <SettingsDialog :open="showSettings" @close="showSettings = false" />
  </div>
</template>

<style scoped>
.editor-toolbar {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  background-color: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
  gap: 8px;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tool-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background-color: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tool-btn:hover:not(:disabled) {
  background-color: var(--color-bg-tertiary);
  border-color: var(--color-border-light);
}

.tool-btn.active {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
  color: #ffffff;
}

.tool-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tool-icon {
  font-size: 16px;
  line-height: 1;
}

.tool-label {
  font-size: 12px;
}

.dropdown-arrow {
  font-size: 10px;
  margin-left: 4px;
}

/* Operator dropdown */
.operator-dropdown {
  position: relative;
}

.operator-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background-color: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  min-width: 200px;
  overflow: hidden;
}

.operator-menu-header {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background-color: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
}

.operator-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background-color: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.1s ease;
  text-align: left;
}

.operator-option:hover {
  background-color: var(--color-bg-tertiary);
}

.operator-option.selected {
  background-color: var(--color-primary);
  color: #ffffff;
}

.op-icon {
  font-size: 16px;
  width: 24px;
  text-align: center;
}

.op-label {
  flex: 1;
}

.toolbar-separator {
  width: 1px;
  height: 24px;
  background-color: var(--color-border);
  margin: 0 8px;
}

.toolbar-spacer {
  flex: 1;
}

.zoom-display {
  min-width: 50px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-muted);
}

.toolbar-info {
  font-size: 13px;
  color: var(--color-text-muted);
}

.help-btn {
  margin-left: 4px;
  border-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: 700;
}

.help-btn:hover {
  background: var(--color-primary);
  color: #ffffff;
  border-color: var(--color-primary);
}

.help-btn .tool-icon {
  font-family: system-ui, sans-serif;
}

.settings-btn {
  margin-left: 4px;
}

.settings-btn .tool-icon {
  font-size: 18px;
}

.discord-btn {
  margin-left: 8px;
  padding: 6px 10px;
  text-decoration: none;
  color: #5865f2;
  border-color: #5865f2;
}

.discord-btn:hover {
  background: #5865f2;
  border-color: #5865f2;
  color: #ffffff;
}

.discord-icon {
  width: 18px;
  height: 18px;
  display: block;
}
</style>
