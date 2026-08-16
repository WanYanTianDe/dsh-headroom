/**
 * dsh-headroom, browser half: registers the Headroom settings card into the
 * settings plugin section. The card edits the shared `headroom` namespace
 * through the settings scope, so the Host restarts the proxy on save.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from './slots.ts'
import { HeadroomCard } from './HeadroomCard.tsx'
import { HeadroomCardController } from './headroom-card-controller.ts'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'dsh-headroom'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Mount the Headroom settings card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-headroom: dictionaries')

  const controller = new HeadroomCardController(ctx.settingsScope.bind({ namespace: 'headroom' }))

  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register(
      {
        name: 'settings.plugin.item',
        id: 'dsh-headroom',
        order: 60,
        locale: NS,
        inject: () => controller.inject(),
      },
      HeadroomCard,
    )
  })
}
