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
  Tooltip,
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
      },
      // 의존성 분석을 위한 새로운 구조
      dependencyAnalysis: {
        components: [],
        allFunctions: [],
        dependencies: [],
        jsxUsages: {},
        functionCalls: {},
        importedModules: [],
      }
    };

    let currentFunction = null;
    const functionDependencies = {};
    const allDefinedFunctions = new Set();
    const functionTypes = {}; // 함수 타입 저장 (component, handler, helper)

    const traverse = (node, depth = 0, parentFunction = null) => {
      if (!node || typeof node !== 'object') return;
      
      analysis.complexity.depth = Math.max(analysis.complexity.depth, depth);

      // 함수 선언 감지
      if (node.type === 'FunctionDeclaration' && node.id?.name) {
        const funcName = node.id.name;
        analysis.functions.push(funcName);
        analysis.metrics.wmc++;
        allDefinedFunctions.add(funcName);
        
        // 함수 타입 분류
        if (/^[A-Z]/.test(funcName)) {
          analysis.components.push(funcName);
          analysis.dependencyAnalysis.components.push(funcName);
          functionTypes[funcName] = 'component';
        } else if (/^(handle|on)[A-Z]/.test(funcName)) {
          analysis.eventHandlers.push(funcName);
          functionTypes[funcName] = 'handler';
        } else {
          functionTypes[funcName] = 'helper';
        }
        
        analysis.dependencyAnalysis.allFunctions.push(funcName);
        
        if (!functionDependencies[funcName]) {
          functionDependencies[funcName] = {};
        }
        
        // 이 함수 내부를 순회할 때 현재 함수 컨텍스트 설정
        const previousFunction = currentFunction;
        currentFunction = funcName;
        
        for (const key in node) {
          if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'id') continue;
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach(c => traverse(c, depth + 1, funcName));
          } else if (child && typeof child === 'object') {
            traverse(child, depth + 1, funcName);
          }
        }
        
        currentFunction = previousFunction;
        return;
      }

      // 변수 선언자 (화살표 함수, 함수 표현식)
      if (node.type === 'VariableDeclarator') {
        if (node.init?.type === 'ArrowFunctionExpression' || 
            node.init?.type === 'FunctionExpression') {
          if (node.id?.name) {
            const funcName = node.id.name;
            analysis.functions.push(funcName);
            analysis.metrics.wmc++;
            allDefinedFunctions.add(funcName);
            
            // 함수 타입 분류
            if (/^[A-Z]/.test(funcName)) {
              analysis.components.push(funcName);
              analysis.dependencyAnalysis.components.push(funcName);
              functionTypes[funcName] = 'component';
            } else if (/^(handle|on)[A-Z]/.test(funcName)) {
              analysis.eventHandlers.push(funcName);
              functionTypes[funcName] = 'handler';
            } else {
              functionTypes[funcName] = 'helper';
            }
            
            analysis.dependencyAnalysis.allFunctions.push(funcName);
            
            if (!functionDependencies[funcName]) {
              functionDependencies[funcName] = {};
            }
            
            // 이 함수 내부를 순회할 때 현재 함수 컨텍스트 설정
            const previousFunction = currentFunction;
            currentFunction = funcName;
            
            for (const key in node.init) {
              if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
              const child = node.init[key];
              if (Array.isArray(child)) {
                child.forEach(c => traverse(c, depth + 1, funcName));
              } else if (child && typeof child === 'object') {
                traverse(child, depth + 1, funcName);
              }
            }
            
            currentFunction = previousFunction;
            return;
          }
        } else {
          if (node.id?.name) {
            analysis.variables.push(node.id.name);
          }
        }
      }

      // JSX 요소 사용 감지 (의존성)
      if (node.type === 'JSXElement' || node.type === 'JSXOpeningElement') {
        const elementName = node.type === 'JSXElement' 
          ? node.openingElement?.name?.name 
          : node.name?.name;
        
        if (elementName && /^[A-Z]/.test(elementName)) {
          if (currentFunction) {
            if (!functionDependencies[currentFunction]) {
              functionDependencies[currentFunction] = {};
            }
            functionDependencies[currentFunction][elementName] = 
              (functionDependencies[currentFunction][elementName] || 0) + 1;
          }
        }
      }

      // 함수 호출 감지 (모든 함수 호출)
      if (node.type === 'CallExpression') {
        let calleeName = null;
        
        // 일반 함수 호출: funcName()
        if (node.callee?.type === 'Identifier') {
          calleeName = node.callee.name;
        }
        // 멤버 표현식: obj.method() - 선택적으로 추적
        else if (node.callee?.type === 'MemberExpression' && node.callee?.property?.name) {
          // setState 등은 제외하고 싶으면 여기서 필터링
        }
        
        if (calleeName) {
          // Hooks 추적
          if (calleeName.startsWith('use')) {
            analysis.hooks.push(calleeName);
          }
          
          // 현재 함수에서 다른 함수 호출 추적
          if (currentFunction && calleeName !== currentFunction) {
            // 빌트인 함수 제외 (alert, console, setTimeout 등)
            const builtins = ['alert', 'console', 'setTimeout', 'setInterval', 'clearTimeout', 
                           'clearInterval', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
                           'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
                           'JSON', 'Math', 'Date', 'Array', 'Object', 'String', 'Number',
                           'Boolean', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise',
                           'fetch', 'require'];
            
            // React hooks와 setState는 제외
            const isHook = calleeName.startsWith('use');
            const isSetState = calleeName.startsWith('set') && calleeName.length > 3 && 
                              calleeName[3] === calleeName[3].toUpperCase();
            
            if (!builtins.includes(calleeName) && !isHook && !isSetState) {
              if (!functionDependencies[currentFunction]) {
                functionDependencies[currentFunction] = {};
              }
              functionDependencies[currentFunction][calleeName] = 
                (functionDependencies[currentFunction][calleeName] || 0) + 1;
            }
          }
        }
      }

      // Import 문 분석
      if (node.type === 'ImportDeclaration') {
        const importSource = node.source?.value;
        const importedItems = node.specifiers?.map(s => ({
          name: s.local?.name,
          imported: s.imported?.name || s.local?.name,
          type: s.type
        })).filter(i => i.name) || [];
        
        analysis.imports.push({
          source: importSource,
          specifiers: importedItems.map(i => i.name)
        });
        
        analysis.dependencyAnalysis.importedModules.push({
          source: importSource,
          items: importedItems
        });
        
        analysis.metrics.cbo++;
      }

      // Export 분석
      if (node.type === 'ExportDefaultDeclaration' || 
          node.type === 'ExportNamedDeclaration') {
        if (node.declaration?.id?.name) {
          analysis.exports.push(node.declaration.id.name);
        }
      }

      // 복잡도 계산
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

      // 보안 이슈 감지
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

      // 자식 노드 순회
      for (const key in node) {
        if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(c => traverse(c, depth + 1, currentFunction));
        } else if (child && typeof child === 'object') {
          traverse(child, depth + 1, currentFunction);
        }
      }
    };

    traverse(ast.program);

    // 중복 제거
    analysis.hooks = [...new Set(analysis.hooks)];
    analysis.components = [...new Set(analysis.components)];
    analysis.dependencyAnalysis.components = [...new Set(analysis.dependencyAnalysis.components)];
    analysis.dependencyAnalysis.allFunctions = [...new Set(analysis.dependencyAnalysis.allFunctions)];
    analysis.functions = [...new Set(analysis.functions)];
    analysis.variables = [...new Set(analysis.variables)];

    // 의존성 배열 생성 (정의된 함수에 대한 호출만 포함)
    const dependencies = [];
    Object.entries(functionDependencies).forEach(([from, targets]) => {
      Object.entries(targets).forEach(([to, count]) => {
        // 정의된 함수이거나 컴포넌트인 경우만 포함
        if (allDefinedFunctions.has(to) || /^[A-Z]/.test(to)) {
          dependencies.push({ 
            from, 
            to, 
            count,
            fromType: functionTypes[from] || 'unknown',
            toType: functionTypes[to] || (/^[A-Z]/.test(to) ? 'component' : 'external')
          });
        }
      });
    });
    
    analysis.dependencyAnalysis.dependencies = dependencies;
    analysis.dependencyAnalysis.functionTypes = functionTypes;

    // 유지보수 지수 계산
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

