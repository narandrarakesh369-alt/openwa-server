"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUniqueViolation = isUniqueViolation;
exports.isMissingTableError = isMissingTableError;
const typeorm_1 = require("typeorm");
function isNamedError(err, name) {
    return typeof err === 'object' && err !== null && err.name === name;
}
function isQueryFailedErrorLike(err) {
    return err instanceof typeorm_1.QueryFailedError || isNamedError(err, 'QueryFailedError');
}
function isUniqueViolation(err) {
    if (err == null || typeof err !== 'object')
        return false;
    const e = err;
    const code = e.driverError?.code ?? e.code;
    if (code === '23505')
        return true;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY')
        return true;
    if (code != null && code !== 'SQLITE_CONSTRAINT')
        return false;
    const message = e.driverError?.message ?? e.message ?? '';
    return /UNIQUE constraint failed/i.test(message);
}
function isMissingTableError(err) {
    if (isQueryFailedErrorLike(err)) {
        const driver = err.driverError;
        if (driver?.code === '42P01')
            return true;
        const message = `${driver?.message ?? ''} ${err.message ?? ''}`;
        return /no such table/i.test(message);
    }
    return isNamedError(err, 'SqliteError') && /no such table/i.test(err.message ?? '');
}
//# sourceMappingURL=db-errors.js.map