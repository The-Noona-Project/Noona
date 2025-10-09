import React from 'react';
import { Heading, Stack, Text } from '@chakra-ui/react';

export default function WardenPage() {
  return (
    <Stack spacing={4} data-testid="warden-page">
      <Heading size="lg">Warden</Heading>
      <Text color="gray.600">
        Coordinate your deployment pipeline, manage rolling updates, and monitor orchestrator health
        across the cluster.
      </Text>
    </Stack>
  );
}
