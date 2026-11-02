import { useEffect, useMemo, useState } from 'react';
import { useProjectScope } from '../projectScope';
import { deckExportAreas, useDeckPreview } from '../useDeckPreview';
import { ContributionViewToggle, type ContributionView } from '../contributionView';
import { CurrencyDisplayControl, type CurrencyDisplaySettings } from '../currencyDisplay';
import './slide-deck-workspace.css';

type Props = {
  active: boolean; geoScope: string; inputs: any; altInputs?: Record<string, any>;
  includeDebt: boolean; onIncludeDebtChange: (value: boolean) => void;
  contributionView: ContributionView; onContributionViewChange: (value: ContributionView) => void;
  currencyDisplay: CurrencyDisplaySettings; onCurrencyDisplayChange: (value: CurrencyDisplaySettings) => void;
  onEditCurrencyRate: () => void;
};

export default function SlideDeckWorkspace({ active, geoScope, inputs, altInputs, includeDebt, onIncludeDebtChange,
  contributionView, onContributionViewChange, currencyDisplay, onCurrencyDisplayChange, onEditCurrencyRate }: Props) {
  const { sectors, projectId } = useProjectScope();
  const areas = useMemo(() => deckExportAreas(geoScope, inputs, altInputs, sectors, includeDebt),
    [geoScope, inputs, altInputs, sectors, includeDebt]);
  const preview = useDeckPreview(areas, contributionView, currencyDisplay, projectId);
  const [selected, setSelected] = useState(0);
  const [imageError, setImageError] = useState(false);
  useEffect(() => { setSelected(0); setImageError(false); }, [preview.artifact]);
  const slides = preview.artifact?.slides || [];
  const slide = slides[selected];
  const move = (index: number) => { setSelected(Math.max(0, Math.min(slides.length - 1, index))); setImageError(false); };
  const missing = Object.entries(areas).filter(([, data]) => !data).map(([area]) => area);
  const configuredDebt = Object.values(areas).some(data => sectors.some(sector => data?.utility_debt?.[sector]?.enabled)) ||
    Object.values(deckExportAreas(geoScope, inputs, altInputs, sectors, true)).some(data => sectors.some(sector => data?.utility_debt?.[sector]?.enabled));
  const sourceCurrency = Object.values(areas).find(Boolean)?.country_config?.currency || currencyDisplay.sourceCurrency;
  return <div className="slide-deck-workspace" hidden={!active} data-testid="slide-deck-workspace" onKeyDown={event => {
    if (!slides.length || event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement).closest('select,input,textarea,[contenteditable="true"]')) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(selected + (event.key === 'ArrowRight' ? 1 : -1)); }
  }}>
    <nav className="modern-inputs-nav" aria-label="Slide contents">
      <span className="modern-inputs-nav__eyebrow">Slide Deck</span>
      <select className="modern-inputs-nav__select" aria-label="Select slide" value={slides.length ? selected : ''} disabled={!slides.length}
        onChange={event => move(Number(event.target.value))}>
        {!slides.length && <option value="">Generate a preview to see slides</option>}
        {slides.map((item, index) => <option key={index} value={index}>{item.number}. {item.title}</option>)}
      </select>
      <div className="modern-inputs-nav__items">{slides.map((item, index) => <button type="button" key={index}
        className="modern-inputs-nav__item" aria-current={selected === index ? 'location' : undefined} onClick={() => move(index)}>
        <span className="modern-inputs-nav__number">{item.number}</span><span>{item.title}</span>
      </button>)}</div>
      {!slides.length && <p className="slide-deck-note">The generated presentation’s slide titles will appear here.</p>}
    </nav>
    <div className="slide-deck-reading">
      <header className="slide-deck-heading">
        <div><h2 className="modern-input-section-heading"><span className="modern-input-section-heading__index">6</span><span>Slide Deck</span></h2>
          <p>Review the branded presentation for all entered areas, then download the same deck. PowerPoint charts and tables are editable; presenter guidance is in speaker notes.</p></div>
        <div className="slide-deck-actions">
          <button type="button" className="slide-deck-button" onClick={preview.generate} disabled={preview.busy || !!missing.length}>
            {preview.busy ? 'Generating preview…' : preview.artifact ? 'Regenerate preview' : 'Generate preview'}</button>
          <button type="button" className="slide-deck-button slide-deck-button--primary" disabled={!preview.artifact || preview.busy} onClick={preview.download}>Download PowerPoint</button>
        </div>
      </header>
      <div className="slide-deck-controls">
        <CurrencyDisplayControl settings={currencyDisplay} sourceCurrency={sourceCurrency}
          onModeChange={mode => onCurrencyDisplayChange({ ...currencyDisplay, mode, sourceCurrency })} onEditRate={onEditCurrencyRate} />
        <ContributionViewToggle value={contributionView} onChange={onContributionViewChange} />
        {configuredDebt && <label>Indicative borrowing<select aria-label="Slide deck debt mode" value={includeDebt ? 'with_debt' : 'without_debt'}
          onChange={event => onIncludeDebtChange(event.target.value === 'with_debt')}>
          <option value="with_debt">Include configured loans</option><option value="without_debt">Exclude borrowing</option>
        </select></label>}
      </div>
      <p className="slide-deck-note">Areas: {Object.keys(areas).map(area => area[0].toUpperCase() + area.slice(1)).join(' + ')} · {sectors.map(sector => sector === 'water' ? 'Water Supply' : 'Sanitation').join(' + ')}.
        {' '}{includeDebt ? 'Saved enabled loans are included; disabled loans stay disabled.' : 'Borrowing is excluded without changing saved loan settings.'}</p>
      {missing.length ? <div className="slide-deck-state slide-deck-state--error" role="alert"><h3>Area inputs are missing</h3>
        <p>Complete the selected {missing.join(' and ')} data before generating a presentation. Another area will not be substituted.</p></div>
        : preview.busy ? <div aria-label="Loading slide preview" aria-busy="true"><p className="slide-deck-note" role="status">Generating PowerPoint and rendering slides. This can take up to three minutes. Keep this workspace open.</p>
          <div className="slide-deck-skeleton"><span /><span /><span /></div></div>
        : preview.failure ? <div className="slide-deck-state slide-deck-state--error" role="alert"><h3>Preview unavailable</h3>
          <p>{preview.failure.message}</p>{!!preview.failure.issues.length && <ul>{preview.failure.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
          <button type="button" className="slide-deck-button" onClick={preview.generate}>Retry preview</button></div>
        : slide ? <section className="slide-deck-viewer" tabIndex={0} aria-label="Slide viewer. Use left and right arrow keys to navigate.">
          {!!preview.artifact?.omitted_sections?.length && <details className="slide-deck-note">
            <summary>Completed sections only — {preview.artifact.omitted_sections.length} sections omitted</summary>
            <ul>{preview.artifact.omitted_sections.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          </details>}
          <h3 className="slide-deck-slide-title">{slide.number}. {slide.title}</h3>
          {imageError ? <div role="alert" className="slide-deck-state slide-deck-state--error"><p>This rendered slide could not be displayed.</p>
            <button type="button" className="slide-deck-button" onClick={preview.generate}>Retry preview</button></div>
            : <div className="slide-deck-frame" style={{ aspectRatio: `${slide.width} / ${slide.height}` }}>
              <img src={slide.image} width={slide.width} height={slide.height} alt={`Slide ${slide.number}: ${slide.title}`} onError={() => setImageError(true)} /></div>}
          <div className="slide-deck-pagination">
            <button type="button" className="slide-deck-button" disabled={selected === 0} onClick={() => move(selected - 1)}>Previous</button>
            <span aria-live="polite">Slide {selected + 1} of {slides.length}</span>
            <button type="button" className="slide-deck-button" disabled={selected === slides.length - 1} onClick={() => move(selected + 1)}>Next</button>
          </div><p className="slide-deck-note">Use left and right arrow keys in the viewer. Preview rendered with LibreOffice; fonts may differ from Microsoft PowerPoint.</p>
        </section>
        : <div className="slide-deck-state" role="status"><h3>{preview.stale ? 'Inputs changed — generate a new preview' : 'Your presentation, ready to review'}</h3>
          <p>{preview.stale ? 'The previous preview and download have been cleared. Regenerate to use the current inputs and display settings.'
            : 'Generate the actual PowerPoint deck to view its slides here. This does not change saved inputs or upload your data to a third-party viewer.'}</p>
          <p>Rendering can take up to three minutes. Download becomes available once the preview is ready.</p></div>}
    </div>
  </div>;
}