const TooltipBar = ({ item }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showValueTooltip, setShowValueTooltip] = useState(false);

  const descriptions = {
    '함수 복잡도': '코드 내 조건문(if, switch)과 반복문(for, while)의 수를 측정합니다. 값이 낮을수록 코드가 단순하고 이해하기 쉽습니다.',
    '변수 관리': '선언된 변수의 수와 관리 상태를 평가합니다. 불필요한 변수가 적을수록 점수가 높습니다.',
    '이벤트 핸들러': '컴포넌트 내 이벤트 핸들러(onClick, onChange 등)의 적절한 사용을 평가합니다.',
    '유지보수 지수': '코드의 유지보수 용이성을 나타내는 종합 지표입니다. 100에 가까울수록 유지보수가 쉽습니다.',
  };

  return (
    <div style={styles.barRow}>
      <div style={styles.barLabelContainer}>
        <span 
          style={styles.barLabel}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          {item.name}
          {showTooltip && (
            <div style={styles.tooltip}>
              {descriptions[item.name]}
            </div>
          )}
        </span>
      </div>
      <div 
        style={styles.barTrack}
        onMouseEnter={() => setShowValueTooltip(true)}
        onMouseLeave={() => setShowValueTooltip(false)}
      >
        <div 
          style={{
            ...styles.barFill,
            width: `${item.value}%`,
            backgroundColor: item.color,
          }}
        />
        {showValueTooltip && (
          <div style={styles.barValueTooltip}>
            {Math.round(item.value)} / 100
          </div>
        )}
      </div>
    </div>
  );
};

const CustomRadarTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div style={styles.radarTooltipBox}>
        <strong>{data.subject}</strong>: {Math.round(data.A)} / 100
      </div>
    );
  }
  return null;
};

const CustomAxisTick = ({ payload, x, y, cx, cy }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const descriptions = {
    'LOC': 'Lines of Code\n코드의 총 줄 수입니다.\n파일이 너무 크면 유지보수가 어려워집니다.',
    'Cyclomatic': 'Cyclomatic Complexity\n순환 복잡도로, 코드의 분기 수를 측정합니다.',
    'CBO': 'Coupling Between Objects\n다른 모듈과의 결합도입니다.\n낮을수록 독립적인 코드입니다.',
    'WMC': 'Weighted Methods per Class\n컴포넌트 내 메서드의 복잡도 총합입니다.',
    'MI': 'Maintainability Index\n유지보수 지수로, 100에 가까울수록 좋습니다.',
  };

  const getTooltipPosition = () => {
    const offsetX = x > cx ? -160 : x < cx ? 10 : -75;
    const offsetY = y > cy ? -80 : y < cy ? 10 : -30;
    return { offsetX, offsetY };
  };

  const { offsetX, offsetY } = getTooltipPosition();

  return (
    <g 
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      style={{ cursor: 'pointer' }}
    >
      <text
        x={x}
        y={y}
        fill="#374151"
        fontSize={12}
        textAnchor={x > cx ? 'start' : x < cx ? 'end' : 'middle'}
        dominantBaseline={y > cy ? 'hanging' : y < cy ? 'auto' : 'middle'}
      >
        {payload.value}
      </text>
      {showTooltip && (
        <foreignObject 
          x={x + offsetX} 
          y={y + offsetY} 
          width={150} 
          height={70}
          style={{ overflow: 'visible' }}
        >
          <div style={{
            background: '#1f2937',
            color: '#ffffff',
            padding: '8px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            lineHeight: '1.4',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            whiteSpace: 'pre-line',
            position: 'relative',
            zIndex: 9999,
          }}>
            {descriptions[payload.value]}
          </div>
        </foreignObject>
      )}
    </g>
  );
};

