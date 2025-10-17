#!/usr/bin/env node
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { SERVICES, buildServices, pushServices, pullServices, startServices, stopAllContainers, cleanServices, deleteDockerResources, readLifecycleHistory, getDeploymentSettings, updateBuildConcurrencyDefaults, updateDebugDefaults, listManagedContainers } from './deploy.mjs';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
const stripAnsi = input => typeof input === 'string' ? input.replace(/\u001B\[[0-9;]*m/g, '') : String(input ?? '');
const formatTable = (rows, columns) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '—';
  }
  const cols = columns && columns.length ? columns : Array.from(new Set(rows.flatMap(row => Object.keys(row || {}))));
  const sanitized = rows.map(row => {
    const obj = row && typeof row === 'object' ? row : {};
    return cols.map(column => stripAnsi(String(obj[column] ?? '')));
  });
  const widths = cols.map((column, index) => Math.max(stripAnsi(column).length, ...sanitized.map(row => row[index].length)));
  const header = cols.map((column, index) => stripAnsi(column).padEnd(widths[index])).join('  ');
  const separator = widths.map(width => '─'.repeat(width)).join('  ');
  const body = sanitized.map(row => row.map((value, index) => value.padEnd(widths[index])).join('  ')).join('\n');
  return `${header}\n${separator}\n${body}`;
};
const LOG_HISTORY_LIMIT = 120;
const appendLogEntry = (logs, entry) => {
  if (!entry || !entry.text) {
    return logs;
  }
  const text = stripAnsi(entry.text);
  if (!text) {
    return logs;
  }
  const normalized = {
    id: entry.id || `${Date.now()}-${Math.random()}`,
    level: entry.level || 'info',
    text,
    timestamp: entry.timestamp || Date.now()
  };
  const next = [...logs, normalized];
  return next.slice(-LOG_HISTORY_LIMIT);
};
const TAB_DEFINITIONS = [{
  id: 'build',
  label: 'Build Images'
}, {
  id: 'push',
  label: 'Push Images'
}, {
  id: 'pull',
  label: 'Pull Images'
}];
const createTabSnapshot = () => ({
  jobs: {},
  logs: [],
  queueSize: 0,
  capacity: null,
  isRunning: false,
  lastServices: [],
  lastUpdated: null
});
const createInitialTabState = () => {
  return TAB_DEFINITIONS.reduce((acc, tab) => {
    acc[tab.id] = createTabSnapshot();
    return acc;
  }, {});
};
const useMessageLog = () => {
  const [messages, setMessages] = useState([]);
  const pushMessage = useCallback(entry => {
    setMessages(prev => {
      const next = [...prev, {
        ...entry,
        id: `${Date.now()}-${Math.random()}`
      }];
      return next.slice(-50);
    });
  }, []);
  const createReporter = useCallback(() => ({
    info: message => pushMessage({
      level: 'info',
      text: stripAnsi(message)
    }),
    warn: message => pushMessage({
      level: 'warn',
      text: stripAnsi(message)
    }),
    error: message => pushMessage({
      level: 'error',
      text: stripAnsi(message)
    }),
    success: message => pushMessage({
      level: 'success',
      text: stripAnsi(message)
    }),
    table: (data, columns) => pushMessage({
      level: 'table',
      text: formatTable(data, columns)
    })
  }), [pushMessage]);
  return {
    messages,
    pushMessage,
    createReporter
  };
};
const ViewContainer = ({
  title,
  children
}) => /*#__PURE__*/_jsxs(Box, {
  flexDirection: "column",
  flexGrow: 1,
  borderStyle: "round",
  borderColor: "cyan",
  padding: 1,
  children: [/*#__PURE__*/_jsx(Text, {
    color: "cyan",
    bold: true,
    children: title
  }), /*#__PURE__*/_jsx(Box, {
    marginTop: 1,
    flexDirection: "column",
    children: children
  })]
});
const Navigation = ({
  active
}) => {
  const views = [{
    id: 'overview',
    label: 'Overview Dashboard'
  }, {
    id: 'builds',
    label: 'Build Queue Manager'
  }, {
    id: 'containers',
    label: 'Container Status Board'
  }, {
    id: 'settings',
    label: 'Settings & Defaults'
  }];
  return /*#__PURE__*/_jsxs(Box, {
    flexDirection: "column",
    width: 30,
    marginRight: 2,
    children: [/*#__PURE__*/_jsx(Text, {
      color: "cyan",
      bold: true,
      children: "Views"
    }), views.map((view, index) => /*#__PURE__*/_jsxs(Text, {
      color: active === view.id ? 'green' : undefined,
      children: [active === view.id ? '▸ ' : '  ', index + 1, ". ", view.label]
    }, view.id)), /*#__PURE__*/_jsxs(Box, {
      marginTop: 1,
      flexDirection: "column",
      children: [/*#__PURE__*/_jsx(Text, {
        dimColor: true,
        children: "\u2190/\u2192 or 1-4 to switch views."
      }), /*#__PURE__*/_jsx(Text, {
        dimColor: true,
        children: "Press q to exit."
      })]
    })]
  });
};
const MessagePanel = ({
  messages
}) => {
  const recent = messages.slice(-4);
  const palette = {
    info: undefined,
    table: 'cyan',
    success: 'green',
    warn: 'yellow',
    error: 'red'
  };
  return /*#__PURE__*/_jsxs(Box, {
    flexDirection: "column",
    marginTop: 1,
    borderStyle: "round",
    borderColor: "gray",
    padding: 1,
    children: [/*#__PURE__*/_jsx(Text, {
      color: "cyan",
      bold: true,
      children: "Activity"
    }), recent.length === 0 ? /*#__PURE__*/_jsx(Text, {
      dimColor: true,
      children: "No messages yet. Actions and status updates will appear here."
    }) : recent.map(entry => /*#__PURE__*/_jsx(Text, {
      color: palette[entry.level],
      children: entry.text
    }, entry.id))]
  });
};
const OverviewDashboard = ({
  isActive,
  pushMessage
}) => {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [containers, setContainers] = useState([]);
  const [history, setHistory] = useState([]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsData, containersData, historyData] = await Promise.all([getDeploymentSettings(), listManagedContainers({
        includeStopped: true
      }), readLifecycleHistory()]);
      setSettings(settingsData);
      setContainers(containersData);
      setHistory(Array.isArray(historyData) ? historyData.slice(-5).reverse() : []);
    } catch (error) {
      pushMessage({
        level: 'error',
        text: `Failed to load overview: ${error.message}`
      });
    } finally {
      setLoading(false);
    }
  }, [pushMessage]);
  useEffect(() => {
    load();
  }, [load]);
  useInput((input, key) => {
    if (!isActive) return;
    if (input === 'r' || key.ctrl && input === 'l') {
      load();
    }
  });
  const runningContainers = useMemo(() => containers.filter(item => item.state === 'running'), [containers]);
  return /*#__PURE__*/_jsx(ViewContainer, {
    title: "Overview",
    children: loading ? /*#__PURE__*/_jsxs(Text, {
      children: [/*#__PURE__*/_jsx(Text, {
        color: "cyan",
        children: /*#__PURE__*/_jsx(Spinner, {
          type: "dots"
        })
      }), " Loading deployment summary\u2026"]
    }) : /*#__PURE__*/_jsxs(_Fragment, {
      children: [/*#__PURE__*/_jsx(Text, {
        bold: true,
        color: "green",
        children: "Build Scheduler"
      }), /*#__PURE__*/_jsxs(Text, {
        children: ["Worker threads: ", settings?.buildScheduler?.workerThreads ?? '—', " | Subprocesses per worker: ", settings?.buildScheduler?.subprocessesPerWorker ?? '—']
      }), /*#__PURE__*/_jsxs(Box, {
        marginTop: 1,
        flexDirection: "column",
        children: [/*#__PURE__*/_jsx(Text, {
          bold: true,
          color: "green",
          children: "Defaults"
        }), /*#__PURE__*/_jsxs(Text, {
          children: ["DEBUG level: ", settings?.defaults?.debugLevel ?? 'false']
        }), /*#__PURE__*/_jsxs(Text, {
          children: ["Boot mode: ", settings?.defaults?.bootMode ?? 'minimal']
        })]
      }), /*#__PURE__*/_jsxs(Box, {
        marginTop: 1,
        flexDirection: "column",
        children: [/*#__PURE__*/_jsx(Text, {
          bold: true,
          color: "green",
          children: "Container Status"
        }), /*#__PURE__*/_jsxs(Text, {
          children: [runningContainers.length, " running / ", containers.length, " tracked containers"]
        }), containers.length > 0 && /*#__PURE__*/_jsxs(Box, {
          flexDirection: "column",
          marginTop: 1,
          children: [containers.slice(0, 5).map(container => /*#__PURE__*/_jsxs(Text, {
            children: [container.name.padEnd(12), " \u2014 ", container.state.padEnd(10), " ", container.ports !== '—' ? `(${container.ports})` : '']
          }, container.id)), containers.length > 5 && /*#__PURE__*/_jsxs(Text, {
            dimColor: true,
            children: ["\u2026and ", containers.length - 5, " more"]
          })]
        })]
      }), /*#__PURE__*/_jsxs(Box, {
        marginTop: 1,
        flexDirection: "column",
        children: [/*#__PURE__*/_jsx(Text, {
          bold: true,
          color: "green",
          children: "Recent Lifecycle Events"
        }), history.length === 0 ? /*#__PURE__*/_jsx(Text, {
          dimColor: true,
          children: "No lifecycle events recorded yet."
        }) : history.map(event => /*#__PURE__*/_jsxs(Text, {
          children: [event.timestamp ? new Date(event.timestamp).toLocaleString() : '—', " \xB7 ", event.service ? `${event.service} · ` : '', event.action, " \xB7 ", event.status]
        }, `${event.timestamp}-${event.service ?? event.action}`))]
      }), /*#__PURE__*/_jsx(Box, {
        marginTop: 1,
        children: /*#__PURE__*/_jsx(Text, {
          dimColor: true,
          children: "Press r to refresh data."
        })
      })]
    })
  });
};
const BuildQueueManager = ({
  isActive,
  createReporter,
  pushMessage
}) => {
  const serviceList = useMemo(() => [...SERVICES], []);
  const [selectedValues, setSelectedValues] = useState(() => [...serviceList]);
  const [cursor, setCursor] = useState(0);
  const [operation, setOperation] = useState('build');
  const [useNoCache, setUseNoCache] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [tabState, setTabState] = useState(() => createInitialTabState());
  const updateTabState = useCallback((tabId, updater) => {
    setTabState(prev => {
      const current = prev[tabId] || createTabSnapshot();
      const nextTab = updater(current);
      if (!nextTab || nextTab === current) {
        return prev;
      }
      return {
        ...prev,
        [tabId]: {
          ...nextTab
        }
      };
    });
  }, []);
  const initializeTabRun = useCallback((tabId, services, headline) => {
    const normalized = Array.isArray(services) ? [...services] : [];
    setTabState(prev => ({
      ...prev,
      [tabId]: {
        ...createTabSnapshot(),
        isRunning: true,
        lastUpdated: Date.now(),
        lastServices: normalized,
        jobs: normalized.reduce((acc, svc) => {
          acc[svc] = {
            status: 'pending',
            message: 'Pending…'
          };
          return acc;
        }, {}),
        logs: headline ? appendLogEntry([], {
          text: headline
        }) : []
      }
    }));
  }, []);
  const finalizeTabRun = useCallback(tabId => {
    updateTabState(tabId, current => ({
      ...current,
      isRunning: false,
      lastUpdated: Date.now()
    }));
  }, [updateTabState]);
  const handleProgress = useCallback((tabId, event) => {
    if (!event) return;
    const sanitizedMessage = event.message ? stripAnsi(event.message) : '';
    updateTabState(tabId, current => {
      const now = Date.now();
      const jobs = {
        ...current.jobs
      };
      let logs = [...current.logs];
      let queueSize = current.queueSize;
      let capacity = current.capacity;
      let isRunningTab = current.isRunning;
      let lastServices = current.lastServices || [];
      const pushLog = (text, level = 'info') => {
        if (!text) return;
        logs = appendLogEntry(logs, {
          text,
          level,
          timestamp: now
        });
      };
      if (event.type === 'capacity' && typeof event.limit === 'number') {
        capacity = event.limit;
        pushLog(`Scheduler capacity set to ${event.limit}.`);
      }
      if (event.service) {
        lastServices = Array.from(new Set([...lastServices, event.service]));
      }
      if (event.type === 'enqueue' && event.service) {
        jobs[event.service] = {
          status: 'queued',
          message: `Queued (${event.queueSize ?? 'pending'} ahead)`
        };
        queueSize = event.queueSize ?? queueSize;
        pushLog(`[${event.service}] queued for execution.`);
        isRunningTab = true;
      }
      if ((event.type === 'log' || event.type === 'update') && event.service) {
        const statusMessage = sanitizedMessage || 'Running…';
        jobs[event.service] = {
          status: 'running',
          message: statusMessage
        };
        pushLog(`[${event.service}] ${statusMessage}`, event.level || 'info');
        isRunningTab = true;
      }
      if (event.type === 'start' && event.service) {
        const statusMessage = sanitizedMessage || 'Starting…';
        jobs[event.service] = {
          status: 'running',
          message: statusMessage
        };
        pushLog(`[${event.service}] ${statusMessage}`);
        isRunningTab = true;
      }
      if (event.type === 'error' && event.service) {
        const errorMessage = sanitizedMessage || event.error?.message || 'Error reported.';
        jobs[event.service] = {
          status: 'failed',
          message: errorMessage
        };
        pushLog(`[${event.service}] ${errorMessage}`, 'error');
        isRunningTab = true;
      }
      if (event.type === 'complete' && event.service) {
        const succeeded = event.status === 'fulfilled' || event.ok !== false && event.status !== 'rejected';
        const detail = succeeded ? sanitizedMessage || 'Completed successfully.' : event.error?.message || sanitizedMessage || 'Failed.';
        jobs[event.service] = {
          status: succeeded ? 'succeeded' : 'failed',
          message: detail
        };
        pushLog(`[${event.service}] ${detail}`, succeeded ? 'success' : 'error');
        if (!succeeded && Array.isArray(event.logs)) {
          event.logs.slice(-5).forEach(line => {
            pushLog(`[${event.service}] ${stripAnsi(line)}`, 'error');
          });
        }
      }
      if (event.type === 'idle') {
        pushLog('Scheduler idle.');
        isRunningTab = false;
      }
      const allComplete = Object.keys(jobs).length > 0 && Object.values(jobs).every(job => ['succeeded', 'failed'].includes(job.status));
      if (allComplete) {
        isRunningTab = false;
      }
      return {
        ...current,
        jobs,
        logs,
        queueSize,
        capacity,
        isRunning: isRunningTab,
        lastUpdated: now,
        lastServices
      };
    });
    if (event.type === 'capacity' && typeof event.limit === 'number') {
      pushMessage({
        level: 'info',
        text: `Scheduler capacity updated to ${event.limit}`
      });
    }
  }, [pushMessage, updateTabState]);
  const execute = useCallback(async () => {
    if (isRunning) return;
    if (selectedValues.length === 0) {
      pushMessage({
        level: 'warn',
        text: 'Select at least one service before executing an operation.'
      });
      return;
    }
    setIsRunning(true);
    const headlineServices = selectedValues.join(', ');
    const headline = headlineServices ? `${operation === 'build' ? 'Starting build' : operation === 'push' ? 'Starting push' : 'Starting pull'} for ${headlineServices}` : '';
    initializeTabRun(operation, selectedValues, headline);
    const reporter = createReporter();
    try {
      if (operation === 'build') {
        const result = await buildServices(selectedValues, {
          useNoCache,
          reporter,
          onProgress: event => handleProgress('build', event)
        });
        if (!result.ok) {
          pushMessage({
            level: 'warn',
            text: 'One or more builds reported failures. Review activity log for details.'
          });
        }
      } else if (operation === 'push') {
        await pushServices(selectedValues, {
          reporter,
          onProgress: event => handleProgress('push', event)
        });
      } else if (operation === 'pull') {
        await pullServices(selectedValues, {
          reporter,
          onProgress: event => handleProgress('pull', event)
        });
      }
    } catch (error) {
      pushMessage({
        level: 'error',
        text: `${operation} operation failed: ${error.message}`
      });
    } finally {
      setIsRunning(false);
      finalizeTabRun(operation);
    }
  }, [createReporter, finalizeTabRun, handleProgress, initializeTabRun, isRunning, operation, pushMessage, selectedValues, useNoCache]);
  const toggleOperation = useCallback(next => {
    setOperation(next);
  }, []);
  useInput((input, key) => {
    if (!isActive) return;
    if (isRunning) return;
    if (key.upArrow || input === 'k') {
      setCursor(current => (current - 1 + serviceList.length) % serviceList.length);
    }
    if (key.downArrow || input === 'j') {
      setCursor(current => (current + 1) % serviceList.length);
    }
    if (input === ' ') {
      const target = serviceList[cursor];
      setSelectedValues(prev => prev.includes(target) ? prev.filter(value => value !== target) : [...prev, target]);
    }
    if (input === 'b') toggleOperation('build');
    if (input === 'p') toggleOperation('push');
    if (input === 'l') toggleOperation('pull');
    if (input === 'g') execute();
    if (input === 'c' && operation === 'build') setUseNoCache(value => !value);
    if (input === 'a') setSelectedValues([...serviceList]);
    if (input === 'n') setSelectedValues([]);
  });
  const actionLabel = operation === 'build' ? `Build selected services${useNoCache ? ' (clean)' : ''}` : operation === 'push' ? 'Push selected services' : 'Pull selected services';
  const currentTabState = tabState[operation] || createTabSnapshot();
  const servicesForDisplay = currentTabState.lastServices.length > 0 ? currentTabState.lastServices : selectedValues;
  const logsToRender = currentTabState.logs.slice(-15);
  const statusPalette = {
    pending: 'gray',
    queued: 'yellow',
    running: 'cyan',
    succeeded: 'green',
    failed: 'red'
  };
  const logPalette = {
    info: undefined,
    warn: 'yellow',
    error: 'red',
    success: 'green'
  };
  return /*#__PURE__*/_jsxs(ViewContainer, {
    title: "Build Queue Manager",
    children: [/*#__PURE__*/_jsxs(Box, {
      flexDirection: "row",
      children: [/*#__PURE__*/_jsxs(Box, {
        flexDirection: "column",
        width: 40,
        marginRight: 2,
        children: [/*#__PURE__*/_jsxs(Text, {
          children: ["Select services (\u2191/\u2193 to move, space to toggle). Press g to run ", actionLabel.toLowerCase(), "."]
        }), /*#__PURE__*/_jsx(Box, {
          flexDirection: "column",
          marginTop: 1,
          children: serviceList.map((service, index) => {
            const isSelected = selectedValues.includes(service);
            const isHighlighted = index === cursor;
            return /*#__PURE__*/_jsxs(Text, {
              color: isHighlighted ? 'cyan' : undefined,
              children: [isHighlighted ? '▸' : ' ', " [", isSelected ? 'x' : ' ', "] ", service]
            }, service);
          })
        }), /*#__PURE__*/_jsxs(Box, {
          marginTop: 1,
          flexDirection: "column",
          children: [/*#__PURE__*/_jsxs(Text, {
            children: ["Operation: ", operation === 'build' ? 'Build images' : operation === 'push' ? 'Push to registry' : 'Pull from registry']
          }), operation === 'build' && /*#__PURE__*/_jsxs(Text, {
            children: ["Clean build: ", useNoCache ? 'enabled' : 'disabled', " (press c to toggle)"]
          }), /*#__PURE__*/_jsx(Text, {
            dimColor: true,
            children: "Shortcuts: \u2191/\u2193 move \xB7 space toggle \xB7 b build \xB7 p push \xB7 l pull \xB7 g execute \xB7 a select all \xB7 n clear selection"
          })]
        })]
      }), /*#__PURE__*/_jsxs(Box, {
        flexDirection: "column",
        flexGrow: 1,
        borderStyle: "round",
        borderColor: "gray",
        padding: 1,
        children: [/*#__PURE__*/_jsx(Text, {
          color: "cyan",
          bold: true,
          children: "Operation Activity"
        }), /*#__PURE__*/_jsx(Box, {
          marginTop: 1,
          flexDirection: "row",
          flexWrap: "wrap",
          children: TAB_DEFINITIONS.map(tab => {
            const state = tabState[tab.id] || createTabSnapshot();
            const indicator = state.isRunning ? '●' : '○';
            const color = tab.id === operation ? 'green' : state.isRunning ? 'yellow' : 'gray';
            return /*#__PURE__*/_jsx(Box, {
              marginRight: 1,
              children: /*#__PURE__*/_jsxs(Text, {
                color: color,
                children: [indicator, " ", tab.label]
              })
            }, tab.id);
          })
        }), currentTabState.capacity ? /*#__PURE__*/_jsxs(Text, {
          dimColor: true,
          children: ["Scheduler capacity: ", currentTabState.capacity]
        }) : null, currentTabState.queueSize ? /*#__PURE__*/_jsxs(Text, {
          dimColor: true,
          children: ["Queue size: ", currentTabState.queueSize]
        }) : null, /*#__PURE__*/_jsxs(Box, {
          marginTop: 1,
          flexDirection: "column",
          children: [/*#__PURE__*/_jsx(Text, {
            bold: true,
            children: "Status by service"
          }), servicesForDisplay.length === 0 ? /*#__PURE__*/_jsx(Text, {
            dimColor: true,
            children: "No services have been queued yet."
          }) : servicesForDisplay.map(service => {
            const state = currentTabState.jobs[service];
            if (!state) {
              return /*#__PURE__*/_jsxs(Text, {
                dimColor: true,
                children: [service, ": pending\u2026"]
              }, service);
            }
            const color = statusPalette[state.status] || undefined;
            return /*#__PURE__*/_jsxs(Text, {
              color: color,
              children: [state.status === 'running' && /*#__PURE__*/_jsx(Spinner, {
                type: "dots"
              }), " ", service, ": ", state.message]
            }, service);
          })]
        }), /*#__PURE__*/_jsxs(Box, {
          marginTop: 1,
          flexDirection: "column",
          children: [/*#__PURE__*/_jsx(Text, {
            bold: true,
            children: "Logs"
          }), logsToRender.length === 0 ? /*#__PURE__*/_jsx(Text, {
            dimColor: true,
            children: "No logs yet for this tab."
          }) : logsToRender.map(entry => /*#__PURE__*/_jsxs(Text, {
            color: logPalette[entry.level],
            children: ["[", entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '—', "] ", entry.text]
          }, entry.id))]
        })]
      })]
    }), isRunning && /*#__PURE__*/_jsx(Box, {
      marginTop: 1,
      children: /*#__PURE__*/_jsxs(Text, {
        color: "cyan",
        children: [/*#__PURE__*/_jsx(Spinner, {
          type: "dots"
        }), " Running ", actionLabel, "\u2026"]
      })
    })]
  });
};
const ContainerStatusBoard = ({
  isActive,
  createReporter,
  pushMessage
}) => {
  const serviceList = useMemo(() => [...SERVICES], []);
  const [containers, setContainers] = useState([]);
  const [selectedValues, setSelectedValues] = useState(() => [...serviceList]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [operating, setOperating] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listManagedContainers({
        includeStopped: true
      });
      setContainers(data);
    } catch (error) {
      pushMessage({
        level: 'error',
        text: `Failed to load container status: ${error.message}`
      });
    } finally {
      setLoading(false);
    }
  }, [pushMessage]);
  useEffect(() => {
    load();
  }, [load]);
  useInput((input, key) => {
    if (!isActive) return;
    if (operating) return;
    if (confirmDelete) {
      if (input === 'y' || input === 'Y') {
        handleDelete();
      } else {
        setConfirmDelete(false);
        pushMessage({
          level: 'info',
          text: 'Delete operation cancelled.'
        });
      }
      return;
    }
    if (input === 'r') load();
    if (input === 'k') handleStopAll();
    if (input === 'x') handleClean();
    if (input === 'd') setConfirmDelete(true);
    if (input === 'w') handleStart();
    if (operating) return;
    if (key.upArrow || input === 'k') {
      setCursor(current => (current - 1 + serviceList.length) % serviceList.length);
    }
    if (key.downArrow || input === 'j') {
      setCursor(current => (current + 1) % serviceList.length);
    }
    if (input === ' ') {
      const target = serviceList[cursor];
      setSelectedValues(prev => prev.includes(target) ? prev.filter(value => value !== target) : [...prev, target]);
    }
  });
  const handleStopAll = useCallback(async () => {
    setOperating(true);
    const reporter = createReporter();
    try {
      await stopAllContainers({
        reporter
      });
      await load();
    } catch (error) {
      pushMessage({
        level: 'error',
        text: `Failed to stop containers: ${error.message}`
      });
    } finally {
      setOperating(false);
    }
  }, [createReporter, load, pushMessage]);
  const handleClean = useCallback(async () => {
    if (selectedValues.length === 0) {
      pushMessage({
        level: 'warn',
        text: 'Select at least one service to clean.'
      });
      return;
    }
    setOperating(true);
    const reporter = createReporter();
    try {
      await cleanServices(selectedValues, {
        reporter
      });
      await load();
    } catch (error) {
      pushMessage({
        level: 'error',
        text: `Failed to clean services: ${error.message}`
      });
    } finally {
      setOperating(false);
    }
  }, [createReporter, load, pushMessage, selectedValues]);
  const handleStart = useCallback(async () => {
    setOperating(true);
    const reporter = createReporter();
    try {
      await startServices(['warden'], {
        reporter,
        onProgress: event => {
          if (!event) return;
          if (event.type === 'complete' && event.ok) {
            pushMessage({
              level: 'success',
              text: 'Warden reported healthy.'
            });
          }
          if (event.type === 'complete' && event.ok === false) {
            pushMessage({
              level: 'error',
              text: `Warden failed to start: ${event.error?.message || 'unknown error'}`
            });
          }
        },
        onLog: payload => {
          if (!payload?.line) return;
          pushMessage({
            level: 'info',
            text: `[${payload.service}] ${stripAnsi(payload.line)}`
          });
        }
      });
      await load();
    } catch (error) {
      pushMessage({
        level: 'error',
        text: `Failed to start warden: ${error.message}`
      });
    } finally {
      setOperating(false);
    }
  }, [createReporter, load, pushMessage]);
  const handleDelete = useCallback(async () => {
    setConfirmDelete(false);
    setOperating(true);
    const reporter = createReporter();
    try {
      await deleteDockerResources({
        reporter,
        confirm: true
      });
      await load();
    } catch (error) {
      pushMessage({
        level: 'error',
        text: `Unable to delete Docker resources: ${error.message}`
      });
    } finally {
      setOperating(false);
    }
  }, [createReporter, load, pushMessage]);
  return /*#__PURE__*/_jsx(ViewContainer, {
    title: "Container Status Board",
    children: loading ? /*#__PURE__*/_jsxs(Text, {
      children: [/*#__PURE__*/_jsx(Text, {
        color: "cyan",
        children: /*#__PURE__*/_jsx(Spinner, {
          type: "dots"
        })
      }), " Loading container metadata\u2026"]
    }) : /*#__PURE__*/_jsxs(_Fragment, {
      children: [containers.length === 0 ? /*#__PURE__*/_jsx(Text, {
        dimColor: true,
        children: "No managed containers detected."
      }) : /*#__PURE__*/_jsx(Box, {
        flexDirection: "column",
        children: containers.map(container => /*#__PURE__*/_jsxs(Text, {
          children: [container.name.padEnd(12), " \xB7 ", container.state.padEnd(10), " \xB7 ", container.ports !== '—' ? container.ports : 'no ports exposed']
        }, container.id))
      }), /*#__PURE__*/_jsxs(Box, {
        marginTop: 1,
        flexDirection: "column",
        children: [/*#__PURE__*/_jsx(Text, {
          children: "Select services to clean (\u2191/\u2193 to move, space to toggle):"
        }), /*#__PURE__*/_jsx(Box, {
          flexDirection: "column",
          marginTop: 1,
          children: serviceList.map((service, index) => {
            const isSelected = selectedValues.includes(service);
            const isHighlighted = index === cursor;
            return /*#__PURE__*/_jsxs(Text, {
              color: isHighlighted ? 'cyan' : undefined,
              children: [isHighlighted ? '▸' : ' ', " [", isSelected ? 'x' : ' ', "] ", service]
            }, service);
          })
        })]
      }), /*#__PURE__*/_jsxs(Box, {
        marginTop: 1,
        flexDirection: "column",
        children: [/*#__PURE__*/_jsx(Text, {
          children: "Shortcuts: \u2191/\u2193 move \xB7 space toggle \xB7 r refresh \xB7 k stop all \xB7 w start warden \xB7 x clean selected \xB7 d delete all"
        }), confirmDelete && /*#__PURE__*/_jsx(Text, {
          color: "red",
          children: "Confirm delete of all Docker resources? Press y to confirm or any other key to cancel."
        }), operating && /*#__PURE__*/_jsxs(Text, {
          color: "yellow",
          children: [/*#__PURE__*/_jsx(Spinner, {
            type: "dots"
          }), " Executing container operation\u2026"]
        })]
      })]
    })
  });
};
const SettingsPanel = ({
  isActive,
  createReporter,
  pushMessage
}) => {
  const [settings, setSettings] = useState(null);
  const [mode, setMode] = useState('menu');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getDeploymentSettings();
      setSettings(data);
    } catch (error) {
      pushMessage({
        level: 'error',
        text: `Failed to read settings: ${error.message}`
      });
    } finally {
      setLoading(false);
    }
  }, [pushMessage]);
  useEffect(() => {
    load();
  }, [load]);
  const resetMode = useCallback(() => setMode('menu'), []);
  const handleUpdateConcurrency = useCallback(async (key, value) => {
    const reporter = createReporter();
    try {
      await updateBuildConcurrencyDefaults({
        [key]: value
      });
      await load();
      reporter.success(`Updated ${key} to ${value}.`);
    } catch (error) {
      reporter.error(`Failed to update ${key}: ${error.message}`);
    } finally {
      resetMode();
    }
  }, [createReporter, load, resetMode]);
  const handleUpdateDebug = useCallback(async updates => {
    const reporter = createReporter();
    try {
      await updateDebugDefaults(updates);
      await load();
      reporter.success('Updated default debug configuration.');
    } catch (error) {
      reporter.error(`Failed to update defaults: ${error.message}`);
    } finally {
      resetMode();
    }
  }, [createReporter, load, resetMode]);
  useInput((input, key) => {
    if (!isActive) return;
    if (mode !== 'menu' && key.escape) {
      resetMode();
    }
  });
  if (loading || !settings) {
    return /*#__PURE__*/_jsx(ViewContainer, {
      title: "Settings & Defaults",
      children: /*#__PURE__*/_jsxs(Text, {
        children: [/*#__PURE__*/_jsx(Text, {
          color: "cyan",
          children: /*#__PURE__*/_jsx(Spinner, {
            type: "dots"
          })
        }), " Loading settings\u2026"]
      })
    });
  }
  if (mode === 'menu') {
    const menuItems = [{
      label: 'Adjust worker threads',
      value: 'workers'
    }, {
      label: 'Adjust subprocesses per worker',
      value: 'subprocessesPerWorker'
    }, {
      label: 'Set default DEBUG level',
      value: 'debugLevel'
    }, {
      label: 'Set default boot mode',
      value: 'bootMode'
    }];
    return /*#__PURE__*/_jsxs(ViewContainer, {
      title: "Settings & Defaults",
      children: [/*#__PURE__*/_jsx(Text, {
        children: "Current build concurrency:"
      }), /*#__PURE__*/_jsxs(Text, {
        children: ["Worker threads: ", settings.buildScheduler.workerThreads, " | Subprocesses per worker: ", settings.buildScheduler.subprocessesPerWorker]
      }), /*#__PURE__*/_jsxs(Box, {
        marginTop: 1,
        flexDirection: "column",
        children: [/*#__PURE__*/_jsx(Text, {
          children: "Defaults:"
        }), /*#__PURE__*/_jsxs(Text, {
          children: ["DEBUG level: ", settings.defaults.debugLevel]
        }), /*#__PURE__*/_jsxs(Text, {
          children: ["Boot mode: ", settings.defaults.bootMode]
        })]
      }), /*#__PURE__*/_jsxs(Box, {
        marginTop: 1,
        flexDirection: "column",
        children: [/*#__PURE__*/_jsx(Text, {
          children: "Select a setting to update:"
        }), /*#__PURE__*/_jsx(SelectInput, {
          items: menuItems,
          onSelect: item => setMode(item.value),
          focus: isActive
        }), /*#__PURE__*/_jsx(Text, {
          dimColor: true,
          children: "Press esc to cancel any edit."
        })]
      })]
    });
  }
  if (mode === 'workers' || mode === 'subprocessesPerWorker') {
    const options = Array.from({
      length: 8
    }, (_, index) => ({
      label: String(index + 1),
      value: index + 1
    }));
    return /*#__PURE__*/_jsxs(ViewContainer, {
      title: "Adjust Concurrency",
      children: [/*#__PURE__*/_jsxs(Text, {
        children: ["Select a new value for ", mode === 'workers' ? 'worker threads' : 'subprocesses per worker', ":"]
      }), /*#__PURE__*/_jsx(SelectInput, {
        items: options,
        onSelect: item => handleUpdateConcurrency(mode === 'workers' ? 'workerThreads' : 'subprocessesPerWorker', item.value),
        focus: isActive
      }), /*#__PURE__*/_jsx(Text, {
        dimColor: true,
        children: "Press esc to cancel."
      })]
    });
  }
  if (mode === 'debugLevel') {
    const options = ['false', 'true', 'super'].map(value => ({
      label: value,
      value
    }));
    return /*#__PURE__*/_jsxs(ViewContainer, {
      title: "Default DEBUG Level",
      children: [/*#__PURE__*/_jsx(Text, {
        children: "Select the default DEBUG level for container launches:"
      }), /*#__PURE__*/_jsx(SelectInput, {
        items: options,
        onSelect: item => handleUpdateDebug({
          debugLevel: item.value
        }),
        focus: isActive
      }), /*#__PURE__*/_jsx(Text, {
        dimColor: true,
        children: "Press esc to cancel."
      })]
    });
  }
  if (mode === 'bootMode') {
    const options = ['minimal', 'super'].map(value => ({
      label: value,
      value
    }));
    return /*#__PURE__*/_jsxs(ViewContainer, {
      title: "Default Boot Mode",
      children: [/*#__PURE__*/_jsx(Text, {
        children: "Select the default boot mode for Warden:"
      }), /*#__PURE__*/_jsx(SelectInput, {
        items: options,
        onSelect: item => handleUpdateDebug({
          bootMode: item.value
        }),
        focus: isActive
      }), /*#__PURE__*/_jsx(Text, {
        dimColor: true,
        children: "Press esc to cancel."
      })]
    });
  }
  return null;
};
const App = () => {
  const {
    exit
  } = useApp();
  const [view, setView] = useState('overview');
  const {
    messages,
    pushMessage,
    createReporter
  } = useMessageLog();
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }
    if (input === 'q') {
      exit();
      return;
    }
    const order = ['overview', 'builds', 'containers', 'settings'];
    const index = order.indexOf(view);
    if (key.leftArrow || input === 'h') {
      const next = (index - 1 + order.length) % order.length;
      setView(order[next]);
    }
    if (key.rightArrow || input === 'l') {
      const next = (index + 1) % order.length;
      setView(order[next]);
    }
    if (['1', '2', '3', '4'].includes(input)) {
      setView(order[Number.parseInt(input, 10) - 1]);
    }
  });
  return /*#__PURE__*/_jsxs(Box, {
    flexDirection: "column",
    children: [/*#__PURE__*/_jsxs(Box, {
      flexDirection: "row",
      children: [/*#__PURE__*/_jsx(Navigation, {
        active: view
      }), view === 'overview' && /*#__PURE__*/_jsx(OverviewDashboard, {
        isActive: true,
        pushMessage: pushMessage
      }), view === 'builds' && /*#__PURE__*/_jsx(BuildQueueManager, {
        isActive: true,
        createReporter: createReporter,
        pushMessage: pushMessage
      }), view === 'containers' && /*#__PURE__*/_jsx(ContainerStatusBoard, {
        isActive: true,
        createReporter: createReporter,
        pushMessage: pushMessage
      }), view === 'settings' && /*#__PURE__*/_jsx(SettingsPanel, {
        isActive: true,
        createReporter: createReporter,
        pushMessage: pushMessage
      })]
    }), /*#__PURE__*/_jsx(MessagePanel, {
      messages: messages
    }), /*#__PURE__*/_jsx(Text, {
      dimColor: true,
      children: "Accessibility: navigation via keyboard, high-contrast colors, spinner feedback during operations."
    })]
  });
};
render(/*#__PURE__*/_jsx(App, {}));
