/**
 * Form controller for the Headroom settings card: stages field drafts and
 * writes them through the settings scope only on save. Mirrors the harness's
 * CardForm pattern (draft staging, presence-marked overrides, host read-back)
 * without importing the internal ui-settings-plugins form machinery.
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Settings namespace shared with the host plugin. */
export const HEADROOM_NS = 'headroom'

/** The section fields the card edits; mirrored from the host declaration. */
export interface HeadroomSettings {
  command?: string
  pythonPath?: string
  uvCommand?: string
  port?: number
  baseUrl?: string
  autoInstall?: boolean
}

/** What the card renders. */
export interface HeadroomCardState {
  /** False while the namespace is not served to this client; the card renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits a save would write. */
  dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged. */
  failed: boolean
  command: string
  pythonPath: string
  uvCommand: string
  port: string
  baseUrl: string
  autoInstall: boolean
}

/** Editable text fields of the card. */
export type HeadroomTextField = 'command' | 'pythonPath' | 'uvCommand' | 'port' | 'baseUrl'

/** The registration-side face the card's slot entry injects. */
export interface HeadroomCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useHeadroomCard. */
    headroomCard: SnapshotStore<HeadroomCardState>
  }
  /** Stage one text field's draft. */
  edit: (field: HeadroomTextField, text: string) => void
  /** Stage the auto-install switch's opposite state. */
  toggleAutoInstall: () => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function portText(value: unknown): string {
  return typeof value === 'number' ? String(value) : ''
}

export class HeadroomCardController {
  private readonly staged = new Map<string, string>()
  private saving = false
  private failed = false
  private readonly store: SnapshotStore<HeadroomCardState>

  constructor(private readonly scope: SettingsScope<HeadroomSettings>) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.publish() })
  }

  private projection(): HeadroomCardState {
    const snapshot = this.scope.getSnapshot()
    const value = snapshot.value
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.staged.size > 0,
      invalid: this.stagedPortInvalid(),
      saving: this.saving,
      failed: this.failed,
      command: this.draft('command', textValue(value?.command)),
      pythonPath: this.draft('pythonPath', textValue(value?.pythonPath)),
      uvCommand: this.draft('uvCommand', textValue(value?.uvCommand)),
      port: this.draft('port', portText(value?.port)),
      baseUrl: this.draft('baseUrl', textValue(value?.baseUrl)),
      autoInstall: value?.autoInstall ?? true,
    }
  }

  private draft(field: string, stored: string): string {
    return this.staged.get(field) ?? stored
  }

  private stagedPortInvalid(): boolean {
    const port = this.staged.get('port')
    if (port === undefined) return false
    const trimmed = port.trim()
    if (trimmed === '') return false
    const parsed = Number(trimmed)
    return !Number.isInteger(parsed) || parsed < 1 || parsed > 65535
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  private stage(field: HeadroomTextField, text: string): void {
    this.staged.set(field, text)
    this.failed = false
    this.publish()
  }

  private async commit(): Promise<void> {
    const writes: Array<Promise<unknown>> = []
    for (const [field, text] of this.staged) {
      const trimmed = text.trim()
      if (field === 'port') {
        if (trimmed === '') writes.push(this.scope.unset('port'))
        else writes.push(this.scope.set('port', Number(trimmed)))
      } else if (trimmed === '') {
        writes.push(this.scope.unset(field))
      } else {
        writes.push(this.scope.set(field, trimmed))
      }
    }
    await Promise.all(writes)
  }

  /**
   * Write every staged edit, then re-seed from the Host's accepted state.
   * A failed save keeps its drafts so the user can correct them.
   */
  private async save(): Promise<void> {
    if (this.staged.size === 0 || this.saving || this.stagedPortInvalid()) return
    this.saving = true
    this.failed = false
    this.publish()
    try {
      await this.commit()
      this.staged.clear()
    } catch {
      this.failed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }

  /** Build the face the card's slot registration injects. */
  inject(): HeadroomCardFace {
    return {
      hooks: { headroomCard: this.store },
      edit: (field, text) => this.stage(field, text),
      toggleAutoInstall: () => {
        this.failed = false
        void this.scope.set('autoInstall', !(this.scope.getSnapshot().value?.autoInstall ?? true))
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }
}
