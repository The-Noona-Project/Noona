import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertIcon,
  AlertTitle,
  Box,
  Button,
  Heading,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react';
import SetupListItem from '../components/SetupListItem.jsx';
import { useServiceInstallation } from '../state/serviceInstallationContext.tsx';

export default function SetupPage() {
  const { services, loading, error, ensureLoaded, refresh } = useServiceInstallation();
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, [ensureLoaded]);

  const handleToggle = useCallback((name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const selectedLabel = useMemo(() => {
    const count = selected.size;
    if (count === 0) {
      return '';
    }
    return `${count} service${count === 1 ? '' : 's'} selected`;
  }, [selected]);

  return (
    <Stack spacing={6} data-testid="setup-page">
      <Stack spacing={2}>
        <Heading size="lg">Moon Setup Wizard</Heading>
        <Text color="gray.600">
          Follow the guided setup to install and verify each Noona service.
        </Text>
      </Stack>

      <Button
        alignSelf="flex-start"
        colorScheme="purple"
        onClick={() => refresh().catch(() => {})}
        isLoading={loading}
      >
        Refresh status
      </Button>

      {loading ? (
        <Box py={12} textAlign="center">
          <Spinner size="lg" />
        </Box>
      ) : error ? (
        <Alert status="error" variant="subtle" borderRadius="md">
          <AlertIcon />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      ) : services.length === 0 ? (
        <Alert status="info" variant="subtle" borderRadius="md">
          <AlertIcon />
          <Text>No services were returned from the control plane.</Text>
        </Alert>
      ) : (
        <Stack spacing={4}>
          {services.map((service) => (
            <SetupListItem
              key={service.name}
              service={service}
              selected={selected.has(service.name)}
              installed={service.installed}
              onToggle={handleToggle}
            />
          ))}
        </Stack>
      )}

      {selectedLabel && (
        <Alert status="info" variant="subtle" borderRadius="md">
          <AlertIcon />
          <Text>{selectedLabel}</Text>
        </Alert>
      )}
    </Stack>
  );
}
