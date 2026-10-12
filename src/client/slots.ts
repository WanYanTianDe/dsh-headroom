/**
 * Client-side slot declarations for the dsh-headroom card.
 *
 * `plugins.bundle.config` is declared by the harness's plugin manager page;
 * this declaration merges the same shape so the browser half can register a
 * card on the page of the bundle it configures, without a build-time
 * dependency on that package.
 */

import type { HeadroomKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One bundle's own configuration, rendered on the bundle's page. */
    'plugins.bundle.config': { kind: 'keyed'; scope: 'root'; owner: { children?: never } }
  }

  interface LocaleNamespaceMap {
    /** The dsh-headroom settings card copy. */
    'dsh-headroom': HeadroomKey
  }
}
