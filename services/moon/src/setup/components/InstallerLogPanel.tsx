import React, { useMemo } from 'react';
import {
  Alert,
  AlertIcon,
  Box,
  Button,
  HStack,
  Select,
  Stack,
  Text,
  Progress,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Divider,
  Code,
} from '@chakra-ui/react';
import type {
  InstallationLogsState,
  InstallState,
  ServiceLogState,
  SetupService,
} from '../useSetupSteps.ts';

interface InstallerLogPanelProps {
  install: InstallState;
  installationLogs: InstallationLogsState;
  onLoadInstallation: (limit?: number) => Promise<void> | void;
  selectedService: string;
  onSelectService: (name: string) => void;
  serviceLogs: Map<string, ServiceLogState>;
  onLoadServiceLogs: (name: string, limit?: number) => Promise<void> | void;
  services: SetupService[];
}

const INSTALLATION_KEY = 'installation';

function resolveLogEntries(state: InstallationLogsState | ServiceLogState | null | undefined) {
  const entries = state?.response?.entries;
  if (!Array.isArray(entries)) {
    return [] as Array<Record<string, unknown>>;
  }
  return entries as Array<Record<string, unknown>>;
}

function resolveMessage(entry: Record<string, unknown>): string {
  if (typeof entry.message === 'string' && entry.message.trim()) {
    return entry.message.trim();
  }
  if (typeof entry.text === 'string' && entry.text.trim()) {
    return entry.text.trim();
  }
  if (typeof entry.detail === 'string' && entry.detail.trim()) {
    return entry.detail.trim();
  }
  return JSON.stringify(entry);
}

function resolveTimestamp(entry: Record<string, unknown>): string | null {
  const candidates = ['timestamp', 'time', 'createdAt', 'updatedAt'];
  for (const key of candidates) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export default function InstallerLogPanel({
  install,
  installationLogs,
  onLoadInstallation,
  selectedService,
  onSelectService,
  serviceLogs,
  onLoadServiceLogs,
  services,
}: InstallerLogPanelProps) {
  const activeLogState = useMemo(() => {
    if (selectedService === INSTALLATION_KEY) {
      return installationLogs;
    }
    return serviceLogs.get(selectedService);
  }, [selectedService, installationLogs, serviceLogs]);

  const entries = resolveLogEntries(activeLogState);

  return (
    <Stack spacing={6} data-testid="installer-panel">
      <Stack spacing={2}>
        <Text fontSize="lg" fontWeight="bold">
          Installer status
        </Text>
        {install.error && (
          <Alert status="error" borderRadius="md" data-testid="installer-error">
            <AlertIcon />
            {install.error}
          </Alert>
        )}
        {install.progressError && (
          <Alert status="error" borderRadius="md" data-testid="installer-progress-error">
            <AlertIcon />
            {install.progressError}
          </Alert>
        )}
        {install.progress && (
          <Box>
            <Text fontWeight="semibold">{install.progress.status ?? 'idle'}</Text>
            <Progress
              mt={2}
              value={typeof install.progress.percent === 'number' ? install.progress.percent : undefined}
              hasStripe
              isAnimated
              max={100}
            />
            <Text fontSize="sm" color="gray.600" mt={2}>
              {install.progress.items.length} item(s) tracked in progress summary.
            </Text>
          </Box>
        )}
        {install.results.length > 0 && (
          <Box>
            <Text fontWeight="semibold" mb={2}>
              Installation response
            </Text>
            <Table size="sm" variant="simple" data-testid="installer-results">
              <Thead>
                <Tr>
                  <Th>Service</Th>
                  <Th>Status</Th>
                </Tr>
              </Thead>
              <Tbody>
                {install.results.map((result, index) => {
                  const name = typeof result?.name === 'string' ? result.name : `service-${index}`;
                  const status = typeof result?.status === 'string' ? result.status : 'queued';
                  return (
                    <Tr key={`${name}-${index}`}>
                      <Td>{name}</Td>
                      <Td>{status}</Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </Box>
        )}
      </Stack>

      <Divider />

      <Stack spacing={3}>
        <HStack justify="space-between" align="center">
          <Text fontSize="lg" fontWeight="bold">
            Installation logs
          </Text>
          <HStack spacing={3}>
            <Select
              value={selectedService}
              onChange={(event) => onSelectService(event.target.value)}
              data-testid="log-service-select"
              maxW="16rem"
            >
              <option value={INSTALLATION_KEY}>Installer history</option>
              {services.map((service) => (
                <option key={service.name} value={service.name}>
                  {service.displayName}
                </option>
              ))}
            </Select>
            <Button
              onClick={() =>
                selectedService === INSTALLATION_KEY
                  ? onLoadInstallation()
                  : onLoadServiceLogs(selectedService)
              }
              isLoading={activeLogState?.loading}
            >
              Refresh
            </Button>
          </HStack>
        </HStack>

        {activeLogState?.error && (
          <Alert status="error" borderRadius="md" data-testid="log-error">
            <AlertIcon />
            {activeLogState.error}
          </Alert>
        )}

        {entries.length === 0 ? (
          <Alert status="info" borderRadius="md" data-testid="log-empty">
            <AlertIcon />
            No log entries available yet.
          </Alert>
        ) : (
          <Stack spacing={3} maxH="320px" overflowY="auto" borderWidth="1px" borderRadius="md" p={4}>
            {entries.map((entry, index) => {
              const message = resolveMessage(entry);
              const timestamp = resolveTimestamp(entry);
              return (
                <Box key={`${message}-${index}`}>
                  <Text fontSize="sm" color="gray.500">
                    {timestamp ?? 'Timestamp unavailable'}
                  </Text>
                  <Code display="block" whiteSpace="pre-wrap" mt={1}>
                    {message}
                  </Code>
                </Box>
              );
            })}
          </Stack>
        )}

        <Button
          alignSelf="flex-start"
          onClick={() =>
            selectedService === INSTALLATION_KEY
              ? onLoadInstallation((installationLogs.limit ?? 25) + 25)
              : onLoadServiceLogs(
                  selectedService,
                  (serviceLogs.get(selectedService)?.limit ?? 25) + 25,
                )
          }
          isDisabled={activeLogState?.loading}
        >
          Load more
        </Button>
      </Stack>
    </Stack>
  );
}
