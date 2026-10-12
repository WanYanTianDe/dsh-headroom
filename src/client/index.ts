/**
 * dsh-headroom, browser half: registers the Headroom card on the page of the
 * bundle it configures. The card edits the plugin entry's own config form, so
 * the Host commits the same fields the `/headroom` command writes.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.slots Context merge and the ctx.configForms merge.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from './slots.ts'
import { HeadroomCard } from './HeadroomCard.tsx'
import { HeadroomCardController, HEADROOM_ENTRY_ID, headroomFormScope } from './headroom-card-controller.ts'
import type { HeadroomCardFace } from './headroom-card-controller.ts'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'dsh-headroom'

/** Package name of the bundle whose page renders the card. */
const BUNDLE = '@wanyantiande/dsh-headroom'

/**
 * Slot registry surface this plugin needs. The client context carries it at
 * runtime; the structural shape keeps this package free of a build-time
 * dependency on the renderer package that declares it.
 */
interface SlotRegistryLike {
  register(options: {
    name: 'plugins.bundle.config'
    key: string
    locale: string
    inject: () => HeadroomCardFace
  }, component: unknown): () => void
  /**
   * Run the contribution factory once the named slot is declared; registering
   * before that point is refused, so every card waits for its seat.
   */
  inject(name: string, register: () => () => void): () => void
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Mount the Headroom settings card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-headroom: dictionaries')

  const controller = new HeadroomCardController(
    headroomFormScope(ctx.configForms.get<Record<string, unknown>>(HEADROOM_ENTRY_ID)),
  )
  ctx.effect(() => () => controller.dispose(), 'dsh-headroom: card controller lifetime')

  const slots = (ctx as unknown as { slots: SlotRegistryLike }).slots
  ctx.effect(() => slots.inject('plugins.bundle.config', () => slots.register(
    {
      name: 'plugins.bundle.config',
      // The seat is keyed by the bundle's package name and rendered on that
      // bundle's page in the Plugins manager.
      key: BUNDLE,
      locale: NS,
      inject: () => controller.inject(),
    },
    HeadroomCard,
  )), 'dsh-headroom: card')
}
