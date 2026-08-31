import { useLang, useT, type Lang } from '../i18n'

// Selector de idioma (ES / EN). Por defecto, el del navegador.
export function LangSwitch({ dark = false }: { dark?: boolean }) {
  const lang = useLang((s) => s.lang)
  const setLang = useLang((s) => s.setLang)
  const t = useT()
  const opts: Lang[] = ['es', 'en']
  return (
    <div className="flex rounded overflow-hidden border border-gray-500 text-[11px] font-semibold" title={t('lang.title')}>
      {opts.map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2 py-0.5 ${
            lang === l
              ? dark
                ? 'bg-white text-gray-900'
                : 'bg-gray-800 text-white'
              : dark
                ? 'bg-transparent text-gray-300 hover:text-white'
                : 'bg-white text-gray-500 hover:text-gray-800'
          }`}
        >
          {t(l === 'es' ? 'lang.es' : 'lang.en')}
        </button>
      ))}
    </div>
  )
}
