import React, { useMemo } from 'react';
import {
  Badge,
  Box,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Progress,
  Stack,
  Text,
} from '@chakra-ui/react';

function normalizeProgress(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

function formatDownloadDate(value) {
  if (!value) {
    return null;
  }
  try {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString();
    }
  } catch (error) {
    // Ignore invalid dates
  }
  return value;
}

export default function RavenLibraryCard({ item, status }) {
  const hasCover = Boolean(item?.coverImage);
  const statusState = status?.state ?? null;

  const isInProgress = useMemo(() => {
    if (!statusState) {
      return false;
    }
    return ['pending', 'downloading', 'queued'].includes(statusState);
  }, [statusState]);

  const isFailed = statusState === 'failed';
  const isCompleted = statusState === 'completed';

  const progressValue = normalizeProgress(status?.progress);

  const statusMessage = useMemo(() => {
    if (!status) {
      return '';
    }
    if (status.message) {
      return status.message;
    }
    if (isCompleted) {
      return 'Download completed';
    }
    if (isFailed) {
      return 'Download failed';
    }
    if (statusState === 'queued') {
      return 'Queued';
    }
    if (isInProgress) {
      return 'Downloading';
    }
    return '';
  }, [isCompleted, isFailed, isInProgress, status, statusState]);

  const subtitle = item?.subtitle ?? item?.author ?? item?.series ?? '';
  const downloadedAtLabel = formatDownloadDate(item?.downloadedAt);

  const statusColor = isCompleted ? 'green' : isFailed ? 'red' : 'purple';
  const statusLabel = isCompleted
    ? 'Ready'
    : isFailed
    ? 'Failed'
    : isInProgress
    ? 'Downloading'
    : statusState ?? 'Pending';

  return (
    <Card data-testid="raven-library-card" height="100%" variant="outline">
      {hasCover && (
        <Box
          as="img"
          src={item.coverImage}
          alt={item.title ?? 'Series cover'}
          height="160px"
          objectFit="cover"
          borderTopLeftRadius="md"
          borderTopRightRadius="md"
        />
      )}
      <CardHeader pb={0}>
        <Stack spacing={1}>
          <Text fontWeight="bold" fontSize="lg">
            {item?.title ?? 'Untitled series'}
          </Text>
          {subtitle ? (
            <Text fontSize="sm" color="gray.500">
              {subtitle}
            </Text>
          ) : null}
        </Stack>
      </CardHeader>
      <CardBody>
        <Stack spacing={3}>
          {item?.description ? (
            <Text fontSize="sm" color="gray.600" _dark={{ color: 'gray.300' }}>
              {item.description}
            </Text>
          ) : null}
          {statusState && (
            <Badge colorScheme={statusColor} width="fit-content">
              {statusLabel}
            </Badge>
          )}
          {progressValue !== null && (
            <Progress
              value={progressValue}
              size="sm"
              colorScheme="purple"
              borderRadius="full"
              data-testid="download-progress"
            />
          )}
          {statusMessage && (
            <Text fontSize="sm" color={isFailed ? 'red.500' : 'gray.600'}>
              {statusMessage}
            </Text>
          )}
        </Stack>
      </CardBody>
      {downloadedAtLabel && (
        <CardFooter pt={0}>
          <Text fontSize="xs" color="gray.500">
            Downloaded {downloadedAtLabel}
          </Text>
        </CardFooter>
      )}
    </Card>
  );
}
