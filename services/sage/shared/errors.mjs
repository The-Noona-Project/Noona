// services/sage/shared/errors.mjs

export class SetupValidationError extends Error {
    constructor(message) {
        super(message)
        this.name = 'SetupValidationError'
    }
}

export default SetupValidationError
