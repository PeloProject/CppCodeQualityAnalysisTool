class CodeNormalizer {
    static normalizeCode(code) {
        return code
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    static getCodeLines(content) {
        return content
            .split("\n")
            .map((line, idx) => ({
                lineNum: idx + 1,
                original: line,
                normalized: CodeNormalizer.normalizeCode(line),
            }))
            .filter((line) => line.normalized.length > 0);
    }
}

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

                let braceCount = 1;
                let functionEndLine = functionStartLine;

                for (let i = functionStartLine - 1; i < lines.length; i++) {
                    const line = lines[i];

                    for (const char of line) {
                        if (char === "{") braceCount++;
                        else if (char === "}") braceCount--;
                    }

                    if (braceCount === 0) {
                        functionEndLine = i + 1;
                        break;
                    }
                }

                const functionLength = functionEndLine - functionStartLine + 1;

                if (functionLength > functionLineThreshold) {
                    let actualCodeLines = 0;
                    for (let i = functionStartLine - 1; i < functionEndLine; i++) {
                        const line = lines[i].trim();
                        if (line && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*")) {
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

class FunctionMetricsAnalyzer {
    static analyze(files) {
        const functions = [];

        files.forEach((file) => {
            const content = file.content;
            const lines = content.split("\n");
            const matches = FunctionMetricsAnalyzer.findFunctionHeaders(content);

            matches.forEach((match) => {
                const functionName = match.functionName;
                const functionStartIndex = match.functionStartIndex;
                const functionStartLine = content.substring(0, functionStartIndex).split("\n").length;
                const signatureInfo = FunctionMetricsAnalyzer.extractSignature(content, functionStartIndex);

                let braceCount = 1;
                let functionEndLine = functionStartLine;
                let currentNesting = 0;
                let maxNesting = 0;
                let complexity = 1;
                let inBlockComment = false;

                for (let i = functionStartLine - 1; i < lines.length; i++) {
                    const line = lines[i];
                    const sanitizeResult = FunctionMetricsAnalyzer.stripCommentsAndStrings(line, inBlockComment);
                    const sanitizedLine = sanitizeResult.line;
                    inBlockComment = sanitizeResult.inBlockComment;

                    complexity += FunctionMetricsAnalyzer.countComplexityTokens(sanitizedLine);

                    for (const char of sanitizedLine) {
                        if (char === "{") {
                            braceCount++;
                            currentNesting = Math.max(0, braceCount - 1);
                            maxNesting = Math.max(maxNesting, currentNesting);
                        } else if (char === "}") {
                            braceCount--;
                            currentNesting = Math.max(0, braceCount - 1);
                        }
                    }

                    if (braceCount === 0) {
                        functionEndLine = i + 1;
                        break;
                    }
                }

                const functionLength = functionEndLine - functionStartLine + 1;

                functions.push({
                    functionName,
                    file: file.path || file.name,
                    startLine: functionStartLine,
                    endLine: functionEndLine,
                    totalLines: functionLength,
                    complexity,
                    maxNesting,
                    parameterCount: signatureInfo.parameterCount,
                });
            });
        });

        const totalFunctions = functions.length;
        const totalLines = functions.reduce((sum, fn) => sum + fn.totalLines, 0);
        const totalComplexity = functions.reduce((sum, fn) => sum + fn.complexity, 0);
        const maxFunctionLines = Math.max(0, ...functions.map((fn) => fn.totalLines));
        const maxComplexity = Math.max(0, ...functions.map((fn) => fn.complexity));
        const maxNesting = Math.max(0, ...functions.map((fn) => fn.maxNesting));
        const maxParams = Math.max(0, ...functions.map((fn) => fn.parameterCount));

        return {
            functions,
            totalFunctions,
            avgFunctionLines: totalFunctions === 0 ? 0 : totalLines / totalFunctions,
            maxFunctionLines,
            avgComplexity: totalFunctions === 0 ? 0 : totalComplexity / totalFunctions,
            maxComplexity,
            maxNesting,
            maxParams,
        };
    }

    static extractSignature(content, startIndex) {
        const startParen = content.indexOf("(", startIndex);
        if (startParen === -1) {
            return { parameterCount: 0, endParen: -1 };
        }

        let depth = 0;
        let endParen = -1;
        for (let i = startParen; i < content.length; i++) {
            const char = content[i];
            if (char === "(") depth++;
            if (char === ")") {
                depth--;
                if (depth === 0) {
                    endParen = i;
                    break;
                }
            }
        }

        if (endParen === -1) {
            return { parameterCount: 0, endParen: -1 };
        }

        const params = content.slice(startParen + 1, endParen);
        const parameterCount = FunctionMetricsAnalyzer.countParameters(params);
        return { parameterCount, endParen };
    }

    static hasFunctionBodyAfter(content, endParen) {
        if (endParen < 0) {
            return false;
        }

        const tail = content.slice(endParen + 1);
        const match = tail.match(/^\s*(?:\s*(?:const|noexcept|override|final))*\s*(?:->[\w\s:<>*&]+)?\s*\{/);
        return Boolean(match);
    }

    static findFunctionHeaders(content) {
        const functionRegex = /^[\s]*(?:(?:inline|static|virtual|explicit|friend|constexpr)\s+)*(?:[\w:]+(?:<[^>]*>)?(?:\s*[&*])*)\s+([\w:]+)\s*\(/gm;
        const matches = [];
        let match;

        while ((match = functionRegex.exec(content)) !== null) {
            const functionName = match[1];
            const functionStartIndex = match.index;
            const signatureInfo = FunctionMetricsAnalyzer.extractSignature(content, functionStartIndex);

            if (!FunctionMetricsAnalyzer.hasFunctionBodyAfter(content, signatureInfo.endParen)) {
                continue;
            }

            matches.push({
                functionName,
                functionStartIndex,
            });
        }

        return matches;
    }

    static countParameters(params) {
        const trimmed = params.trim();
        if (!trimmed || trimmed === "void") {
            return 0;
        }

        let count = 1;
        let depthAngle = 0;
        let depthParen = 0;
        let depthBracket = 0;
        let depthBrace = 0;
        let inString = false;
        let stringChar = "";

        for (let i = 0; i < params.length; i++) {
            const char = params[i];
            if (inString) {
                if (char === stringChar && params[i - 1] !== "\\") {
                    inString = false;
                }
                continue;
            }

            if (char === "\"" || char === "'") {
                inString = true;
                stringChar = char;
                continue;
            }

            if (char === "<") depthAngle++;
            else if (char === ">") depthAngle = Math.max(0, depthAngle - 1);
            else if (char === "(") depthParen++;
            else if (char === ")") depthParen = Math.max(0, depthParen - 1);
            else if (char === "[") depthBracket++;
            else if (char === "]") depthBracket = Math.max(0, depthBracket - 1);
            else if (char === "{") depthBrace++;
            else if (char === "}") depthBrace = Math.max(0, depthBrace - 1);

            if (char === "," && depthAngle === 0 && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
                count++;
            }
        }

        return count;
    }

    static stripCommentsAndStrings(line, inBlockComment) {
        let result = "";
        let i = 0;
        let inString = false;
        let stringChar = "";

        while (i < line.length) {
            const char = line[i];
            const next = line[i + 1];

            if (inBlockComment) {
                if (char === "*" && next === "/") {
                    inBlockComment = false;
                    i += 2;
                    continue;
                }
                i += 1;
                continue;
            }

            if (!inString && char === "/" && next === "*") {
                inBlockComment = true;
                i += 2;
                continue;
            }

            if (!inString && char === "/" && next === "/") {
                break;
            }

            if (inString) {
                if (char === stringChar && line[i - 1] !== "\\") {
                    inString = false;
                }
                i += 1;
                continue;
            }

            if (char === "\"" || char === "'") {
                inString = true;
                stringChar = char;
                i += 1;
                continue;
            }

            result += char;
            i += 1;
        }

        return { line: result, inBlockComment };
    }

    static countComplexityTokens(line) {
        const patterns = [
            /\bif\b/g,
            /\bfor\b/g,
            /\bwhile\b/g,
            /\bcase\b/g,
            /\bcatch\b/g,
            /\?/g,
            /&&/g,
            /\|\|/g,
        ];

        return patterns.reduce((sum, pattern) => {
            const matches = line.match(pattern);
            return sum + (matches ? matches.length : 0);
        }, 0);
    }
}

class ClassAnalyzer {
    static stripNestedTypes(content) {
        const typeRegex = /(class|struct)\s+\w+[^{;]*\{/g;
        let result = "";
        let lastIndex = 0;
        let match;

        while ((match = typeRegex.exec(content)) !== null) {
            const startIndex = match.index;
            const braceStart = content.indexOf("{", startIndex);
            if (braceStart === -1) {
                continue;
            }

            result += content.slice(lastIndex, startIndex);

            let braceCount = 0;
            let endIndex = braceStart;
            for (; endIndex < content.length; endIndex++) {
                const char = content[endIndex];
                if (char === "{") {
                    braceCount++;
                } else if (char === "}") {
                    braceCount--;
                }

                if (braceCount === 0) {
                    endIndex++;
                    break;
                }
            }

            lastIndex = endIndex;
            typeRegex.lastIndex = endIndex;
        }

        result += content.slice(lastIndex);
        return result;
    }

    static analyze(files) {
        const issues = {
            nonVirtualDestructors: [],
            hiddenMembers: [],
            longFunctions: [],
            godClasses: [],
        };

        const classMap = new Map();

        files.forEach((file) => {
            const content = file.content;
            const lines = content.split("\n");

            const classRegex = /(?:class|struct)\s+(\w+)(?:\s*:\s*(?:public|protected|private)?\s*(\w+(?:\s*,\s*(?:public|protected|private)?\s*\w+)*))?/g;
            let match;

            while ((match = classRegex.exec(content)) !== null) {
                const className = match[1];
                const inheritance = match[2];
                const lineNum = content.substring(0, match.index).split("\n").length;

                let braceCount = 0;
                let classContent = "";
                let started = false;
                let endLine = lineNum;

                for (let i = lineNum - 1; i < lines.length; i++) {
                    const line = lines[i];
                    classContent += line + "\n";

                    for (const char of line) {
                        if (char === "{") {
                            braceCount++;
                            started = true;
                        } else if (char === "}") {
                            braceCount--;
                        }
                    }

                    if (started && braceCount === 0) {
                        endLine = i + 1;
                        break;
                    }
                }

                const contentWithoutNested = ClassAnalyzer.stripNestedTypes(classContent);
                const baseClasses = [];
                if (inheritance) {
                    const bases = inheritance.split(",");
                    bases.forEach((base) => {
                        const baseName = base.trim().replace(/^(public|protected|private)\s+/, "");
                        baseClasses.push(baseName);
                    });
                }

                const members = {
                    functions: [],
                    variables: [],
                    hasVirtualDestructor: false,
                };

                const destructorRegex = new RegExp(`(virtual\\s+)?~${className}\\s*\\(`);
                const destructorMatch = contentWithoutNested.match(destructorRegex);
                if (destructorMatch) {
                    members.hasVirtualDestructor = destructorMatch[1] !== undefined;
                }

                const functionRegex = /(?:virtual\s+)?(?:static\s+)?(?:\w+(?:<[^>]+>)?(?:\s*\*|\s*&)?)\s+(\w+)\s*\([^)]*\)(?:\s*const)?(?:\s*override)?(?:\s*final)?/g;
                let funcMatch;
                while ((funcMatch = functionRegex.exec(contentWithoutNested)) !== null) {
                    const funcName = funcMatch[1];
                    if (funcName !== className && !funcName.startsWith("~")) {
                        members.functions.push({
                            name: funcName,
                            declaration: funcMatch[0].trim(),
                        });
                    }
                }

                const varRegex = /(?:(?:static|const|mutable)\s+)*(?:\w+(?:<[^>]+>)?(?:\s*\*|\s*&)?)\s+(\w+)\s*(?:=|;|\[)/g;
                let varMatch;
                while ((varMatch = varRegex.exec(contentWithoutNested)) !== null) {
                    const varName = varMatch[1];
                    if (!["public", "private", "protected", "class", "struct", "if", "for", "while", "return"].includes(varName)) {
                        members.variables.push(varName);
                    }
                }

                classMap.set(className, {
                    file: file.path || file.name,
                    lineNum,
                    endLine,
                    baseClasses,
                    members,
                    content: classContent,
                    contentWithoutNested,
                });
            }
        });

        const derivedByBase = new Map();
        classMap.forEach((classInfo, className) => {
            classInfo.baseClasses.forEach((baseName) => {
                if (!derivedByBase.has(baseName)) {
                    derivedByBase.set(baseName, []);
                }
                derivedByBase.get(baseName).push(className);
            });
        });

        derivedByBase.forEach((derivedClasses, baseName) => {
            const baseClass = classMap.get(baseName);
            if (!baseClass) {
                return;
            }
            if (baseClass.members.hasVirtualDestructor) {
                return;
            }
            const hasDestructor = baseClass.contentWithoutNested.includes(`~${baseName}`);
            const hasVirtualMembers = /\bvirtual\b/.test(baseClass.contentWithoutNested);
            if (hasDestructor || hasVirtualMembers) {
                issues.nonVirtualDestructors.push({
                    className: baseName,
                    file: baseClass.file,
                    lineNum: baseClass.lineNum,
                    baseClasses: derivedClasses,
                });
            }
        });

        classMap.forEach((classInfo, className) => {
            classInfo.baseClasses.forEach((baseName) => {
                const baseClass = classMap.get(baseName);
                if (baseClass) {
                    baseClass.members.functions.forEach((baseFunc) => {
                        const hidingFunc = classInfo.members.functions.find((f) =>
                            f.name === baseFunc.name && !f.declaration.includes("override")
                        );

                        if (hidingFunc) {
                            issues.hiddenMembers.push({
                                derivedClass: className,
                                baseClass: baseName,
                                memberType: "関数",
                                memberName: baseFunc.name,
                                file: classInfo.file,
                                lineNum: classInfo.lineNum,
                                baseFuncDecl: baseFunc.declaration,
                            });
                        }
                    });

                    baseClass.members.variables.forEach((baseVar) => {
                        if (classInfo.members.variables.includes(baseVar)) {
                            issues.hiddenMembers.push({
                                derivedClass: className,
                                baseClass: baseName,
                                memberType: "変数",
                                memberName: baseVar,
                                file: classInfo.file,
                                lineNum: classInfo.lineNum,
                            });
                        }
                    });
                }
            });
        });

        issues.godClasses = GodClassAnalyzer.analyze(classMap);
        issues.longFunctions = LongFunctionAnalyzer.analyze(files);
        return issues;
    }
}

class GodClassAnalyzer {
    static analyze(classMap) {
        const results = [];
        const thresholds = {
            functionCount: 20,
            variableCount: 20,
            totalMembers: 30,
            totalLines: 300,
        };

        classMap.forEach((classInfo, className) => {
            const functionCount = classInfo.members.functions.length;
            const variableCount = classInfo.members.variables.length;
            const totalMembers = functionCount + variableCount;
            const totalLines = classInfo.endLine - classInfo.lineNum + 1;
            const reasons = [];

            if (functionCount >= thresholds.functionCount) {
                reasons.push(`関数数が多い (${functionCount})`);
            }
            if (variableCount >= thresholds.variableCount) {
                reasons.push(`メンバ変数が多い (${variableCount})`);
            }
            if (totalMembers >= thresholds.totalMembers) {
                reasons.push(`総メンバ数が多い (${totalMembers})`);
            }
            if (totalLines >= thresholds.totalLines) {
                reasons.push(`クラスの行数が多い (${totalLines})`);
            }

            if (reasons.length > 0) {
                results.push({
                    className,
                    file: classInfo.file,
                    lineNum: classInfo.lineNum,
                    endLine: classInfo.endLine,
                    functionCount,
                    variableCount,
                    totalMembers,
                    totalLines,
                    reasons,
                });
            }
        });

        results.sort((a, b) => b.totalMembers - a.totalMembers);
        return results;
    }
}

class DuplicateFinder {
    static find(files, minLines) {
        const duplicates = [];
        const duplicateMap = new Map();
        const maxSegmentsPerFile = 5000;
        const maxSegmentsTotal = 15000;
        let totalSegments = 0;

        files.forEach((file, fileIdx) => {
            const lines = CodeNormalizer.getCodeLines(file.content);
            let segmentCount = 0;

            for (let i = 0; i < lines.length; i++) {
                if (segmentCount >= maxSegmentsPerFile || totalSegments >= maxSegmentsTotal) {
                    break;
                }
                if (i + minLines > lines.length) {
                    break;
                }

                const segment = lines
                    .slice(i, i + minLines)
                    .map((l) => l.normalized)
                    .join("\n");

                if (segment.length < 20) continue;

                if (!duplicateMap.has(segment)) {
                    duplicateMap.set(segment, []);
                }

                duplicateMap.get(segment).push({
                    fileIdx,
                    fileName: file.name,
                    filePath: file.path,
                    startLine: lines[i].lineNum,
                    endLine: lines[i + minLines - 1].lineNum,
                    length: minLines,
                });
                segmentCount += 1;
                totalSegments += 1;
            }
        });

        duplicateMap.forEach((locations) => {
            if (locations.length > 1) {
                const uniqueLocations = [];
                const seen = new Set();

                locations.forEach((loc) => {
                    const key = `${loc.fileName}-${loc.startLine}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        uniqueLocations.push(loc);
                    }
                });

                if (uniqueLocations.length > 1) {
                    duplicates.push({
                        locations: uniqueLocations,
                    });
                }
            }
        });

        duplicates.sort((a, b) => {
            const maxLengthA = Math.max(...a.locations.map((l) => l.length));
            const maxLengthB = Math.max(...b.locations.map((l) => l.length));
            return maxLengthB - maxLengthA;
        });

        const deduped = DuplicateFinder.collapseNearDuplicates(duplicates, 0.8);
        const pruned = DuplicateFinder.removeContainedDuplicates(deduped);
        const merged = DuplicateFinder.collapseOverlappingRuns(pruned);

        const totalDuplicateLines = merged.reduce((sum, dup) => {
            return sum + (dup.locations.length - 1) * dup.locations[0].length;
        }, 0);

        return {
            duplicates: merged.slice(0, 50),
            totalDuplicates: merged.length,
            totalDuplicateLines,
        };
    }

    static collapseNearDuplicates(duplicates, overlapThreshold) {
        const deduped = [];

        duplicates.forEach((candidate) => {
            const isDuplicate = deduped.some((existing) =>
                DuplicateFinder.isNearDuplicate(candidate, existing, overlapThreshold)
            );
            if (!isDuplicate) {
                deduped.push(candidate);
            }
        });

        return deduped;
    }

    static isNearDuplicate(a, b, overlapThreshold) {
        if (a.locations.length !== b.locations.length) {
            return false;
        }

        const aSorted = DuplicateFinder.sortLocations(a.locations);
        const bSorted = DuplicateFinder.sortLocations(b.locations);

        return aSorted.every((locA, index) => {
            const locB = bSorted[index];
            if (!locB) {
                return false;
            }
            if (DuplicateFinder.locationKey(locA) !== DuplicateFinder.locationKey(locB)) {
                return false;
            }
            return DuplicateFinder.overlapRatio(locA, locB) >= overlapThreshold;
        });
    }

    static locationKey(loc) {
        return loc.filePath || loc.fileName;
    }

    static sortLocations(locations) {
        return [...locations].sort((a, b) => {
            const fileA = DuplicateFinder.locationKey(a);
            const fileB = DuplicateFinder.locationKey(b);
            if (fileA !== fileB) {
                return fileA.localeCompare(fileB);
            }
            return a.startLine - b.startLine;
        });
    }

    static overlapRatio(a, b) {
        const start = Math.max(a.startLine, b.startLine);
        const end = Math.min(a.endLine, b.endLine);
        const overlap = Math.max(0, end - start + 1);
        const minLength = Math.min(a.length, b.length);
        if (minLength === 0) {
            return 0;
        }
        return overlap / minLength;
    }

    static removeContainedDuplicates(duplicates) {
        const sorted = [...duplicates].sort((a, b) => {
            const maxLengthA = Math.max(...a.locations.map((l) => l.length));
            const maxLengthB = Math.max(...b.locations.map((l) => l.length));
            return maxLengthB - maxLengthA;
        });

        const kept = [];
        sorted.forEach((candidate) => {
            const isContained = kept.some((existing) =>
                DuplicateFinder.isContainedIn(candidate, existing)
            );
            if (!isContained) {
                kept.push(candidate);
            }
        });

        return kept;
    }

    static collapseOverlappingRuns(duplicates) {
        const sorted = [...duplicates].sort((a, b) => {
            const locA = a.locations[0];
            const locB = b.locations[0];
            if (!locA || !locB) {
                return 0;
            }
            const fileA = DuplicateFinder.locationKey(locA);
            const fileB = DuplicateFinder.locationKey(locB);
            if (fileA !== fileB) {
                return fileA.localeCompare(fileB);
            }
            return locA.startLine - locB.startLine;
        });

        const rangesByKey = new Map();
        const kept = [];

        sorted.forEach((candidate) => {
            if (candidate.locations.length !== 2) {
                kept.push(candidate);
                return;
            }

            const locA = candidate.locations[0];
            const locB = candidate.locations[1];
            const fileA = DuplicateFinder.locationKey(locA);
            const fileB = DuplicateFinder.locationKey(locB);
            const key = `${fileA}::${fileB}::${locB.startLine - locA.startLine}`;

            if (!rangesByKey.has(key)) {
                rangesByKey.set(key, []);
            }

            const ranges = rangesByKey.get(key);
            const last = ranges[ranges.length - 1];
            if (last && locA.startLine <= last.endLine) {
                if (locA.endLine > last.endLine) {
                    last.endLine = locA.endLine;
                }
                return;
            }

            ranges.push({ startLine: locA.startLine, endLine: locA.endLine });
            kept.push(candidate);
        });

        return kept;
    }

    static isContainedIn(smaller, larger) {
        if (smaller.locations.length !== larger.locations.length) {
            return false;
        }

        const smallSorted = DuplicateFinder.sortLocations(smaller.locations);
        const largeSorted = DuplicateFinder.sortLocations(larger.locations);

        return smallSorted.every((locA, index) => {
            const locB = largeSorted[index];
            if (!locB) {
                return false;
            }
            if (DuplicateFinder.locationKey(locA) !== DuplicateFinder.locationKey(locB)) {
                return false;
            }
            const contained = locA.startLine >= locB.startLine && locA.endLine <= locB.endLine;
            return contained;
        });
    }
}

class SafetyScanner {
    static scan(files) {
        const findings = [];
        const patterns = [
            { id: "new", label: "new の使用", regex: /\bnew\b/g },
            { id: "delete", label: "delete の使用", regex: /\bdelete\b/g },
            { id: "malloc", label: "malloc/free の使用", regex: /\bmalloc\b|\bfree\b/g },
            { id: "strcpy", label: "strcpy/strcat の使用", regex: /\bstrcpy\b|\bstrcat\b/g },
            { id: "sprintf", label: "sprintf/scanf の使用", regex: /\bsprintf\b|\bscanf\b/g },
            { id: "memcpy", label: "memcpy の使用", regex: /\bmemcpy\b/g },
        ];

        files.forEach((file) => {
            const lines = file.content.split("\n");
            let inBlockComment = false;

            lines.forEach((line, idx) => {
                const sanitizeResult = FunctionMetricsAnalyzer.stripCommentsAndStrings(line, inBlockComment);
                const sanitizedLine = sanitizeResult.line;
                inBlockComment = sanitizeResult.inBlockComment;

                patterns.forEach((pattern) => {
                    if (pattern.regex.test(sanitizedLine)) {
                        findings.push({
                            file: file.path || file.name,
                            lineNum: idx + 1,
                            label: pattern.label,
                        });
                    }
                });
            });
        });

        return {
            count: findings.length,
            findings,
        };
    }
}

class CandidateEvaluator {
    static evaluate(files, analysis, profileKey) {
        const profiles = CandidateEvaluator.getProfiles();
        const profile = profiles[profileKey] || profiles.standard;

        const totalLines = files.reduce((sum, file) => sum + file.content.split("\n").length, 0);
        const duplicateLinesTotal = analysis.duplicates.scopedTotalLines ?? totalLines;
        const duplicateRatio = duplicateLinesTotal === 0
            ? 0
            : analysis.duplicates.totalDuplicateLines / duplicateLinesTotal;
        const functionMetrics = analysis.functionMetrics;
        const classIssues = analysis.classIssues;
        const safety = analysis.safety;

        const readabilityScore = CandidateEvaluator.scoreReadability(functionMetrics, profile);
        const designScore = CandidateEvaluator.scoreDesign(classIssues, profile);
        const complexityScore = CandidateEvaluator.scoreComplexity(functionMetrics, profile);
        const duplicationScore = CandidateEvaluator.scoreDuplication(duplicateRatio, profile);
        const robustnessScore = CandidateEvaluator.scoreRobustness(functionMetrics, safety, profile);

        const totalScore = CandidateEvaluator.weightedScore({
            readability: readabilityScore,
            design: designScore,
            complexity: complexityScore,
            duplication: duplicationScore,
            robustness: robustnessScore,
        }, profile.weights);

        const criticalIssues = CandidateEvaluator.countCriticalIssues(functionMetrics, classIssues, safety, profile);
        const pass = totalScore >= profile.passScore && criticalIssues <= profile.maxCriticalIssues;

        return {
            profileKey: profile.key,
            pass,
            totalScore: Math.round(totalScore),
            radar: {
                可読性: Math.round(readabilityScore),
                設計: Math.round(designScore),
                複雑度: Math.round(complexityScore),
                重複: Math.round(duplicationScore),
                堅牢性: Math.round(robustnessScore),
            },
            comment: CandidateEvaluator.buildComment({
                totalScore,
                pass,
                lowestAxis: CandidateEvaluator.getLowestAxis({
                    readability: readabilityScore,
                    design: designScore,
                    complexity: complexityScore,
                    duplication: duplicationScore,
                    robustness: robustnessScore,
                }),
                criticalIssues,
            }),
            details: {
                totalFiles: files.length,
                totalLines,
                totalFunctions: functionMetrics.totalFunctions,
                avgFunctionLines: CandidateEvaluator.round(functionMetrics.avgFunctionLines, 1),
                maxFunctionLines: functionMetrics.maxFunctionLines,
                avgComplexity: CandidateEvaluator.round(functionMetrics.avgComplexity, 1),
                maxComplexity: functionMetrics.maxComplexity,
                maxNesting: functionMetrics.maxNesting,
                maxParams: functionMetrics.maxParams,
                duplicateRatio: CandidateEvaluator.round(duplicateRatio * 100, 1),
                godClasses: classIssues.godClasses.length,
                hiddenMembers: classIssues.hiddenMembers.length,
                nonVirtualDestructors: classIssues.nonVirtualDestructors.length,
                safetyFindings: safety.count,
                criticalIssues,
            },
        };
    }

    static getProfiles() {
        return {
            strict: {
                key: "strict",
                label: "厳格",
                passScore: 80,
                maxCriticalIssues: 0,
                thresholds: {
                    avgFunctionLines: 25,
                    maxFunctionLines: 80,
                    maxParams: 6,
                    maxNesting: 4,
                    avgComplexity: 8,
                    maxComplexity: 20,
                    duplicateRatio: 0.08,
                    safetyFindings: 5,
                },
                critical: {
                    maxComplexity: 30,
                    safetyFindings: 10,
                    godClasses: 2,
                },
                weights: {
                    readability: 0.22,
                    design: 0.26,
                    complexity: 0.2,
                    duplication: 0.16,
                    robustness: 0.16,
                },
            },
            standard: {
                key: "standard",
                label: "標準",
                passScore: 70,
                maxCriticalIssues: 1,
                thresholds: {
                    avgFunctionLines: 35,
                    maxFunctionLines: 120,
                    maxParams: 8,
                    maxNesting: 5,
                    avgComplexity: 12,
                    maxComplexity: 25,
                    duplicateRatio: 0.12,
                    safetyFindings: 10,
                },
                critical: {
                    maxComplexity: 40,
                    safetyFindings: 20,
                    godClasses: 3,
                },
                weights: {
                    readability: 0.22,
                    design: 0.25,
                    complexity: 0.2,
                    duplication: 0.16,
                    robustness: 0.17,
                },
            },
            lenient: {
                key: "lenient",
                label: "緩め",
                passScore: 60,
                maxCriticalIssues: 2,
                thresholds: {
                    avgFunctionLines: 45,
                    maxFunctionLines: 160,
                    maxParams: 10,
                    maxNesting: 6,
                    avgComplexity: 15,
                    maxComplexity: 30,
                    duplicateRatio: 0.18,
                    safetyFindings: 15,
                },
                critical: {
                    maxComplexity: 50,
                    safetyFindings: 30,
                    godClasses: 4,
                },
                weights: {
                    readability: 0.22,
                    design: 0.23,
                    complexity: 0.2,
                    duplication: 0.15,
                    robustness: 0.2,
                },
            },
        };
    }

    static scoreReadability(functionMetrics, profile) {
        const thresholds = profile.thresholds;
        let score = 100;

        score -= CandidateEvaluator.linearPenalty(functionMetrics.avgFunctionLines, thresholds.avgFunctionLines, 25);
        score -= CandidateEvaluator.linearPenalty(functionMetrics.maxFunctionLines, thresholds.maxFunctionLines, 25);
        score -= CandidateEvaluator.linearPenalty(functionMetrics.maxParams, thresholds.maxParams, 15);
        score -= CandidateEvaluator.linearPenalty(functionMetrics.maxNesting, thresholds.maxNesting, 20);

        return CandidateEvaluator.clamp(score, 0, 100);
    }

    static scoreDesign(classIssues, profile) {
        let score = 100;

        score -= classIssues.godClasses.length * 15;
        score -= classIssues.hiddenMembers.length * 5;
        score -= classIssues.nonVirtualDestructors.length * 8;

        return CandidateEvaluator.clamp(score, 0, 100);
    }

    static scoreComplexity(functionMetrics, profile) {
        const thresholds = profile.thresholds;
        let score = 100;

        score -= CandidateEvaluator.linearPenalty(functionMetrics.avgComplexity, thresholds.avgComplexity, 30);
        score -= CandidateEvaluator.linearPenalty(functionMetrics.maxComplexity, thresholds.maxComplexity, 30);
        score -= CandidateEvaluator.linearPenalty(functionMetrics.maxNesting, thresholds.maxNesting, 10);

        return CandidateEvaluator.clamp(score, 0, 100);
    }

    static scoreDuplication(duplicateRatio, profile) {
        const threshold = profile.thresholds.duplicateRatio;
        if (duplicateRatio <= threshold) {
            return 100;
        }

        const normalized = (duplicateRatio - threshold) / Math.max(0.01, 1 - threshold);
        const penalty = CandidateEvaluator.clamp(normalized * 80, 0, 100);
        return CandidateEvaluator.clamp(100 - penalty, 0, 100);
    }

    static scoreRobustness(functionMetrics, safety, profile) {
        const thresholds = profile.thresholds;
        let score = 100;

        score -= CandidateEvaluator.linearPenalty(safety.count, thresholds.safetyFindings, 35);
        score -= CandidateEvaluator.linearPenalty(functionMetrics.maxParams, thresholds.maxParams, 10);

        return CandidateEvaluator.clamp(score, 0, 100);
    }

    static linearPenalty(value, threshold, maxPenalty) {
        if (value <= threshold) {
            return 0;
        }
        const ratio = (value - threshold) / Math.max(1, threshold);
        return CandidateEvaluator.clamp(ratio * maxPenalty, 0, maxPenalty);
    }

    static weightedScore(scores, weights) {
        return scores.readability * weights.readability
            + scores.design * weights.design
            + scores.complexity * weights.complexity
            + scores.duplication * weights.duplication
            + scores.robustness * weights.robustness;
    }

    static countCriticalIssues(functionMetrics, classIssues, safety, profile) {
        let count = 0;
        const critical = profile.critical;

        if (functionMetrics.maxComplexity >= critical.maxComplexity) {
            count += 1;
        }
        if (safety.count >= critical.safetyFindings) {
            count += 1;
        }
        if (classIssues.godClasses.length >= critical.godClasses) {
            count += 1;
        }

        return count;
    }

    static getLowestAxis(scores) {
        const entries = Object.entries(scores);
        entries.sort((a, b) => a[1] - b[1]);
        return entries[0][0];
    }

    static buildComment({ totalScore, pass, lowestAxis, criticalIssues }) {
        if (criticalIssues > 0) {
            return "致命的な指標が見つかりました。基準未達のため改善が必要です。";
        }

        if (pass) {
            return `基準を満たしています。特に${CandidateEvaluator.axisLabel(lowestAxis)}の改善でさらに良くなります。`;
        }

        if (totalScore >= 60) {
            return `全体として惜しい結果です。${CandidateEvaluator.axisLabel(lowestAxis)}の改善が優先です。`;
        }

        return `基準未達です。${CandidateEvaluator.axisLabel(lowestAxis)}の基礎改善が必要です。`;
    }

    static axisLabel(key) {
        const map = {
            readability: "可読性",
            design: "設計",
            complexity: "複雑度",
            duplication: "重複",
            robustness: "堅牢性",
        };
        return map[key] || key;
    }

    static clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    static round(value, digits) {
        const factor = Math.pow(10, digits);
        return Math.round(value * factor) / factor;
    }
}

class CppAnalyzerCore {
    static isHeaderFile(file) {
        const path = (file.path || file.name || "").toLowerCase();
        return /\.(h|hh|hpp|hxx|inl)$/.test(path);
    }

    static evaluateCandidate(files, minLines, profileKey) {
        const stats = CppAnalyzerCore.getStats(files);
        const useLightMode = stats.totalLines > 120000 || stats.totalBytes > 3000000;

        const duplicates = CppAnalyzerCore.findDuplicates(files, minLines);
        const classIssues = useLightMode
            ? {
                nonVirtualDestructors: [],
                hiddenMembers: [],
                longFunctions: [],
                godClasses: [],
            }
            : ClassAnalyzer.analyze(files);
        const functionMetrics = useLightMode
            ? {
                functions: [],
                totalFunctions: 0,
                avgFunctionLines: 0,
                maxFunctionLines: 0,
                avgComplexity: 0,
                maxComplexity: 0,
                maxNesting: 0,
                maxParams: 0,
            }
            : FunctionMetricsAnalyzer.analyze(files);
        const safety = useLightMode
            ? { count: 0, findings: [] }
            : SafetyScanner.scan(files);
        const evaluation = CandidateEvaluator.evaluate(files, {
            duplicates,
            classIssues,
            functionMetrics,
            safety,
        }, profileKey);

        if (useLightMode) {
            evaluation.details.analysisMode = "light";
            evaluation.details.analysisNote = "データ量が多いため軽量モードで評価しました。";
        }

        return {
            duplicates,
            classIssues,
            functionMetrics,
            safety,
            evaluation,
        };
    }

    static analyzeLongFunctions(files, functionLineThreshold = 50) {
        return LongFunctionAnalyzer.analyze(files, functionLineThreshold);
    }

    static analyzeClasses(files) {
        return ClassAnalyzer.analyze(files);
    }

    static findDuplicates(files, minLines) {
        const sourceFiles = files.filter((file) => !CppAnalyzerCore.isHeaderFile(file));
        const totalLines = sourceFiles.reduce((sum, file) => sum + file.content.split("\n").length, 0);
        if (totalLines > 120000) {
            return {
                duplicates: [],
                totalDuplicates: 0,
                totalDuplicateLines: 0,
                skipped: true,
                reason: "データ量が多いため重複検出をスキップしました。",
                scopedTotalLines: totalLines,
            };
        }
        if (sourceFiles.length === 0) {
            return {
                duplicates: [],
                totalDuplicates: 0,
                totalDuplicateLines: 0,
                scopedTotalLines: 0,
            };
        }
        const result = DuplicateFinder.find(sourceFiles, minLines);
        return {
            ...result,
            scopedTotalLines: totalLines,
        };
    }

    static getStats(files) {
        let totalLines = 0;
        let totalBytes = 0;
        files.forEach((file) => {
            totalLines += file.content.split("\n").length;
            totalBytes += file.content.length;
        });
        return { totalLines, totalBytes };
    }
}
