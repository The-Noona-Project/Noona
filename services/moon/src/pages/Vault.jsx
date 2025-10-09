import React from 'react';
import { Heading, Stack, Text } from '@chakra-ui/react';

export default function VaultPage() {
  return (
    <Stack spacing={4} data-testid="vault-page">
      <Heading size="lg">Vault</Heading>
      <Text color="gray.600">
        Secure identity and access flows, configure JWT lifetimes, and review the gateway that brokers
        requests to Redis and MongoDB.
      </Text>
    </Stack>
  );
}
