export interface ProgressEvent {
    type?: string;
    service?: string;
    step?: string;
    status?: string;
    message?: string;
    [key: string]: unknown;
}

export interface ContainerLogEvent {
    service?: string;
    line?: string;
    [key: string]: unknown;
}

export interface StreamEntry {
    action?: string;
    type?: string;
    level?: 'info' | 'warn' | 'error' | 'success' | string;
    message?: string;
    event?: ProgressEvent | ContainerLogEvent;
    data?: Record<string, unknown>[];
    columns?: string[];
    ok?: boolean;
    result?: unknown;
    raw?: string;
    [key: string]: unknown;
}

export interface ServicesResponse {
    ok?: boolean;
    services?: unknown[];
    containers?: unknown[];
    history?: unknown[];
    errors?: unknown;
}
