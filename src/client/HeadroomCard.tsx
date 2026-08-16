/**
 * Headroom settings card: edit the headroom/uv command paths, proxy port and
 * base URL, and the auto-install switch, then save through the settings scope.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './slots.ts'
import type { HeadroomCardFace, HeadroomCardState, HeadroomTextField } from './headroom-card-controller.ts'
import type { HeadroomKey } from './locales.ts'
import css from './HeadroomCard.module.css'

/** Props the renderer binds for the Headroom settings card. */
export type HeadroomCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'dsh-headroom'>
  & InjectFace<HeadroomCardFace>

const TEXT_FIELDS: Array<{
  field: HeadroomTextField
  label: 'commandLabel' | 'pythonPathLabel' | 'uvCommandLabel' | 'portLabel' | 'baseUrlLabel' | 'thresholdLabel'
  placeholder: 'commandPlaceholder' | 'pythonPathPlaceholder' | 'uvCommandPlaceholder' | 'portPlaceholder' | 'baseUrlPlaceholder' | 'thresholdPlaceholder'
  numeric: boolean
}> = [
  { field: 'command', label: 'commandLabel', placeholder: 'commandPlaceholder', numeric: false },
  { field: 'pythonPath', label: 'pythonPathLabel', placeholder: 'pythonPathPlaceholder', numeric: false },
  { field: 'uvCommand', label: 'uvCommandLabel', placeholder: 'uvCommandPlaceholder', numeric: false },
  { field: 'port', label: 'portLabel', placeholder: 'portPlaceholder', numeric: true },
  { field: 'baseUrl', label: 'baseUrlLabel', placeholder: 'baseUrlPlaceholder', numeric: false },
  { field: 'thresholdChars', label: 'thresholdLabel', placeholder: 'thresholdPlaceholder', numeric: true },
]

/** Invalid-state copy per numeric field; the port's message also covers other invalid drafts. */
function invalidText(field: HeadroomTextField, state: HeadroomCardState, t: (key: HeadroomKey) => string): string | null {
  if (field === 'port' && state.invalid) return t('invalidPort')
  if (field === 'thresholdChars' && state.thresholdInvalid) return t('invalidThreshold')
  return null
}

/**
 * Render the Headroom settings card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export function HeadroomCard(props: HeadroomCardProps) {
  const { t } = props
  const state = props.useHeadroomCard(snapshot => snapshot)
  if (!state.available) return null

  const fieldValue = (field: HeadroomTextField): string => {
    switch (field) {
      case 'command': return state.command
      case 'pythonPath': return state.pythonPath
      case 'uvCommand': return state.uvCommand
      case 'port': return state.port
      case 'baseUrl': return state.baseUrl
      case 'thresholdChars': return state.thresholdChars
    }
  }

  return (
    <li className={css.card}>
      <div className={css.header}>
        <span className={css.name}>{t('cardTitle')}</span>
        <span className={css.description}>{t('cardDescription')}</span>
      </div>

      {TEXT_FIELDS.map(({ field, label, placeholder }) => {
        const invalid = invalidText(field, state, t)
        return (
          <div className={css.field} key={field}>
            <label className={css.label} htmlFor={`dsh-headroom-${field}`}>{t(label)}</label>
            <input
              id={`dsh-headroom-${field}`}
              className={css.input + (invalid !== null ? ` ${css.invalid}` : '')}
              type="text"
              value={fieldValue(field)}
              placeholder={t(placeholder)}
              disabled={!state.writable}
              onChange={(event) => props.edit(field, event.target.value)}
            />
            {invalid !== null && (
              <span className={css.placeholder}>{invalid}</span>
            )}
          </div>
        )
      })}

      <label className={css.toggle}>
        <input
          type="checkbox"
          checked={state.autoInstall}
          disabled={!state.writable}
          onChange={props.toggleAutoInstall}
        />
        <span>{t('autoInstallLabel')}</span>
      </label>

      <label className={css.toggle}>
        <input
          type="checkbox"
          checked={state.resultCompressionEnabled}
          disabled={!state.writable}
          onChange={props.toggleResultCompression}
        />
        <span>{t('resultCompressionLabel')}</span>
      </label>

      <div className={css.actions}>
        <button
          className={`${css.button} ${css.buttonPrimary}`}
          disabled={!state.dirty || state.invalid || state.saving}
          onClick={props.save}
        >
          {state.saving ? t('saving') : t('save')}
        </button>
        <button
          className={css.button}
          disabled={(!state.dirty && !state.failed) || state.saving}
          onClick={props.discard}
        >
          {t('discard')}
        </button>
        {state.failed && <span className={`${css.status} ${css.statusError}`}>{t('failed')}</span>}
      </div>

      <p className={css.hint}>{t('hint')}</p>
    </li>
  )
}
