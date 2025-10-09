import React, { useMemo } from 'react';
import {
  Badge,
  Box,
  Checkbox,
  HStack,
  Icon,
  Link,
  Stack,
  Tag,
  Text,
  VStack,
} from '@chakra-ui/react';
import { getIconPath } from './icons.js';

function normalizeCategoryLabel(category) {
  if (!category) {
    return 'Service';
  }
  if (category === 'core') {
    return 'Core Service';
  }
  if (category === 'addon') {
    return 'Addon';
  }
  return category
    .toString()
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function categoryDescription(service) {
  if (service?.description) {
    return service.description;
  }
  if (service?.category === 'core') {
    return 'Essential Noona component.';
  }
  if (service?.category === 'addon') {
    return 'Optional add-on service.';
  }
  return 'Service configuration';
}

function MdiIcon({ name }) {
  const path = getIconPath(name);
  return (
    <Icon viewBox="0 0 24 24" boxSize="1rem">
      <path fill="currentColor" d={path} />
    </Icon>
  );
}

export default function SetupListItem({
  service,
  selected = false,
  disabled = false,
  installed = false,
  onToggle,
}) {
  const isLocked = service?.required === true;
  const isInstalled = installed === true;
  const isDisabled = disabled || isLocked || isInstalled;

  const categoryLabel = useMemo(
    () => normalizeCategoryLabel(service?.category ?? 'service'),
    [service?.category],
  );

  const descriptionText = useMemo(() => categoryDescription(service), [service]);

  const handleToggle = () => {
    if (isDisabled) {
      return;
    }
    onToggle?.(service?.name ?? '');
  };

  const handleKeyDown = (event) => {
    if (isDisabled) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleToggle();
    }
  };

  return (
    <Box
      role="checkbox"
      aria-checked={selected}
      aria-disabled={isDisabled}
      aria-required={isLocked}
      aria-label={service?.name ?? 'Service option'}
      tabIndex={isDisabled ? -1 : 0}
      borderWidth="1px"
      borderRadius="lg"
      p={4}
      bg={selected ? 'purple.50' : 'white'}
      _dark={{ bg: selected ? 'purple.900' : 'gray.800', borderColor: 'whiteAlpha.300' }}
      cursor={isDisabled ? 'not-allowed' : 'pointer'}
      opacity={isDisabled && !isLocked ? 0.75 : 1}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      transition="box-shadow 0.2s ease, transform 0.2s ease"
      _hover={{
        boxShadow: isDisabled ? undefined : 'lg',
      }}
      data-testid={`setup-item-${service?.name ?? 'unknown'}`}
    >
      <HStack align="flex-start" spacing={4} mb={3}>
        <Checkbox
          isChecked={selected}
          isDisabled={isDisabled}
          onChange={(event) => {
            event.stopPropagation();
            handleToggle();
          }}
          onClick={(event) => event.stopPropagation()}
          size="lg"
          aria-label={service?.name ?? 'Service option'}
        />
        <VStack align="flex-start" spacing={2} flex="1">
          <HStack spacing={2} align="center" flexWrap="wrap">
            <Text fontWeight="semibold" fontSize="lg">
              {service?.name ?? 'Unknown service'}
            </Text>
            <Tag size="sm" colorScheme="purple" textTransform="uppercase">
              {categoryLabel}
            </Tag>
            {isInstalled && (
              <Tag size="sm" colorScheme="green" textTransform="uppercase">
                <HStack spacing={1}>
                  <MdiIcon name="mdi-check-circle-outline" />
                  <Text>Installed</Text>
                </HStack>
              </Tag>
            )}
            {isLocked && (
              <Tag size="sm" colorScheme="red" textTransform="uppercase">
                Required
              </Tag>
            )}
          </HStack>
          <Text fontSize="sm" color="gray.600" _dark={{ color: 'gray.300' }}>
            {descriptionText}
          </Text>
        </VStack>
      </HStack>

      <Stack spacing={1} fontSize="sm" color="gray.600" _dark={{ color: 'gray.300' }}>
        <HStack>
          <Text fontWeight="medium">Image:</Text>
          <Text>{service?.image ?? 'Unknown'}</Text>
        </HStack>
        {service?.hostServiceUrl ? (
          <HStack>
            <Text fontWeight="medium">Host URL:</Text>
            <Link href={service.hostServiceUrl} isExternal color="purple.500">
              {service.hostServiceUrl}
            </Link>
          </HStack>
        ) : service?.port != null ? (
          <HStack>
            <Text fontWeight="medium">Port:</Text>
            <Text>{service.port}</Text>
          </HStack>
        ) : null}
        {service?.health && (
          <HStack>
            <Text fontWeight="medium">Health:</Text>
            <Text>{service.health}</Text>
          </HStack>
        )}
        {service?.status && (
          <HStack>
            <Text fontWeight="medium">Status:</Text>
            <Badge colorScheme={isInstalled ? 'green' : 'gray'}>{service.status}</Badge>
          </HStack>
        )}
      </Stack>
    </Box>
  );
}
