import React, { useMemo, useState } from 'react';
import {
  Alert,
  AlertIcon,
  Button,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Input,
  SimpleGrid,
  Stack,
  Text,
  Tag,
  TagLabel,
  Divider,
} from '@chakra-ui/react';
import type { DiscordState } from '../useSetupSteps.ts';

interface DiscordSetupFormProps {
  discord: DiscordState;
}

function formatList(items: Array<Record<string, unknown>> | null | undefined, key: string) {
  if (!Array.isArray(items) || items.length === 0) {
    return 'None reported.';
  }
  return items
    .map((item) => {
      const candidate = item?.[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
      if (typeof item?.name === 'string') {
        return item.name;
      }
      if (typeof item?.id === 'string') {
        return item.id;
      }
      return 'Unknown';
    })
    .join(', ');
}

export default function DiscordSetupForm({ discord }: DiscordSetupFormProps) {
  const [roleName, setRoleName] = useState('Noona Member');
  const [channelName, setChannelName] = useState('noona-onboarding');
  const [channelType, setChannelType] = useState('text');

  const validationTimestamp = useMemo(() => {
    if (!discord.lastValidatedAt) {
      return null;
    }
    return new Date(discord.lastValidatedAt).toLocaleString();
  }, [discord.lastValidatedAt]);

  const roleCreatedTimestamp = useMemo(() => {
    if (!discord.lastRoleCreatedAt) {
      return null;
    }
    return new Date(discord.lastRoleCreatedAt).toLocaleString();
  }, [discord.lastRoleCreatedAt]);

  const channelCreatedTimestamp = useMemo(() => {
    if (!discord.lastChannelCreatedAt) {
      return null;
    }
    return new Date(discord.lastChannelCreatedAt).toLocaleString();
  }, [discord.lastChannelCreatedAt]);

  return (
    <Stack spacing={6} data-testid="discord-setup">
      <Text color="gray.600">
        Provide Discord credentials so Noona Portal can issue onboarding invitations and automate guild setup.
      </Text>

      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
        <FormControl isRequired isInvalid={!discord.token} data-testid="discord-token">
          <FormLabel>Discord Bot Token</FormLabel>
          <Input
            value={discord.token}
            onChange={(event) => discord.onFieldChange('DISCORD_BOT_TOKEN', event.target.value)}
            placeholder="Paste your bot token"
          />
          {!discord.token && <FormErrorMessage>Bot token is required.</FormErrorMessage>}
        </FormControl>

        <FormControl isRequired isInvalid={!discord.guildId} data-testid="discord-guild">
          <FormLabel>Discord Guild ID</FormLabel>
          <Input
            value={discord.guildId}
            onChange={(event) => discord.onFieldChange('DISCORD_GUILD_ID', event.target.value)}
            placeholder="Guild identifier"
          />
          {!discord.guildId && <FormErrorMessage>Guild ID is required.</FormErrorMessage>}
        </FormControl>
      </SimpleGrid>

      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
        <FormControl data-testid="discord-role-id">
          <FormLabel>Guild Role ID</FormLabel>
          <Input
            value={discord.roleId}
            onChange={(event) => discord.onFieldChange('DISCORD_GUILD_ROLE_ID', event.target.value)}
            placeholder="Optional role identifier"
          />
        </FormControl>

        <FormControl data-testid="discord-default-role">
          <FormLabel>Default Role ID</FormLabel>
          <Input
            value={discord.defaultRoleId}
            onChange={(event) =>
              discord.onFieldChange('DISCORD_DEFAULT_ROLE_ID', event.target.value)
            }
            placeholder="Optional fallback role"
          />
        </FormControl>
      </SimpleGrid>

      {discord.validationError && (
        <Alert status="error" borderRadius="md" data-testid="discord-validation-error">
          <AlertIcon />
          {discord.validationError}
        </Alert>
      )}

      <Stack spacing={3} direction={{ base: 'column', md: 'row' }} align="flex-start">
        <Button
          colorScheme="purple"
          onClick={discord.onValidate}
          isLoading={discord.validating}
          loadingText="Validating"
          data-testid="discord-validate"
        >
          Validate credentials
        </Button>
        {validationTimestamp && (
          <Tag colorScheme="green" data-testid="discord-validation-success">
            <TagLabel>Validated {validationTimestamp}</TagLabel>
          </Tag>
        )}
        {roleCreatedTimestamp && (
          <Tag colorScheme="purple" data-testid="discord-role-created">
            <TagLabel>Role created {roleCreatedTimestamp}</TagLabel>
          </Tag>
        )}
        {channelCreatedTimestamp && (
          <Tag colorScheme="purple" data-testid="discord-channel-created">
            <TagLabel>Channel created {channelCreatedTimestamp}</TagLabel>
          </Tag>
        )}
      </Stack>

      {discord.validation && (
        <Stack spacing={4} borderWidth="1px" borderRadius="md" p={4} data-testid="discord-validation-details">
          <Text fontWeight="bold">Validation results</Text>
          <Text fontSize="sm">
            Guild: {discord.validation?.guild?.name ?? discord.guildId}
          </Text>
          <Text fontSize="sm">Roles: {formatList(discord.validation?.roles ?? null, 'name')}</Text>
          <Text fontSize="sm">
            Channels: {formatList(discord.validation?.channels ?? null, 'name')}
          </Text>
        </Stack>
      )}

      <Divider />

      <Stack spacing={6}>
        <Text fontWeight="semibold">Bootstrap helpers</Text>
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
          <FormControl
            data-testid="discord-create-role"
            isInvalid={!!discord.createRoleState.error}
          >
            <FormLabel>New role name</FormLabel>
            <Input value={roleName} onChange={(event) => setRoleName(event.target.value)} />
            {discord.createRoleState.error && (
              <FormErrorMessage>{discord.createRoleState.error}</FormErrorMessage>
            )}
            {discord.createRoleState.successMessage && (
              <Text fontSize="sm" color="green.500">
                {discord.createRoleState.successMessage}
              </Text>
            )}
            <Button
              mt={3}
              colorScheme="purple"
              onClick={() => discord.onCreateRole(roleName)}
              isLoading={discord.createRoleState.loading}
            >
              Create role
            </Button>
          </FormControl>

          <FormControl
            data-testid="discord-create-channel"
            isInvalid={!!discord.createChannelState.error}
          >
            <FormLabel>New channel name</FormLabel>
            <Input value={channelName} onChange={(event) => setChannelName(event.target.value)} />
            <FormLabel mt={4}>Channel type</FormLabel>
            <Input value={channelType} onChange={(event) => setChannelType(event.target.value)} />
            {discord.createChannelState.error && (
              <FormErrorMessage>{discord.createChannelState.error}</FormErrorMessage>
            )}
            {discord.createChannelState.successMessage && (
              <Text fontSize="sm" color="green.500">
                {discord.createChannelState.successMessage}
              </Text>
            )}
            <Button
              mt={3}
              colorScheme="purple"
              onClick={() => discord.onCreateChannel(channelName, channelType)}
              isLoading={discord.createChannelState.loading}
            >
              Create channel
            </Button>
          </FormControl>
        </SimpleGrid>
      </Stack>
    </Stack>
  );
}
