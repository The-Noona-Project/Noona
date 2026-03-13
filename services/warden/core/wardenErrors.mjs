export class WardenError extends Error {
    constructor(message, options = {}) {
        const {
            cause,
            code = 'WARDEN_ERROR',
            details = null,
            payload = null,
            statusCode = 500,
        } = options;

        super(message, cause ? {cause} : undefined);
        this.name = new.target.name;
        this.code = code;
        this.statusCode = statusCode;

        if (details != null) {
            this.details = details;
        }

        if (payload != null) {
            this.payload = payload;
        }
    }
}

export class WardenValidationError extends WardenError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            code: options.code ?? 'WARDEN_VALIDATION_ERROR',
            statusCode: 400,
        });
    }
}

export class WardenNotFoundError extends WardenError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            code: options.code ?? 'WARDEN_NOT_FOUND',
            statusCode: 404,
        });
    }
}

export class WardenConflictError extends WardenError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            code: options.code ?? 'WARDEN_CONFLICT',
            statusCode: 409,
        });
    }
}

export class WardenApplyError extends WardenError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            code: options.code ?? 'WARDEN_APPLY_FAILED',
            statusCode: options.statusCode ?? 500,
        });
    }
}

export const isWardenHttpError = (error) =>
    Boolean(error)
    && Number.isInteger(error.statusCode)
    && error.statusCode >= 400
    && error.statusCode <= 599;
