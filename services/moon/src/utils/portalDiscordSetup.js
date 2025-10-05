const PORTAL_DISCORD_VALIDATE_ENDPOINT =
  '/api/setup/services/noona-portal/discord/validate';
const PORTAL_DISCORD_ROLES_ENDPOINT =
  '/api/setup/services/noona-portal/discord/roles';
const PORTAL_DISCORD_CHANNELS_ENDPOINT =
  '/api/setup/services/noona-portal/discord/channels';

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

export const validatePortalDiscordConfig = async ({ token, guildId }) => {
  const response = await fetch(PORTAL_DISCORD_VALIDATE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, guildId }),
  });

  return await parseResponse(
    response,
    'Unable to verify the provided Discord credentials.',
  );
};

export const createPortalDiscordRole = async ({ token, guildId, name }) => {
  const response = await fetch(PORTAL_DISCORD_ROLES_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, guildId, name }),
  });

  const payload = await parseResponse(
    response,
    'Unable to create a new Discord role.',
  );
  return payload?.role ?? null;
};

export const createPortalDiscordChannel = async ({
  token,
  guildId,
  name,
  type,
}) => {
  const response = await fetch(PORTAL_DISCORD_CHANNELS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, guildId, name, type }),
  });

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
