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

                let braceCount = 0;
                let functionEndLine = functionStartLine;
                let currentNesting = 0;
                let maxNesting = 0;
                let complexity = 1;
                let inBlockComment = false;
                let started = false;

                for (let i = functionStartLine - 1; i < lines.length; i++) {
                    const line = lines[i];
                    const sanitizeResult = FunctionMetricsAnalyzer.stripCommentsAndStrings(line, inBlockComment);
                    const sanitizedLine = sanitizeResult.line;
                    inBlockComment = sanitizeResult.inBlockComment;

                    complexity += FunctionMetricsAnalyzer.countComplexityTokens(sanitizedLine);

                    for (const char of sanitizedLine) {
                        if (char === "{") {
                            braceCount++;
                            started = true;
                            currentNesting = Math.max(0, braceCount - 1);
                            maxNesting = Math.max(maxNesting, currentNesting);
                        } else if (char === "}") {
                            braceCount--;
                            currentNesting = Math.max(0, braceCount - 1);
                        }
                    }

                    if (started && braceCount === 0) {
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

class SimilarityFinder {
    static find(files, minLines) {
        const settings = {
            kgram: 5,
            window: 4,
            similarityThreshold: 0.75,
            minFingerprints: 8,
            maxBucketSize: 50,
            maxFunctions: 1500,
        };

        const functions = SimilarityFinder.extractFunctions(files, minLines, settings.maxFunctions);
        if (functions.skipped) {
            return {
                duplicates: [],
                totalDuplicates: 0,
                totalDuplicateLines: 0,
                skipped: true,
                reason: functions.reason,
            };
        }

        functions.items.forEach((fn) => {
            const tokens = SimilarityFinder.tokenize(fn.content);
            const fingerprints = SimilarityFinder.winnow(tokens, settings.kgram, settings.window);
            fn.fingerprints = fingerprints.set;
            fn.fingerprintCount = fingerprints.count;
        });

        const pairs = SimilarityFinder.computeSimilarPairs(functions.items, settings);
        const results = pairs.map((pair) => {
            const left = functions.items[pair.left];
            const right = functions.items[pair.right];
            return {
                similarity: pair.similarity,
                locations: [
                    {
                        fileName: left.file,
                        filePath: left.file,
                        startLine: left.startLine,
                        endLine: left.endLine,
                        functionName: left.name,
                        length: left.totalLines,
                    },
                    {
                        fileName: right.file,
                        filePath: right.file,
                        startLine: right.startLine,
                        endLine: right.endLine,
                        functionName: right.name,
                        length: right.totalLines,
                    },
                ],
            };
        });

        const totalDuplicateLines = results.reduce((sum, item) => {
            const lenA = item.locations[0]?.length || 0;
            const lenB = item.locations[1]?.length || 0;
            return sum + Math.min(lenA, lenB);
        }, 0);

        return {
            duplicates: results.slice(0, 50),
            totalDuplicates: results.length,
            totalDuplicateLines,
        };
    }

    static extractFunctions(files, minLines, maxFunctions) {
        const items = [];
        let total = 0;

        for (const file of files) {
            const content = file.content;
            const lines = content.split("\n");
            const matches = FunctionMetricsAnalyzer.findFunctionHeaders(content);

            for (const match of matches) {
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

                const totalLines = functionEndLine - functionStartLine + 1;
                if (totalLines < minLines) {
                    continue;
                }

                items.push({
                    file: file.path || file.name,
                    name: match.functionName,
                    startLine: functionStartLine,
                    endLine: functionEndLine,
                    totalLines,
                    content: lines.slice(functionStartLine - 1, functionEndLine).join("\n"),
                });

                total += 1;
                if (total >= maxFunctions) {
                    return {
                        skipped: true,
                        reason: "関数数が多いため類似度解析をスキップしました。",
                        items: [],
                    };
                }
            }
        }

        return { items };
    }

    static tokenize(content) {
        const keywords = new Set([
            "if",
            "for",
            "while",
            "switch",
            "case",
            "break",
            "continue",
            "return",
            "try",
            "catch",
            "throw",
            "class",
            "struct",
            "public",
            "private",
            "protected",
            "virtual",
            "override",
            "final",
            "const",
            "static",
            "inline",
            "constexpr",
            "typename",
            "template",
            "using",
            "namespace",
            "new",
            "delete",
            "sizeof",
            "operator",
            "enum",
            "typedef",
            "auto",
            "bool",
            "char",
            "int",
            "long",
            "short",
            "float",
            "double",
            "void",
            "unsigned",
            "signed",
        ]);

        const lines = content.split("\n");
        let inBlockComment = false;
        const sanitized = [];

        lines.forEach((line) => {
            const result = FunctionMetricsAnalyzer.stripCommentsAndStrings(line, inBlockComment);
            inBlockComment = result.inBlockComment;
            sanitized.push(result.line);
        });

        const tokenRegex = /[A-Za-z_]\w*|\d+|==|!=|<=|>=|&&|\|\||->|::|[{}()[\];,<>+\-*/%&|^!~?:.=]/g;
        const tokens = [];
        const text = sanitized.join("\n");
        const matches = text.match(tokenRegex) || [];

        matches.forEach((token) => {
            if (/^\d+$/.test(token)) {
                tokens.push("NUM");
                return;
            }
            if (/^[A-Za-z_]\w*$/.test(token)) {
                tokens.push(keywords.has(token) ? token : "ID");
                return;
            }
            tokens.push(token);
        });

        return tokens;
    }

    static winnow(tokens, kgram, window) {
        if (tokens.length < kgram) {
            return { set: new Set(), count: 0 };
        }

        const hashes = [];
        for (let i = 0; i <= tokens.length - kgram; i++) {
            const gram = tokens.slice(i, i + kgram).join(" ");
            hashes.push({ hash: SimilarityFinder.hashString(gram), pos: i });
        }

        if (hashes.length === 0) {
            return { set: new Set(), count: 0 };
        }

        const selected = new Map();
        let lastPos = -1;
        const w = Math.max(1, window);

        for (let i = 0; i <= hashes.length - w; i++) {
            let min = hashes[i];
            for (let j = 1; j < w; j++) {
                const candidate = hashes[i + j];
                if (candidate.hash < min.hash || (candidate.hash === min.hash && candidate.pos > min.pos)) {
                    min = candidate;
                }
            }
            if (min.pos !== lastPos) {
                selected.set(min.hash, min.pos);
                lastPos = min.pos;
            }
        }

        return { set: new Set(selected.keys()), count: selected.size };
    }

    static hashString(text) {
        let hash = 5381;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) + hash) + text.charCodeAt(i);
            hash &= 0xffffffff;
        }
        return hash >>> 0;
    }

    static computeSimilarPairs(functions, settings) {
        const index = new Map();
        const sizes = functions.map((fn) => fn.fingerprintCount || 0);

        functions.forEach((fn, idx) => {
            if (sizes[idx] < settings.minFingerprints) {
                return;
            }
            fn.fingerprints.forEach((hash) => {
                if (!index.has(hash)) {
                    index.set(hash, []);
                }
                index.get(hash).push(idx);
            });
        });

        const pairCounts = new Map();
        index.forEach((list) => {
            if (list.length > settings.maxBucketSize) {
                return;
            }
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    const a = list[i];
                    const b = list[j];
                    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
                    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
                }
            }
        });

        const results = [];
        pairCounts.forEach((shared, key) => {
            const parts = key.split("|");
            const left = Number(parts[0]);
            const right = Number(parts[1]);
            const sizeA = sizes[left];
            const sizeB = sizes[right];
            if (sizeA < settings.minFingerprints || sizeB < settings.minFingerprints) {
                return;
            }
            const union = sizeA + sizeB - shared;
            if (union <= 0) {
                return;
            }
            const similarity = shared / union;
            if (similarity >= settings.similarityThreshold) {
                results.push({ left, right, similarity });
            }
        });

        results.sort((a, b) => b.similarity - a.similarity);
        return results;
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

