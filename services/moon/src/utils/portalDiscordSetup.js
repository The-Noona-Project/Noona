const DEFAULT_PORTAL_DISCORD_BASE = '/api/setup/services/noona-portal/discord';

const sanitizeBaseUrl = (baseUrl) => {
  if (typeof baseUrl !== 'string') {
    return DEFAULT_PORTAL_DISCORD_BASE;
  }

  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return DEFAULT_PORTAL_DISCORD_BASE;
  }

  return trimmed.replace(/\/+$/, '');
};

const buildPortalDiscordEndpoint = (segment, baseUrl) => {
  const base = sanitizeBaseUrl(baseUrl);
  const normalizedSegment = segment.startsWith('/') ? segment : `/${segment}`;
  return `${base}${normalizedSegment}`;
};

const parseResponse = async (response, fallbackError) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : fallbackError;
    throw new Error(message);
  }

  return payload;
};

export const validatePortalDiscordConfig = async (
  { token, guildId },
  baseUrl,
) => {
  const response = await fetch(
    buildPortalDiscordEndpoint('/validate', baseUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, guildId }),
    },
  );

  return await parseResponse(
    response,
    'Unable to verify the provided Discord credentials.',
  );
};

export const createPortalDiscordRole = async (
  { token, guildId, name },
  baseUrl,
) => {
  const response = await fetch(
    buildPortalDiscordEndpoint('/roles', baseUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, guildId, name }),
    },
  );

  const payload = await parseResponse(
    response,
    'Unable to create a new Discord role.',
  );
  return payload?.role ?? null;
};

export const createPortalDiscordChannel = async (
  { token, guildId, name, type },
  baseUrl,
) => {
  const response = await fetch(
    buildPortalDiscordEndpoint('/channels', baseUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, guildId, name, type }),
    },
  );

  const payload = await parseResponse(
    response,
    'Unable to create a new Discord channel.',
  );
  return payload?.channel ?? null;
};

export default {
  validatePortalDiscordConfig,
  createPortalDiscordRole,
  createPortalDiscordChannel,
};
