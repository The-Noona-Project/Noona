const DEFAULT_HEADERS = {'Content-Type': 'application/json'};

const buildOptions = (options = {}) => {
  const headers = {...DEFAULT_HEADERS, ...(options.headers ?? {})};
  const init = {...options, headers};

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    init.body = JSON.stringify(options.body);
  }

  return init;
};

const request = async (path, options = {}) => {
  const response = await fetch(path, buildOptions(options));

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const text = await response.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          message = parsed?.message ?? parsed?.error ?? text;
        } catch (_) {
          message = text;
        }
      }
    } catch (_) {
      // Ignore secondary failures while extracting the error message
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return await response.json();
  }

  return await response.text();
};

export const fetchLibrary = () => request('/api/raven/library');

export const searchTitles = (query) =>
  request('/api/raven/search', {
    method: 'POST',
    body: {query},
  });

export const startDownload = ({searchId, optionIndex}) =>
  request('/api/raven/download', {
    method: 'POST',
    body: {searchId, optionIndex},
  });

export const fetchDownloadStatuses = () => request('/api/raven/downloads/status');

export {request as __ravenRequest};
