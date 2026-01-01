"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Column,
  Dialog,
  Grid,
  Heading,
  Icon,
  Input,
  LetterFx,
  Line,
  List,
  ListItem,
  ProgressBar,
  Row,
  Text,
} from "@once-ui-system/core";

import { WizardProvider, useWizardModel } from "./wizard/model";
import { ServiceSelection, WizardStepKey, WizardStatus } from "./wizard/types";

const statusTone: Record<WizardStatus, string> = {
  pending: "neutral-weak",
  "in-progress": "accent-weak",
  complete: "positive-strong",
  error: "negative-strong",
  skipped: "neutral-weak",
};

const StepStatusBadge = ({ status }: { status: WizardStatus }) => (
  <Badge textVariant="label-default-s" border="neutral-alpha-strong" onBackground={statusTone[status]} gap="8">
    {status}
  </Badge>
);

const StepCard = ({
  stepId,
  onInspect,
}: {
  stepId: WizardStepKey;
  onInspect: (step: WizardStepKey) => void;
}) => {
  const { metadata, wizard, currentStep, setCurrentStep, validationErrors } = useWizardModel();
  const step = metadata?.steps.find((entry) => entry.id === stepId);
  const state = wizard?.[stepId];
  const errors = validationErrors[stepId] ?? [];

  if (!step || !state) return null;

  return (
    <Card
      key={step.id}
      padding="m"
      border="solid-medium"
      radius="l"
      gap="m"
      background={currentStep === stepId ? "surface-strong" : "surface"}
    >
      <Row align="center" justify="between" gap="s">
        <Column gap="2xs">
          <Row gap="s" align="center">
            <Heading variant="heading-strong-m">{step.title}</Heading>
            {step.optional && (
              <Badge textVariant="label-default-s" border="neutral-alpha-medium" onBackground="neutral-weak">
                Optional
              </Badge>
            )}
          </Row>
          <Text variant="body-default-s" onBackground="neutral-weak">
            {step.description}
          </Text>
        </Column>
        <StepStatusBadge status={state.status} />
      </Row>

      {state.detail && (
        <Text variant="body-default-s" onBackground="neutral-medium">
          {state.detail}
        </Text>
      )}
      {state.error && (
        <Text variant="body-default-s" onBackground="negative-strong">
          {state.error}
        </Text>
      )}

      {errors.length > 0 && (
        <Card border="dashed-medium" padding="s" gap="2xs" background="surface-strong" radius="m">
          <Row align="center" gap="s">
            <Icon name="alertTriangle" color="negative-strong" />
            <Text variant="label-strong-s" onBackground="negative-strong">
              Validation issues
            </Text>
          </Row>
          <List gap="2xs" style={{ margin: 0 }}>
            {errors.map((item) => (
              <ListItem key={item}>
                <Text variant="body-default-s" onBackground="negative-strong">
                  {item}
                </Text>
              </ListItem>
            ))}
          </List>
        </Card>
      )}

      <Row gap="s" wrap>
        <Button variant="secondary" size="s" onClick={() => onInspect(stepId)}>
          View history & guidance
        </Button>
        <Button variant="tertiary" size="s" onClick={() => setCurrentStep(stepId)}>
          Focus this step
        </Button>
      </Row>
    </Card>
  );
};

