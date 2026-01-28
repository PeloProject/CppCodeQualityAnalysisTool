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
    const [evaluation, setEvaluation] = useState(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [profile, setProfile] = useState("standard");
    const [editor, setEditor] = useState("notepad");
    const [sourceRoot, setSourceRoot] = useState("");
    const [uploadWarning, setUploadWarning] = useState("");
    const [memoryInfo, setMemoryInfo] = useState(null);

    React.useEffect(() => {
        const intervalId = setInterval(() => {
            if (performance && performance.memory) {
                setMemoryInfo({
                    used: performance.memory.usedJSHeapSize,
                    total: performance.memory.totalJSHeapSize,
                    limit: performance.memory.jsHeapSizeLimit,
                });
            } else {
                setMemoryInfo(null);
            }
        }, 1000);

        return () => clearInterval(intervalId);
    }, []);

    const handleFileUpload = async (e) => {
        const uploadedFiles = Array.from(e.target.files);
        const fileData = [];
        const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
        const MAX_TOTAL_LINES = 10000;
        const MAX_FILE_BYTES = 5 * 1024 * 1024;
        let totalBytes = 0;
        let totalLines = 0;
        let warning = "";

        for (const file of uploadedFiles) {
            if (file.name.endsWith(".cpp") || file.name.endsWith(".h") || file.name.endsWith(".hpp")) {
                const buffer = await file.arrayBuffer();
                if (buffer.byteLength > MAX_FILE_BYTES) {
                    warning = "ファイルサイズが大きすぎるため一部を読み込みませんでした。";
                    continue;
                }
                if (totalBytes + buffer.byteLength > MAX_TOTAL_BYTES) {
                    warning = "合計サイズが大きすぎるため一部を読み込みませんでした。";
                    break;
                }
                const decoder = new TextDecoder("utf-8", { fatal: false });
                const content = decoder.decode(buffer);
                const lineCount = content.split("\n").length;
                if (totalLines + lineCount > MAX_TOTAL_LINES) {
                    warning = "合計行数が大きすぎるため一部を読み込みませんでした。";
                    break;
                }
                const path = file.webkitRelativePath || file.name;
                fileData.push({ name: file.name, path, content });
                totalBytes += buffer.byteLength;
                totalLines += lineCount;
            }
        }

        setFiles(fileData);
        setResults(null);
        setClassIssues(null);
        setEvaluation(null);
        setUploadWarning(warning);
    };

    const findDuplicates = () => {
        setAnalyzing(true);
        setTimeout(() => {
            const analysis = CppAnalyzerCore.evaluateCandidate(files, minLines, profile);

            setResults(analysis.duplicates);
            setClassIssues(analysis.classIssues);
            setEvaluation(analysis.evaluation);
            setAnalyzing(false);
        }, 100);
    };

    const profiles = [
        { key: "strict", label: "厳格" },
        { key: "standard", label: "標準" },
        { key: "lenient", label: "緩め" },
    ];

    const editors = [
        { key: "notepad", label: "メモ帳" },
        { key: "vscode", label: "VS Code" },
        { key: "sakura", label: "サクラエディタ" },
        { key: "hidemaru", label: "秀丸" },
    ];

    const resolveFilePath = (path) => {
        if (!path) {
            return null;
        }

        const isAbsolute = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
        if (isAbsolute) {
            return path;
        }

        if (!sourceRoot.trim()) {
            return null;
        }

        const root = sourceRoot.trim().replace(/[\\/]+$/, "");
        return `${root}/${path}`;
    };

    const openFileInEditor = async (path, line) => {
        const resolved = resolveFilePath(path);
        if (!resolved) {
            alert("ソースルートのパスを入力してください。");
            return;
        }

        const params = new URLSearchParams({
            file: resolved,
            line: String(line || 1),
            editor,
        });

        try {
            const response = await fetch(`/open?${params.toString()}`);
            if (!response.ok) {
                const text = await response.text();
                alert(`エディタ起動に失敗しました: ${text}`);
            }
        } catch (err) {
            alert(`エディタ起動に失敗しました: ${err}`);
        }
    };

    const getCodeSnippet = (loc) => {
        const targetPath = loc.filePath || loc.fileName;
        const file = targetPath
            ? files.find((candidate) => (candidate.path || candidate.name) === targetPath)
            : files[loc.fileIdx];
        if (!file || !file.content) {
            return "";
        }
        const lines = file.content.split("\n");
        return lines.slice(loc.startLine - 1, loc.endLine).join("\n");
    };

    const RadarChart = ({ scores }) => {
        const labels = Object.keys(scores);
        const values = labels.map((label) => scores[label]);
        const size = 220;
        const center = size / 2;
        const radius = 70;
        const angleStep = (Math.PI * 2) / labels.length;

        const points = values.map((value, index) => {
            const angle = -Math.PI / 2 + angleStep * index;
            const r = (value / 100) * radius;
            const x = center + r * Math.cos(angle);
            const y = center + r * Math.sin(angle);
            return `${x},${y}`;
        }).join(" ");

        return (
            <svg width={size} height={size} className="mx-auto">
                {labels.map((_, index) => {
                    const angle = -Math.PI / 2 + angleStep * index;
                    const x = center + radius * Math.cos(angle);
                    const y = center + radius * Math.sin(angle);
                    return (
                        <line
                            key={`axis-${index}`}
                            x1={center}
                            y1={center}
                            x2={x}
                            y2={y}
                            stroke="rgba(255,255,255,0.25)"
                            strokeWidth="1"
                        />
                    );
                })}
                <polygon
                    points={points}
                    fill="rgba(168,85,247,0.25)"
                    stroke="rgba(168,85,247,0.8)"
                    strokeWidth="2"
                />
                {labels.map((label, index) => {
                    const angle = -Math.PI / 2 + angleStep * index;
                    const x = center + (radius + 20) * Math.cos(angle);
                    const y = center + (radius + 20) * Math.sin(angle);
                    return (
                        <text
                            key={`label-${label}`}
                            x={x}
                            y={y}
                            fill="white"
                            fontSize="12"
                            textAnchor="middle"
                            dominantBaseline="middle"
                        >
                            {label}
                        </text>
                    );
                })}
            </svg>
        );
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
                        {uploadWarning && (
                            <div className="mt-3 text-yellow-200 text-sm">
                                {uploadWarning}
                            </div>
                        )}
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
                    <div className="mb-4">
                        <label className="block text-purple-200 mb-2 font-semibold">
                            評価基準
                        </label>
                        <select
                            value={profile}
                            onChange={(e) => setProfile(e.target.value)}
                            className="w-full rounded-md bg-white/10 text-white border border-white/20 px-3 py-2"
                        >
                            {profiles.map((p) => (
                                <option key={p.key} value={p.key} className="text-slate-900">
                                    {p.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="mb-4">
                        <label className="block text-purple-200 mb-2 font-semibold">
                            起動エディタ
                        </label>
                        <select
                            value={editor}
                            onChange={(e) => setEditor(e.target.value)}
                            className="w-full rounded-md bg-white/10 text-white border border-white/20 px-3 py-2"
                        >
                            {editors.map((item) => (
                                <option key={item.key} value={item.key} className="text-slate-900">
                                    {item.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="mb-4">
                        <label className="block text-purple-200 mb-2 font-semibold">
                            ソースルート（実ファイルのパス）
                        </label>
                        <input
                            type="text"
                            value={sourceRoot}
                            onChange={(e) => setSourceRoot(e.target.value)}
                            placeholder="例: C:\\Users\\shinji\\Documents\\Projects"
                            className="w-full rounded-md bg-white/10 text-white border border-white/20 px-3 py-2"
                        />
                        <p className="text-purple-300 text-xs mt-2">
                            ※ アップロードしたファイルの相対パスに対して、このルートを結合します
                        </p>
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
                    {memoryInfo && (
                        <div className="mt-3 text-xs text-purple-200">
                            JS Heap: {Math.round(memoryInfo.used / (1024 * 1024))}MB /
                            {Math.round(memoryInfo.total / (1024 * 1024))}MB (limit {Math.round(memoryInfo.limit / (1024 * 1024))}MB)
                        </div>
                    )}
                </div>

                {evaluation && (
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6 border border-white/20">
                        {evaluation.details.analysisMode === "light" && (
                            <div className="bg-yellow-900/30 border border-yellow-500/50 text-yellow-200 rounded-lg p-4 mb-4">
                                {evaluation.details.analysisNote}
                            </div>
                        )}
                        <div className="flex flex-col lg:flex-row gap-6">
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-3">
                                    <span className={`px-3 py-1 rounded-full text-sm font-bold ${evaluation.pass ? "bg-emerald-500/80" : "bg-red-500/80"} text-white`}>
                                        {evaluation.pass ? "合格" : "不合格"}
                                    </span>
                                    <div className="text-3xl font-bold text-white">
                                        {evaluation.totalScore}
                                    </div>
                                    <div className="text-purple-200 text-sm">
                                        / 100
                                    </div>
                                </div>
                                <div className="text-purple-200 mb-4">
                                    コメント: <span className="text-white">{evaluation.comment}</span>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                    <div className="bg-black/30 rounded-lg p-3">
                                        <div className="text-purple-200">総行数</div>
                                        <div className="text-white font-bold">{evaluation.details.totalLines}</div>
                                    </div>
                                    <div className="bg-black/30 rounded-lg p-3">
                                        <div className="text-purple-200">関数数</div>
                                        <div className="text-white font-bold">{evaluation.details.totalFunctions}</div>
                                    </div>
                                    <div className="bg-black/30 rounded-lg p-3">
                                        <div className="text-purple-200">平均関数行数</div>
                                        <div className="text-white font-bold">{evaluation.details.avgFunctionLines}</div>
                                    </div>
                                    <div className="bg-black/30 rounded-lg p-3">
                                        <div className="text-purple-200">最大複雑度</div>
                                        <div className="text-white font-bold">{evaluation.details.maxComplexity}</div>
                                    </div>
                                    <div className="bg-black/30 rounded-lg p-3">
                                        <div className="text-purple-200">最大ネスト</div>
                                        <div className="text-white font-bold">{evaluation.details.maxNesting}</div>
                                    </div>
                                    <div className="bg-black/30 rounded-lg p-3">
                                        <div className="text-purple-200">重複率</div>
                                        <div className="text-white font-bold">{evaluation.details.duplicateRatio}%</div>
                                    </div>
                                    <div className="bg-black/30 rounded-lg p-3">
                                        <div className="text-purple-200">神クラス疑い</div>
                                        <div className="text-white font-bold">{evaluation.details.godClasses}</div>
                                    </div>
                                    <div className="bg-black/30 rounded-lg p-3">
                                        <div className="text-purple-200">安全性指摘</div>
                                        <div className="text-white font-bold">{evaluation.details.safetyFindings}</div>
                                    </div>
                                </div>
                            </div>
                            <div className="lg:w-72">
                                <RadarChart scores={evaluation.radar} />
                            </div>
                        </div>
                    </div>
                )}

                {classIssues && (
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6 border border-red-500/30">
                        <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                            <span className="w-6 h-6 text-red-400"><AlertTriangle /></span>
                            クラス設計の問題
                        </h2>

                        <div className="grid grid-cols-4 gap-4 mb-6">
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
                            <div className="bg-purple-600/30 rounded-lg p-4 text-center">
                                <div className="text-3xl font-bold text-white">
                                    {classIssues.godClasses.length}
                                </div>
                                <div className="text-purple-200 text-sm">神クラス疑い</div>
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
                                                        <button
                                                            type="button"
                                                            onClick={() => openFileInEditor(issue.file, issue.lineNum)}
                                                            className="text-yellow-300 underline"
                                                        >
                                                            📄 {issue.file} (行 {issue.lineNum})
                                                        </button>
                                                    </div>
                                            <div className="text-white">
                                                クラス: <span className="font-bold text-red-300">{issue.className}</span>
                                            </div>
                                            <div className="text-gray-300 text-sm">
                                                派生クラス: {issue.baseClasses.join(", ")}
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
                                                <button
                                                    type="button"
                                                    onClick={() => openFileInEditor(issue.file, issue.lineNum)}
                                                    className="text-yellow-300 underline"
                                                >
                                                    📄 {issue.file} (行 {issue.lineNum})
                                                </button>
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
                                                <button
                                                    type="button"
                                                    onClick={() => openFileInEditor(func.file, func.startLine)}
                                                    className="text-yellow-300 underline"
                                                >
                                                    📄 {func.file} (行 {func.startLine}-{func.endLine})
                                                </button>
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

                        {classIssues.godClasses.length > 0 && (
                            <div className="mt-6">
                                <h3 className="text-xl font-bold text-purple-300 mb-3">
                                    ⚠️ 神クラスの疑いがあるクラス
                                </h3>
                                <div className="space-y-3">
                                    {classIssues.godClasses.map((issue, idx) => (
                                        <div key={idx} className="bg-purple-900/30 rounded-lg p-4 border border-purple-500/50">
                                            <div className="font-mono text-purple-200 mb-2">
                                                <button
                                                    type="button"
                                                    onClick={() => openFileInEditor(issue.file, issue.lineNum)}
                                                    className="text-purple-200 underline"
                                                >
                                                    📄 {issue.file} (行 {issue.lineNum}-{issue.endLine})
                                                </button>
                                            </div>
                                            <div className="text-white mb-1">
                                                クラス: <span className="font-bold text-purple-300">{issue.className}</span>
                                            </div>
                                            <div className="text-gray-300 text-sm mb-2">
                                                関数 {issue.functionCount} / 変数 {issue.variableCount} / 総メンバ {issue.totalMembers} / 行数 {issue.totalLines}
                                            </div>
                                            <div className="text-purple-200 text-sm">
                                                理由: {issue.reasons.join("、")}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                        {results && results.skipped && (
                            <div className="bg-yellow-900/30 border border-yellow-500/50 text-yellow-200 rounded-lg p-4 mb-4">
                                {results.reason}
                            </div>
                        )}

                        {results && !results.skipped && (
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
                                                        <button
                                                            type="button"
                                                    onClick={() => openFileInEditor(loc.filePath || loc.fileName, loc.startLine)}
                                                    className="text-yellow-300 underline"
                                                >
                                                    📄 {loc.filePath || loc.fileName} (行 {loc.startLine}-{loc.endLine})
                                                </button>
                                            </div>
                                                    {locIdx === 0 && (
                                                        <pre className="bg-slate-900/50 p-3 rounded overflow-x-auto text-xs text-green-300 font-mono max-h-40 overflow-y-auto">
                                                            {getCodeSnippet(loc)}
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
