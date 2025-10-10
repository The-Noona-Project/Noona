import React, { useMemo } from 'react';
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  HStack,
  Icon,
  Spinner,
  Stack,
  StackDivider,
  Text,
  Tooltip,
} from '@chakra-ui/react';
import { CheckCircleIcon, InfoOutlineIcon, WarningIcon } from '@chakra-ui/icons';
import type { WizardState } from '../api.ts';
import type { InstallState, VerificationState } from '../useSetupSteps.ts';

export interface VerificationPanelProps {
  install: InstallState;
  verification: VerificationState;
  wizardState: WizardState | null;
  wizardLoading: boolean;
  onRefresh: () => void | Promise<void>;
  onRunChecks: () => void | Promise<void>;
  onComplete: () => void | Promise<void>;
}

type VerificationCheckStatus = 'pass' | 'fail' | 'skipped';

const CHECK_STATUS_CONFIG: Record<
  VerificationCheckStatus,
  { color: string; icon: typeof CheckCircleIcon | typeof WarningIcon | typeof InfoOutlineIcon; label: string }
> = {
  pass: { color: 'green', icon: CheckCircleIcon, label: 'Pass' },
  fail: { color: 'red', icon: WarningIcon, label: 'Fail' },
  skipped: { color: 'gray', icon: InfoOutlineIcon, label: 'Skipped' },
};

const VERIFICATION_STATUS_COLORS: Record<string, string> = {
  pending: 'gray',
  'in-progress': 'blue',
  complete: 'green',
  error: 'red',
  skipped: 'gray',
};

