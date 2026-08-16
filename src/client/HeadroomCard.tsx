/**
 * Headroom settings card: edit the headroom/uv command paths, proxy port and
 * base URL, and the auto-install switch, then save through the settings scope.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './slots.ts'
import type { HeadroomCardFace, HeadroomTextField } from './headroom-card-controller.ts'
import css from './HeadroomCard.module.css'

/** Props the renderer binds for the Headroom settings card. */
export type HeadroomCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'dsh-headroom'>
  & InjectFace<HeadroomCardFace>

const TEXT_FIELDS: Array<{
  field: HeadroomTextField
  label: 'commandLabel' | 'pythonPathLabel' | 'uvCommandLabel' | 'portLabel' | 'baseUrlLabel'
  placeholder: 'commandPlaceholder' | 'pythonPathPlaceholder' | 'uvCommandPlaceholder' | 'portPlaceholder' | 'baseUrlPlaceholder'
  numeric: boolean
}> = [
  { field: 'command', label: 'commandLabel', placeholder: 'commandPlaceholder', numeric: false },
  { field: 'pythonPath', label: 'pythonPathLabel', placeholder: 'pythonPathPlaceholder', numeric: false },
  { field: 'uvCommand', label: 'uvCommandLabel', placeholder: 'uvCommandPlaceholder', numeric: false },
  { field: 'port', label: 'portLabel', placeholder: 'portPlaceholder', numeric: true },
  { field: 'baseUrl', label: 'baseUrlLabel', placeholder: 'baseUrlPlaceholder', numeric: false },
]

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
    }
  }

  return (
    <li className={css.card}>
      <div className={css.header}>
        <span className={css.name}>{t('cardTitle')}</span>
        <span className={css.description}>{t('cardDescription')}</span>
      </div>

      {TEXT_FIELDS.map(({ field, label, placeholder, numeric }) => (
        <div className={css.field} key={field}>
          <label className={css.label} htmlFor={`dsh-headroom-${field}`}>{t(label)}</label>
          <input
            id={`dsh-headroom-${field}`}
            className={css.input + (numeric && state.invalid ? ` ${css.invalid}` : '')}
            type="text"
            value={fieldValue(field)}
            placeholder={t(placeholder)}
            disabled={!state.writable}
            onChange={(event) => props.edit(field, event.target.value)}
          />
          {numeric && state.invalid && (
            <span className={css.placeholder}>{t('invalidPort')}</span>
          )}
        </div>
      ))}

      <label className={css.toggle}>
        <input
          type="checkbox"
          checked={state.autoInstall}
          disabled={!state.writable}
          onChange={props.toggleAutoInstall}
        />
        <span>{t('autoInstallLabel')}</span>
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
