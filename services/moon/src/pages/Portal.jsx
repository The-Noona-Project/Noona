import React from 'react';
import { Heading, Stack, Text } from '@chakra-ui/react';

export default function PortalPage() {
  return (
    <Stack spacing={4} data-testid="portal-page">
      <Heading size="lg">Portal</Heading>
      <Text color="gray.600">
        Manage Discord integrations, configure webhooks, and bridge guild events into the Noona stack.
      </Text>
    </Stack>
  );
}
