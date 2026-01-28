class LongFunctionAnalyzer {
    static analyze(files, functionLineThreshold = 50) {
        const longFunctions = [];

        files.forEach((file) => {
            const content = file.content;
            const lines = content.split("\n");
            const matches = FunctionMetricsAnalyzer.findFunctionHeaders(content);

            matches.forEach((match) => {
                const functionName = match.functionName;
                const functionStartIndex = match.functionStartIndex;
                const functionStartLine = content.substring(0, functionStartIndex).split("\n").length;

                let braceCount = 0;
                let functionEndLine = functionStartLine;
                let inBlockComment = false;
                let started = false;

                for (let i = functionStartLine - 1; i < lines.length; i++) {
                    const line = lines[i];
                    const sanitizeResult = FunctionMetricsAnalyzer.stripCommentsAndStrings(line, inBlockComment);
                    const sanitizedLine = sanitizeResult.line;
                    inBlockComment = sanitizeResult.inBlockComment;

                    for (const char of sanitizedLine) {
                        if (char === "{") {
                            braceCount++;
                            started = true;
                        } else if (char === "}") {
                            braceCount--;
                        }
                    }

                    if (started && braceCount === 0) {
                        functionEndLine = i + 1;
                        break;
                    }
                }

                const functionLength = functionEndLine - functionStartLine + 1;

                if (functionLength > functionLineThreshold) {
                    let actualCodeLines = 0;
                    inBlockComment = false;
                    for (let i = functionStartLine - 1; i < functionEndLine; i++) {
                        const line = lines[i];
                        const sanitizeResult = FunctionMetricsAnalyzer.stripCommentsAndStrings(line, inBlockComment);
                        const sanitizedLine = sanitizeResult.line;
                        inBlockComment = sanitizeResult.inBlockComment;
                        const trimmed = sanitizedLine.trim();
                        if (trimmed.length > 0) {
                            actualCodeLines++;
                        }
                    }

                    longFunctions.push({
                        functionName,
                        file: file.path || file.name,
                        startLine: functionStartLine,
                        endLine: functionEndLine,
                        totalLines: functionLength,
                        codeLines: actualCodeLines,
                    });
                }
            });
        });

        longFunctions.sort((a, b) => b.codeLines - a.codeLines);
        return longFunctions;
    }
}