class ErrorHandlingScanner {
    static stripComments(text) {
        return text
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/.*$/gm, "");
    }

    static scan(files) {
        const findings = [];

        files.forEach((file) => {
            const content = file.content;
            const catchRegex = /\bcatch\s*\([^)]*\)\s*\{([\s\S]*?)\}/g;
            let match;

            while ((match = catchRegex.exec(content)) !== null) {
                const body = ErrorHandlingScanner.stripComments(match[1]).trim();
                if (body.length === 0) {
                    const lineNum = content.substring(0, match.index).split("\n").length;
                    findings.push({
                        file: file.path || file.name,
                        lineNum,
                        label: "空のcatchブロック",
                    });
                }
            }
        });

        return {
            count: findings.length,
            findings,
        };
    }
}

class ParameterPassingAnalyzer {
    static splitParams(params) {
        const parts = [];
        let current = "";
        let depthAngle = 0;
        let depthParen = 0;
        let depthBracket = 0;
        let depthBrace = 0;
        let inString = false;
        let stringChar = "";

        for (let i = 0; i < params.length; i++) {
            const char = params[i];
            if (inString) {
                current += char;
                if (char === stringChar && params[i - 1] !== "\\") {
                    inString = false;
                }
                continue;
            }

            if (char === "\"" || char === "'") {
                inString = true;
                stringChar = char;
                current += char;
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
                parts.push(current.trim());
                current = "";
                continue;
            }

            current += char;
        }

        if (current.trim().length > 0) {
            parts.push(current.trim());
        }

        return parts;
    }

