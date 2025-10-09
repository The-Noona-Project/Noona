import React from 'react';
import { Badge, Box, Button, HStack, Stack, Text, Tooltip } from '@chakra-ui/react';
import type { SetupStepDefinition, SetupStepId } from '../useSetupSteps.ts';

const STATUS_COLOR: Record<SetupStepDefinition['status'], string> = {
  current: 'purple',
  complete: 'green',
  upcoming: 'gray',
  error: 'red',
};

interface SetupStepperProps {
  steps: SetupStepDefinition[];
  currentStepId: SetupStepId;
  onSelect: (id: SetupStepId) => void;
}

export default function SetupStepper({ steps, currentStepId, onSelect }: SetupStepperProps) {
  return (
    <Stack direction={{ base: 'column', md: 'row' }} spacing={4} data-testid="setup-stepper">
      {steps.map((step, index) => {
        const isCurrent = step.id === currentStepId;
        const isComplete = step.status === 'complete';
        const isError = step.status === 'error';
        const colorScheme = STATUS_COLOR[step.status] ?? 'gray';
        const tooltip = step.error || step.description;

        const content = (
          <Button
            onClick={() => onSelect(step.id)}
            variant={isCurrent ? 'solid' : 'outline'}
            colorScheme={colorScheme}
            justifyContent="flex-start"
            textAlign="left"
            flex="1"
            data-testid={`setup-step-${step.id}`}
          >
            <Stack spacing={1} align="flex-start">
              <HStack spacing={2} align="center">
                <Text fontWeight="semibold">
                  {index + 1}. {step.title}
                </Text>
                {step.optional && (
                  <Badge colorScheme="gray" fontSize="0.7rem">
                    Optional
                  </Badge>
                )}
                {isComplete && !isCurrent && !isError && (
                  <Badge colorScheme="green" fontSize="0.7rem">
                    Complete
                  </Badge>
                )}
                {isError && (
                  <Badge colorScheme="red" fontSize="0.7rem">
                    Attention
                  </Badge>
                )}
              </HStack>
              <Text fontSize="sm" color="gray.600">
                {step.description}
              </Text>
            </Stack>
          </Button>
        );

        return (
          <Box key={step.id} flex="1" minW={{ base: 'auto', md: '12rem' }}>
            {tooltip ? (
              <Tooltip label={tooltip} placement="top-start" hasArrow>
                {content}
              </Tooltip>
            ) : (
              content
            )}
          </Box>
        );
      })}
    </Stack>
  );
}
