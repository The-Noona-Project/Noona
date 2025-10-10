import React, {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { fetchWizardState as fetchWizardStateRequest, type WizardState } from '../setup/api.ts';
import { normalizeServiceList, resolveServiceInstalled, type ServiceEntry } from '../utils/serviceStatus.ts';

type FetchServicesFn = (force?: boolean) => Promise<ServiceEntry[]>;
type FetchWizardStateFn = (force?: boolean) => Promise<WizardState>;

export interface ServiceNavigationItem {
  title: string;
  icon: string;
  path: string;
  description: string;
  requiredService: string | null;
}

export const SERVICE_NAVIGATION_CONFIG: ServiceNavigationItem[] = [
  {
    title: 'Home',
    icon: 'mdi-home',
    path: '/',
    description: 'Overview of the Moon control center.',
    requiredService: null,
  },
  {
    title: 'Setup',
    icon: 'mdi-cog-play',
    path: '/setup',
    description: 'Guide for configuring your deployment.',
    requiredService: null,
  },
  {
    title: 'Warden',
    icon: 'mdi-shield-crown',
    path: '/warden',
    description: 'Orchestrator for the entire stack.',
    requiredService: 'noona-warden',
  },
  {
    title: 'Vault',
    icon: 'mdi-safe-square',
    path: '/vault',
    description: 'Authentication and data access gateway.',
    requiredService: 'noona-vault',
  },
  {
    title: 'Portal',
    icon: 'mdi-transit-connection-variant',
    path: '/portal',
    description: 'External integrations hub.',
    requiredService: 'noona-portal',
  },
  {
    title: 'Sage',
    icon: 'mdi-chart-box-outline',
    path: '/sage',
    description: 'Monitoring and logging backbone.',
    requiredService: 'noona-sage',
  },
  {
    title: 'Moon Service',
    icon: 'mdi-moon-waning-crescent',
    path: '/moon-service',
    description: 'Web-based control center features.',
    requiredService: 'noona-moon',
  },
  {
    title: 'Raven',
    icon: 'mdi-crow',
    path: '/raven',
    description: 'Custom Java-based scraper/downloader.',
    requiredService: 'noona-raven',
  },
  {
    title: 'Oracle',
    icon: 'mdi-crystal-ball',
    path: '/oracle',
    description: 'AI assistant layer for insights.',
    requiredService: 'noona-oracle',
  },
];

export interface ServiceInstallationState {
  services: ServiceEntry[];
  loading: boolean;
  error: string;
  navigationItems: ServiceNavigationItem[];
  hasPendingSetup: boolean;
  wizardState: WizardState | null;
  wizardLoading: boolean;
  wizardError: string;
  ensureLoaded: () => Promise<ServiceEntry[]>;
  refresh: () => Promise<ServiceEntry[]>;
  refreshWizard: () => Promise<WizardState | null>;
  isServiceInstalled: (name: string | null | undefined) => boolean;
}

const ServiceInstallationContext = createContext<ServiceInstallationState | undefined>(undefined);

async function defaultFetchServices(): Promise<ServiceEntry[]> {
  const response = await fetch('/api/setup/services', {
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const payload = await response.json();
  return normalizeServiceList(payload);
}

async function defaultFetchWizardState(): Promise<WizardState> {
  return await fetchWizardStateRequest();
}

export interface ServiceInstallationProviderProps extends PropsWithChildren {
  initialServices?: ServiceEntry[];
  fetchServices?: FetchServicesFn;
  initialWizardState?: WizardState | null;
  fetchWizardState?: FetchWizardStateFn;
}

export function ServiceInstallationProvider({
  children,
  initialServices = [],
  fetchServices = defaultFetchServices,
  initialWizardState: initialWizardStateProp,
  fetchWizardState = defaultFetchWizardState,
}: ServiceInstallationProviderProps): JSX.Element {
  const [services, setServices] = useState<ServiceEntry[]>(() =>
    initialServices.map((item) => ({
      ...item,
      name: typeof item.name === 'string' ? item.name : '',
      installed: resolveServiceInstalled(item),
    })),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [wizardState, setWizardState] = useState<WizardState | null>(
    initialWizardStateProp ?? null,
  );
  const [wizardLoading, setWizardLoading] = useState(false);
  const [wizardError, setWizardError] = useState('');

  const servicesRef = useRef<ServiceEntry[]>(services);
  const loadPromiseRef = useRef<Promise<ServiceEntry[]> | null>(null);
  const fetcherRef = useRef<FetchServicesFn>(fetchServices);
  const wizardFetcherRef = useRef<FetchWizardStateFn>(fetchWizardState);
  const wizardStateRef = useRef<WizardState | null>(initialWizardStateProp ?? null);
  const wizardLoadedRef = useRef<boolean>(initialWizardStateProp !== undefined);

  useEffect(() => {
    servicesRef.current = services;
  }, [services]);

  useEffect(() => {
    fetcherRef.current = fetchServices;
  }, [fetchServices]);

  useEffect(() => {
    wizardFetcherRef.current = fetchWizardState;
  }, [fetchWizardState]);

  useEffect(() => {
    wizardStateRef.current = wizardState;
  }, [wizardState]);

  const loadServices = useCallback(
    async (force = false): Promise<ServiceEntry[]> => {
      if (!force) {
        if (loadPromiseRef.current) {
          return loadPromiseRef.current;
        }
        if (servicesRef.current.length > 0 && wizardLoadedRef.current) {
          return servicesRef.current;
        }
      }

      setLoading(true);
      setWizardLoading(true);
      setError('');
      setWizardError('');

      const pending = (async () => {
        try {
          const wizardPromise = wizardFetcherRef.current(force)
            .then((state) => ({ state, error: null as string | null }))
            .catch((cause) => {
              const message =
                cause instanceof Error
                  ? cause.message
                  : 'Failed to load wizard state';
              setWizardError(message);
              return { state: wizardStateRef.current, error: message };
            });

          const [list, wizardResult] = await Promise.all([
            fetcherRef.current(force),
            wizardPromise,
          ]);

          const normalized = list.map((item) => ({
            ...item,
            name: typeof item.name === 'string' ? item.name : '',
            installed: resolveServiceInstalled(item),
          }));
          servicesRef.current = normalized;
          setServices(normalized);

          if (!wizardResult.error) {
            setWizardError('');
          }

          setWizardState(wizardResult.state ?? null);
          wizardStateRef.current = wizardResult.state ?? null;
          wizardLoadedRef.current = !wizardResult.error;

          return normalized;
        } catch (cause) {
          servicesRef.current = [];
          setServices([]);
          const message =
            cause instanceof Error ? cause.message : 'Failed to load services';
          setError(message);
          throw cause;
        } finally {
          setLoading(false);
          setWizardLoading(false);
          loadPromiseRef.current = null;
        }
      })();

      loadPromiseRef.current = pending;
      return pending;
    },
    [],
  );

  const ensureLoaded = useCallback(async (): Promise<ServiceEntry[]> => {
    try {
      return await loadServices(false);
    } catch (cause) {
      console.error('Failed to load service installation state', cause);
      return [];
    }
  }, [loadServices]);

  const refresh = useCallback(() => loadServices(true), [loadServices]);

  const refreshWizard = useCallback(async (): Promise<WizardState | null> => {
    setWizardLoading(true);
    setWizardError('');
    try {
      const state = await wizardFetcherRef.current(true);
      setWizardState(state ?? null);
      wizardStateRef.current = state ?? null;
      wizardLoadedRef.current = true;
      return state;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Failed to load wizard state';
      setWizardError(message);
      wizardLoadedRef.current = false;
      throw cause;
    } finally {
      setWizardLoading(false);
    }
  }, []);

  const installedServiceNames = useMemo(() => {
    const installed = new Set<string>();
    services.forEach((service) => {
      if (service && typeof service.name === 'string' && resolveServiceInstalled(service)) {
        installed.add(service.name);
      }
    });
    return installed;
  }, [services]);

  const wizardCompleted = wizardState?.completed === true;
  const hasPendingSetup = !wizardCompleted;

  const navigationItems = useMemo(() => {
    return SERVICE_NAVIGATION_CONFIG.filter((item) => {
      if (item.path === '/setup') {
        return hasPendingSetup;
      }
      if (!item.requiredService) {
        return true;
      }
      return installedServiceNames.has(item.requiredService);
    });
  }, [hasPendingSetup, installedServiceNames]);

  const isServiceInstalled = useCallback(
    (name: string | null | undefined) => {
      if (!name) {
        return true;
      }
      return installedServiceNames.has(name);
    },
    [installedServiceNames],
  );

  const value = useMemo<ServiceInstallationState>(
    () => ({
      services,
      loading,
      error,
      navigationItems,
      hasPendingSetup,
      wizardState,
      wizardLoading,
      wizardError,
      ensureLoaded,
      refresh,
      refreshWizard,
      isServiceInstalled,
    }),
    [
      services,
      loading,
      error,
      navigationItems,
      hasPendingSetup,
      wizardState,
      wizardLoading,
      wizardError,
      ensureLoaded,
      refresh,
      refreshWizard,
      isServiceInstalled,
    ],
  );

  return (
    <ServiceInstallationContext.Provider value={value}>
      {children}
    </ServiceInstallationContext.Provider>
  );
}

export function useServiceInstallation(): ServiceInstallationState {
  const context = useContext(ServiceInstallationContext);
  if (!context) {
    throw new Error(
      'useServiceInstallation must be used within a ServiceInstallationProvider',
    );
  }
  return context;
}

export function getRequiredServiceForPath(path: string): string | null {
  const match = SERVICE_NAVIGATION_CONFIG.find((item) => item.path === path);
  return match?.requiredService ?? null;
}