    static stripDefaultValue(param) {
        let depthAngle = 0;
        let depthParen = 0;
        let depthBracket = 0;
        let depthBrace = 0;
        let inString = false;
        let stringChar = "";

        for (let i = 0; i < param.length; i++) {
            const char = param[i];
            if (inString) {
                if (char === stringChar && param[i - 1] !== "\\") {
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

            if (char === "=" && depthAngle === 0 && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
                return param.slice(0, i).trim();
            }
        }

        return param.trim();
    }

    static removeAttributes(text) {
        return text.replace(/\[\[[^\]]*\]\]\s*/g, "");
    }

    static hasTopLevelRefOrPtr(text) {
        let depthAngle = 0;
        let depthParen = 0;
        let depthBracket = 0;
        let depthBrace = 0;
        let inString = false;
        let stringChar = "";

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (inString) {
                if (char === stringChar && text[i - 1] !== "\\") {
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

            if (depthAngle === 0 && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
                if (char === "&" || char === "*") {
                    return true;
                }
            }
        }

        return false;
    }

    static extractParamName(param) {
        const trimmed = param.trim();
        const match = trimmed.match(/[\s\*&]([_A-Za-z]\w*)\s*$/);
        return match ? match[1] : "";
    }

    static extractType(param) {
        let text = ParameterPassingAnalyzer.stripDefaultValue(param);
        text = ParameterPassingAnalyzer.removeAttributes(text);
        const nameMatch = text.match(/(.*?)[\s\*&]([_A-Za-z]\w*)\s*$/);
        if (nameMatch && nameMatch[1].trim().length > 0) {
            return nameMatch[1].trim();
        }
        return text.trim();
    }

    static normalizeType(type) {
        return type
            .replace(/\b(const|volatile|mutable|static|constexpr|inline|typename|class|struct|enum)\b/g, " ")
            .replace(/[*&]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    static isPrimitiveType(type) {
        const normalized = ParameterPassingAnalyzer.normalizeType(type).toLowerCase();
        if (!normalized) {
            return false;
        }

        const primitives = new Set([
            "void",
            "bool",
            "char",
            "wchar_t",
            "char16_t",
            "char32_t",
            "short",
            "int",
            "long",
            "long long",
            "float",
            "double",
            "signed",
            "unsigned",
            "size_t",
            "ssize_t",
            "ptrdiff_t",
            "intptr_t",
            "uintptr_t",
            "int8_t",
            "uint8_t",
            "int16_t",
            "uint16_t",
            "int32_t",
            "uint32_t",
            "int64_t",
            "uint64_t",
        ]);

        if (primitives.has(normalized)) {
            return true;
        }

        const stdTypedef = /(.*::)?(u?int(8|16|32|64)_t|size_t|ptrdiff_t|intptr_t|uintptr_t)$/;
        return stdTypedef.test(normalized);
    }

    static isClassLikeType(type) {
        if (!type) {
            return false;
        }
        if (ParameterPassingAnalyzer.isPrimitiveType(type)) {
            return false;
        }

        const raw = type.trim();
        if (/\b(class|struct)\b/.test(raw)) {
            return true;
        }
        if (raw.includes("::")) {
            return true;
        }
        if (raw.includes("<") && raw.includes(">")) {
            return true;
        }
        if (/\b[A-Z]\w*/.test(raw)) {
            return true;
        }
        return false;
    }

    static scan(files) {
        const findings = [];

        files.forEach((file) => {
            const content = file.content;
            const matches = FunctionMetricsAnalyzer.findFunctionHeaders(content);

            matches.forEach((match) => {
                const signatureInfo = FunctionMetricsAnalyzer.extractSignature(content, match.functionStartIndex);
                if (signatureInfo.endParen < 0) {
                    return;
                }

                const startParen = content.indexOf("(", match.functionStartIndex);
                if (startParen < 0) {
                    return;
                }

                const params = content.slice(startParen + 1, signatureInfo.endParen);
                if (!params.trim()) {
                    return;
                }

                const functionStartLine = content.substring(0, match.functionStartIndex).split("\n").length;
                const paramList = ParameterPassingAnalyzer.splitParams(params);

                paramList.forEach((param) => {
                    const cleaned = ParameterPassingAnalyzer.stripDefaultValue(param);
                    if (!cleaned || cleaned === "void" || cleaned === "...") {
                        return;
                    }
                    if (ParameterPassingAnalyzer.hasTopLevelRefOrPtr(cleaned)) {
                        return;
                    }

                    const typePart = ParameterPassingAnalyzer.extractType(cleaned);
                    if (!ParameterPassingAnalyzer.isClassLikeType(typePart)) {
                        return;
                    }

                    const name = ParameterPassingAnalyzer.extractParamName(cleaned);
                    findings.push({
                        file: file.path || file.name,
                        lineNum: functionStartLine,
                        functionName: match.functionName,
                        paramName: name,
                        typeName: typePart,
                        label: "クラス/構造体が値渡し",
                    });
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
        const errorHandling = analysis.errorHandling;
        const paramPassing = analysis.paramPassing;

        const readabilityScore = CandidateEvaluator.scoreReadability(functionMetrics, profile);
        const designScore = CandidateEvaluator.scoreDesign(classIssues, profile);
        const complexityScore = CandidateEvaluator.scoreComplexity(functionMetrics, profile);
        const duplicationScore = CandidateEvaluator.scoreDuplication(duplicateRatio, profile);
        const robustnessScore = CandidateEvaluator.scoreRobustness(
            functionMetrics,
            safety,
            errorHandling,
            paramPassing,
            profile
        );

        const totalScore = CandidateEvaluator.weightedScore({
            readability: readabilityScore,
            design: designScore,
            complexity: complexityScore,
            duplication: duplicationScore,
            robustness: robustnessScore,
        }, profile.weights);

        const criticalIssues = CandidateEvaluator.countCriticalIssues(
            functionMetrics,
            classIssues,
            safety,
            errorHandling,
            paramPassing,
            profile
        );
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
                emptyCatch: errorHandling.count,
                nonRefClassParams: paramPassing.count,
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
                    emptyCatch: 2,
                    nonRefClassParams: 4,
                },
                critical: {
                    maxComplexity: 30,
                    safetyFindings: 10,
                    godClasses: 2,
                    emptyCatch: 8,
                    nonRefClassParams: 20,
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
                    emptyCatch: 3,
                    nonRefClassParams: 6,
                },
                critical: {
                    maxComplexity: 40,
                    safetyFindings: 20,
                    godClasses: 3,
                    emptyCatch: 10,
                    nonRefClassParams: 25,
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
                    emptyCatch: 5,
                    nonRefClassParams: 8,
                },
                critical: {
                    maxComplexity: 50,
                    safetyFindings: 30,
                    godClasses: 4,
                    emptyCatch: 12,
                    nonRefClassParams: 30,
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

    static scoreRobustness(functionMetrics, safety, errorHandling, paramPassing, profile) {
        const thresholds = profile.thresholds;
        let score = 100;

        score -= CandidateEvaluator.linearPenalty(safety.count, thresholds.safetyFindings, 35);
        score -= CandidateEvaluator.linearPenalty(errorHandling.count, thresholds.emptyCatch, 15);
        score -= CandidateEvaluator.linearPenalty(paramPassing.count, thresholds.nonRefClassParams, 15);
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

    static countCriticalIssues(functionMetrics, classIssues, safety, errorHandling, paramPassing, profile) {
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
        if (errorHandling.count >= critical.emptyCatch) {
            count += 1;
        }
        if (paramPassing.count >= critical.nonRefClassParams) {
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
        const errorHandling = useLightMode
            ? { count: 0, findings: [] }
            : ErrorHandlingScanner.scan(files);
        const paramPassing = useLightMode
            ? { count: 0, findings: [] }
            : ParameterPassingAnalyzer.scan(files);
        const evaluation = CandidateEvaluator.evaluate(files, {
            duplicates,
            classIssues,
            functionMetrics,
            safety,
            errorHandling,
            paramPassing,
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
            errorHandling,
            paramPassing,
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
                reason: "データ量が多いため類似度解析をスキップしました。",
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
        const result = SimilarityFinder.find(sourceFiles, minLines);
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
