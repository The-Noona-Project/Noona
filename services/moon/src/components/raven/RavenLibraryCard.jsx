import React, { useMemo } from 'react';
import { ProgressBar, StatusBadge, Text as OneUIText } from '@textkernel/oneui';
import tokens from '../../theme/tokens.js';

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
    <article className="raven-card" data-testid="raven-library-card">
      {hasCover && (
        <img className="raven-card__cover" src={item.coverImage} alt={item.title ?? 'Series cover'} />
      )}
      <div className="raven-card__header">
        <p className="raven-card__title">{item?.title ?? 'Untitled series'}</p>
        {subtitle ? <p className="raven-card__subtitle">{subtitle}</p> : null}
      </div>
      <div className="raven-card__body">
        {item?.description ? (
          <OneUIText size="small" className="raven-card__description">
            {item.description}
          </OneUIText>
        ) : null}
        {statusState && (
          <StatusBadge context={statusColor === 'green' ? 'success' : statusColor === 'red' ? 'critical' : 'info'} variant="subtle">
            {statusLabel}
          </StatusBadge>
        )}
        {progressValue !== null && (
          <ProgressBar
            percentage={progressValue}
            animated
            small
            data-testid="download-progress"
            style={{ marginTop: tokens.spacing.sm }}
          />
        )}
        {statusMessage && (
          <OneUIText size="small" context={isFailed ? 'critical' : 'neutral'}>
            {statusMessage}
          </OneUIText>
        )}
      </div>
      {downloadedAtLabel && (
        <div className="raven-card__footer">
          <OneUIText size="small" context="neutral">
            Downloaded {downloadedAtLabel}
          </OneUIText>
        </div>
      )}
    </article>
  );
}
