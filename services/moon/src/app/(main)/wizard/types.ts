export type WizardStepKey = 'foundation' | 'portal' | 'raven' | 'verification';
export type WizardStatus = 'pending' | 'in-progress' | 'complete' | 'error' | 'skipped';

export interface WizardActor {
  id: string | null;
  type: string | null;
  label: string | null;
  avatarUrl: string | null;
  metadata: Record<string, unknown> | null;
}

export interface WizardTimelineEvent {
  id: string | null;
  timestamp: string | null;
  status: string | null;
  message: string | null;
  detail: string | null;
  code: string | null;
  actor: WizardActor | null;
  context: Record<string, unknown> | null;
}

export interface WizardStepState {
  status: WizardStatus;
  detail: string | null;
  error: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  retries: number;
  timeline: WizardTimelineEvent[];
  actor: WizardActor | null;
}

export interface WizardState {
  version?: number;
  updatedAt: string | null;
  completed: boolean;
  foundation: WizardStepState;
  portal: WizardStepState;
  raven: WizardStepState;
  verification: WizardStepState;
}

export interface WizardStepMetadata {
  id: WizardStepKey;
  title: string;
  description: string;
  optional: boolean;
  icon: string | null;
  capabilities: string[];
}

export interface WizardMetadata {
  steps: WizardStepMetadata[];
  featureFlags?: Record<string, boolean>;
}

export interface InstallProgressItem {
  name: string;
  status: string;
  percent?: number | null;
  detail?: string | null;
}

export interface InstallProgress {
  items: InstallProgressItem[];
  status: string | null;
  percent: number | null;
}

export interface WizardProgressPayload {
  wizard: WizardState;
  progress: InstallProgress;
}

export interface WizardHistoryResponse {
  step: WizardStepKey;
  events: WizardTimelineEvent[];
}

export interface ServiceCatalogEntry {
  name: string;
  category?: string | null;
  description?: string | null;
  required?: boolean;
  installed?: boolean;
  hostServiceUrl?: string | null;
  envConfig?: Array<{ key: string; required?: boolean }> | null;
}

export interface ServiceSelection {
  name: string;
  env?: Record<string, string>;
}

export interface SelectionPreviewSummary {
  total: number;
  known: number;
  unknown: number;
}

export interface SelectionPreviewEntry {
  name: string;
  env: Record<string, string>;
  known: boolean;
}

export interface SelectionPreview {
  services: SelectionPreviewEntry[];
  summary: SelectionPreviewSummary;
}

export interface NdjsonEnvelope<T = unknown> {
  type: string;
  data?: T;
  error?: string;
}
