const { useState } = React;

// アイコンコンポーネント（lucide-reactの代替）
const FileText = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
    </svg>
);

const AlertCircle = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
);

const Copy = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
);

const Search = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
    </svg>
);

const AlertTriangle = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
);

function CppAnalyzer() {
    const [files, setFiles] = useState([]);
    const [minLines, setMinLines] = useState(5);
    const [results, setResults] = useState(null);
    const [classIssues, setClassIssues] = useState(null);
    const [analyzing, setAnalyzing] = useState(false);

    const handleFileUpload = async (e) => {
        const uploadedFiles = Array.from(e.target.files);
        const fileData = [];

        for (const file of uploadedFiles) {
            if (file.name.endsWith(".cpp") || file.name.endsWith(".h") || file.name.endsWith(".hpp")) {
                const buffer = await file.arrayBuffer();
                const decoder = new TextDecoder("utf-8", { fatal: false });
                const content = decoder.decode(buffer);
                const path = file.webkitRelativePath || file.name;
                fileData.push({ name: file.name, path, content });
            }
        }

        setFiles(fileData);
        setResults(null);
        setClassIssues(null);
    };

    const normalizeCode = (code) => {
        return code
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\s+/g, " ")
            .trim();
    };

    const getCodeLines = (content) => {
        return content.split("\n").map((line, idx) => {
            const normalized = normalizeCode(line);
            return {
                lineNum: idx + 1,
                original: line,
                normalized,
                isCodeLine: normalized.length > 0,
            };
        });
    };

    const analyzeLongFunctions = () => {
        const longFunctions = [];
        const functionLineThreshold = 50;

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
    };

    const analyzeClasses = () => {
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

        issues.longFunctions = analyzeLongFunctions();
        setClassIssues(issues);
    };

    const findDuplicates = () => {
        setAnalyzing(true);
        setTimeout(() => {
            const duplicates = [];
            const duplicateMap = new Map();

            files.forEach((file, fileIdx) => {
                const lines = getCodeLines(file.content);

                for (let i = 0; i < lines.length; i++) {
                    let codeLineCount = 0;
                    let normalizedCharCount = 0;

                    for (let j = i; j < lines.length; j++) {
                        if (lines[j].isCodeLine) {
                            codeLineCount += 1;
                            normalizedCharCount += lines[j].normalized.length;
                        }

                        if (codeLineCount < minLines) {
                            continue;
                        }

                        if (normalizedCharCount < 20) {
                            continue;
                        }

                        const segment = lines
                            .slice(i, j + 1)
                            .map((l) => (l.isCodeLine ? l.normalized : "<EMPTY>"))
                            .join("\n");

                        const hash = segment;

                        if (!duplicateMap.has(hash)) {
                            duplicateMap.set(hash, []);
                        }

                        duplicateMap.get(hash).push({
                            fileIdx,
                            fileName: file.name,
                            filePath: file.path,
                            startLine: lines[i].lineNum,
                            endLine: lines[j].lineNum,
                            code: lines.slice(i, j + 1).map((l) => l.original).join("\n"),
                            length: codeLineCount,
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

            setResults({
                duplicates: duplicates.slice(0, 50),
                totalDuplicates: duplicates.length,
                totalDuplicateLines,
            });

            analyzeClasses();
            setAnalyzing(false);
        }, 100);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center gap-3 mb-4">
                        <div className="w-10 h-10 text-purple-400"><Copy /></div>
                        <h1 className="text-4xl font-bold text-white">C++ コード品質分析ツール</h1>
                    </div>
                    <p className="text-purple-200">重複コード検出 + クラス設計問題の検出</p>
                </div>

                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6 border border-white/20">
                    <div className="mb-4">
                        <label className="block text-purple-200 mb-2 font-semibold">
                            <span className="inline-flex items-center gap-2">
                                <span className="w-5 h-5"><FileText /></span>
                                C++ファイル/フォルダをアップロード
                            </span>
                        </label>
                        <input
                            type="file"
                            multiple
                            webkitdirectory=""
                            directory=""
                            accept=".cpp,.h,.hpp"
                            onChange={handleFileUpload}
                            className="hidden"
                            id="folderInput"
                        />
                        <input
                            type="file"
                            multiple
                            accept=".cpp,.h,.hpp"
                            onChange={handleFileUpload}
                            className="hidden"
                            id="fileInput"
                        />
                        <div className="flex gap-3">
                            <label
                                htmlFor="folderInput"
                                className="flex-1 p-4 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold text-center cursor-pointer transition-colors border-2 border-purple-400"
                            >
                                📁 フォルダを選択
                            </label>
                            <label
                                htmlFor="fileInput"
                                className="flex-1 p-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-center cursor-pointer transition-colors border-2 border-blue-400"
                            >
                                📄 ファイルを選択
                            </label>
                        </div>
                        <p className="text-purple-300 text-sm mt-2">
                            ※ フォルダを選択すると、内部のすべての.cpp/.h/.hppファイルを自動的に読み込みます
                        </p>
                    </div>

                    <div className="mb-4">
                        <label className="block text-purple-200 mb-2 font-semibold">
                            最小検出行数: {minLines}行
                        </label>
                        <input
                            type="range"
                            min="3"
                            max="20"
                            value={minLines}
                            onChange={(e) => setMinLines(parseInt(e.target.value))}
                            className="w-full"
                        />
                    </div>

                    {files.length > 0 && (
                        <div className="mb-4">
                            <p className="text-purple-200 mb-2">
                                読み込まれたファイル: <span className="font-bold text-white">{files.length}個</span>
                            </p>
                            <div className="max-h-40 overflow-y-auto bg-black/20 rounded-lg p-3">
                                {files.map((f, idx) => (
                                    <div key={idx} className="text-purple-100 text-sm font-mono">
                                        • {f.path || f.name}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <button
                        onClick={findDuplicates}
                        disabled={files.length === 0 || analyzing}
                        className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                        <span className="w-5 h-5"><Search /></span>
                        {analyzing ? "解析中..." : "コード分析を実行"}
                    </button>
                </div>

                {classIssues && (
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6 border border-red-500/30">
                        <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                            <span className="w-6 h-6 text-red-400"><AlertTriangle /></span>
                            クラス設計の問題
                        </h2>

                        <div className="grid grid-cols-3 gap-4 mb-6">
                            <div className="bg-red-600/30 rounded-lg p-4 text-center">
                                <div className="text-3xl font-bold text-white">
                                    {classIssues.nonVirtualDestructors.length}
                                </div>
                                <div className="text-red-200 text-sm">非virtualデストラクタ</div>
                            </div>
                            <div className="bg-orange-600/30 rounded-lg p-4 text-center">
                                <div className="text-3xl font-bold text-white">
                                    {classIssues.hiddenMembers.length}
                                </div>
                                <div className="text-orange-200 text-sm">メンバ隠蔽</div>
                            </div>
                            <div className="bg-yellow-600/30 rounded-lg p-4 text-center">
                                <div className="text-3xl font-bold text-white">
                                    {classIssues.longFunctions.length}
                                </div>
                                <div className="text-yellow-200 text-sm">長すぎる関数</div>
                            </div>
                        </div>

                        {classIssues.nonVirtualDestructors.length > 0 && (
                            <div className="mb-6">
                                <h3 className="text-xl font-bold text-red-300 mb-3">
                                    ⚠️ 基底クラスのデストラクタに virtual が付いていません
                                </h3>
                                <div className="space-y-3">
                                    {classIssues.nonVirtualDestructors.map((issue, idx) => (
                                        <div key={idx} className="bg-red-900/30 rounded-lg p-4 border border-red-500/50">
                                            <div className="font-mono text-yellow-300 mb-2">
                                                📄 {issue.file} (行 {issue.lineNum})
                                            </div>
                                            <div className="text-white">
                                                クラス: <span className="font-bold text-red-300">{issue.className}</span>
                                            </div>
                                            <div className="text-gray-300 text-sm">
                                                継承元: {issue.baseClasses.join(", ")}
                                            </div>
                                            <div className="mt-2 text-orange-200 text-sm">
                                                💡 派生クラスをポリモーフィックに使用する場合、基底クラスのデストラクタは virtual にすべきです
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {classIssues.hiddenMembers.length > 0 && (
                            <div className="mb-6">
                                <h3 className="text-xl font-bold text-orange-300 mb-3">
                                    ⚠️ 基底クラスのメンバが override なしで上書きされています
                                </h3>
                                <div className="space-y-3">
                                    {classIssues.hiddenMembers.map((issue, idx) => (
                                        <div key={idx} className="bg-orange-900/30 rounded-lg p-4 border border-orange-500/50">
                                            <div className="font-mono text-yellow-300 mb-2">
                                                📄 {issue.file} (行 {issue.lineNum})
                                            </div>
                                            <div className="text-white mb-1">
                                                派生クラス: <span className="font-bold text-orange-300">{issue.derivedClass}</span>
                                            </div>
                                            <div className="text-gray-300 text-sm mb-1">
                                                基底クラス: {issue.baseClass}
                                            </div>
                                            <div className="text-white">
                                                隠蔽されている{issue.memberType}: <span className="font-bold text-red-300">{issue.memberName}</span>
                                            </div>
                                            {issue.baseFuncDecl && (
                                                <div className="mt-2 bg-black/30 p-2 rounded text-xs text-green-300 font-mono">
                                                    基底クラスの宣言: {issue.baseFuncDecl}
                                                </div>
                                            )}
                                            <div className="mt-2 text-yellow-200 text-sm">
                                                💡 意図的なオーバーライドの場合は override キーワードを使用してください
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {classIssues.longFunctions.length > 0 && (
                            <div>
                                <h3 className="text-xl font-bold text-yellow-300 mb-3">
                                    ⚠️ 過度に長い関数が検出されました (50行以上)
                                </h3>
                                <div className="space-y-3 max-h-96 overflow-y-auto">
                                    {classIssues.longFunctions.map((func, idx) => (
                                        <div key={idx} className="bg-yellow-900/30 rounded-lg p-4 border border-yellow-500/50">
                                            <div className="font-mono text-yellow-300 mb-2">
                                                📄 {func.file} (行 {func.startLine}-{func.endLine})
                                            </div>
                                            <div className="text-white mb-1">
                                                関数名: <span className="font-bold text-yellow-300">{func.functionName}</span>
                                            </div>
                                            <div className="flex gap-4 text-sm mb-2">
                                                <span className="text-gray-300">
                                                    総行数: <span className="font-bold text-white">{func.totalLines}</span>行
                                                </span>
                                                <span className="text-gray-300">
                                                    実コード行数: <span className="font-bold text-red-300">{func.codeLines}</span>行
                                                </span>
                                            </div>
                                            <div className="mt-2 text-yellow-200 text-sm">
                                                💡 長い関数は理解・保守が困難です。単一責任の原則に従って小さな関数に分割することを検討してください
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {results && (
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
                        <div className="mb-6">
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-purple-600/30 rounded-lg p-4 text-center">
                                    <div className="text-3xl font-bold text-white">{results.totalDuplicates}</div>
                                    <div className="text-purple-200 text-sm">重複パターン</div>
                                </div>
                                <div className="bg-red-600/30 rounded-lg p-4 text-center">
                                    <div className="text-3xl font-bold text-white">{results.totalDuplicateLines}</div>
                                    <div className="text-purple-200 text-sm">重複行数</div>
                                </div>
                                <div className="bg-yellow-600/30 rounded-lg p-4 text-center">
                                    <div className="text-3xl font-bold text-white">
                                        {files.reduce((sum, f) => sum + f.content.split("\n").length, 0)}
                                    </div>
                                    <div className="text-purple-200 text-sm">総行数</div>
                                </div>
                            </div>
                        </div>

                        <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                            <span className="w-6 h-6 text-yellow-400"><AlertCircle /></span>
                            検出された重複コード (上位50件)
                        </h2>

                        <div className="space-y-4 max-h-[600px] overflow-y-auto">
                            {results.duplicates.map((dup, idx) => (
                                <div key={idx} className="bg-black/30 rounded-lg p-4 border border-purple-500/30">
                                    <div className="flex justify-between items-start mb-3">
                                        <span className="text-purple-300 font-semibold">
                                            重複 #{idx + 1} ({dup.locations[0].length}行)
                                        </span>
                                        <span className="bg-red-500/80 text-white px-3 py-1 rounded-full text-sm">
                                            {dup.locations.length}箇所
                                        </span>
                                    </div>

                                    {dup.locations.map((loc, locIdx) => (
                                        <div key={locIdx} className="mb-3 last:mb-0">
                                            <div className="text-yellow-300 text-sm mb-1 font-mono">
                                                📄 {loc.filePath || loc.fileName} (行 {loc.startLine}-{loc.endLine})
                                            </div>
                                            {locIdx === 0 && (
                                                <pre className="bg-slate-900/50 p-3 rounded overflow-x-auto text-xs text-green-300 font-mono max-h-40 overflow-y-auto">
                                                    {loc.code}
                                                </pre>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<CppAnalyzer />);
