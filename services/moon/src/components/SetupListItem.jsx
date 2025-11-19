import React, { useMemo } from 'react';
import { Checkbox, StatusBadge } from '@textkernel/oneui';
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
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d={path} />
    </svg>
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

  const checkboxId = `setup-service-${service?.name ?? 'unknown'}`;

  return (
    <div
      role="checkbox"
      aria-checked={selected}
      aria-disabled={isDisabled}
      aria-required={isLocked}
      aria-label={service?.name ?? 'Service option'}
      tabIndex={isDisabled ? -1 : 0}
      className={`setup-list-item${selected ? ' is-selected' : ''}${
        isDisabled && !isLocked ? ' is-disabled' : ''
      }`}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      data-testid={`setup-item-${service?.name ?? 'unknown'}`}
    >
      <div className="setup-list-item__header">
        <Checkbox
          id={checkboxId}
          checked={selected}
          disabled={isDisabled}
          onChange={(event) => {
            event.stopPropagation();
            handleToggle();
          }}
          aria-label={service?.name ?? 'Service option'}
        />
        <div className="setup-list-item__title-group">
          <div className="setup-list-item__title-row">
            <span className="setup-list-item__name">{service?.name ?? 'Unknown service'}</span>
            <StatusBadge context="neutral" variant="subtle">
              {categoryLabel}
            </StatusBadge>
            {isInstalled && (
              <StatusBadge context="success" variant="subtle">
                <span className="setup-list-item__badge-content">
                  <MdiIcon name="mdi-check-circle-outline" /> Installed
                </span>
              </StatusBadge>
            )}
            {isLocked && (
              <StatusBadge context="critical" variant="bold">
                Required
              </StatusBadge>
            )}
          </div>
          <p className="setup-list-item__description">{descriptionText}</p>
        </div>
      </div>

      <dl className="setup-list-item__meta">
        <div className="setup-list-item__meta-row">
          <dt>Image</dt>
          <dd>{service?.image ?? 'Unknown'}</dd>
        </div>
        {service?.hostServiceUrl ? (
          <div className="setup-list-item__meta-row">
            <dt>Host URL</dt>
            <dd>
              <a href={service.hostServiceUrl} target="_blank" rel="noreferrer">
                {service.hostServiceUrl}
              </a>
            </dd>
          </div>
        ) : service?.port != null ? (
          <div className="setup-list-item__meta-row">
            <dt>Port</dt>
            <dd>{service.port}</dd>
          </div>
        ) : null}
        {service?.health && (
          <div className="setup-list-item__meta-row">
            <dt>Health</dt>
            <dd>{service.health}</dd>
          </div>
        )}
        {service?.status && (
          <div className="setup-list-item__meta-row">
            <dt>Status</dt>
            <dd>
              <StatusBadge context={isInstalled ? 'success' : 'info'} variant="subtle">
                {service.status}
              </StatusBadge>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
