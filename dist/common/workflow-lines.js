"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executableLines = executableLines;
function executableLines(run) {
    return run
        .split('\n')
        .map(line => {
        const hash = line.indexOf('#');
        if (hash === -1)
            return line;
        const before = line.slice(0, hash);
        const quotes = (before.match(/["']/g) ?? []).length;
        return quotes % 2 === 1 ? line : before;
    })
        .join('\n');
}
//# sourceMappingURL=workflow-lines.js.map