const StepDrawer = ({
  isOpen,
  onClose,
  historyLoading,
  setHistoryLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  historyLoading: boolean;
  setHistoryLoading: (value: boolean) => void;
}) => {
  const { metadata, wizard, currentStep, loadHistory } = useWizardModel();
  const [historyDetail, setHistoryDetail] = useState<{ message: string; timestamp: string | null }[]>([]);

  const step = metadata?.steps.find((entry) => entry.id === currentStep);
  const state = wizard?.[currentStep];

  useEffect(() => {
    if (!isOpen || !step) return;
    setHistoryLoading(true);
    void loadHistory(step.id, 30)
      .then((response) => {
        setHistoryDetail(
          response.events.map((entry) => ({ message: entry.message ?? "Updated", timestamp: entry.timestamp })),
        );
      })
      .finally(() => setHistoryLoading(false));
  }, [isOpen, loadHistory, setHistoryLoading, step]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Step drawer · ${step?.title ?? currentStep}`}
      description="Review timeline entries, actor context, and the latest validation summaries for this step."
      stack
      style={{ maxWidth: "960px", width: "min(960px, 92vw)", marginLeft: "auto" }}
    >
      <Column gap="m">
        <Card padding="m" border="neutral-alpha-strong" background="surface" radius="m" gap="xs">
          <Row gap="s" align="center">
            <Icon name="info" color="accent-strong" />
            <Text variant="body-strong-s">Guidance</Text>
          </Row>
          <Text variant="body-default-s" onBackground="neutral-weak">
            Keep each step in sync with backend readiness. Use this drawer to confirm actor updates, watch retry counts, and
            surface validation output before moving forward.
          </Text>
        </Card>

        <Card padding="m" border="solid-medium" radius="m" gap="s">
          <Row justify="between" align="center">
            <Text variant="heading-strong-s">Current status</Text>
            {state && <StepStatusBadge status={state.status} />}
          </Row>
          <Column gap="2xs">
            <Text variant="body-default-s" onBackground="neutral-medium">
              {state?.detail || "No extra detail provided yet."}
            </Text>
            {state?.updatedAt && (
              <Text variant="body-default-s" onBackground="neutral-weak">
                Updated at {new Date(state.updatedAt).toLocaleString()}
              </Text>
            )}
            {state?.error && (
              <Text variant="body-default-s" onBackground="negative-strong">
                {state.error}
              </Text>
            )}
          </Column>
        </Card>

        <Card padding="m" border="dashed-medium" radius="m" gap="s" background="surface-strong">
          <Row justify="between" align="center">
            <Text variant="heading-strong-s">Recent history</Text>
            <Button size="s" variant="tertiary" onClick={() => onClose()}>
              Close drawer
            </Button>
          </Row>
          {historyLoading ? (
            <Text variant="body-default-s" onBackground="neutral-weak">
              Loading activity…
            </Text>
          ) : historyDetail.length === 0 ? (
            <Text variant="body-default-s" onBackground="neutral-weak">
              No history entries captured for this step yet.
            </Text>
          ) : (
            <List gap="xs" style={{ maxHeight: "320px", overflowY: "auto", margin: 0 }}>
              {historyDetail.map((entry, index) => (
                <ListItem key={`${entry.message}-${index}`}>
                  <Column gap="2xs">
                    <Text variant="body-strong-s">{entry.message}</Text>
                    <Text variant="body-default-s" onBackground="neutral-weak">
                      {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "Timestamp unavailable"}
                    </Text>
                  </Column>
                </ListItem>
              ))}
            </List>
          )}
        </Card>
      </Column>
    </Dialog>
  );
};

const ServiceSelectionPanel = ({ onOpenDrawer }: { onOpenDrawer: () => void }) => {
  const { stepSelections, serviceCatalog } = useWizardModel();
  const requiredCount = serviceCatalog.filter((entry) => entry.required).length;
  const optionalCount = serviceCatalog.length - requiredCount;

  return (
    <Card padding="m" border="solid-medium" radius="l" gap="m" background="surface">
      <Row justify="between" align="center" gap="s">
        <Column gap="2xs">
          <Heading variant="heading-strong-m">Service selection</Heading>
          <Text variant="body-default-s" onBackground="neutral-weak">
            Use the editor drawer to toggle add-ons, enrich environment variables, and preview validation output before commits.
          </Text>
        </Column>
        <Button variant="primary" onClick={onOpenDrawer} prefixIcon="edit" size="s">
          Open settings drawer
        </Button>
      </Row>

      <Row gap="m" wrap>
        <Card padding="s" border="neutral-alpha-medium" radius="m" background="surface-strong" gap="2xs">
          <Text variant="label-strong-s">Catalog</Text>
          <Text variant="body-default-s" onBackground="neutral-weak">
            {requiredCount} required · {optionalCount} optional
          </Text>
        </Card>
        <Card padding="s" border="neutral-alpha-medium" radius="m" background="surface-strong" gap="2xs">
          <Text variant="label-strong-s">Selections</Text>
          <Text variant="body-default-s" onBackground="neutral-weak">
            Foundation: {stepSelections.foundation.length}, Add-ons: {stepSelections.addons.length}, Verification:
            {" "}
            {stepSelections.verification.length}
          </Text>
        </Card>
      </Row>

      <Grid columns="repeat(auto-fit, minmax(260px, 1fr))" gap="s">
        <Card padding="s" border="neutral-alpha-strong" radius="m" background="surface-strong" gap="2xs">
          <Text variant="label-strong-s">Foundation</Text>
          <Text variant="body-default-s" onBackground="neutral-weak">
            {stepSelections.foundation.length === 0
              ? "No base services detected yet."
              : stepSelections.foundation.map((service) => service.name).join(", ")}
          </Text>
        </Card>
        <Card padding="s" border="neutral-alpha-strong" radius="m" background="surface-strong" gap="2xs">
          <Text variant="label-strong-s">Add-ons</Text>
          <Text variant="body-default-s" onBackground="neutral-weak">
            {stepSelections.addons.length === 0
              ? "Select optional services to expand capabilities."
              : stepSelections.addons.map((service) => service.name).join(", ")}
          </Text>
        </Card>
        <Card padding="s" border="neutral-alpha-strong" radius="m" background="surface-strong" gap="2xs">
          <Text variant="label-strong-s">Verification targets</Text>
          <Text variant="body-default-s" onBackground="neutral-weak">
            {stepSelections.verification.length === 0
              ? "Assign checks to watch post-install validation."
              : stepSelections.verification.map((service) => service.name).join(", ")}
          </Text>
        </Card>
      </Grid>
    </Card>
  );
};

const ServiceDrawer = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const { serviceCatalog, previewSelection, validateSelection } = useWizardModel();
  const requiredNames = useMemo(
    () => new Set(serviceCatalog.filter((entry) => entry.required).map((entry) => entry.name)),
    [serviceCatalog],
  );
  const [selection, setSelection] = useState<ServiceSelection[]>([]);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setSelection((previous) => {
      const existing = new Set(previous.map((entry) => entry.name));
      const required = serviceCatalog.filter((entry) => entry.required);
      const merged = [...previous];
      required.forEach((entry) => {
        if (!existing.has(entry.name)) {
          merged.push({ name: entry.name, env: {} });
        }
      });
      return merged;
    });
  }, [serviceCatalog]);

  const toggleSelection = useCallback(
    (name: string) => {
      if (requiredNames.has(name)) return;
      const isSelected = selection.some((entry) => entry.name === name);
      if (isSelected) {
        setPendingRemoval(name);
      } else {
        setSelection((previous) => [...previous, { name, env: {} }]);
      }
    },
    [requiredNames, selection],
  );

  const confirmRemoval = useCallback(() => {
    if (!pendingRemoval) return;
    setSelection((previous) => previous.filter((entry) => entry.name !== pendingRemoval));
    setPendingRemoval(null);
  }, [pendingRemoval]);

  const updateEnv = useCallback((name: string, key: string, value: string) => {
    setSelection((previous) =>
      previous.map((entry) => (entry.name === name ? { ...entry, env: { ...(entry.env ?? {}), [key]: value } } : entry)),
    );
  }, []);

  const handlePreview = useCallback(async () => {
    setActionError(null);
    try {
      await previewSelection(selection);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Preview failed";
      setActionError(message);
    }
  }, [previewSelection, selection]);

  const handleValidate = useCallback(async () => {
    setActionError(null);
    try {
      await validateSelection(selection);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Validation failed";
      setActionError(message);
    }
  }, [selection, validateSelection]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Settings drawer"
      description="Toggle services, inject environment defaults, and confirm previews before applying changes to the wizard."
      stack
      style={{ maxWidth: "1100px", width: "min(1100px, 94vw)", marginLeft: "auto" }}
    >
      <Column gap="m">
        <Card padding="m" border="neutral-alpha-strong" radius="m" background="surface-strong" gap="xs">
          <Row gap="s" align="center">
            <Icon name="alertCircle" color="neutral-weak" />
            <Text variant="body-strong-s">Required services cannot be deselected.</Text>
          </Row>
          <Text variant="body-default-s" onBackground="neutral-weak">
            Add-ons and verification targets can be toggled below. Inline guidance appears when environment inputs are needed.
          </Text>
        </Card>

        <Grid columns="repeat(auto-fit, minmax(280px, 1fr))" gap="s">
          {serviceCatalog.map((service) => {
            const isSelected = selection.some((entry) => entry.name === service.name);
            return (
              <Card key={service.name} padding="m" border="solid-medium" radius="m" gap="s" background="surface">
                <Row justify="between" align="center" gap="s">
                  <Column gap="2xs">
                    <Text variant="heading-strong-s">{service.name}</Text>
                    <Text variant="body-default-s" onBackground="neutral-weak">
                      {service.description ?? "No description provided."}
                    </Text>
                  </Column>
                  <Checkbox
                    aria-label={`Select ${service.name}`}
                    isChecked={isSelected}
                    onToggle={() => toggleSelection(service.name)}
                    disabled={service.required}
                  />
                </Row>

                {service.category && (
                  <Badge textVariant="label-default-s" border="neutral-alpha-strong" onBackground="neutral-medium">
                    {service.category}
                  </Badge>
                )}

                {isSelected && service.envConfig?.length ? (
                  <Column gap="2xs">
                    <Text variant="label-strong-s">Environment</Text>
                    {service.envConfig.map((env) => (
                      <Input
                        key={`${service.name}-${env.key}`}
                        id={`${service.name}-${env.key}`}
                        label={env.key}
                        placeholder={env.required ? "Required" : "Optional"}
                        onChange={(event) => updateEnv(service.name, env.key, event.target.value)}
                      />
                    ))}
                  </Column>
                ) : isSelected ? (
                  <Text variant="body-default-s" onBackground="neutral-weak">
                    No environment overrides required.
                  </Text>
                ) : (
                  <Text variant="body-default-s" onBackground="neutral-weak">
                    Enable to configure environment defaults.
                  </Text>
                )}

                {service.required && (
                  <Text variant="body-default-s" onBackground="neutral-weak">
                    Required for installation.
                  </Text>
                )}
                {!service.required && isSelected && (
                  <Button variant="danger" size="s" onClick={() => setPendingRemoval(service.name)}>
                    Remove selection
                  </Button>
                )}
              </Card>
            );
          })}
        </Grid>

        {actionError && (
          <Card padding="s" border="dashed-medium" radius="m" background="surface-strong" gap="2xs">
            <Text variant="label-strong-s" onBackground="negative-strong">
              Action could not complete
            </Text>
            <Text variant="body-default-s" onBackground="negative-strong">
              {actionError}
            </Text>
          </Card>
        )}

        <Row gap="s" wrap justify="end">
          <Button variant="secondary" onClick={handlePreview} prefixIcon="eye">
            Preview selection
          </Button>
          <Button variant="primary" onClick={handleValidate} prefixIcon="check">
            Validate selection
          </Button>
          <Button variant="tertiary" onClick={onClose}>
            Close
          </Button>
        </Row>
      </Column>

      <Dialog
        isOpen={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        title="Confirm removal"
        description="Removing a service clears any pending environment values."
      >
        <Column gap="s">
          <Text variant="body-default-s" onBackground="neutral-weak">
            Are you sure you want to remove {pendingRemoval}? This action does not affect installed services but will reset the
            draft selection.
          </Text>
          <Row gap="s" justify="end">
            <Button variant="tertiary" onClick={() => setPendingRemoval(null)}>
              Keep service
            </Button>
            <Button variant="danger" onClick={confirmRemoval}>
              Delete selection
            </Button>
          </Row>
        </Column>
      </Dialog>
    </Dialog>
  );
};

const NdjsonEventLog = () => {
  const { ndjsonEvents } = useWizardModel();

  if (ndjsonEvents.length === 0) return null;

  return (
    <Card padding="m" border="solid-medium" radius="l" gap="s" background="surface" aria-live="polite" role="log">
      <Row align="center" gap="s">
        <Heading variant="heading-strong-m">Streaming events</Heading>
        <Badge textVariant="label-default-s" border="neutral-alpha-medium" onBackground="neutral-weak">
          {ndjsonEvents.length} entries
        </Badge>
      </Row>
      <Text variant="body-default-s" onBackground="neutral-weak">
        Events stream directly from NDJSON wizard endpoints. Use this panel to ensure previews and validations remain readable
        during long-running tasks.
      </Text>
      <List gap="s" style={{ maxHeight: "420px", overflowY: "auto", margin: 0 }}>
        {ndjsonEvents.map((event, index) => (
          <ListItem key={`${event.type}-${index}`}>
            <Card padding="s" border="neutral-alpha-strong" radius="m" gap="2xs" background="surface-strong">
              <Row justify="between" align="center">
                <Text variant="label-strong-s">{event.type}</Text>
                {event.error && (
                  <Badge textVariant="label-default-s" border="neutral-alpha-strong" onBackground="negative-strong">
                    Error
                  </Badge>
                )}
              </Row>
              {event.error && (
                <Text variant="body-default-s" onBackground="negative-strong">
                  {event.error}
                </Text>
              )}
              {event.data && (
                <Text variant="code-default-s" onBackground="neutral-weak" style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(event.data, null, 2)}
                </Text>
              )}
            </Card>
          </ListItem>
        ))}
      </List>
    </Card>
  );
};

const WizardShell = () => {
  const { metadata, wizard, progress, refresh, error, setCurrentStep } = useWizardModel();
  const [stepDrawerOpen, setStepDrawerOpen] = useState(false);
  const [serviceDrawerOpen, setServiceDrawerOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const percent = useMemo(() => {
    if (progress?.percent != null) return progress.percent;
    const steps = metadata?.steps ?? [];
    if (!wizard || steps.length === 0) return null;
    const completed = steps.filter((step) => wizard[step.id].status === "complete").length;
    return Math.round((completed / steps.length) * 100);
  }, [metadata?.steps, progress?.percent, wizard]);

  const handleInspectStep = useCallback(
    (step: WizardStepKey) => {
      setCurrentStep(step);
      setStepDrawerOpen(true);
    },
    [setCurrentStep],
  );

  return (
    <Column fillWidth padding="xl" gap="l" style={{ minHeight: "100vh" }}>
      <Card padding="l" radius="xl" border="solid-medium" background="surface" gap="m">
        <Row align="center" gap="s" wrap>
          <Badge textVariant="code-default-s" border="neutral-alpha-medium" onBackground="neutral-medium" gap="16">
            <Line vert background="neutral-alpha-strong" />
            <Text marginX="4">
              <LetterFx trigger="instant">Setup wizard</LetterFx>
            </Text>
          </Badge>
          {percent != null && (
            <Badge textVariant="label-default-s" border="neutral-alpha-strong" onBackground="neutral-weak">
              {percent}% complete
            </Badge>
          )}
        </Row>
        <Heading variant="display-strong-l">Deploy Noona with confidence</Heading>
        <Text variant="heading-default-m" onBackground="neutral-weak">
          Follow the guided steps to configure core services, add-ons, and verification checks. The UI now tracks backend wizard
          endpoints, NDJSON streams, and validation issues per step.
        </Text>
        <Row gap="s" wrap>
          <Button onClick={() => refresh()}>Refresh wizard state</Button>
          <Button variant="secondary" onClick={() => setServiceDrawerOpen(true)} prefixIcon="layers">
            Edit service selection
          </Button>
          <Button variant="tertiary" onClick={() => setStepDrawerOpen(true)} prefixIcon="list">
            Open step drawer
          </Button>
        </Row>
        {error && (
          <Text variant="body-default-s" onBackground="negative-strong">
            {error}
          </Text>
        )}
      </Card>

      <Card padding="l" radius="l" border="solid-medium" background="surface" gap="m">
        <Row justify="between" align="center" wrap gap="s">
          <Heading variant="heading-strong-m">Wizard stepper</Heading>
          {percent != null && <ProgressBar value={percent} label />}
        </Row>
        <Grid columns="repeat(auto-fit, minmax(320px, 1fr))" gap="s">
          {metadata?.steps.map((entry) => (
            <StepCard key={entry.id} stepId={entry.id} onInspect={handleInspectStep} />
          ))}
        </Grid>
      </Card>

      <Grid columns="repeat(auto-fit, minmax(420px, 1fr))" gap="m">
        <ServiceSelectionPanel onOpenDrawer={() => setServiceDrawerOpen(true)} />
        <NdjsonEventLog />
      </Grid>

      <StepDrawer
        isOpen={stepDrawerOpen}
        onClose={() => setStepDrawerOpen(false)}
        historyLoading={historyLoading}
        setHistoryLoading={setHistoryLoading}
      />
      <ServiceDrawer isOpen={serviceDrawerOpen} onClose={() => setServiceDrawerOpen(false)} />
    </Column>
  );
};

export default function Home() {
  return (
    <WizardProvider>
      <WizardShell />
    </WizardProvider>
  );
}
