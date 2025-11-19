import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Callout,
  Input,
  LoadingSpinner,
  Modal,
  StatusBadge,
  Text as OneUIText,
} from '@textkernel/oneui';
import { getIconPath } from '../components/icons.js';
import RavenLibraryGrid from '../components/raven/RavenLibraryGrid.jsx';
import {
  fetchDownloadStatuses,
  fetchLibrary,
  searchTitles,
  startDownload,
} from '../utils/ravenClient.js';
import useDisclosureState from '../utils/useDisclosureState.ts';

const POLL_INTERVAL = 5000;

function parseLibraryResponse(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.library)) return payload.library;
  if (Array.isArray(payload.series)) return payload.series;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function parseDownloadsResponse(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.downloads)) return payload.downloads;
  if (Array.isArray(payload.statuses)) return payload.statuses;
  return [];
}

function statusKey(status) {
  if (!status) return null;
  return (
    status.libraryId ??
    status.id ??
    status.searchId ??
    status.seriesId ??
    status.title ??
    null
  );
}

function SearchIcon() {
  return (
    <span className="raven-input-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path fill="currentColor" d={getIconPath('mdi-magnify')} />
      </svg>
    </span>
  );
}

export default function RavenPage() {
  const [library, setLibrary] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');

  const [downloads, setDownloads] = useState([]);
  const [downloadsError, setDownloadsError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  const [downloadError, setDownloadError] = useState('');
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);

  const completedDownloads = useRef(new Set());

  const { isOpen, onOpen, onClose } = useDisclosureState(false);

  const resetDialogState = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchError('');
    setDownloadError('');
    setDownloadLoading(false);
    setSelectedOption(null);
  }, []);

  const closeDialog = useCallback(() => {
    onClose();
    resetDialogState();
  }, [onClose, resetDialogState]);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError('');
    try {
      const payload = await fetchLibrary();
      setLibrary(parseLibraryResponse(payload));
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'Failed to load library.');
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  const refreshDownloads = useCallback(async () => {
    try {
      setDownloadsError('');
      const payload = await fetchDownloadStatuses();
      const list = parseDownloadsResponse(payload);
      setDownloads(list);

      let shouldRefreshLibrary = false;
      list.forEach((status) => {
        const key = statusKey(status);
        if (status?.state === 'completed' && key && !completedDownloads.current.has(key)) {
          completedDownloads.current.add(key);
          shouldRefreshLibrary = true;
        }
      });

      if (shouldRefreshLibrary) {
        await loadLibrary();
      }
    } catch (error) {
      setDownloadsError(
        error instanceof Error ? error.message : 'Failed to load download status.',
      );
    }
  }, [loadLibrary]);

  useEffect(() => {
    loadLibrary().catch(() => {});
  }, [loadLibrary]);

  useEffect(() => {
    let isMounted = true;

    const poll = async () => {
      if (!isMounted) return;
      await refreshDownloads();
    };

    poll().catch(() => {});
    const handle = window.setInterval(() => {
      poll().catch(() => {});
    }, POLL_INTERVAL);

    return () => {
      isMounted = false;
      window.clearInterval(handle);
    };
  }, [refreshDownloads]);

  const performSearch = useCallback(
    async (event) => {
      event?.preventDefault?.();
      const query = searchQuery.trim();
      if (!query) {
        setSearchError('Enter a search term to query the Raven index.');
        setSearchResults([]);
        return;
      }

      setSearchLoading(true);
      setSearchError('');
      setDownloadError('');
      setSelectedOption(null);

      try {
        const payload = await searchTitles(query);
        const results = Array.isArray(payload?.results)
          ? payload.results
          : Array.isArray(payload)
          ? payload
          : [];
        setSearchResults(results);
        if (!results.length) {
          setSearchError('No results were found for that query.');
        }
      } catch (error) {
        setSearchError(error instanceof Error ? error.message : 'Search failed.');
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    },
    [searchQuery],
  );

  const selectOption = useCallback((searchId, optionIndex) => {
    setSelectedOption({ searchId, optionIndex });
  }, []);

  const isSelected = useCallback(
    (searchId, optionIndex) =>
      selectedOption?.searchId === searchId && selectedOption?.optionIndex === optionIndex,
    [selectedOption],
  );

  const activeSelectionLabel = useMemo(() => {
    if (!selectedOption) {
      return '';
    }
    const match = searchResults.find((result) => {
      const id = result?.id ?? result?.searchId;
      return id === selectedOption.searchId;
    });
    if (!match) {
      return '';
    }
    const option = match.options?.[selectedOption.optionIndex];
    const baseTitle = match.title ?? match.name ?? 'Selected option';
    const optionLabel = option?.label ?? option?.name ?? `Option ${selectedOption.optionIndex + 1}`;
    return `${baseTitle} — ${optionLabel}`;
  }, [searchResults, selectedOption]);

  const startDownloadFlow = useCallback(async () => {
    if (!selectedOption) {
      setDownloadError('Select an option before confirming the download.');
      return;
    }
    setDownloadLoading(true);
    setDownloadError('');

    try {
      await startDownload(selectedOption);
      await refreshDownloads();
      await loadLibrary();
      closeDialog();
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Failed to start download.');
    } finally {
      setDownloadLoading(false);
    }
  }, [closeDialog, loadLibrary, refreshDownloads, selectedOption]);

  const openDialog = useCallback(() => {
    resetDialogState();
    onOpen();
  }, [onOpen, resetDialogState]);

  const activeDownloads = useMemo(() => downloads ?? [], [downloads]);

  return (
    <div className="stack raven-page" data-testid="raven-page">
      <div className="raven-page__header">
        <h1>Raven Library</h1>
        <Button context="primary" onClick={openDialog} data-testid="open-add-dialog">
          Add new title
        </Button>
      </div>

      {downloadsError && (
        <Callout context="critical">
          <OneUIText isBold>{downloadsError}</OneUIText>
        </Callout>
      )}

      <section className="stack raven-section">
        <h2>Library</h2>
        {libraryLoading ? (
          <div className="raven-loading">
            <LoadingSpinner />
          </div>
        ) : libraryError ? (
          <Callout context="critical">
            <OneUIText>{libraryError}</OneUIText>
          </Callout>
        ) : library.length === 0 ? (
          <div className="raven-empty" data-testid="library-empty">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d={getIconPath('mdi-crow')} />
            </svg>
            <p className="raven-empty__title">Your Raven library is empty.</p>
            <p>Start a search to download your first telemetry series.</p>
          </div>
        ) : (
          <RavenLibraryGrid items={library} statuses={activeDownloads} />
        )}
      </section>

      {activeDownloads.length > 0 && (
        <section className="stack raven-section">
          <h2>Active downloads</h2>
          <div className="stack">
            {activeDownloads.map((status) => {
              const key = statusKey(status) ?? Math.random().toString(36);
              return (
                <div className="raven-download" key={key}>
                  <p className="raven-download__title">{status.title ?? 'Processing download'}</p>
                  <OneUIText size="small" context="neutral">
                    {status.message ?? 'Preparing files…'}
                  </OneUIText>
                  {typeof status.progress === 'number' && (
                    <StatusBadge context="info" variant="subtle">
                      {Math.round(status.progress)}%
                    </StatusBadge>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <Modal
        isOpen={isOpen}
        onRequestClose={closeDialog}
        contentLabel="Add a new title"
        className="raven-modal"
        overlayClassName="app-modal__overlay"
      >
        <div className="stack" data-testid="add-dialog">
          <div className="raven-modal__header">
            <h2>Add a new title</h2>
            <Button variant="ghost" context="secondary" onClick={closeDialog}>
              Close
            </Button>
          </div>
          <form className="stack" onSubmit={performSearch}>
            <label htmlFor="raven-search-query" className="form-label">
              Search the Raven index
            </label>
            <Input
              id="raven-search-query"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Enter a series name or keyword"
              data-testid="search-query"
              leadingIcon={<SearchIcon />}
            />
            <Button
              type="submit"
              context="primary"
              isLoading={searchLoading}
              data-testid="submit-search"
            >
              Search
            </Button>
          </form>

          {searchLoading && (
            <div className="raven-loading">
              <LoadingSpinner />
            </div>
          )}

          {searchError && !searchLoading && (
            <Callout context="critical" data-testid="search-error">
              <OneUIText>{searchError}</OneUIText>
            </Callout>
          )}

          {searchResults.length > 0 && (
            <div className="stack" data-testid="search-results">
              {searchResults.map((result) => {
                const resultId = result.id ?? result.searchId;
                return (
                  <div className="raven-result" key={resultId ?? Math.random().toString(36)}>
                    <p className="raven-result__title">{result.title ?? result.name}</p>
                    {result.description && (
                      <OneUIText size="small" context="neutral">
                        {result.description}
                      </OneUIText>
                    )}
                    <div className="stack stack--row stack--wrap raven-option-list">
                      {(result.options ?? []).map((option, optionIndex) => (
                        <Button
                          key={optionIndex}
                          variant={isSelected(resultId, optionIndex) ? 'filled' : 'outlined'}
                          context={isSelected(resultId, optionIndex) ? 'primary' : 'secondary'}
                          onClick={() => selectOption(resultId, optionIndex)}
                          data-testid="search-option"
                        >
                          {option?.label ?? option?.name ?? `Option ${optionIndex + 1}`}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {downloadError && (
            <Callout context="critical" data-testid="download-error">
              <OneUIText>{downloadError}</OneUIText>
            </Callout>
          )}

          {activeSelectionLabel && (
            <Callout context="info" data-testid="selected-option">
              <OneUIText>{activeSelectionLabel}</OneUIText>
            </Callout>
          )}

          <div className="raven-modal__footer">
            <Button variant="ghost" context="secondary" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              context="primary"
              onClick={startDownloadFlow}
              disabled={!selectedOption}
              isLoading={downloadLoading}
              data-testid="confirm-download"
            >
              Confirm download
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