// ============================================
// 함수 의존성 다이어그램 (모든 함수 포함)
// ============================================
const DependencyDiagram = ({ dependencyAnalysis }) => {
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);
  
  const { allFunctions, dependencies, functionTypes } = dependencyAnalysis;
  
  // 모든 함수 수집 (의존성에서 참조되는 것 포함)
  const allNodes = new Set(allFunctions || []);
  dependencies.forEach(dep => {
    allNodes.add(dep.from);
    allNodes.add(dep.to);
  });
  
  const nodeList = Array.from(allNodes);
  
  if (nodeList.length === 0) {
    return (
      <div style={styles.emptyDiagram}>
        <p>📭 분석된 함수가 없습니다.</p>
        <p style={{ fontSize: '13px', color: '#9ca3af' }}>
          JavaScript/React 코드를 분석하면 함수 의존성 다이어그램이 생성됩니다.
        </p>
      </div>
    );
  }

  // 각 노드의 연결 수 계산 (중심성)
  const nodeConnections = {};
  nodeList.forEach(node => {
    nodeConnections[node] = { in: 0, out: 0, total: 0 };
  });
  
  dependencies.forEach(dep => {
    if (nodeConnections[dep.from]) {
      nodeConnections[dep.from].out += dep.count;
      nodeConnections[dep.from].total += dep.count;
    }
    if (nodeConnections[dep.to]) {
      nodeConnections[dep.to].in += dep.count;
      nodeConnections[dep.to].total += dep.count;
    }
  });

  // 노드 위치 계산
  const svgWidth = 850;
  const svgHeight = Math.max(500, nodeList.length * 70);
  const centerX = svgWidth / 2;
  const centerY = svgHeight / 2;
  
  // 연결이 많은 노드를 중앙에 배치
  const sortedNodes = [...nodeList].sort((a, b) => 
    nodeConnections[b].total - nodeConnections[a].total
  );
  
  const nodePositions = {};
  const nodeWidth = 130;
  const nodeHeight = 44;
  
  // 원형 레이아웃 + 중심성 기반 배치
  sortedNodes.forEach((node, index) => {
    if (index === 0 && sortedNodes.length > 1) {
      // 가장 연결이 많은 노드는 중앙에
      nodePositions[node] = { x: centerX, y: centerY };
    } else if (sortedNodes.length === 1) {
      // 노드가 1개면 중앙에
      nodePositions[node] = { x: centerX, y: centerY };
    } else {
      // 나머지는 원형으로 배치
      const adjustedIndex = index - 1;
      const layer = Math.floor(adjustedIndex / 6) + 1;
      const posInLayer = adjustedIndex % 6;
      const nodesInThisLayer = Math.min(6, sortedNodes.length - 1 - (layer - 1) * 6);
      const angle = (posInLayer / nodesInThisLayer) * 2 * Math.PI - Math.PI / 2;
      const radius = 140 + layer * 110;
      
      nodePositions[node] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
      };
    }
  });

  // 함수 타입에 따른 노드 스타일
  const getNodeStyle = (node) => {
    const type = functionTypes?.[node] || (/^[A-Z]/.test(node) ? 'component' : 'helper');
    
    switch(type) {
      case 'component':
        return { 
          fill: '#dbeafe', 
          stroke: '#3b82f6', 
          text: '#1e40af',
          icon: '⚛️',
          label: 'Component'
        };
      case 'handler':
        return { 
          fill: '#fef3c7', 
          stroke: '#f59e0b', 
          text: '#92400e',
          icon: '🎯',
          label: 'Handler'
        };
      case 'helper':
        return { 
          fill: '#dcfce7', 
          stroke: '#22c55e', 
          text: '#166534',
          icon: '🔧',
          label: 'Helper'
        };
      default:
        return { 
          fill: '#f3f4f6', 
          stroke: '#9ca3af', 
          text: '#374151',
          icon: '📦',
          label: 'External'
        };
    }
  };

  // 노드 크기 (연결 수에 따라)
  const getNodeSize = (node) => {
    const connections = nodeConnections[node]?.total || 0;
    const baseWidth = 130;
    const baseHeight = 44;
    const scale = Math.min(1.4, 1 + connections * 0.08);
    return { width: baseWidth * scale, height: baseHeight * scale };
  };

  // 화살표 경로 계산
  const getEdgePath = (from, to) => {
    const fromPos = nodePositions[from];
    const toPos = nodePositions[to];
    
    if (!fromPos || !toPos) return null;
    
    const fromSize = getNodeSize(from);
    const toSize = getNodeSize(to);
    
    // 방향 벡터
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist === 0) return null;
    
    const nx = dx / dist;
    const ny = dy / dist;
    
    // 시작점과 끝점 (노드 테두리)
    const startX = fromPos.x + nx * (fromSize.width / 2 + 5);
    const startY = fromPos.y + ny * (fromSize.height / 2 + 5);
    const endX = toPos.x - nx * (toSize.width / 2 + 15);
    const endY = toPos.y - ny * (toSize.height / 2 + 15);
    
    // 곡선 제어점
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    
    // 약간의 곡선 추가
    const perpX = -ny * 30;
    const perpY = nx * 30;
    
    return {
      path: `M ${startX} ${startY} Q ${midX + perpX} ${midY + perpY} ${endX} ${endY}`,
      labelX: midX + perpX * 0.6,
      labelY: midY + perpY * 0.6,
      startX, startY, endX, endY
    };
  };

  // 자기 참조 경로
  const getSelfLoopPath = (node) => {
    const pos = nodePositions[node];
    const size = getNodeSize(node);
    
    if (!pos) return null;
    
    const x = pos.x + size.width / 2;
    const y = pos.y - size.height / 2;
    
    return {
      path: `M ${x} ${y} C ${x + 60} ${y - 50} ${x + 60} ${y + 50} ${x} ${y + size.height}`,
      labelX: x + 65,
      labelY: y + 10
    };
  };

  const renderEdge = (dep, idx) => {
    const isSelfLoop = dep.from === dep.to;
    const edgeData = isSelfLoop 
      ? getSelfLoopPath(dep.from)
      : getEdgePath(dep.from, dep.to);
    
    if (!edgeData) return null;
    
    const isHovered = hoveredEdge === idx;
    const strokeWidth = Math.min(4, 1.5 + dep.count * 0.5);
    
    return (
      <g 
        key={idx}
        onMouseEnter={() => setHoveredEdge(idx)}
        onMouseLeave={() => setHoveredEdge(null)}
        style={{ cursor: 'pointer' }}
      >
        <path
          d={edgeData.path}
          fill="none"
          stroke={isHovered ? '#6366f1' : '#94a3b8'}
          strokeWidth={isHovered ? strokeWidth + 1.5 : strokeWidth}
          markerEnd="url(#dependency-arrow)"
          style={{ transition: 'all 0.2s ease' }}
        />
        {/* 의존 횟수 표시 */}
        <g transform={`translate(${edgeData.labelX}, ${edgeData.labelY})`}>
          <circle
            r="14"
            fill={isHovered ? '#6366f1' : '#ffffff'}
            stroke={isHovered ? '#4f46e5' : '#94a3b8'}
            strokeWidth="2"
          />
          <text
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="11"
            fontWeight="700"
            fill={isHovered ? '#ffffff' : '#475569'}
          >
            {dep.count}
          </text>
        </g>
        {/* 호버 툴팁 */}
        {isHovered && (
          <foreignObject 
            x={edgeData.labelX + 25} 
            y={edgeData.labelY - 20} 
            width="200" 
            height="60"
          >
            <div style={styles.diagramTooltip}>
              <strong>{dep.from}</strong> → <strong>{dep.to}</strong>
              <br />
              호출 횟수: {dep.count}회
            </div>
          </foreignObject>
        )}
      </g>
    );
  };

  const renderNode = (node) => {
    const pos = nodePositions[node];
    const size = getNodeSize(node);
    const style = getNodeStyle(node);
    const conn = nodeConnections[node];
    const isHovered = hoveredNode === node;
    
    if (!pos) return null;
    
    return (
      <g 
        key={node}
        onMouseEnter={() => setHoveredNode(node)}
        onMouseLeave={() => setHoveredNode(null)}
        style={{ cursor: 'pointer' }}
        transform={`translate(${pos.x}, ${pos.y})`}
      >
        {/* 노드 그림자 */}
        <rect
          x={-size.width / 2 + 3}
          y={-size.height / 2 + 3}
          width={size.width}
          height={size.height}
          rx="10"
          fill="rgba(0,0,0,0.1)"
        />
        {/* 노드 배경 */}
        <rect
          x={-size.width / 2}
          y={-size.height / 2}
          width={size.width}
          height={size.height}
          rx="10"
          fill={isHovered ? style.stroke : style.fill}
          stroke={style.stroke}
          strokeWidth={isHovered ? 3 : 2}
          style={{ transition: 'all 0.2s ease' }}
        />
        {/* 아이콘 */}
        <text
          x={-size.width / 2 + 12}
          y={2}
          fontSize="14"
          dominantBaseline="middle"
        >
          {style.icon}
        </text>
        {/* 함수 이름 */}
        <text
          x={5}
          y={0}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="12"
          fontWeight="600"
          fill={isHovered ? '#ffffff' : style.text}
        >
          {node.length > 14 ? node.slice(0, 12) + '...' : node}
        </text>
        {/* 타입 라벨 */}
        <text
          x={5}
          y={size.height / 2 - 10}
          textAnchor="middle"
          fontSize="9"
          fill={isHovered ? 'rgba(255,255,255,0.8)' : style.stroke}
        >
          {style.label}
        </text>
        {/* 연결 수 뱃지 */}
        {conn && conn.total > 0 && (
          <g transform={`translate(${size.width / 2 - 8}, ${-size.height / 2 - 8})`}>
            <circle r="12" fill="#ef4444" stroke="#ffffff" strokeWidth="2" />
            <text
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="10"
              fontWeight="bold"
              fill="#ffffff"
            >
              {conn.total}
            </text>
          </g>
        )}
        {/* 호버 툴팁 */}
        {isHovered && (
          <foreignObject 
            x={size.width / 2 + 15} 
            y={-40} 
            width="180" 
            height="100"
          >
            <div style={styles.diagramTooltip}>
              <strong>{node}</strong>
              <br />
              타입: {style.label}
              <br />
              호출됨 (In): {conn?.in || 0}회
              <br />
              호출함 (Out): {conn?.out || 0}회
            </div>
          </foreignObject>
        )}
      </g>
    );
  };

  return (
    <div style={styles.diagramContainer}>
      <svg width={svgWidth} height={svgHeight} style={{ overflow: 'visible' }}>
        <defs>
          <marker
            id="dependency-arrow"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
          </marker>
        </defs>
        
        {/* 엣지 먼저 렌더링 */}
        {dependencies.map(renderEdge)}
        
        {/* 노드 렌더링 */}
        {nodeList.map(renderNode)}
      </svg>
      
      {/* 범례 */}
      <div style={styles.diagramLegend}>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendBox, background: '#dbeafe', border: '2px solid #3b82f6' }}></div>
          <span>⚛️ Component (컴포넌트)</span>
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendBox, background: '#fef3c7', border: '2px solid #f59e0b' }}></div>
          <span>🎯 Handler (이벤트 핸들러)</span>
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendBox, background: '#dcfce7', border: '2px solid #22c55e' }}></div>
          <span>🔧 Helper (헬퍼 함수)</span>
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendCircle, background: '#ef4444' }}></div>
          <span>총 연결 수</span>
        </div>
      </div>
      
      {/* 통계 요약 */}
      <div style={styles.dependencyStats}>
        <div style={styles.statItem}>
          <span style={styles.statValue}>{nodeList.length}</span>
          <span style={styles.statLabel}>전체 함수</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statValue}>
            {nodeList.filter(n => (functionTypes?.[n] || (/^[A-Z]/.test(n) ? 'component' : '')) === 'component').length}
          </span>
          <span style={styles.statLabel}>컴포넌트</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statValue}>{dependencies.length}</span>
          <span style={styles.statLabel}>의존 관계</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statValue}>
            {dependencies.reduce((sum, d) => sum + d.count, 0)}
          </span>
          <span style={styles.statLabel}>총 호출 횟수</span>
        </div>
        <div style={styles.statItem}>
          <span style={{...styles.statValue, fontSize: '16px'}}>
            {sortedNodes[0] || '-'}
          </span>
          <span style={styles.statLabel}>중심 함수</span>
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
        
        const allPaths = Object.keys(contents.files);
        const validPaths = allPaths.filter(path => {
          if (contents.files[path].dir) return false;
          if (path.includes('node_modules/')) return false;
          if (path.includes('/.')) return false;
          if (path.startsWith('.')) return false;
          if (path.includes('/build/')) return false;
          if (path.includes('/dist/')) return false;
          if (!path.match(/\.(js|jsx|ts|tsx)$/)) return false;
          return true;
        });
        
        setProgress(10);
        
        for (let i = 0; i < validPaths.length; i++) {
          const path = validPaths[i];
          const zipEntry = contents.files[path];
          const content = await zipEntry.async('string');
          fileList.push({ name: path, content });
          setProgress(10 + Math.round((i / validPaths.length) * 15));
        }
      } else if (file.name.match(/\.(js|jsx|tsx|ts)$/)) {
        const content = await file.text();
        fileList.push({ name: file.name, content });
      }
    }

    setProgress(25);
    setCurrentStep('AST 변환 중...');
    
    await new Promise(r => setTimeout(r, 300));
    setProgress(40);
    await new Promise(r => setTimeout(r, 300));
    setProgress(50);

    setCurrentStep('메트릭 계산 중...');
    const analysisResults = [];
    for (let i = 0; i < fileList.length; i++) {
      const result = analyzeCode(fileList[i].content, fileList[i].name);
      result.qualityScore = calculateQualityScore(result);
      analysisResults.push(result);
      setProgress(50 + Math.round((i / fileList.length) * 25));
      await new Promise(r => setTimeout(r, 100));
    }

    setCurrentStep('결과 생성 중...');
    setProgress(80);
    await new Promise(r => setTimeout(r, 300));
    setProgress(90);
    await new Promise(r => setTimeout(r, 300));
    setProgress(100);

    const validResults = analysisResults.filter(r => !r.error);
    
    // 의존성 분석 결과 통합
    const combinedDependencyAnalysis = {
      allFunctions: [],
      components: [],
      dependencies: [],
      functionTypes: {},
    };
    
    const allFunctionsSet = new Set();
    const dependencyMap = {};
    const mergedFunctionTypes = {};
    
    validResults.forEach(r => {
      if (r.dependencyAnalysis) {
        (r.dependencyAnalysis.allFunctions || []).forEach(f => allFunctionsSet.add(f));
        (r.dependencyAnalysis.components || []).forEach(c => combinedDependencyAnalysis.components.push(c));
        
        // 함수 타입 병합
        if (r.dependencyAnalysis.functionTypes) {
          Object.assign(mergedFunctionTypes, r.dependencyAnalysis.functionTypes);
        }
        
        r.dependencyAnalysis.dependencies.forEach(dep => {
          const key = `${dep.from}->${dep.to}`;
          if (dependencyMap[key]) {
            dependencyMap[key].count += dep.count;
          } else {
            dependencyMap[key] = { ...dep };
          }
        });
      }
    });
    
    combinedDependencyAnalysis.allFunctions = Array.from(allFunctionsSet);
    combinedDependencyAnalysis.dependencies = Object.values(dependencyMap);
    combinedDependencyAnalysis.functionTypes = mergedFunctionTypes;
    combinedDependencyAnalysis.components = [...new Set(combinedDependencyAnalysis.components)];
    
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
      avgQualityScore: validResults.length > 0 ? Math.round(
        validResults.reduce((sum, r) => sum + r.qualityScore, 0) / validResults.length
      ) : 0,
      avgCyclomaticComplexity: validResults.length > 0 ? Math.round(
        validResults.reduce((sum, r) => sum + (r.metrics?.cyclomaticComplexity || 0), 0) / validResults.length
      ) : 0,
      avgMaintainabilityIndex: validResults.length > 0 ? Math.round(
        validResults.reduce((sum, r) => sum + (r.metrics?.maintainabilityIndex || 0), 0) / validResults.length
      ) : 0,
      totalCBO: validResults.reduce((sum, r) => sum + (r.metrics?.cbo || 0), 0),
      totalWMC: validResults.reduce((sum, r) => sum + (r.metrics?.wmc || 0), 0),
      totalAnalysisTime: validResults.reduce((sum, r) => sum + parseFloat(r.analysisTime || 0), 0).toFixed(2),
      dependencyAnalysis: combinedDependencyAnalysis,
    };

    setResults({ files: analysisResults, summary });
    setCurrentStep('완료!');
    
    setTimeout(() => {
      setScreen('results');
    }, 500);
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
          <p style={styles.uploadNote}>
            ⚡ node_modules, build, dist 폴더는 자동으로 제외됩니다
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

          <div style={styles.chartCardBar}>
            <div style={styles.chartTitleSection}>
              <h3 style={styles.chartTitle}>
                <span style={styles.chartIcon}>📈</span> 품질 지표 분석
              </h3>
              <p style={styles.chartHint}>* 각 항목에 마우스를 올려 설명을 확인하세요</p>
            </div>
            <div style={styles.barChartWrapper}>
              <div style={styles.barChartContainer}>
                {qualityBarData.map((item, index) => (
                  <TooltipBar key={index} item={item} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={styles.radarCard}>
          <h3 style={styles.chartTitle}>
            <span style={styles.chartIcon}>📡</span> 확장 메트릭 레이더
          </h3>
          <p style={styles.chartHint}>* 각 축 이름에 마우스를 올려 설명을 확인하세요</p>
          <div style={styles.radarChartWrapper}>
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis 
                  dataKey="subject" 
                  tick={<CustomAxisTick />}
                />
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
                <Tooltip content={<CustomRadarTooltip />} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 함수 의존성 다이어그램 */}
        <div style={styles.stateDiagramCard}>
          <h3 style={styles.chartTitle}>
            <span style={styles.chartIcon}>🔗</span> 상태 다이어그램 (State Diagram)
          </h3>
          <p style={styles.chartHint}>
            * 각 노드와 화살표에 마우스를 올려 상세 정보를 확인하세요. 
            화살표는 A → B (A가 B를 호출)를 의미하며, 숫자는 호출 횟수입니다.
          </p>
          <DependencyDiagram 
            dependencyAnalysis={results.summary.dependencyAnalysis} 
          />
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
    margin: '0 0 8px 0',
  },
  uploadNote: {
    color: '#9ca3af',
    fontSize: '12px',
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
  },
  chartCardBar: {
    padding: '24px',
    background: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
    border: '1px solid #f3f4f6',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '280px',
  },
  chartTitleSection: {
    marginBottom: '0',
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
  chartHint: {
    fontSize: '11px',
    color: '#9ca3af',
    margin: '8px 0 0 0',
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
  barChartWrapper: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barChartContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    width: '100%',
  },
  barRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  barLabelContainer: {
    position: 'relative',
    width: '100px',
    textAlign: 'right',
  },
  barLabel: {
    fontSize: '13px',
    color: '#4b5563',
    cursor: 'pointer',
    borderBottom: '1px dashed #9ca3af',
  },
  tooltip: {
    position: 'absolute',
    bottom: '100%',
    right: 0,
    marginBottom: '8px',
    background: '#1f2937',
    color: '#ffffff',
    padding: '10px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    lineHeight: '1.5',
    width: '200px',
    zIndex: 100,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  },
  barTrack: {
    flex: 1,
    height: '24px',
    background: '#f3f4f6',
    borderRadius: '4px',
    overflow: 'visible',
    position: 'relative',
    cursor: 'pointer',
  },
  barFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 1s ease-out',
  },
  barValueTooltip: {
    position: 'absolute',
    top: '-32px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#1f2937',
    color: '#ffffff',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '600',
    whiteSpace: 'nowrap',
    zIndex: 100,
  },
  radarCard: {
    maxWidth: '1200px',
    margin: '0 auto 24px',
    padding: '24px',
    background: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
    border: '1px solid #f3f4f6',
    overflow: 'visible',
  },
  radarChartWrapper: {
    padding: '20px 40px',
    overflow: 'visible',
  },
  radarTooltipBox: {
    background: '#1f2937',
    color: '#ffffff',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '500',
  },
  stateDiagramCard: {
    maxWidth: '1200px',
    margin: '0 auto 24px',
    padding: '24px',
    background: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
    border: '1px solid #f3f4f6',
    overflow: 'auto',
  },
  diagramContainer: {
    padding: '20px',
    minWidth: '850px',
  },
  diagramLegend: {
    display: 'flex',
    gap: '24px',
    marginTop: '20px',
    paddingTop: '16px',
    borderTop: '1px solid #e5e7eb',
    flexWrap: 'wrap',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#6b7280',
  },
  legendDot: {
    width: '14px',
    height: '14px',
    borderRadius: '4px',
  },
  legendBox: {
    width: '20px',
    height: '14px',
    borderRadius: '4px',
  },
  legendCircle: {
    width: '14px',
    height: '14px',
    borderRadius: '50%',
  },
  diagramTooltip: {
    background: '#1f2937',
    color: '#ffffff',
    padding: '10px 12px',
    borderRadius: '8px',
    fontSize: '11px',
    lineHeight: '1.5',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
    whiteSpace: 'pre-line',
  },
  emptyDiagram: {
    textAlign: 'center',
    padding: '40px',
    color: '#6b7280',
  },
  dependencyStats: {
    display: 'flex',
    gap: '32px',
    marginTop: '20px',
    paddingTop: '16px',
    borderTop: '1px solid #e5e7eb',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
  },
  statValue: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#6366f1',
  },
  statLabel: {
    fontSize: '12px',
    color: '#6b7280',
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