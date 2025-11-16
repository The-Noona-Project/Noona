import React from 'react';
import {
  Alert,
  AlertIcon,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Heading,
  HStack,
  Spinner,
  Stack,
  StackDivider,
  Text,
} from '@chakra-ui/react';
import type { SetupService } from '../useSetupSteps.ts';
import type { WizardState, WizardStepState } from '../api.ts';

function formatTimelineTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const WIZARD_STATUS_COLORS: Record<string, string> = {
  pending: 'gray',
  'in-progress': 'blue',
  complete: 'green',
  error: 'red',
  skipped: 'gray',
};

export interface SetupTimelineStep {
  key: string;
  label: string;
  state: WizardStepState;
}

export interface SetupTimelineProps {
  foundationServices: SetupService[];
  additionalServices: SetupService[];
  wizardSteps: SetupTimelineStep[];
  wizardState: WizardState | null;
  wizardLoading: boolean;
  wizardError: string | null;
  onRefresh: () => void | Promise<void>;
}

export default function SetupTimeline({
  foundationServices,
  additionalServices,
  wizardSteps,
  wizardState,
  wizardLoading,
  wizardError,
  onRefresh,
}: SetupTimelineProps): JSX.Element {
  const hasServices = foundationServices.length > 0 || additionalServices.length > 0;

  return (
    <Stack spacing={6} h="full">
      <Card variant="outline" borderColor="gray.200" h="full">
        <CardHeader borderBottomWidth="1px" borderColor="gray.100">
          <Stack spacing={1}>
            <Heading size="sm">Core services</Heading>
            <Text fontSize="sm" color="gray.600">
              Review foundation and additional installation targets.
            </Text>
          </Stack>
        </CardHeader>
        <CardBody>
          {hasServices ? (
            <Stack spacing={4} divider={<StackDivider borderColor="gray.100" />}> 
              {foundationServices.length > 0 ? (
                <Stack spacing={2}>
                  <Heading size="xs" textTransform="uppercase" color="gray.500">
                    Foundation
                  </Heading>
                  <Stack spacing={3}>
                    {foundationServices.map((service) => (
                      <Stack key={service.name} spacing={1} data-testid={`foundation-service-${service.name}`}>
                        <Text fontWeight="semibold">{service.displayName}</Text>
                        <Text fontSize="sm" color="gray.600">
                          {service.description}
                        </Text>
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
              ) : null}
              {additionalServices.length > 0 ? (
                <Stack spacing={2}>
                  <Heading size="xs" textTransform="uppercase" color="gray.500">
                    Additional services
                  </Heading>
                  <Stack spacing={3}>
                    {additionalServices.map((service) => (
                      <Stack key={service.name} spacing={1} data-testid={`install-service-${service.name}`}>
                        <HStack justify="space-between" align="flex-start">
                          <Text fontWeight="semibold">{service.displayName}</Text>
                          {service.recommended ? (
                            <Badge colorScheme="purple" variant="subtle">
                              Recommended
                            </Badge>
                          ) : null}
                        </HStack>
                        <Text fontSize="sm" color="gray.600">
                          {service.description}
                        </Text>
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
              ) : null}
            </Stack>
          ) : (
            <Text fontSize="sm" color="gray.500">
              Service information will appear once discovery completes.
            </Text>
          )}
        </CardBody>
      </Card>

      <Card variant="outline" borderColor="gray.200">
        <CardHeader borderBottomWidth="1px" borderColor="gray.100">
          <Stack spacing={1}>
            <Heading size="sm">Wizard status</Heading>
            <Text fontSize="sm" color="gray.600">
              Track setup milestones across foundation, portal, raven, and verification steps.
            </Text>
          </Stack>
        </CardHeader>
        <CardBody>
          {wizardError ? (
            <Alert status="error" borderRadius="md" mb={wizardState ? 4 : 0} data-testid="wizard-state-error">
              <AlertIcon />
              {wizardError}
            </Alert>
          ) : null}
          {wizardLoading && !wizardState ? (
            <HStack justify="center" py={4}>
              <Spinner size="sm" />
            </HStack>
          ) : wizardState ? (
            <Stack spacing={3} divider={<StackDivider borderColor="gray.100" />}>
              {wizardSteps.map((item) => {
                const timeline = Array.isArray(item.state.timeline) ? item.state.timeline : [];
                const lastEntry = timeline.length > 0 ? timeline[timeline.length - 1] : null;
                const actorLabel =
                  lastEntry?.actor?.label || lastEntry?.actor?.id || lastEntry?.actor?.type || null;
                const timestampLabel = formatTimelineTimestamp(lastEntry?.timestamp);

                return (
                  <Stack key={item.key} spacing={1} data-testid={`wizard-step-${item.key}`}>
                    <HStack justify="space-between" align="flex-start">
                      <Text fontWeight="semibold">{item.label}</Text>
                      <Badge colorScheme={WIZARD_STATUS_COLORS[item.state.status] ?? 'gray'} textTransform="capitalize">
                        {item.state.status}
                      </Badge>
                    </HStack>
                    {item.state.error ? (
                      <Text fontSize="sm" color="red.500">
                        {item.state.error}
                      </Text>
                    ) : item.state.detail ? (
                      <Text fontSize="sm" color="gray.600">
                        {item.state.detail}
                      </Text>
                    ) : null}
                    {lastEntry ? (
                      <Stack
                        spacing={0.5}
                        fontSize="xs"
                        color="gray.500"
                        data-testid={`wizard-step-${item.key}-timeline`}
                      >
                        <Text>
                          Last activity
                          {actorLabel ? ` · ${actorLabel}` : ''}
                          {timestampLabel ? ` · ${timestampLabel}` : ''}
                        </Text>
                        {lastEntry.message ? (
                          <Text color="gray.600">{lastEntry.message}</Text>
                        ) : null}
                        {lastEntry.detail && lastEntry.detail !== lastEntry.message ? (
                          <Text>{lastEntry.detail}</Text>
                        ) : null}
                      </Stack>
                    ) : null}
                    {item.state.retries > 0 ? (
                      <Text
                        fontSize="xs"
                        color="orange.600"
                        data-testid={`wizard-step-${item.key}-retries`}
                      >
                        Retried {item.state.retries}{' '}
                        {item.state.retries === 1 ? 'time' : 'times'}
                      </Text>
                    ) : null}
                  </Stack>
                );
              })}
            </Stack>
          ) : (
            <Text fontSize="sm" color="gray.600">
              Wizard progress will appear once an installation run begins.
            </Text>
          )}
        </CardBody>
        <CardFooter borderTopWidth="1px" borderColor="gray.100">
          <Button size="sm" onClick={onRefresh} isLoading={wizardLoading}>
            Refresh status
          </Button>
        </CardFooter>
      </Card>
    </Stack>
  );
}
