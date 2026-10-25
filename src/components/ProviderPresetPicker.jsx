import {Check, ChevronDown, ExternalLink, LockKeyhole} from 'lucide-react';
import {PROVIDER_PRESETS, UNSUPPORTED_PROVIDER_PRESETS} from '../../shared/provider-presets.mjs';

export function ProviderPresetPicker({selectedId, disabled, onSelect}) {
  const selected = PROVIDER_PRESETS.find(preset => preset.id === selectedId);
  return <section className="provider-preset-picker" aria-labelledby="provider-presets-title">
    <div className="provider-preset-heading"><strong id="provider-presets-title">预设供应商</strong></div>
    <div className="provider-presets" role="group" aria-label="预设供应商">
      {PROVIDER_PRESETS.map(preset => <button type="button" key={preset.id} data-preset-id={preset.id} disabled={disabled} aria-pressed={selectedId === preset.id} className={selectedId === preset.id ? 'active' : ''} onClick={() => onSelect(preset.id)}>
        <span>{preset.label}</span>{selectedId === preset.id && <Check size={14} aria-hidden="true"/>}
      </button>)}
      {UNSUPPORTED_PROVIDER_PRESETS.map(preset => <button type="button" key={preset.id} data-unavailable-preset-id={preset.id} disabled title={preset.description} aria-describedby={`${preset.id}-notice`}>
        <span>{preset.label}</span><LockKeyhole size={13} aria-hidden="true"/>
      </button>)}
    </div>
    {UNSUPPORTED_PROVIDER_PRESETS.map(preset => <span className="sr-only" id={`${preset.id}-notice`} key={preset.id}>{preset.scope}：{preset.description}</span>)}
    {selected?.docsUrl && <div className="provider-preset-detail">
      <details key={selected.id} className="settings-help"><summary>{selected.scope}<ChevronDown size={12}/></summary><p>{selected.description}</p></details>
      <a href={selected.docsUrl} target="_blank" rel="noreferrer">接入文档<ExternalLink size={12}/></a>
    </div>}
  </section>;
}
