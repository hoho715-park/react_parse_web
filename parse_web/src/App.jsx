import { useState, useCallback } from 'react';
import JSZip from 'jszip';
import * as parser from '@babel/parser';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts';

const analyzeCode = (code, filename) => {
  const startTime = performance.now();
  
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties'],
      errorRecovery: true,
    });

    const analysis = {
      filename,
      functions: [],
      variables: [],
      eventHandlers: [],
      components: [],
      hooks: [],
      imports: [],
      exports: [],
      complexity: { depth: 0, branches: 0, loops: 0 },
      issues: [],
      loc: code.split('\n').length,
      metrics: {
        cyclomaticComplexity: 1,
        cbo: 0,
        wmc: 0,
        maintainabilityIndex: 100,
      }
    };

    const traverse = (node, depth = 0) => {
      if (!node || typeof node !== 'object') return;
      
      analysis.complexity.depth = Math.max(analysis.complexity.depth, depth);

      if (node.type === 'FunctionDeclaration' && node.id?.name) {
        analysis.functions.push(node.id.name);
        analysis.metrics.wmc++;
        if (/^[A-Z]/.test(node.id.name)) {
          analysis.components.push(node.id.name);
        }
      }

      if (node.type === 'VariableDeclarator') {
        if (node.init?.type === 'ArrowFunctionExpression' || 
            node.init?.type === 'FunctionExpression') {
          if (node.id?.name) {
            analysis.functions.push(node.id.name);
            analysis.metrics.wmc++;
            if (/^[A-Z]/.test(node.id.name)) {
              analysis.components.push(node.id.name);
            }
            if (/^(handle|on)[A-Z]/.test(node.id.name)) {
              analysis.eventHandlers.push(node.id.name);
            }
          }
        } else {
          if (node.id?.name) {
            analysis.variables.push(node.id.name);
          }
        }
      }

      if (node.type === 'CallExpression' && 
          node.callee?.name?.startsWith('use')) {
        analysis.hooks.push(node.callee.name);
      }

      if (node.type === 'ImportDeclaration') {
        analysis.imports.push({
          source: node.source?.value,
          specifiers: node.specifiers?.map(s => s.local?.name).filter(Boolean) || []
        });
        analysis.metrics.cbo++;
      }

      if (node.type === 'ExportDefaultDeclaration' || 
          node.type === 'ExportNamedDeclaration') {
        if (node.declaration?.id?.name) {
          analysis.exports.push(node.declaration.id.name);
        }
      }

      if (['IfStatement', 'ConditionalExpression', 'SwitchCase', 'CatchClause'].includes(node.type)) {
        analysis.complexity.branches++;
        analysis.metrics.cyclomaticComplexity++;
      }

      if (['ForStatement', 'WhileStatement', 'DoWhileStatement', 'ForInStatement', 'ForOfStatement'].includes(node.type)) {
        analysis.complexity.loops++;
        analysis.metrics.cyclomaticComplexity++;
      }

      if (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||')) {
        analysis.metrics.cyclomaticComplexity++;
      }

      if (node.type === 'JSXAttribute' && 
          node.name?.name === 'dangerouslySetInnerHTML') {
        analysis.issues.push({
          type: 'security',
          message: 'dangerouslySetInnerHTML 사용 감지 - XSS 위험',
          severity: 'high'
        });
      }

      if (node.type === 'CallExpression' && node.callee?.name === 'eval') {
        analysis.issues.push({
          type: 'security',
          message: 'eval() 사용 감지 - 보안 위험',
          severity: 'high'
        });
      }

      for (const key in node) {
        if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(c => traverse(c, depth + 1));
        } else if (child && typeof child === 'object') {
          traverse(child, depth + 1);
        }
      }
    };

    traverse(ast.program);

    analysis.hooks = [...new Set(analysis.hooks)];
    analysis.components = [...new Set(analysis.components)];
    analysis.functions = [...new Set(analysis.functions)];
    analysis.variables = [...new Set(analysis.variables)];

    const V = analysis.loc;
    const CC = analysis.metrics.cyclomaticComplexity;
    const LOC = analysis.loc;
    
    let mi = 171 - 5.2 * Math.log(V + 1) - 0.23 * CC - 16.2 * Math.log(LOC + 1);
    mi = Math.max(0, Math.min(100, mi));
    analysis.metrics.maintainabilityIndex = Math.round(mi);

    analysis.analysisTime = ((performance.now() - startTime) / 1000).toFixed(2);

    return analysis;
  } catch (error) {
    return {
      filename,
      error: error.message,
      loc: code.split('\n').length,
      analysisTime: ((performance.now() - startTime) / 1000).toFixed(2),
    };
  }
};

