import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AlertIcon,
  AlertTitle,
  Badge,
  Box,
  Button,
  FormControl,
  FormLabel,
  Heading,
  Icon,
  Input,
  InputGroup,
  InputLeftElement,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Stack,
  Text,
  useDisclosure,
} from '@chakra-ui/react';
import { getIconPath } from '../components/icons.js';
import RavenLibraryGrid from '../components/raven/RavenLibraryGrid.jsx';
import {
  fetchDownloadStatuses,
  fetchLibrary,
  searchTitles,
  startDownload,
} from '../utils/ravenClient.js';

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
    <Icon viewBox="0 0 24 24">
      <path fill="currentColor" d={getIconPath('mdi-magnify')} />
    </Icon>
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

  const { isOpen, onOpen, onClose } = useDisclosure();

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
    <Stack spacing={8} data-testid="raven-page">
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Heading size="lg">Raven Library</Heading>
        <Button colorScheme="purple" onClick={openDialog} data-testid="open-add-dialog">
          Add new title
        </Button>
      </Box>

      {downloadsError && (
        <Alert status="error" variant="subtle" borderRadius="md">
          <AlertIcon />
          <AlertTitle>{downloadsError}</AlertTitle>
        </Alert>
      )}

      <Stack spacing={4}>
        <Heading as="h2" size="md">
          Library
        </Heading>
        {libraryLoading ? (
          <Box py={16} textAlign="center">
            <Spinner size="lg" />
          </Box>
        ) : libraryError ? (
          <Alert status="error" variant="subtle" borderRadius="md">
            <AlertIcon />
            <AlertTitle>{libraryError}</AlertTitle>
          </Alert>
        ) : library.length === 0 ? (
          <Box textAlign="center" py={16} color="gray.500" data-testid="library-empty">
            <Icon viewBox="0 0 24 24" boxSize="48px" color="purple.400" mb={4}>
              <path fill="currentColor" d={getIconPath('mdi-crow')} />
            </Icon>
            <Text fontSize="xl" fontWeight="semibold" mb={2}>
              Your Raven library is empty.
            </Text>
            <Text>Start a search to download your first telemetry series.</Text>
          </Box>
        ) : (
          <RavenLibraryGrid items={library} statuses={activeDownloads} />
        )}
      </Stack>

      {activeDownloads.length > 0 && (
        <Stack spacing={3}>
          <Heading as="h2" size="md">
            Active downloads
          </Heading>
          {activeDownloads.map((status) => {
            const key = statusKey(status) ?? Math.random().toString(36);
            return (
              <Box
                key={key}
                borderWidth="1px"
                borderRadius="md"
                p={4}
                bg="white"
                _dark={{ bg: 'gray.800', borderColor: 'whiteAlpha.300' }}
              >
                <Text fontWeight="semibold">{status.title ?? 'Processing download'}</Text>
                <Text fontSize="sm" color="gray.500">
                  {status.message ?? 'Preparing files…'}
                </Text>
                {typeof status.progress === 'number' && (
                  <Badge mt={2} colorScheme="purple">
                    {Math.round(status.progress)}%
                  </Badge>
                )}
              </Box>
            );
          })}
        </Stack>
      )}

      <Modal isOpen={isOpen} onClose={closeDialog} size="lg">
        <ModalOverlay />
        <ModalContent data-testid="add-dialog">
          <ModalHeader>Add a new title</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <form onSubmit={performSearch}>
              <Stack spacing={4}>
                <FormControl>
                  <FormLabel htmlFor="raven-search-query">Search the Raven index</FormLabel>
                  <InputGroup>
                    <InputLeftElement pointerEvents="none">
                      <SearchIcon />
                    </InputLeftElement>
                    <Input
                      id="raven-search-query"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Enter a series name or keyword"
                      data-testid="search-query"
                    />
                  </InputGroup>
                </FormControl>
                <Button
                  type="submit"
                  colorScheme="purple"
                  isLoading={searchLoading}
                  loadingText="Searching"
                  data-testid="submit-search"
                >
                  Search
                </Button>
              </Stack>
            </form>

            {searchLoading && (
              <Box py={8} textAlign="center">
                <Spinner />
              </Box>
            )}

            {searchError && !searchLoading && (
              <Alert status="error" variant="subtle" borderRadius="md" mt={4} data-testid="search-error">
                <AlertIcon />
                <Text>{searchError}</Text>
              </Alert>
            )}

            {searchResults.length > 0 && (
              <Stack spacing={4} mt={6} data-testid="search-results">
                {searchResults.map((result) => {
                  const resultId = result.id ?? result.searchId;
                  return (
                    <Box key={resultId ?? Math.random().toString(36)} borderWidth="1px" borderRadius="md" p={4}>
                      <Text fontWeight="semibold">{result.title ?? result.name}</Text>
                      {result.description && (
                        <Text fontSize="sm" color="gray.500" mt={1}>
                          {result.description}
                        </Text>
                      )}
                      <Stack direction="row" flexWrap="wrap" spacing={2} mt={3}>
                        {(result.options ?? []).map((option, optionIndex) => (
                          <Button
                            key={optionIndex}
                            variant={isSelected(resultId, optionIndex) ? 'solid' : 'outline'}
                            colorScheme={isSelected(resultId, optionIndex) ? 'purple' : 'gray'}
                            onClick={() => selectOption(resultId, optionIndex)}
                            data-testid="search-option"
                          >
                            {option?.label ?? option?.name ?? `Option ${optionIndex + 1}`}
                          </Button>
                        ))}
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            )}

            {downloadError && (
              <Alert status="error" variant="subtle" borderRadius="md" mt={4} data-testid="download-error">
                <AlertIcon />
                <Text>{downloadError}</Text>
              </Alert>
            )}

            {activeSelectionLabel && (
              <Alert status="info" variant="subtle" borderRadius="md" mt={4} data-testid="selected-option">
                <AlertIcon />
                <Text>{activeSelectionLabel}</Text>
              </Alert>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              colorScheme="purple"
              onClick={startDownloadFlow}
              isDisabled={!selectedOption}
              isLoading={downloadLoading}
              data-testid="confirm-download"
            >
              Confirm download
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Stack>
  );
}
