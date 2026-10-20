import React, {useEffect, useRef, useState} from 'react';
import Link from '@docusaurus/Link';

export default function SearchBar() {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const restoreTrigger = useRef(true);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const loading = useRef(null);
  function openSearch() {
    restoreTrigger.current = true;
    dialog.current.showModal();
    if (!loading.current) {
      setLoadError(false);
      loading.current = fetch('/docs/generated/search-index.json', {signal: AbortSignal.timeout(10000)})
        .then(response => {if (!response.ok) throw new Error('Search index unavailable'); return response.json();})
        .then(setIndex)
        .catch(() => {loading.current = null; setLoadError(true);});
    }
  }
  useEffect(() => {
    function shortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!dialog.current.open) {
          openSearch();
        }
      }
    }
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const results = words.length && index ? index.filter(page => words.every(word =>
    `${page.title} ${page.description} ${page.text}`.toLowerCase().includes(word),
  )).sort((a, b) => Number(b.title.toLowerCase().includes(query.toLowerCase())) - Number(a.title.toLowerCase().includes(query.toLowerCase()))).slice(0, 12) : [];
  return <>
    <button ref={trigger} type="button" className="docs-search-trigger" onClick={openSearch} aria-label="Search documentation">
      <span>Search docs</span><kbd>Ctrl K</kbd>
    </button>
    <dialog ref={dialog} className="docs-search" aria-labelledby="docs-search-title" onClose={() => {if (restoreTrigger.current) trigger.current?.focus();}}>
      <div className="docs-search-head">
        <h2 id="docs-search-title">Search documentation</h2>
        <button type="button" onClick={() => dialog.current.close()} aria-label="Close search">Esc</button>
      </div>
      <label htmlFor="docs-search-input">What are you building?</label>
      <input id="docs-search-input" type="search" placeholder="Try memo, cursor, or checkpoint" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {if (event.key === 'Escape') {event.preventDefault(); dialog.current.close();}}} autoFocus />
      <p className="docs-search-status" role="status">{loadError ? 'Search could not load. Close and reopen to retry, or browse the sidebar.' : !index ? 'Loading the documentation index…' : !words.length ? 'Search Prep and Chef guides. Your search stays in this browser.' : results.length ? `${results.length} matching pages` : 'No matching pages. Try a shorter term such as “memo” or “query”.'}</p>
      <ul className="docs-search-results">{results.map(page => <li key={page.url}>
        <Link to={page.url} onClick={() => {restoreTrigger.current = false; dialog.current.close();}}><span className="docs-search-section">{page.section}</span><strong>{page.title}</strong><span>{page.description}</span></Link>
      </li>)}</ul>
    </dialog>
  </>;
}