function formatTimestamp(value: string | null): string {
  if (!value) {
    return 'Not yet run';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function resolveCheckStatus(status: VerificationCheckStatus) {
  return CHECK_STATUS_CONFIG[status] ?? CHECK_STATUS_CONFIG.pass;
}

export default function VerificationPanel({
  install,
  verification,
  wizardState,
  wizardLoading,
  onRefresh,
  onRunChecks,
  onComplete,
}: VerificationPanelProps): JSX.Element {
  const summary = verification.summary;
  const checks = summary?.checks ?? [];
  const wizardCompleted = wizardState?.completed === true;
  const verificationStatus = wizardState?.verification?.status ?? 'pending';

  const hasChecks = checks.length > 0;
  const allChecksPassing = hasChecks && checks.every((check) => check.supported === false || check.success);

  const completeDisabledReason = useMemo(() => {
    if (verification.completing) {
      return null;
    }
    if (wizardCompleted) {
      return 'Setup is already complete.';
    }
    if (!hasChecks) {
      return 'Run verification checks before completing setup.';
    }
    if (!allChecksPassing) {
      return 'Resolve failing verification checks before completing setup.';
    }
    if (verificationStatus !== 'complete') {
      return 'Verification step must reach the "complete" state before finishing setup.';
    }
    if (verification.running || verification.loading) {
      return 'Wait for verification results before completing setup.';
    }
    return null;
  }, [
    allChecksPassing,
    hasChecks,
    verificationStatus,
    verification.running,
    verification.loading,
    wizardCompleted,
    verification.completing,
  ]);

  const healthEntries = [
    { key: 'warden', label: 'Warden', entry: verification.health.warden },
    { key: 'sage', label: 'Sage', entry: verification.health.sage },
  ];

  return (
    <Stack spacing={6} data-testid="verification-panel">
      <Stack spacing={2}>
        <Text color="gray.600">
          Review container health and execute verification checks to confirm the stack is ready for use.
        </Text>
        {install.installing ? (
          <Alert status="info" variant="subtle" borderRadius="md">
            <AlertIcon />
            Installation is still running. Verification results may change once provisioning completes.
          </Alert>
        ) : null}
        {verification.error ? (
          <Alert status="error" borderRadius="md" data-testid="verification-error">
            <AlertIcon />
            {verification.error}
          </Alert>
        ) : null}
        {wizardCompleted ? (
          <Alert status="success" variant="subtle" borderRadius="md" data-testid="wizard-completed-alert">
            <AlertIcon />
            Setup has been completed. You can rerun verification checks at any time.
          </Alert>
        ) : null}
      </Stack>

      <Stack spacing={6} divider={<StackDivider borderColor="gray.100" />}>
        <Stack spacing={3}>
          <Text fontWeight="semibold">Wizard status</Text>
          {wizardLoading ? (
            <HStack spacing={3}>
              <Spinner size="sm" />
              <Text color="gray.600">Loading verification status…</Text>
            </HStack>
          ) : (
            <Stack spacing={2}>
              <HStack spacing={3}>
                <Badge colorScheme={wizardCompleted ? 'green' : VERIFICATION_STATUS_COLORS[verificationStatus] ?? 'gray'}>
                  {wizardCompleted ? 'completed' : verificationStatus}
                </Badge>
                {wizardState?.updatedAt ? (
                  <Text fontSize="sm" color="gray.600">
                    Updated {formatTimestamp(wizardState.updatedAt)}
                  </Text>
                ) : null}
              </HStack>
              {!wizardCompleted && summary?.lastRunAt ? (
                <Text fontSize="sm" color="gray.600">
                  Last verification run {formatTimestamp(summary.lastRunAt)}
                </Text>
              ) : null}
            </Stack>
          )}
        </Stack>

        <Stack spacing={3}>
          <Text fontWeight="semibold">Service health</Text>
          <Stack spacing={3}>
            {healthEntries.map(({ key, label, entry }) => {
              const colorScheme = entry?.success === true ? 'green' : entry?.success === false ? 'red' : 'gray';
              return (
                <Stack key={key} spacing={1} data-testid={`verification-health-${key}`}>
                  <HStack spacing={3} align="center">
                    <Text fontWeight="semibold">{label}</Text>
                    <Badge colorScheme={colorScheme} textTransform="capitalize">
                      {entry?.status ?? 'unknown'}
                    </Badge>
                  </HStack>
                  <Text fontSize="sm" color="gray.600">
                    {entry?.message ?? 'No status available.'}
                  </Text>
                  {entry?.checkedAt ? (
                    <Text fontSize="xs" color="gray.500">
                      Checked {formatTimestamp(entry.checkedAt)}
                    </Text>
                  ) : null}
                </Stack>
              );
            })}
          </Stack>
        </Stack>

        <Stack spacing={3}>
          <Text fontWeight="semibold">Verification checks</Text>
          {verification.loading && !checks.length ? (
            <HStack spacing={3}>
              <Spinner size="sm" />
              <Text color="gray.600">Loading verification checks…</Text>
            </HStack>
          ) : null}
          {!verification.loading && !checks.length ? (
            <Text fontSize="sm" color="gray.600">
              Run verification checks to validate Vault, Redis, Mongo, Raven, and Portal connectivity.
            </Text>
          ) : null}
          <Stack spacing={3}>
            {checks.map((check) => {
              const { color, icon: StatusIcon, label } = resolveCheckStatus(check.status);
              return (
                <Stack key={check.service} spacing={1} borderWidth="1px" borderColor={`${color}.200`} borderRadius="md" p={3}>
                  <HStack spacing={3} align="center">
                    <Icon as={StatusIcon} color={`${color}.500`} boxSize={5} aria-hidden="true" />
                    <Text fontWeight="semibold">{check.label}</Text>
                    <Badge colorScheme={color} variant="subtle">
                      {label}
                    </Badge>
                  </HStack>
                  {check.message ? (
                    <Text fontSize="sm" color="gray.600">
                      {check.message}
                    </Text>
                  ) : null}
                  <HStack spacing={3} color="gray.500" fontSize="xs">
                    <Text>Checked {formatTimestamp(check.checkedAt ?? null)}</Text>
                    {check.duration != null ? <Text>Duration: {Math.round(check.duration)}ms</Text> : null}
                  </HStack>
                </Stack>
              );
            })}
          </Stack>
        </Stack>
      </Stack>

      <HStack justify="space-between" flexWrap="wrap" spacing={3}>
        <Button variant="ghost" onClick={() => void onRefresh()} isLoading={verification.loading} data-testid="verification-refresh">
          Refresh status
        </Button>
        <HStack spacing={3}>
          <Button
            colorScheme="purple"
            onClick={() => void onRunChecks()}
            isLoading={verification.running}
            isDisabled={verification.running || verification.loading}
            data-testid="verification-run"
          >
            Run checks
          </Button>
          <Tooltip label={completeDisabledReason ?? ''} isDisabled={!completeDisabledReason} hasArrow>
            <Box>
              <Button
                colorScheme="green"
                onClick={() => void onComplete()}
                isLoading={verification.completing}
                isDisabled={
                  verification.completing ||
                  verification.running ||
                  verification.loading ||
                  Boolean(completeDisabledReason)
                }
                data-testid="verification-complete"
              >
                Complete setup
              </Button>
            </Box>
          </Tooltip>
        </HStack>
      </HStack>
    </Stack>
  );
}
