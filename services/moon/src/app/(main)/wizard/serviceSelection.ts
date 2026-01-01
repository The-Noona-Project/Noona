import { ServiceCatalogEntry, WizardStepKey } from './types';

type StepSelections = Record<WizardStepKey, ServiceCatalogEntry[]>;

const match = (value: string | null | undefined, patterns: string[]): boolean => {
  if (!value) return false;
  return patterns.some((pattern) => value.toLowerCase().includes(pattern));
};

export const deriveStepSelections = (catalog: ServiceCatalogEntry[]): StepSelections => {
  const foundation: ServiceCatalogEntry[] = [];
  const addons: ServiceCatalogEntry[] = [];
  const verification: ServiceCatalogEntry[] = [];

  catalog.forEach((service) => {
    const category = service.category?.toLowerCase() ?? '';
    if (service.required || match(category, ['core', 'foundation'])) {
      foundation.push(service);
      return;
    }

    if (match(service.name, ['vault', 'warden', 'sage'])) {
      foundation.push(service);
      return;
    }

    if (match(category, ['addon', 'extra']) || match(service.name, ['portal', 'raven'])) {
      addons.push(service);
      return;
    }

    if (match(category, ['verification', 'check', 'health']) || match(service.name, ['verify', 'health'])) {
      verification.push(service);
      return;
    }

    addons.push(service);
  });

  if (verification.length === 0) {
    verification.push(...catalog);
  }

  return {
    foundation,
    addons,
    verification,
  };
};
