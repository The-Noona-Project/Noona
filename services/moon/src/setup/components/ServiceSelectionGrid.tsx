import React, { useMemo } from 'react';
import {
  Badge,
  Box,
  HStack,
  Icon,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
  useColorModeValue,
  Checkbox,
  Alert,
  AlertIcon,
} from '@chakra-ui/react';
import { mdiAlert, mdiCheckboxMarkedCircleOutline } from '@mdi/js';
import type { SetupService } from '../useSetupSteps.ts';

interface ServiceSelectionGridProps {
  services: SetupService[];
  selected: Set<string>;
  selectionErrors: string[];
  onToggle: (name: string) => void;
}

function buildDependencyLabel(service: SetupService): string | null {
  if (!service.dependencies.length) {
    return null;
  }

  return `Requires ${service.dependencies
    .map((name) => name.replace(/^noona-/, '').replace(/-/g, ' '))
    .join(', ')}`;
}

export default function ServiceSelectionGrid({
  services,
  selected,
  selectionErrors,
  onToggle,
}: ServiceSelectionGridProps) {
  const sorted = useMemo(() => {
    return [...services].sort((a, b) => {
      if (a.installed && !b.installed) return 1;
      if (!a.installed && b.installed) return -1;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [services]);

  const cardBg = useColorModeValue('white', 'gray.900');
  const activeBorder = useColorModeValue('purple.500', 'purple.300');

  return (
    <Stack spacing={4} data-testid="service-selection">
      {selectionErrors.length > 0 && (
        <Alert status="warning" borderRadius="md" data-testid="service-selection-errors">
          <AlertIcon />
          <Stack spacing={1}>
            {selectionErrors.map((error) => (
              <Text key={error}>{error}</Text>
            ))}
          </Stack>
        </Alert>
      )}
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
        {sorted.map((service) => {
          const isSelected = selected.has(service.name);
          const dependencyLabel = buildDependencyLabel(service);
          return (
            <Box
              key={service.name}
              borderWidth="1px"
              borderRadius="md"
              p={4}
              bg={cardBg}
              borderColor={isSelected ? activeBorder : 'gray.200'}
              boxShadow={isSelected ? 'outline' : 'sm'}
              cursor="pointer"
              role="group"
              data-testid={`service-card-${service.name}`}
              onClick={() => onToggle(service.name)}
            >
              <Stack spacing={3}>
                <HStack justify="space-between">
                  <Text fontSize="lg" fontWeight="bold">
                    {service.displayName}
                  </Text>
                  {service.installed ? (
                    <Badge colorScheme="green" display="flex" alignItems="center" gap={1}>
                      <Icon viewBox="0 0 24 24" boxSize={4}>
                        <path d={mdiCheckboxMarkedCircleOutline} />
                      </Icon>
                      Installed
                    </Badge>
                  ) : service.recommended ? (
                    <Badge colorScheme="purple">Recommended</Badge>
                  ) : (
                    <Badge colorScheme="gray">Optional</Badge>
                  )}
                </HStack>

                <Text fontSize="sm" color="gray.600">
                  {service.description}
                </Text>

                <HStack justify="space-between" align="center">
                  <Checkbox
                    isChecked={isSelected}
                    onChange={() => onToggle(service.name)}
                    colorScheme="purple"
                    size="lg"
                  >
                    Include in installation
                  </Checkbox>
                  {dependencyLabel && (
                    <Tooltip label={dependencyLabel} placement="top">
                      <Box color="orange.400">
                        <Icon viewBox="0 0 24 24" boxSize={5}>
                          <path d={mdiAlert} />
                        </Icon>
                      </Box>
                    </Tooltip>
                  )}
                </HStack>
              </Stack>
            </Box>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
