import React from 'react';
import { Heading, Stack, Text } from '@chakra-ui/react';

export default function MoonServicePage() {
  return (
    <Stack spacing={4} data-testid="moon-service-page">
      <Heading size="lg">Moon Service</Heading>
      <Text color="gray.600">
        Configure the Moon web experience, enable authentication providers, and surface dashboards for
        admins and readers.
      </Text>
    </Stack>
  );
}