const calculateQualityScore = (analysis) => {
  if (analysis.error) return 0;
  
  let score = 100;
  score -= Math.min(30, analysis.metrics.cyclomaticComplexity * 2);
  score -= Math.min(15, analysis.complexity.depth);
  score -= analysis.issues.length * 10;
  if (analysis.loc > 300) score -= 10;
  if (analysis.loc > 500) score -= 10;
  if (analysis.hooks.length > 0 && analysis.components.length > 0) {
    score += 5;
  }
  
  return Math.max(0, Math.min(100, Math.round(score)));
};

const CircularGauge = ({ score }) => {
  const radius = 80;
  const strokeWidth = 12;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference * 0.75;
  
  const getColor = (score) => {
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#eab308';
    if (score >= 40) return '#f97316';
    return '#ef4444';
  };

  return (
    <div style={styles.gaugeContainer}>
      <svg width="200" height="200" viewBox="0 0 200 200">
        <path
          d="M 100 180 A 80 80 0 1 1 100 20"
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        <path
          d="M 100 180 A 80 80 0 1 1 100 20"
          fill="none"
          stroke={getColor(score)}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference}`}
          style={{ transition: 'stroke-dasharray 1s ease-out' }}
        />
      </svg>
      <div style={styles.gaugeScore}>
        <span style={{ ...styles.gaugeNumber, color: getColor(score) }}>{score}</span>
        <span style={styles.gaugeMax}>/ 100</span>
      </div>
    </div>
  );
};

const QualityInfoModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>📊 코드 품질 점수 계산 방법</h3>
          <button style={styles.modalCloseBtn} onClick={onClose}>✕</button>
        </div>
        <div style={styles.modalBody}>
          <p style={styles.modalIntro}>
            코드 품질 점수는 <strong>100점 만점</strong>에서 시작하여, 다양한 요소에 따라 감점 또는 가점됩니다.
          </p>
          
          <div style={styles.modalSection}>
            <h4 style={styles.modalSubtitle}>🔻 감점 요소</h4>
            <ul style={styles.modalList}>
              <li><strong>순환 복잡도 (Cyclomatic Complexity)</strong><br/>조건문, 반복문이 많을수록 감점 (최대 -30점)</li>
              <li><strong>코드 깊이 (Nesting Depth)</strong><br/>중첩이 깊을수록 감점 (최대 -15점)</li>
              <li><strong>보안 이슈</strong><br/>dangerouslySetInnerHTML, eval() 사용 시 각 -10점</li>
              <li><strong>파일 크기</strong><br/>300줄 초과: -10점 / 500줄 초과: 추가 -10점</li>
            </ul>
          </div>

          <div style={styles.modalSection}>
            <h4 style={styles.modalSubtitle}>🔺 가점 요소</h4>
            <ul style={styles.modalList}>
              <li><strong>React 패턴 준수</strong><br/>컴포넌트에서 Hooks를 적절히 사용하면 +5점</li>
            </ul>
          </div>

          <div style={styles.modalSection}>
            <h4 style={styles.modalSubtitle}>📈 점수 해석</h4>
            <div style={styles.scoreGuide}>
              <div style={styles.scoreRow}><span style={{...styles.scoreDot, background: '#22c55e'}}></span> 80-100점: 우수한 코드 품질</div>
              <div style={styles.scoreRow}><span style={{...styles.scoreDot, background: '#eab308'}}></span> 60-79점: 양호, 개선 권장</div>
              <div style={styles.scoreRow}><span style={{...styles.scoreDot, background: '#f97316'}}></span> 40-59점: 리팩토링 필요</div>
              <div style={styles.scoreRow}><span style={{...styles.scoreDot, background: '#ef4444'}}></span> 0-39점: 즉시 개선 필요</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [screen, setScreen] = useState('upload');
  const [results, setResults] = useState(null);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [currentStep, setCurrentStep] = useState('');
  const [showQualityInfo, setShowQualityInfo] = useState(false);

  const processFiles = useCallback(async (uploadedFiles) => {
    setScreen('analyzing');
    setProgress(0);
    setCurrentStep('파일 읽는 중...');

    const fileList = [];
    
    for (const file of uploadedFiles) {
      if (file.name.endsWith('.zip')) {
        const zip = new JSZip();
        const contents = await zip.loadAsync(file);
        
        const entries = Object.entries(contents.files);
        for (let i = 0; i < entries.length; i++) {
          const [path, zipEntry] = entries[i];
          if (!zipEntry.dir && (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.tsx') || path.endsWith('.ts'))) {
            if (!path.includes('node_modules')) {
              const content = await zipEntry.async('string');
              fileList.push({ name: path, content });
            }
          }
          setProgress(Math.round((i / entries.length) * 25));
          await new Promise(r => setTimeout(r, 30));
        }
      } else if (file.name.match(/\.(js|jsx|tsx|ts)$/)) {
        const content = await file.text();
        fileList.push({ name: file.name, content });
      }
    }

    setCurrentStep('AST 변환 중...');
    for (let i = 0; i <= 25; i++) {
      setProgress(25 + i);
      await new Promise(r => setTimeout(r, 60));
    }

    setCurrentStep('메트릭 계산 중...');
    const analysisResults = [];
    for (let i = 0; i < fileList.length; i++) {
      const result = analyzeCode(fileList[i].content, fileList[i].name);
      result.qualityScore = calculateQualityScore(result);
      analysisResults.push(result);
      setProgress(50 + Math.round((i / fileList.length) * 25));
      await new Promise(r => setTimeout(r, 300));
    }

    setCurrentStep('결과 생성 중...');
    for (let i = 0; i <= 25; i++) {
      setProgress(75 + i);
      await new Promise(r => setTimeout(r, 50));
    }

    const validResults = analysisResults.filter(r => !r.error);
    const summary = {
      totalFiles: analysisResults.length,
      totalLOC: analysisResults.reduce((sum, r) => sum + (r.loc || 0), 0),
      totalFunctions: validResults.reduce((sum, r) => sum + (r.functions?.length || 0), 0),
      totalVariables: validResults.reduce((sum, r) => sum + (r.variables?.length || 0), 0),
      totalEventHandlers: validResults.reduce((sum, r) => sum + (r.eventHandlers?.length || 0), 0),
      totalComponents: validResults.reduce((sum, r) => sum + (r.components?.length || 0), 0),
      totalHooks: [...new Set(validResults.flatMap(r => r.hooks || []))],
      totalImports: [...new Set(validResults.flatMap(r => r.imports?.map(i => i.source) || []))],
      totalIssues: validResults.reduce((sum, r) => sum + (r.issues?.length || 0), 0),
      avgQualityScore: Math.round(
        validResults.reduce((sum, r) => sum + r.qualityScore, 0) / validResults.length
      ),
      avgCyclomaticComplexity: Math.round(
        validResults.reduce((sum, r) => sum + (r.metrics?.cyclomaticComplexity || 0), 0) / validResults.length
      ),
      avgMaintainabilityIndex: Math.round(
        validResults.reduce((sum, r) => sum + (r.metrics?.maintainabilityIndex || 0), 0) / validResults.length
      ),
      totalCBO: validResults.reduce((sum, r) => sum + (r.metrics?.cbo || 0), 0),
      totalWMC: validResults.reduce((sum, r) => sum + (r.metrics?.wmc || 0), 0),
      totalAnalysisTime: validResults.reduce((sum, r) => sum + parseFloat(r.analysisTime || 0), 0).toFixed(2),
    };

    setResults({ files: analysisResults, summary });
    setCurrentStep('완료!');
    
    setTimeout(() => {
      setScreen('results');
    }, 800);
  }, []);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  }, [processFiles]);

  const handleFileInput = useCallback((e) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(Array.from(e.target.files));
    }
  }, [processFiles]);

  const resetApp = () => {
    setScreen('upload');
    setResults(null);
    setProgress(0);
    setCurrentStep('');
  };

  if (screen === 'upload') {
    return (
      <div style={styles.containerUpload}>
        <div style={styles.header}>
          <div style={styles.logo}>
            <span style={styles.logoIcon}>⚛️</span>
            <h1 style={styles.logoText}>React Code Analyzer</h1>
          </div>
          <p style={styles.subtitle}>React 코드를 분석하여 구조, 복잡도, 보안 이슈를 파악합니다</p>
        </div>

        <div
          style={{
            ...styles.uploadArea,
            ...(dragActive ? styles.uploadAreaActive : {})
          }}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => document.getElementById('fileInput').click()}
        >
          <input
            id="fileInput"
            type="file"
            accept=".zip,.js,.jsx,.ts,.tsx"
            multiple
            onChange={handleFileInput}
            style={{ display: 'none' }}
          />
          
          <div style={styles.uploadIcon}>
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17,8 12,3 7,8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          
          <h2 style={styles.uploadTitle}>파일을 드래그하거나 클릭하여 업로드</h2>
          <p style={styles.uploadDesc}>
            ZIP 파일 또는 .js, .jsx, .ts, .tsx 파일을 업로드하세요
          </p>
          
          <div style={styles.uploadBadges}>
            <span style={styles.badge}>📦 ZIP</span>
            <span style={styles.badge}>⚛️ JSX</span>
            <span style={styles.badge}>📘 TSX</span>
            <span style={styles.badge}>📄 JS/TS</span>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'analyzing') {
    return (
      <div style={styles.containerUpload}>
        <div style={styles.analyzingBox}>
          <div style={styles.spinner}>
            <div style={styles.spinnerRing}></div>
            <span style={styles.spinnerIcon}>⚛️</span>
          </div>
          
          <h2 style={styles.analyzingTitle}>코드 분석 중...</h2>
          <p style={styles.analyzingDesc}>{currentStep}</p>
          
          <div style={styles.progressContainer}>
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${progress}%` }}></div>
            </div>
            <span style={styles.progressText}>{progress}%</span>
          </div>

          <div style={styles.analyzingSteps}>
            <div style={{...styles.step, opacity: progress > 0 ? 1 : 0.3}}>
              <span style={styles.stepCheck}>{progress > 25 ? '✓' : '○'}</span>
              <span>파일 읽기</span>
            </div>
            <div style={{...styles.step, opacity: progress > 25 ? 1 : 0.3}}>
              <span style={styles.stepCheck}>{progress > 50 ? '✓' : '○'}</span>
              <span>AST 변환</span>
            </div>
            <div style={{...styles.step, opacity: progress > 50 ? 1 : 0.3}}>
              <span style={styles.stepCheck}>{progress > 75 ? '✓' : '○'}</span>
              <span>메트릭 계산</span>
            </div>
            <div style={{...styles.step, opacity: progress > 75 ? 1 : 0.3}}>
              <span style={styles.stepCheck}>{progress >= 100 ? '✓' : '○'}</span>
              <span>결과 생성</span>
            </div>
          </div>
        </div>

        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (screen === 'results' && results) {
    const qualityBarData = [
      { name: '함수 복잡도', value: Math.min(100, results.summary.avgCyclomaticComplexity * 10), color: '#ec4899' },
      { name: '변수 관리', value: Math.min(100, 100 - results.summary.totalVariables / results.summary.totalFiles * 2), color: '#f59e0b' },
      { name: '이벤트 핸들러', value: Math.min(100, results.summary.totalEventHandlers * 15), color: '#8b5cf6' },
      { name: '유지보수 지수', value: results.summary.avgMaintainabilityIndex, color: '#3b82f6' },
    ];

    const radarData = [
      { subject: 'LOC', A: Math.min(100, results.summary.totalLOC / 10), fullMark: 100 },
      { subject: 'Cyclomatic', A: Math.min(100, results.summary.avgCyclomaticComplexity * 10), fullMark: 100 },
      { subject: 'CBO', A: Math.min(100, results.summary.totalCBO * 5), fullMark: 100 },
      { subject: 'WMC', A: Math.min(100, results.summary.totalWMC * 5), fullMark: 100 },
      { subject: 'MI', A: results.summary.avgMaintainabilityIndex, fullMark: 100 },
    ];

    return (
      <div style={styles.container}>
        <QualityInfoModal isOpen={showQualityInfo} onClose={() => setShowQualityInfo(false)} />
        
        <div style={styles.resultsHeader}>
          <button style={styles.backButton} onClick={resetApp}>
            ← 새로운 분석
          </button>
        </div>

        <div style={styles.summaryCard}>
          <h2 style={styles.cardTitle}>
            <span style={styles.cardIcon}>📊</span> AST 요약 분석 결과
          </h2>
          <div style={styles.summaryStats}>
            <span>✓ 함수 선언: <strong>{results.summary.totalFunctions}</strong></span>
            <span>✓ 변수 선언: <strong>{results.summary.totalVariables}</strong></span>
            <span>✓ 이벤트 핸들러: <strong>{results.summary.totalEventHandlers}</strong></span>
          </div>
          <div style={styles.summaryStats}>
            <span>✓ 파일: <strong>{results.files.map(f => f.filename).join(', ')}</strong></span>
            <span>✓ 분석 소요 시간: <strong>{results.summary.totalAnalysisTime}초</strong></span>
          </div>
        </div>

        <div style={styles.dashboardGrid}>
          <div style={styles.chartCard}>
            <div style={styles.chartTitleRow}>
              <h3 style={styles.chartTitle}>
                <span style={styles.chartIcon}>🎯</span> 코드 품질 점수
              </h3>
              <button style={styles.infoButton} onClick={() => setShowQualityInfo(true)}>
                ❓ 계산 방법
              </button>
            </div>
            <CircularGauge score={results.summary.avgQualityScore} />
          </div>

          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>
              <span style={styles.chartIcon}>📈</span> 품질 지표 분석
            </h3>
            <div style={styles.barChartContainer}>
              {qualityBarData.map((item, index) => (
                <div key={index} style={styles.barRow}>
                  <span style={styles.barLabel}>{item.name}</span>
                  <div style={styles.barTrack}>
                    <div 
                      style={{
                        ...styles.barFill,
                        width: `${item.value}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={styles.radarCard}>
          <h3 style={styles.chartTitle}>
            <span style={styles.chartIcon}>📡</span> 확장 메트릭 레이더
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#e5e7eb" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#374151', fontSize: 12 }} />
              <PolarRadiusAxis 
                angle={90} 
                domain={[0, 100]} 
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                axisLine={false}
              />
              <Radar
                name="메트릭"
                dataKey="A"
                stroke="#6366f1"
                fill="#6366f1"
                fillOpacity={0.3}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div style={styles.filesSection}>
          <h3 style={styles.sectionTitle}>📁 파일별 분석 결과</h3>
          <div style={styles.fileList}>
            {results.files.map((file, index) => (
              <div key={index} style={styles.fileCard}>
                <div style={styles.fileHeader}>
                  <span style={styles.fileName}>📄 {file.filename}</span>
                  <div style={{
                    ...styles.fileScoreBadge,
                    backgroundColor: file.qualityScore >= 70 ? '#dcfce7' : file.qualityScore >= 50 ? '#fef3c7' : '#fee2e2',
                  }}>
                    <span style={{
                      ...styles.scoreText,
                      color: file.qualityScore >= 70 ? '#16a34a' : file.qualityScore >= 50 ? '#ca8a04' : '#dc2626'
                    }}>
                      {file.qualityScore}점
                    </span>
                  </div>
                </div>
                
                {file.error ? (
                  <div style={styles.fileError}>⚠️ 파싱 에러: {file.error}</div>
                ) : (
                  <div style={styles.fileDetails}>
                    <div style={styles.fileMetrics}>
                      <span style={styles.metricItem}>📝 {file.loc} lines</span>
                      <span style={styles.metricItem}>🔧 함수 {file.functions?.length || 0}</span>
                      <span style={styles.metricItem}>📦 변수 {file.variables?.length || 0}</span>
                      <span style={styles.metricItem}>🔄 CC: {file.metrics?.cyclomaticComplexity || 0}</span>
                    </div>
                    
                    {file.components?.length > 0 && (
                      <div style={styles.tagRow}>
                        <span style={styles.tagLabel}>컴포넌트:</span>
                        {file.components.map((comp, i) => (
                          <span key={i} style={styles.componentTag}>{comp}</span>
                        ))}
                      </div>
                    )}
                    
                    {file.hooks?.length > 0 && (
                      <div style={styles.tagRow}>
                        <span style={styles.tagLabel}>Hooks:</span>
                        {file.hooks.map((hook, i) => (
                          <span key={i} style={styles.hookTag}>{hook}</span>
                        ))}
                      </div>
                    )}
                    
                    {file.issues?.length > 0 && (
                      <div style={styles.issuesList}>
                        {file.issues.map((issue, i) => (
                          <div key={i} style={styles.issueItem}>
                            🚨 {issue.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return null;
};

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
    padding: '40px 20px',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    color: '#1f2937',
  },
  containerUpload: {
    height: '100vh',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
    padding: '20px',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    color: '#1f2937',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    boxSizing: 'border-box',
  },
  header: {
    textAlign: 'center',
    marginBottom: '24px',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    marginBottom: '12px',
  },
  logoIcon: {
    fontSize: '36px',
  },
  logoText: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#6366f1',
    margin: 0,
    letterSpacing: '-0.5px',
  },
  subtitle: {
    color: '#6b7280',
    fontSize: '14px',
    margin: 0,
  },
  uploadArea: {
    width: '100%',
    maxWidth: '600px',
    padding: '60px 40px',
    background: '#ffffff',
    borderRadius: '24px',
    border: '2px dashed #d1d5db',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.06)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadAreaActive: {
    borderColor: '#6366f1',
    background: '#f5f3ff',
    transform: 'scale(1.02)',
  },
  uploadIcon: {
    marginBottom: '20px',
  },
  uploadTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 8px 0',
  },
  uploadDesc: {
    color: '#6b7280',
    fontSize: '14px',
    margin: '0 0 20px 0',
  },
  uploadBadges: {
    display: 'flex',
    justifyContent: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  badge: {
    padding: '6px 12px',
    background: '#f3f4f6',
    borderRadius: '20px',
    fontSize: '13px',
    color: '#4b5563',
  },
  analyzingBox: {
    width: '100%',
    maxWidth: '450px',
    padding: '40px',
    background: '#ffffff',
    borderRadius: '24px',
    textAlign: 'center',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)',
    border: '1px solid #f3f4f6',
  },
  spinner: {
    position: 'relative',
    width: '70px',
    height: '70px',
    margin: '0 auto 24px',
  },
  spinnerRing: {
    position: 'absolute',
    inset: 0,
    border: '3px solid #e5e7eb',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  spinnerIcon: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
  },
  analyzingTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 8px 0',
  },
  analyzingDesc: {
    color: '#6366f1',
    fontSize: '14px',
    margin: '0 0 24px 0',
    fontWeight: '500',
  },
  progressContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px',
  },
  progressBar: {
    flex: 1,
    height: '8px',
    background: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#6366f1',
    minWidth: '40px',
  },
  analyzingSteps: {
    display: 'flex',
    justifyContent: 'center',
    gap: '20px',
    flexWrap: 'wrap',
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#6b7280',
    transition: 'opacity 0.3s ease',
  },
  stepCheck: {
    color: '#6366f1',
    fontWeight: '600',
  },
  resultsHeader: {
    maxWidth: '1200px',
    margin: '0 auto 24px',
  },
  backButton: {
    padding: '10px 20px',
    background: '#ffffff',
    color: '#6366f1',
    border: '2px solid #6366f1',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  summaryCard: {
    maxWidth: '1200px',
    margin: '0 auto 24px',
    padding: '24px',
    background: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
    border: '1px solid #f3f4f6',
  },
  cardTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 16px 0',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  cardIcon: {
    fontSize: '20px',
  },
  summaryStats: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '24px',
    fontSize: '14px',
    color: '#4b5563',
    marginBottom: '8px',
  },
  dashboardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
    gap: '24px',
    maxWidth: '1200px',
    margin: '0 auto 24px',
  },
  chartCard: {
    padding: '24px',
    background: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
    border: '1px solid #f3f4f6',
    display: 'flex',
    flexDirection: 'column',
  },
  chartTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  chartTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  chartIcon: {
    fontSize: '18px',
  },
  infoButton: {
    padding: '6px 12px',
    background: '#f3f4f6',
    color: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  gaugeContainer: {
    position: 'relative',
    width: '200px',
    height: '200px',
    margin: '0 auto',
  },
  gaugeScore: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center',
  },
  gaugeNumber: {
    fontSize: '48px',
    fontWeight: '700',
    display: 'block',
    lineHeight: '1',
  },
  gaugeMax: {
    fontSize: '16px',
    color: '#9ca3af',
    display: 'block',
    marginTop: '4px',
  },
  barChartContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    flex: 1,
    justifyContent: 'center',
  },
  barRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  barLabel: {
    width: '100px',
    fontSize: '13px',
    color: '#4b5563',
    textAlign: 'right',
  },
  barTrack: {
    flex: 1,
    height: '20px',
    background: '#f3f4f6',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 1s ease-out',
  },
  radarCard: {
    maxWidth: '1200px',
    margin: '0 auto 24px',
    padding: '24px',
    background: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
    border: '1px solid #f3f4f6',
  },
  filesSection: {
    maxWidth: '1200px',
    margin: '0 auto',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '16px',
  },
  fileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  fileCard: {
    background: '#ffffff',
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
    border: '1px solid #f3f4f6',
  },
  fileHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  fileName: {
    fontWeight: '600',
    color: '#1f2937',
    fontSize: '14px',
  },
  fileScoreBadge: {
    padding: '4px 12px',
    borderRadius: '20px',
  },
  scoreText: {
    fontSize: '14px',
    fontWeight: '600',
  },
  fileError: {
    color: '#dc2626',
    fontSize: '13px',
    padding: '12px',
    background: '#fef2f2',
    borderRadius: '8px',
  },
  fileDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  fileMetrics: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '16px',
  },
  metricItem: {
    fontSize: '13px',
    color: '#6b7280',
  },
  tagRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
  },
  tagLabel: {
    fontSize: '13px',
    color: '#6b7280',
  },
  componentTag: {
    padding: '4px 10px',
    background: '#ede9fe',
    color: '#7c3aed',
    borderRadius: '12px',
    fontSize: '12px',
  },
  hookTag: {
    padding: '4px 10px',
    background: '#dbeafe',
    color: '#2563eb',
    borderRadius: '12px',
    fontSize: '12px',
  },
  issuesList: {
    padding: '12px',
    background: '#fef2f2',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  issueItem: {
    fontSize: '13px',
    color: '#dc2626',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '20px',
  },
  modalContent: {
    background: '#ffffff',
    borderRadius: '20px',
    maxWidth: '500px',
    width: '100%',
    maxHeight: '80vh',
    overflow: 'auto',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.2)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #f3f4f6',
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0,
  },
  modalCloseBtn: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '4px',
  },
  modalBody: {
    padding: '24px',
  },
  modalIntro: {
    fontSize: '14px',
    color: '#4b5563',
    lineHeight: '1.6',
    marginBottom: '20px',
  },
  modalSection: {
    marginBottom: '20px',
  },
  modalSubtitle: {
    fontSize: '15px',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '12px',
  },
  modalList: {
    paddingLeft: '20px',
    margin: 0,
    fontSize: '13px',
    color: '#4b5563',
    lineHeight: '1.8',
  },
  scoreGuide: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  scoreRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '13px',
    color: '#4b5563',
  },
  scoreDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
  },
};

export default App;