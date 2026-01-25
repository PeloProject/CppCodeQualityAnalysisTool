class CppAnalyzerCore {
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
                normalized: CppAnalyzerCore.normalizeCode(line),
            }))
            .filter((line) => line.normalized.length > 0);
    }

    static analyzeLongFunctions(files, functionLineThreshold = 50) {
        const longFunctions = [];

        files.forEach((file) => {
            const content = file.content;
            const lines = content.split("\n");

            const functionRegex = /^[\s]*(?:(?:inline|static|virtual|explicit|friend|constexpr)\s+)*(?:[\w:]+(?:<[^>]*>)?(?:\s*[&*])*)\s+([\w:]+)\s*\([^)]*\)(?:\s*const)?(?:\s*noexcept)?(?:\s*override)?(?:\s*final)?[\s]*(?:->[\w\s:<>*&]+)?[\s]*\{/gm;

            let match;
            while ((match = functionRegex.exec(content)) !== null) {
                const functionName = match[1];
                const functionStartIndex = match.index;
                const functionStartLine = content.substring(0, functionStartIndex).split("\n").length;

                let braceCount = 1;
                let functionEndLine = functionStartLine;

                for (let i = functionStartLine; i < lines.length; i++) {
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
            }
        });

        longFunctions.sort((a, b) => b.codeLines - a.codeLines);
        return longFunctions;
    }

    static analyzeClasses(files) {
        const issues = {
            nonVirtualDestructors: [],
            hiddenMembers: [],
            longFunctions: [],
        };

        const classMap = new Map();

        files.forEach((file) => {
            const content = file.content;
            const lines = content.split("\n");

            const classRegex = /class\s+(\w+)(?:\s*:\s*(?:public|protected|private)?\s*(\w+(?:\s*,\s*(?:public|protected|private)?\s*\w+)*))?/g;
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
                const destructorMatch = classContent.match(destructorRegex);
                if (destructorMatch) {
                    members.hasVirtualDestructor = destructorMatch[1] !== undefined;
                }

                const functionRegex = /(?:virtual\s+)?(?:static\s+)?(?:\w+(?:<[^>]+>)?(?:\s*\*|\s*&)?)\s+(\w+)\s*\([^)]*\)(?:\s*const)?(?:\s*override)?(?:\s*final)?/g;
                let funcMatch;
                while ((funcMatch = functionRegex.exec(classContent)) !== null) {
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
                while ((varMatch = varRegex.exec(classContent)) !== null) {
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
                });
            }
        });

        classMap.forEach((classInfo, className) => {
            if (classInfo.baseClasses.length > 0 && !classInfo.members.hasVirtualDestructor) {
                const hasDestructor = classInfo.content.includes(`~${className}`);
                if (hasDestructor || classInfo.content.includes("virtual")) {
                    issues.nonVirtualDestructors.push({
                        className,
                        file: classInfo.file,
                        lineNum: classInfo.lineNum,
                        baseClasses: classInfo.baseClasses,
                    });
                }
            }

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

        issues.longFunctions = CppAnalyzerCore.analyzeLongFunctions(files);
        return issues;
    }

    static findDuplicates(files, minLines) {
        const duplicates = [];
        const duplicateMap = new Map();

        files.forEach((file, fileIdx) => {
            const lines = CppAnalyzerCore.getCodeLines(file.content);

            for (let i = 0; i < lines.length; i++) {
                for (let length = minLines; i + length <= lines.length; length++) {
                    const segment = lines
                        .slice(i, i + length)
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
                        endLine: lines[i + length - 1].lineNum,
                        code: lines.slice(i, i + length).map((l) => l.original).join("\n"),
                        length,
                    });
                }
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

        const totalDuplicateLines = duplicates.reduce((sum, dup) => {
            return sum + (dup.locations.length - 1) * dup.locations[0].length;
        }, 0);

        return {
            duplicates: duplicates.slice(0, 50),
            totalDuplicates: duplicates.length,
            totalDuplicateLines,
        };
    }
}
