import React from 'react';
import {
  Badge,
  Box,
  Button,
  HStack,
  Stack,
  Text,
  Tooltip,
  Stepper,
  Step,
  StepIndicator,
  StepSeparator,
  useBreakpointValue,
  VisuallyHidden,
} from '@chakra-ui/react';
import { AtSignIcon, CheckCircleIcon, CheckIcon, DownloadIcon, SettingsIcon, WarningTwoIcon } from '@chakra-ui/icons';
import type { SetupStepDefinition, SetupStepId } from '../useSetupSteps.ts';

const STATUS_COLOR: Record<SetupStepDefinition['status'], string> = {
  current: 'purple',
  complete: 'green',
  upcoming: 'gray',
  error: 'red',
};

const STEP_ICON_MAP: Record<string, React.ElementType> = {
  foundation: SettingsIcon,
  settings: SettingsIcon,
  portal: AtSignIcon,
  raven: DownloadIcon,
  download: DownloadIcon,
  verification: CheckCircleIcon,
  check: CheckCircleIcon,
};

interface SetupStepperProps {
  steps: SetupStepDefinition[];
  currentStepId: SetupStepId;
  onSelect: (id: SetupStepId) => void;
}

export default function SetupStepper({ steps, currentStepId, onSelect }: SetupStepperProps) {
  const orientation = useBreakpointValue({ base: 'vertical', md: 'horizontal' }) ?? 'vertical';
  const currentIndex = Math.max(
    steps.findIndex((step) => step.id === currentStepId),
    0,
  );
  const completedCount = steps.filter((step) => step.status === 'complete').length;
  const errorCount = steps.filter((step) => step.status === 'error').length;

  return (
    <Stack spacing={4} data-testid="setup-stepper" aria-label="Setup progress">
      <HStack
        justify="space-between"
        align={{ base: 'flex-start', md: 'center' }}
        spacing={3}
        flexWrap="wrap"
      >
        <Text fontWeight="semibold" color="gray.700" aria-live="polite">
          Step {currentIndex + 1} of {steps.length}
        </Text>
        <Text fontSize="sm" color="gray.600">
          {completedCount} of {steps.length} steps complete
        </Text>
        {errorCount > 0 && (
          <Badge colorScheme="red" variant="solid">
            {errorCount} {errorCount === 1 ? 'step needs attention' : 'steps need attention'}
          </Badge>
        )}
      </HStack>

      <Stepper index={currentIndex} orientation={orientation} gap={{ base: 6, md: 8 }}>
        {steps.map((step, index) => {
          const isCurrent = step.id === currentStepId;
          const isComplete = step.status === 'complete';
          const isError = step.status === 'error';
          const statusColor = STATUS_COLOR[step.status] ?? 'gray';
          const descriptionId = `setup-step-${step.id}-description`;
          const errorId = `setup-step-${step.id}-error`;
          const describedBy = [descriptionId];
          if (isError && step.error) {
            describedBy.push(errorId);
          }
          const iconKey = step.icon ?? step.id;
          const IconComponent =
            (iconKey && STEP_ICON_MAP[iconKey]) || (STEP_ICON_MAP[step.id] ?? null);

          const indicatorBg = isError
            ? 'red.500'
            : isComplete
            ? 'green.500'
            : isCurrent
            ? 'purple.500'
            : 'white';
          const indicatorBorder = isError
            ? 'red.500'
            : isComplete
            ? 'green.500'
            : isCurrent
            ? 'purple.500'
            : 'gray.300';
          const indicatorColor = isError || isComplete || isCurrent ? 'white' : 'gray.600';

          const tooltip = step.error || step.description;
          const statusLabel = isError
            ? 'Step has errors'
            : isComplete
            ? 'Step completed'
            : isCurrent
            ? 'Current step'
            : 'Upcoming step';

          const button = (
            <Button
              onClick={() => onSelect(step.id)}
              variant="ghost"
              justifyContent="flex-start"
              textAlign="left"
              w="full"
              px={0}
              py={0}
              h="auto"
              data-testid={`setup-step-${step.id}`}
              aria-current={isCurrent ? 'step' : undefined}
              aria-describedby={describedBy.join(' ')}
            >
              <HStack align="flex-start" spacing={4} w="full">
                <StepIndicator
                  boxSize={10}
                  borderWidth={2}
                  borderColor={indicatorBorder}
                  bg={indicatorBg}
                  color={indicatorColor}
                  rounded="full"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                >
                  {isError ? (
                    <WarningTwoIcon boxSize={4} />
                  ) : isComplete ? (
                    <CheckIcon boxSize={3} />
                  ) : IconComponent ? (
                    <IconComponent boxSize={4} color={indicatorColor} aria-hidden="true" />
                  ) : (
                    <Text fontWeight="bold" color={indicatorColor}>
                      {index + 1}
                    </Text>
                  )}
                </StepIndicator>

                <Stack spacing={1} flex="1">
                  <HStack spacing={2} align="center" flexWrap="wrap">
                    <Text fontWeight="semibold" color="gray.800">
                      {step.title}
                    </Text>
                    {step.optional && (
                      <Badge colorScheme="gray" variant="subtle">
                        Optional
                      </Badge>
                    )}
                    {isComplete && !isError && (
                      <Badge colorScheme="green" variant="subtle">
                        Complete
                      </Badge>
                    )}
                    {isError && (
                      <Badge colorScheme="red" variant="solid">
                        Attention
                      </Badge>
                    )}
                    <VisuallyHidden>{statusLabel}</VisuallyHidden>
                  </HStack>
                  <Text id={descriptionId} fontSize="sm" color="gray.600">
                    {step.description}
                  </Text>
                  {isError && step.error && (
                    <Text id={errorId} fontSize="sm" color="red.600">
                      {step.error}
                    </Text>
                  )}
                </Stack>
              </HStack>
            </Button>
          );

          return (
            <Step key={step.id} w="full" data-status-color={statusColor}>
              {tooltip ? (
                <Tooltip label={tooltip} placement="top" hasArrow isDisabled={!tooltip} openDelay={300}>
                  <Box w="full">{button}</Box>
                </Tooltip>
              ) : (
                <Box w="full">{button}</Box>
              )}
              {index < steps.length - 1 && (
                <StepSeparator
                  borderColor={isError ? 'red.300' : isComplete ? 'purple.400' : 'gray.200'}
                  _horizontal={{ ml: 6 }}
                  _vertical={{ ml: 0, my: 4 }}
                />
              )}
            </Step>
          );
        })}
      </Stepper>
    </Stack>
  );
}
