'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  NdjsonEnvelope,
  SelectionPreview,
  ServiceCatalogEntry,
  ServiceSelection,
  WizardHistoryResponse,
  WizardMetadata,
  InstallProgress,
  WizardState,
  WizardStepKey,
} from './types';
import {
  loadServiceCatalog,
  loadWizardHistory,
  loadWizardMetadata,
  loadWizardProgress,
  loadWizardState,
  streamServicePreview,
  streamServiceValidation,
} from './api';
import { deriveStepSelections } from './serviceSelection';

type ValidationState = Partial<Record<WizardStepKey, string[]>>;

type WizardModel = {
  metadata: WizardMetadata | null;
  wizard: WizardState | null;
  progress: InstallProgress | null;
  currentStep: WizardStepKey;
  setCurrentStep: (step: WizardStepKey) => void;
  stepSelections: ReturnType<typeof deriveStepSelections>;
  serviceCatalog: ServiceCatalogEntry[];
  validationErrors: ValidationState;
  ndjsonEvents: NdjsonEnvelope<SelectionPreview | { services: ServiceSelection[] }>[];
  refresh: () => Promise<void>;
  loadHistory: (step: WizardStepKey, limit?: number) => Promise<WizardHistoryResponse>;
  previewSelection: (services: ServiceSelection[]) => Promise<NdjsonEnvelope<SelectionPreview>[]>;
  validateSelection: (services: ServiceSelection[]) => Promise<NdjsonEnvelope<{ services: ServiceSelection[] }>[]>;
  error: string | null;
};

const WizardContext = createContext<WizardModel | null>(null);

const DEFAULT_VALIDATION: ValidationState = {
  foundation: [],
  portal: [],
  raven: [],
  verification: [],
};

export const WizardProvider = ({ children }: { children: React.ReactNode }) => {
  const [metadata, setMetadata] = useState<WizardMetadata | null>(null);
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogEntry[]>([]);
  const [currentStep, setCurrentStep] = useState<WizardStepKey>('foundation');
  const [validationErrors, setValidationErrors] = useState<ValidationState>(DEFAULT_VALIDATION);
  const [ndjsonEvents, setNdjsonEvents] = useState<
    NdjsonEnvelope<SelectionPreview | { services: ServiceSelection[] }>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [loadedMetadata, loadedState, loadedProgress, catalogResult] = await Promise.all([
        loadWizardMetadata(),
        loadWizardState(),
        loadWizardProgress(),
        loadServiceCatalog(),
      ]);
      setMetadata(loadedMetadata);
      setWizard(loadedProgress?.wizard ?? loadedState);
      setProgress(loadedProgress?.progress ?? null);
      setServiceCatalog(catalogResult.services);

      if (loadedMetadata.steps.some((entry) => entry.id === currentStep) === false) {
        setCurrentStep(loadedMetadata.steps[0]?.id ?? 'foundation');
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to load wizard state';
      setError(message);
    }
  }, [currentStep]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetValidation = useCallback(() => {
    setValidationErrors({ ...DEFAULT_VALIDATION });
  }, []);

  const previewSelection = useCallback(
    async (services: ServiceSelection[]) => {
      resetValidation();
      try {
        const events = await streamServicePreview(services);
        setNdjsonEvents(events);
        return events;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Preview failed';
        setError(message);
        throw caught;
      }
    },
    [resetValidation],
  );

  const validateSelection = useCallback(
    async (services: ServiceSelection[]) => {
      resetValidation();
      try {
        const events = await streamServiceValidation(services);
        setNdjsonEvents(events);
        if (events.some((entry) => entry.error)) {
          setValidationErrors((previous) => ({
            ...previous,
            [currentStep]: events.filter((entry) => entry.error).map((entry) => entry.error ?? ''),
          }));
        }
        return events;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Validation failed';
        setError(message);
        throw caught;
      }
    },
    [currentStep, resetValidation],
  );

  const loadHistory = useCallback(async (step: WizardStepKey, limit?: number) => {
    try {
      return await loadWizardHistory(step, limit);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to load history';
      setError(message);
      throw caught;
    }
  }, []);

  const stepSelections = useMemo(() => deriveStepSelections(serviceCatalog), [serviceCatalog]);

  const contextValue: WizardModel = {
    metadata,
    wizard,
    progress,
    currentStep,
    setCurrentStep,
    stepSelections,
    serviceCatalog,
    validationErrors,
    ndjsonEvents,
    refresh,
    loadHistory,
    previewSelection,
    validateSelection,
    error,
  };

  return <WizardContext.Provider value={contextValue}>{children}</WizardContext.Provider>;
};

export const useWizardModel = (): WizardModel => {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error('useWizardModel must be used within a WizardProvider');
  }
  return context;
};
