/**
 * Client-side slot declarations for the dsh-headroom card.
 *
 * `settings.plugin.item` is declared by the harness's ui-settings-plugins
 * package; this declaration merges the same shape so the browser half can
 * register a card without a build-time dependency on that package.
 */

import type { SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
import type { HeadroomKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Settings namespace binder, provided by the harness's ui-settings package. */
    settingsScope: {
      bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T>
    }
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One plugin card inside the settings plugin section. */
    'settings.plugin.item': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }

  interface LocaleNamespaceMap {
    /** The dsh-headroom settings card copy. */
    'dsh-headroom': HeadroomKey
  }
}

