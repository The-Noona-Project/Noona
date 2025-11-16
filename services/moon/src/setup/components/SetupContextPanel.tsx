import React from 'react';
import { Card, CardBody, CardFooter, CardHeader, Heading, Stack, Text } from '@chakra-ui/react';

export interface SetupContextPanelProps {
  label?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export default function SetupContextPanel({
  label = 'Current Step',
  title,
  description,
  children,
  footer,
}: SetupContextPanelProps): JSX.Element {
  return (
    <Card variant="outline" borderColor="gray.200" h="full">
      <CardHeader borderBottomWidth="1px" borderColor="gray.100">
        <Stack spacing={1}>
          {label ? (
            <Text fontSize="sm" color="gray.500" textTransform="uppercase" letterSpacing="wide">
              {label}
            </Text>
          ) : null}
          <Heading size="md">{title}</Heading>
          {description ? <Text color="gray.600">{description}</Text> : null}
        </Stack>
      </CardHeader>
      <CardBody>{children}</CardBody>
      {footer ? (
        <CardFooter borderTopWidth="1px" borderColor="gray.100">
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}
