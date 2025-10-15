import React from 'react';
import {
  Alert,
  AlertIcon,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  HStack,
  Stack,
  Text,
} from '@chakra-ui/react';
import EnvironmentEditor from './EnvironmentEditor.tsx';
import type { EnvSection, RavenStepState } from '../useSetupSteps.ts';
import type { WizardStepStatus } from '../api.ts';

const STATUS_COLORS: Record<WizardStepStatus, string> = {
  pending: 'gray',
  'in-progress': 'blue',
  complete: 'green',
  error: 'red',
  skipped: 'gray',
};

interface RavenConfigurationPanelProps {
  sections: EnvSection[];
  onChange: (serviceName: string, key: string, value: string) => void;
  environmentError?: string;
  raven: RavenStepState;
  onDetect: () => Promise<void>;
  onCheckHealth: () => Promise<void>;
}

function formatTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleString();
  } catch {
    return null;
  }
}

function detectionStatusLabel(status: RavenStepState['detection']['status']): string {
  switch (status) {
    case 'detecting':
      return 'Detecting mount…';
    case 'detected':
      return 'Mount detected';
    case 'not-found':
      return 'Mount not detected';
    case 'error':
      return 'Detection failed';
    default:
      return 'Awaiting detection';
  }
}

function launchStatusLabel(status: RavenStepState['launch']['status']): string {
  switch (status) {
    case 'launching':
      return 'Requesting installation…';
    case 'launched':
      return 'Installation requested';
    case 'error':
      return 'Installation failed';
    default:
      return 'Not requested';
  }
}

function healthStatusLabel(status: string | null): string {
  if (!status) {
    return 'Health not checked';
  }

  if (status === 'error') {
    return 'Health check failed';
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function RavenConfigurationPanel({
  sections,
  onChange,
  environmentError,
  raven,
  onDetect,
  onCheckHealth,
}: RavenConfigurationPanelProps) {
  const detectionMessage = raven.detection.message ?? detectionStatusLabel(raven.detection.status);
  const detectionUpdated = formatTimestamp(raven.detection.updatedAt);

  const launchMessage =
    raven.launch.status === 'error'
      ? raven.launch.error ?? launchStatusLabel(raven.launch.status)
      : raven.wizardDetail ?? launchStatusLabel(raven.launch.status);
  const launchStarted = formatTimestamp(raven.launch.startedAt);
  const launchCompleted = formatTimestamp(raven.launch.completedAt);

  const healthMessage = raven.health.message ?? healthStatusLabel(raven.health.status);
  const healthChecked = formatTimestamp(raven.health.updatedAt);

  const hasWizardDetail = Boolean(raven.wizardDetail);
  const hasWizardError = Boolean(raven.wizardError);

  return (
    <Stack spacing={6} data-testid="raven-configuration">
      <Stack spacing={4}>
        {hasWizardError && (
          <Alert status="error" borderRadius="md" data-testid="raven-wizard-error">
            <AlertIcon />
            {raven.wizardError}
          </Alert>
        )}
        {raven.error && !hasWizardError && (
          <Alert status="error" borderRadius="md" data-testid="raven-error">
            <AlertIcon />
            {raven.error}
          </Alert>
        )}
        {hasWizardDetail && (
          <Alert
            status={raven.wizardStatus === 'complete' ? 'success' : 'info'}
            borderRadius="md"
            data-testid="raven-wizard-detail"
          >
            <AlertIcon />
            {raven.wizardDetail}
          </Alert>
        )}
        <EnvironmentEditor sections={sections} onChange={onChange} error={environmentError} />
      </Stack>

      <Card variant="outline" borderColor="gray.200" data-testid="raven-detection-card">
        <CardHeader borderBottomWidth="1px" borderColor="gray.100">
          <HStack justify="space-between" align="flex-start">
            <Stack spacing={1}>
              <Text fontSize="lg" fontWeight="semibold">
                Kavita data mount detection
              </Text>
              <Text fontSize="sm" color="gray.600">
                Detect or specify the Kavita library mount path required by Raven.
              </Text>
            </Stack>
            <Badge colorScheme={STATUS_COLORS[raven.wizardStatus] ?? 'gray'}>{
              raven.wizardStatus.replace('-', ' ')
            }</Badge>
          </HStack>
        </CardHeader>
        <CardBody>
          <Stack spacing={3}>
            <Text fontWeight="medium" data-testid="raven-detection-status">
              {detectionMessage}
            </Text>
            {raven.detection.mountPath && (
              <Text fontSize="sm" color="gray.600" data-testid="raven-detection-path">
                Mount path: {raven.detection.mountPath}
              </Text>
            )}
            {detectionUpdated && (
              <Text fontSize="sm" color="gray.500" data-testid="raven-detection-updated">
                Last updated: {detectionUpdated}
              </Text>
            )}
            <HStack>
              <Button
                onClick={() => {
                  void onDetect();
                }}
                isLoading={raven.detection.status === 'detecting'}
                loadingText="Detecting"
                data-testid="raven-detect"
              >
                Detect mount
              </Button>
            </HStack>
          </Stack>
        </CardBody>
      </Card>

      <Card variant="outline" borderColor="gray.200" data-testid="raven-launch-card">
        <CardHeader borderBottomWidth="1px" borderColor="gray.100">
          <Text fontSize="lg" fontWeight="semibold">
            Raven installation status
          </Text>
        </CardHeader>
        <CardBody>
          <Stack spacing={2}>
            <Text fontWeight="medium" data-testid="raven-launch-status">
              {launchMessage || launchStatusLabel(raven.launch.status)}
            </Text>
            <Text fontSize="sm" color="gray.600">
              Current state: {launchStatusLabel(raven.launch.status)}
            </Text>
            {launchStarted && (
              <Text fontSize="sm" color="gray.500" data-testid="raven-launch-started">
                Requested at: {launchStarted}
              </Text>
            )}
            {launchCompleted && (
              <Text fontSize="sm" color="gray.500" data-testid="raven-launch-completed">
                Completed at: {launchCompleted}
              </Text>
            )}
          </Stack>
        </CardBody>
      </Card>

      <Card variant="outline" borderColor="gray.200" data-testid="raven-health-card">
        <CardHeader borderBottomWidth="1px" borderColor="gray.100">
          <Text fontSize="lg" fontWeight="semibold">
            Raven health
          </Text>
        </CardHeader>
        <CardBody>
          <Stack spacing={3}>
            <Text fontWeight="medium" data-testid="raven-health-status">
              {healthMessage}
            </Text>
            {healthChecked && (
              <Text fontSize="sm" color="gray.500" data-testid="raven-health-updated">
                Last checked: {healthChecked}
              </Text>
            )}
            <HStack>
              <Button
                onClick={() => {
                  void onCheckHealth();
                }}
                isLoading={raven.health.checking}
                loadingText="Checking"
                data-testid="raven-health-check"
              >
                Check Raven health
              </Button>
            </HStack>
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
