import React from 'react';
import {
  Alert,
  AlertIcon,
  Button,
  FormControl,
  FormLabel,
  FormErrorMessage,
  FormHelperText,
  HStack,
  Icon,
  Input,
  Stack,
  Text,
  Tooltip,
} from '@chakra-ui/react';
import { mdiLockOutline } from '@mdi/js';
import type { EnvSection } from '../useSetupSteps.ts';

interface EnvironmentEditorProps {
  sections: EnvSection[];
  onChange: (serviceName: string, key: string, value: string) => void;
  onDetectRaven: () => void;
  detectingRaven: boolean;
  ravenDetectionError: string;
}

export default function EnvironmentEditor({
  sections,
  onChange,
  onDetectRaven,
  detectingRaven,
  ravenDetectionError,
}: EnvironmentEditorProps) {
  if (sections.length === 0) {
    return (
      <Alert status="info" borderRadius="md">
        <AlertIcon />
        Select at least one service to review configuration.
      </Alert>
    );
  }

  return (
    <Stack spacing={8} data-testid="environment-editor">
      {sections.map((section) => (
        <Stack key={section.service.name} spacing={4} borderWidth="1px" borderRadius="md" p={6}>
          <HStack justify="space-between" align="flex-start">
            <Stack spacing={1}>
              <Text fontSize="lg" fontWeight="bold">
                {section.service.displayName}
              </Text>
              <Text fontSize="sm" color="gray.600">
                Configure environment variables for {section.service.displayName} before installation.
              </Text>
            </Stack>
            {section.service.name === 'noona-raven' && (
              <Stack spacing={2} align="flex-end">
                <Button
                  colorScheme="purple"
                  size="sm"
                  onClick={onDetectRaven}
                  isLoading={detectingRaven}
                  loadingText="Detecting"
                  data-testid="detect-raven"
                >
                  Detect Kavita mount
                </Button>
                {ravenDetectionError && (
                  <Text color="red.500" fontSize="sm" data-testid="raven-detect-error">
                    {ravenDetectionError}
                  </Text>
                )}
              </Stack>
            )}
          </HStack>
          <Stack spacing={6}>
            {section.fields.map((field) => (
              <FormControl
                key={field.key}
                isRequired={field.required}
                isInvalid={!!field.error}
                data-testid={`env-field-${section.service.name}-${field.key}`}
              >
                <HStack spacing={2} align="center">
                  <FormLabel mb={0}>{field.label}</FormLabel>
                  {field.readOnly && (
                    <Tooltip label="This value is managed automatically" placement="top">
                      <Icon viewBox="0 0 24 24" boxSize={4} color="gray.500">
                        <path d={mdiLockOutline} />
                      </Icon>
                    </Tooltip>
                  )}
                </HStack>
                <Input
                  value={field.value}
                  onChange={(event) => onChange(section.service.name, field.key, event.target.value)}
                  isReadOnly={field.readOnly}
                  variant={field.readOnly ? 'filled' : 'outline'}
                />
                {field.description && (
                  <FormHelperText>{field.description}</FormHelperText>
                )}
                {field.warning && (
                  <Text fontSize="sm" color="orange.500">
                    {field.warning}
                  </Text>
                )}
                {field.error && <FormErrorMessage>{field.error}</FormErrorMessage>}
              </FormControl>
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}
