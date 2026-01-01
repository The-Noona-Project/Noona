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

const statusIcon: Record<WizardStatus, string> = {
  pending: "clock",
  "in-progress": "activity",
  complete: "check",
  error: "alertTriangle",
  skipped: "minus",
};

const StepStatusBadge = ({ status }: { status: WizardStatus }) => (
  <Badge textVariant="label-default-s" border="neutral-alpha-strong" onBackground={statusTone[status]} gap="8">
    <Icon name={statusIcon[status]} size="16" />
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
      className="console-card"
    >
      <Row align="center" justify="between" gap="s" wrap>
        <Column gap="2xs">
          <Row gap="s" align="center" wrap>
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

      <Row gap="s" className="console-chip-row">
        <span className="console-pill">
          <Icon name="layout" size="16" />
          {step.id}
        </span>
        {state.updatedAt && (
          <span className="console-pill">
            <Icon name="clock" size="16" />
            Updated {new Date(state.updatedAt).toLocaleTimeString()}
          </span>
        )}
        {state.detail && (
          <span className="console-pill">
            <Icon name="info" size="16" />
            {state.detail}
          </span>
        )}
      </Row>

      {state.error && (
        <Card border="dashed-medium" padding="s" gap="2xs" background="surface-strong" radius="m">
          <Row align="center" gap="s">
            <Icon name="alertTriangle" color="negative-strong" />
            <Text variant="label-strong-s" onBackground="negative-strong">
              {state.error}
            </Text>
          </Row>
        </Card>
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
        <Button variant="primary" size="s" onClick={() => onInspect(stepId)}>
          View history & guidance
        </Button>
        <Button variant="secondary" size="s" onClick={() => setCurrentStep(stepId)} prefixIcon="target">
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
  const { stepSelections, serviceCatalog, validationErrors } = useWizardModel();
  const requiredCount = serviceCatalog.filter((entry) => entry.required).length;
  const optionalCount = serviceCatalog.length - requiredCount;
  const totalIssues = useMemo(() => Object.values(validationErrors).flat().length, [validationErrors]);

  return (
    <Card padding="l" border="solid-medium" radius="l" gap="m" background="surface" className="console-card">
      <Row justify="between" align="center" gap="s" wrap>
        <Column gap="2xs">
          <Text variant="label-strong-s" onBackground="neutral-weak" className="console-section-title">
            Deployment controls
          </Text>
          <Heading variant="heading-strong-m">Service selection</Heading>
          <Text variant="body-default-s" onBackground="neutral-weak">
            Toggle add-ons, enrich environment variables, and preview validation output before commits.
          </Text>
        </Column>
        <Button variant="primary" onClick={onOpenDrawer} prefixIcon="edit" size="s">
          Open settings drawer
        </Button>
      </Row>

      <Grid columns="repeat(auto-fit, minmax(220px, 1fr))" gap="s">
        <Card padding="s" border="neutral-alpha-medium" radius="m" background="surface-strong" gap="2xs" className="console-stats">
          <Text variant="label-strong-s">Catalog</Text>
          <Text variant="body-default-s" onBackground="neutral-weak">
            {requiredCount} required · {optionalCount} optional
          </Text>
        </Card>
        <Card padding="s" border="neutral-alpha-medium" radius="m" background="surface-strong" gap="2xs" className="console-stats">
          <Text variant="label-strong-s">Selections</Text>
          <Text variant="body-default-s" onBackground="neutral-weak">
            Foundation: {stepSelections.foundation.length}, Add-ons: {stepSelections.addons.length}, Verification: {" "}
            {stepSelections.verification.length}
          </Text>
        </Card>
        <Card padding="s" border="neutral-alpha-medium" radius="m" background="surface-strong" gap="2xs" className="console-stats">
          <Text variant="label-strong-s">Validation</Text>
          <Text variant="body-default-s" onBackground={totalIssues > 0 ? "negative-strong" : "positive-strong"}>
            {totalIssues > 0 ? `${totalIssues} issues detected` : "Ready for validation"}
          </Text>
        </Card>
      </Grid>

      <Grid columns="repeat(auto-fit, minmax(240px, 1fr))" gap="s">
        <Card padding="s" border="neutral-alpha-strong" radius="m" background="surface-strong" gap="2xs" className="console-card">
          <Text variant="label-strong-s">Foundation</Text>
          <Text variant="body-default-s" onBackground="neutral-weak">
            {stepSelections.foundation.length === 0
              ? "No base services detected yet."
              : stepSelections.foundation.map((service) => service.name).join(", ")}
          </Text>
        </Card>
        <Card padding="s" border="neutral-alpha-strong" radius="m" background="surface-strong" gap="2xs" className="console-card">
          <Text variant="label-strong-s">Add-ons</Text>
          <Text variant="body-default-s" onBackground="neutral-weak">
            {stepSelections.addons.length === 0
              ? "Select optional services to expand capabilities."
              : stepSelections.addons.map((service) => service.name).join(", ")}
          </Text>
        </Card>
        <Card padding="s" border="neutral-alpha-strong" radius="m" background="surface-strong" gap="2xs" className="console-card">
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
              <Card key={service.name} padding="m" border="solid-medium" radius="m" gap="s" background="surface" className="console-card">
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
    <Card
      padding="l"
      border="solid-medium"
      radius="l"
      gap="s"
      background="surface"
      aria-live="polite"
      role="log"
      className="console-card"
      id="ndjson-log"
    >
      <Row align="center" gap="s" justify="between" wrap>
        <Row align="center" gap="s">
          <Heading variant="heading-strong-m">Streaming events</Heading>
          <Badge textVariant="label-default-s" border="neutral-alpha-medium" onBackground="neutral-weak">
            {ndjsonEvents.length} entries
          </Badge>
        </Row>
        <Text variant="label-default-s" onBackground="neutral-weak">
          NDJSON stream
        </Text>
      </Row>
      <Text variant="body-default-s" onBackground="neutral-weak">
        Events stream directly from NDJSON wizard endpoints. Use this panel to ensure previews and validations remain readable
        during long-running tasks.
      </Text>
      <Line hor background="neutral-alpha-strong" />
      <List gap="s" style={{ maxHeight: "420px", overflowY: "auto", margin: 0 }}>
        {ndjsonEvents.map((event, index) => (
          <ListItem key={`${event.type}-${index}`}>
            <Card padding="s" border="neutral-alpha-strong" radius="m" gap="2xs" background="surface-strong" className="console-card">
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
  const { metadata, wizard, progress, refresh, error, setCurrentStep, validationErrors } = useWizardModel();
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

  const completedCount = useMemo(() => {
    const steps = metadata?.steps ?? [];
    if (!wizard || steps.length === 0) return 0;
    return steps.filter((step) => wizard[step.id].status === "complete").length;
  }, [metadata?.steps, wizard]);

  const currentStepMeta = useMemo(
    () => metadata?.steps.find((entry) => entry.id === progress?.currentStep) ?? metadata?.steps.find((entry) => entry.id === "foundation"),
    [metadata?.steps, progress?.currentStep],
  );

  const openStepDrawer = useCallback(() => setStepDrawerOpen(true), []);
  const scrollToLog = useCallback(() => {
    const element = document.getElementById("ndjson-log");
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const handleInspectStep = useCallback(
    (step: WizardStepKey) => {
      setCurrentStep(step);
      setStepDrawerOpen(true);
    },
    [setCurrentStep],
  );

  const issueCount = useMemo(() => Object.values(validationErrors).flat().length, [validationErrors]);

  return (
    <Column fillWidth padding="xl" gap="xl" style={{ minHeight: "100vh" }} className="console-shell">
      <Card padding="xl" radius="xl" border="solid-medium" background="surface" gap="m" className="console-hero">
        <Row align="center" justify="between" gap="m" wrap>
          <Column gap="s">
            <Badge textVariant="code-default-s" border="neutral-alpha-medium" onBackground="neutral-medium" gap="16">
              <Line vert background="neutral-alpha-strong" />
              <Text marginX="4">
                <LetterFx trigger="instant">Warden Deployment Console</LetterFx>
              </Text>
            </Badge>
            <Heading variant="display-strong-l">Command &amp; control, but sleek</Heading>
            <Text variant="heading-default-m" onBackground="neutral-weak">
              A dark cockpit for orchestrating installs, previews, and validation. Track every wizard step with live NDJSON
              streams and guided history drawers.
            </Text>
            <Row gap="s" wrap>
              <div className="console-pill">
                <Icon name="shield" size="16" /> Hardened surfaces
              </div>
              <div className="console-pill">
                <Icon name="cpu" size="16" /> Backend-synced
              </div>
              <div className="console-pill">
                <Icon name="zap" size="16" /> Quick actions restored
              </div>
            </Row>
          </Column>
          <Column gap="s" align="end">
            {percent != null && (
              <Column align="end" gap="2xs" style={{ minWidth: "240px" }}>
                <ProgressBar value={percent} label />
                <Text variant="label-default-s" onBackground="neutral-weak">
                  {percent}% ready
                </Text>
              </Column>
            )}
            <Row gap="s" wrap justify="end">
              <Button onClick={() => refresh()} prefixIcon="refreshCcw" variant="primary">
                Refresh wizard state
              </Button>
              <Button variant="secondary" onClick={() => setServiceDrawerOpen(true)} prefixIcon="layers">
                Configure services
              </Button>
              <Button variant="tertiary" onClick={openStepDrawer} prefixIcon="list">
                Review steps
              </Button>
              <Button variant="tertiary" onClick={scrollToLog} prefixIcon="activity">
                View stream
              </Button>
            </Row>
          </Column>
        </Row>
      </Card>

      <Grid columns="repeat(auto-fit, minmax(260px, 1fr))" gap="m">
        <Card padding="m" radius="l" border="solid-medium" background="surface" gap="xs" className="console-card">
          <Text variant="label-strong-s" onBackground="neutral-weak">
            Step completion
          </Text>
          <Heading variant="display-strong-s">{completedCount}</Heading>
          <Text variant="body-default-s" onBackground="neutral-weak">
            of {metadata?.steps.length ?? 0} steps complete
          </Text>
        </Card>
        <Card padding="m" radius="l" border="solid-medium" background="surface" gap="xs" className="console-card">
          <Text variant="label-strong-s" onBackground="neutral-weak">
            Active step
          </Text>
          <Heading variant="display-strong-s">{currentStepMeta?.title ?? "Not started"}</Heading>
          <Text variant="body-default-s" onBackground="neutral-weak">
            {currentStepMeta?.description ?? "Wizard metadata will populate once loaded."}
          </Text>
        </Card>
        <Card padding="m" radius="l" border="solid-medium" background="surface" gap="xs" className="console-card">
          <Text variant="label-strong-s" onBackground="neutral-weak">
            Validation status
          </Text>
          <Heading variant="display-strong-s" onBackground={issueCount > 0 ? "negative-strong" : "positive-strong"}>
            {issueCount > 0 ? `${issueCount} open` : "Clean"}
          </Heading>
          <Text variant="body-default-s" onBackground="neutral-weak">
            Issues surfaced from previews and validations
          </Text>
        </Card>
      </Grid>

      <Grid columns="repeat(auto-fit, minmax(420px, 1fr))" gap="xl" className="console-grid-gap">
        <Column gap="m">
          <Card padding="l" radius="l" border="solid-medium" background="surface" gap="m" className="console-card">
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

          <NdjsonEventLog />
        </Column>

        <Column gap="m">
          <ServiceSelectionPanel onOpenDrawer={() => setServiceDrawerOpen(true)} />

          <Card padding="l" border="solid-medium" radius="l" gap="m" background="surface-strong" className="console-card">
            <Row justify="between" align="center" wrap gap="s">
              <Heading variant="heading-strong-m">Action center</Heading>
              <Badge textVariant="label-default-s" border="neutral-alpha-medium" onBackground="neutral-weak">
                Quick buttons restored
              </Badge>
            </Row>
            <Text variant="body-default-s" onBackground="neutral-weak">
              Run the common tasks you expect from the deployment console. These shortcuts mirror the CLI and keep parity with
              the darker experience shown in the reference UI.
            </Text>
            <Row gap="s" wrap>
              <Button variant="primary" prefixIcon="play" onClick={() => setServiceDrawerOpen(true)}>
                Start configuration
              </Button>
              <Button variant="secondary" prefixIcon="check" onClick={openStepDrawer}>
                Review validation
              </Button>
              <Button variant="tertiary" prefixIcon="download" onClick={scrollToLog}>
                Stream logs
              </Button>
              <Button variant="tertiary" prefixIcon="refreshCcw" onClick={() => refresh()}>
                Refresh state
              </Button>
            </Row>
            {error && (
              <Card padding="s" border="dashed-medium" radius="m" background="surface" gap="2xs" className="console-card">
                <Row gap="s" align="center">
                  <Icon name="alertTriangle" color="negative-strong" />
                  <Text variant="label-strong-s" onBackground="negative-strong">
                    {error}
                  </Text>
                </Row>
                <Text variant="body-default-s" onBackground="neutral-weak">
                  Refresh the wizard or revisit service selection if issues persist.
                </Text>
              </Card>
            )}
          </Card>
        </Column>
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
