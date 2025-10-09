import React from 'react';
import {
  Alert,
  AlertIcon,
  HStack,
  Icon,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react';
import { CheckCircleIcon, TimeIcon, WarningIcon } from '@chakra-ui/icons';
import EnvironmentEditor from './EnvironmentEditor.tsx';
import type {
  EnvSection,
  FoundationState,
  FoundationProgressItem,
  FoundationProgressStatus,
} from '../useSetupSteps.ts';

interface FoundationPanelProps {
  sections: EnvSection[];
  onChange: (serviceName: string, key: string, value: string) => void;
  state: FoundationState;
}

function StatusIcon({ status }: { status: FoundationProgressStatus }): JSX.Element {
  switch (status) {
    case 'success':
      return <Icon as={CheckCircleIcon} color="green.500" boxSize={5} />;
    case 'error':
      return <Icon as={WarningIcon} color="red.500" boxSize={5} />;
    case 'pending':
      return <Spinner size="sm" color="blue.500" />;
    default:
      return <Icon as={TimeIcon} color="gray.400" boxSize={5} />;
  }
}

function ProgressItem({ item }: { item: FoundationProgressItem }): JSX.Element {
  return (
    <HStack align="flex-start" spacing={3}>
      <StatusIcon status={item.status} />
      <Stack spacing={0} flex={1}>
        <Text fontWeight="medium">{item.label}</Text>
        {item.message ? (
          <Text fontSize="sm" color="gray.600">
            {item.message}
          </Text>
        ) : null}
      </Stack>
    </HStack>
  );
}

export default function FoundationPanel({ sections, onChange, state }: FoundationPanelProps): JSX.Element {
  return (
    <Stack spacing={6} data-testid="foundation-panel">
      {sections.length > 0 ? (
        <EnvironmentEditor sections={sections} onChange={onChange} />
      ) : (
        <Text fontSize="sm" color="gray.500">
          Foundation environment configuration will appear once service metadata loads.
        </Text>
      )}

      <Stack spacing={3}>
        <Text fontWeight="semibold">Bootstrap progress</Text>
        <Stack spacing={3}>
          {state.progress.map((item) => (
            <ProgressItem key={item.key} item={item} />
          ))}
        </Stack>
        {state.error ? (
          <Alert status="error" borderRadius="md" data-testid="foundation-error">
            <AlertIcon />
            {state.error}
          </Alert>
        ) : null}
      </Stack>
    </Stack>
  );
}
