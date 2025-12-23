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
      stateAnalysis: {
        states: [],
        transitions: [],
        effects: [],
        renders: [],
      }
    };

    let currentComponent = null;
    const stateSetters = {};

    const traverse = (node, depth = 0, parentComponent = null) => {
      if (!node || typeof node !== 'object') return;
      
      analysis.complexity.depth = Math.max(analysis.complexity.depth, depth);

      if (node.type === 'FunctionDeclaration' && node.id?.name) {
        analysis.functions.push(node.id.name);
        analysis.metrics.wmc++;
        if (/^[A-Z]/.test(node.id.name)) {
          analysis.components.push(node.id.name);
          currentComponent = node.id.name;
          analysis.stateAnalysis.renders.push({
            component: node.id.name,
            type: 'FunctionComponent'
          });
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
              currentComponent = node.id.name;
              analysis.stateAnalysis.renders.push({
                component: node.id.name,
                type: 'FunctionComponent'
              });
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

        if (node.id?.type === 'ArrayPattern' && 
            node.init?.callee?.name === 'useState') {
          const stateName = node.id.elements?.[0]?.name;
          const setterName = node.id.elements?.[1]?.name;
          const initialValue = node.init.arguments?.[0];
          
          let initialValueStr = 'undefined';
          if (initialValue) {
            if (initialValue.type === 'StringLiteral') initialValueStr = `"${initialValue.value}"`;
            else if (initialValue.type === 'NumericLiteral') initialValueStr = String(initialValue.value);
            else if (initialValue.type === 'BooleanLiteral') initialValueStr = String(initialValue.value);
            else if (initialValue.type === 'NullLiteral') initialValueStr = 'null';
            else if (initialValue.type === 'ArrayExpression') initialValueStr = '[]';
            else if (initialValue.type === 'ObjectExpression') initialValueStr = '{}';
            else if (initialValue.type === 'ArrowFunctionExpression') initialValueStr = '() => ...';
          }

          if (stateName) {
            analysis.stateAnalysis.states.push({
              name: stateName,
              setter: setterName,
              initialValue: initialValueStr,
              component: currentComponent || 'Unknown',
            });
            if (setterName) {
              stateSetters[setterName] = stateName;
            }
          }
        }
      }

      if (node.type === 'CallExpression') {
        if (node.callee?.name?.startsWith('use')) {
          analysis.hooks.push(node.callee.name);
          
          if (node.callee.name === 'useEffect') {
            const deps = node.arguments?.[1]?.elements?.map(e => e?.name).filter(Boolean) || [];
            analysis.stateAnalysis.effects.push({
              component: currentComponent || 'Unknown',
              dependencies: deps,
              type: 'useEffect'
            });
          }
          
          if (node.callee.name === 'useCallback' || node.callee.name === 'useMemo') {
            const deps = node.arguments?.[1]?.elements?.map(e => e?.name).filter(Boolean) || [];
            analysis.stateAnalysis.effects.push({
              component: currentComponent || 'Unknown',
              dependencies: deps,
              type: node.callee.name
            });
          }
        }

        if (node.callee?.name && stateSetters[node.callee.name]) {
          const stateName = stateSetters[node.callee.name];
          let trigger = 'direct call';
          
          analysis.stateAnalysis.transitions.push({
            from: stateName,
            to: stateName,
            trigger: trigger,
            setter: node.callee.name,
            component: currentComponent || 'Unknown',
          });
        }
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
          child.forEach(c => traverse(c, depth + 1, currentComponent));
        } else if (child && typeof child === 'object') {
          traverse(child, depth + 1, currentComponent);
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

const StateDiagram = ({ stateAnalysis, components }) => {
  const [hoveredNode, setHoveredNode] = useState(null);
  
  const { states, transitions, effects } = stateAnalysis;
  
  const nodeWidth = 140;
  const nodeHeight = 50;
  const padding = 40;
  
  const diagramNodes = [];
  const diagramEdges = [];
  
  diagramNodes.push({
    id: 'start',
    type: 'start',
    label: '시작',
    x: padding,
    y: 150,
    description: '컴포넌트가 마운트되기 전 초기 상태입니다.'
  });
  
  diagramNodes.push({
    id: 'mount',
    type: 'lifecycle',
    label: '컴포넌트 마운트',
    x: padding + 100,
    y: 150,
    description: '컴포넌트가 DOM에 삽입되는 단계입니다. useEffect의 setup 함수가 실행됩니다.'
  });
  
  diagramEdges.push({
    from: 'start',
    to: 'mount',
    label: '초기화'
  });
  
  const groupedStates = {};
  states.forEach(state => {
    if (!groupedStates[state.component]) {
      groupedStates[state.component] = [];
    }
    groupedStates[state.component].push(state);
  });
  
  let yOffset = 60;
  let stateIndex = 0;
  
  Object.entries(groupedStates).forEach(([component, componentStates], groupIndex) => {
    const groupStartX = padding + 280;
    const groupWidth = Math.max(300, componentStates.length * 180);
    
    diagramNodes.push({
      id: `group-${component}`,
      type: 'group',
      label: component,
      x: groupStartX - 20,
      y: yOffset - 30,
      width: groupWidth,
      height: componentStates.length > 2 ? 200 : 150,
      description: `${component} 컴포넌트의 상태 관리 영역입니다.`
    });
    
    componentStates.forEach((state, idx) => {
      const xPos = groupStartX + (idx % 2) * 160;
      const yPos = yOffset + Math.floor(idx / 2) * 80 + 20;
      
      diagramNodes.push({
        id: `state-${state.name}`,
        type: 'state',
        label: state.name,
        sublabel: `초기값: ${state.initialValue}`,
        x: xPos,
        y: yPos,
        setter: state.setter,
        description: `useState로 관리되는 상태입니다.\n• 상태명: ${state.name}\n• setter: ${state.setter}\n• 초기값: ${state.initialValue}`
      });
      
      if (idx === 0) {
        diagramEdges.push({
          from: 'mount',
          to: `state-${state.name}`,
          label: '상태 초기화'
        });
      }
      
      stateIndex++;
    });
    
    yOffset += componentStates.length > 2 ? 220 : 170;
  });
  
  transitions.forEach((transition, idx) => {
    const existingEdge = diagramEdges.find(
      e => e.from === `state-${transition.from}` && e.to === `state-${transition.to}` && e.isSelfLoop
    );
    
    if (!existingEdge) {
      diagramEdges.push({
        from: `state-${transition.from}`,
        to: `state-${transition.to}`,
        label: transition.setter,
        isSelfLoop: transition.from === transition.to,
        description: `${transition.setter}() 호출로 상태가 업데이트됩니다.`
      });
    }
  });
  
  effects.forEach((effect, idx) => {
    if (effect.dependencies.length > 0) {
      effect.dependencies.forEach(dep => {
        const stateNode = diagramNodes.find(n => n.id === `state-${dep}`);
        if (stateNode) {
          diagramEdges.push({
            from: `state-${dep}`,
            to: `effect-${idx}`,
            label: '의존성',
            isEffect: true
          });
        }
      });
      
      diagramNodes.push({
        id: `effect-${idx}`,
        type: 'effect',
        label: effect.type,
        x: padding + 600,
        y: 80 + idx * 70,
        description: `${effect.type} 훅입니다.\n의존성: [${effect.dependencies.join(', ')}]\n의존성 배열의 값이 변경될 때 실행됩니다.`
      });
    }
  });
  
  const renderActions = [];
  states.forEach(state => {
    renderActions.push({
      stateName: state.name,
      action: '리렌더링 트리거'
    });
  });
  
  if (renderActions.length > 0) {
    diagramNodes.push({
      id: 'render',
      type: 'lifecycle',
      label: '리렌더링',
      x: padding + 600,
      y: 280,
      description: '상태가 변경되면 컴포넌트가 리렌더링됩니다.\nReact는 Virtual DOM을 비교하여 실제 DOM을 효율적으로 업데이트합니다.'
    });
    
    states.forEach(state => {
      diagramEdges.push({
        from: `state-${state.name}`,
        to: 'render',
        label: '상태 변경',
        isDashed: true
      });
    });
  }
  
  diagramNodes.push({
    id: 'unmount',
    type: 'end',
    label: '언마운트',
    x: padding + 750,
    y: 150,
    description: '컴포넌트가 DOM에서 제거되는 단계입니다.\nuseEffect의 cleanup 함수가 실행됩니다.'
  });
  
  diagramEdges.push({
    from: 'render',
    to: 'unmount',
    label: '컴포넌트 제거',
    isDashed: true
  });

  const svgWidth = 900;
  const svgHeight = Math.max(400, yOffset + 100);

  const getNodeCenter = (node) => {
    if (node.type === 'start' || node.type === 'end') {
      return { x: node.x + 15, y: node.y + 15 };
    }
    return { x: node.x + nodeWidth / 2, y: node.y + nodeHeight / 2 };
  };

  const renderEdge = (edge, idx) => {
    const fromNode = diagramNodes.find(n => n.id === edge.from);
    const toNode = diagramNodes.find(n => n.id === edge.to);
    
    if (!fromNode || !toNode) return null;
    
    const from = getNodeCenter(fromNode);
    const to = getNodeCenter(toNode);
    
    if (edge.isSelfLoop) {
      const loopPath = `M ${from.x + 40} ${from.y - 20} 
                        C ${from.x + 80} ${from.y - 60} 
                          ${from.x + 80} ${from.y + 60} 
                          ${from.x + 40} ${from.y + 20}`;
      return (
        <g key={idx}>
          <path
            d={loopPath}
            fill="none"
            stroke="#6366f1"
            strokeWidth="2"
            markerEnd="url(#arrowhead)"
          />
          <text
            x={from.x + 90}
            y={from.y}
            fontSize="10"
            fill="#6366f1"
            textAnchor="start"
          >
            {edge.label}
          </text>
        </g>
      );
    }
    
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    
    return (
      <g key={idx}>
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={edge.isEffect ? '#22c55e' : edge.isDashed ? '#9ca3af' : '#6366f1'}
          strokeWidth="2"
          strokeDasharray={edge.isDashed ? '5,5' : 'none'}
          markerEnd="url(#arrowhead)"
        />
        {edge.label && (
          <text
            x={midX}
            y={midY - 8}
            fontSize="10"
            fill="#6b7280"
            textAnchor="middle"
            style={{ background: '#ffffff' }}
          >
            {edge.label}
          </text>
        )}
      </g>
    );
  };

  const renderNode = (node) => {
    const isHovered = hoveredNode === node.id;
    
    if (node.type === 'start') {
      return (
        <g 
          key={node.id}
          onMouseEnter={() => setHoveredNode(node.id)}
          onMouseLeave={() => setHoveredNode(null)}
          style={{ cursor: 'pointer' }}
        >
          <circle
            cx={node.x + 15}
            cy={node.y + 15}
            r="15"
            fill="#1f2937"
          />
          {isHovered && (
            <foreignObject x={node.x - 50} y={node.y + 40} width="150" height="60">
              <div style={styles.diagramTooltip}>{node.description}</div>
            </foreignObject>
          )}
        </g>
      );
    }
    
    if (node.type === 'end') {
      return (
        <g 
          key={node.id}
          onMouseEnter={() => setHoveredNode(node.id)}
          onMouseLeave={() => setHoveredNode(null)}
          style={{ cursor: 'pointer' }}
        >
          <circle
            cx={node.x + 15}
            cy={node.y + 15}
            r="15"
            fill="none"
            stroke="#1f2937"
            strokeWidth="3"
          />
          <circle
            cx={node.x + 15}
            cy={node.y + 15}
            r="10"
            fill="#1f2937"
          />
          <text
            x={node.x + 15}
            y={node.y + 45}
            fontSize="11"
            fill="#374151"
            textAnchor="middle"
          >
            {node.label}
          </text>
          {isHovered && (
            <foreignObject x={node.x - 50} y={node.y + 55} width="150" height="80">
              <div style={styles.diagramTooltip}>{node.description}</div>
            </foreignObject>
          )}
        </g>
      );
    }
    
    if (node.type === 'group') {
      return (
        <g key={node.id}>
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            fill="#f8fafc"
            stroke="#e5e7eb"
            strokeWidth="1"
            rx="8"
          />
          <text
            x={node.x + 10}
            y={node.y + 20}
            fontSize="12"
            fill="#6b7280"
            fontWeight="600"
          >
            {node.label}
          </text>
        </g>
      );
    }
    
    if (node.type === 'state') {
      return (
        <g 
          key={node.id}
          onMouseEnter={() => setHoveredNode(node.id)}
          onMouseLeave={() => setHoveredNode(null)}
          style={{ cursor: 'pointer' }}
        >
          <rect
            x={node.x}
            y={node.y}
            width={nodeWidth}
            height={nodeHeight}
            fill={isHovered ? '#dbeafe' : '#3b82f6'}
            stroke={isHovered ? '#3b82f6' : '#2563eb'}
            strokeWidth="2"
            rx="8"
          />
          <text
            x={node.x + nodeWidth / 2}
            y={node.y + 20}
            fontSize="12"
            fill={isHovered ? '#1e40af' : '#ffffff'}
            textAnchor="middle"
            fontWeight="600"
          >
            {node.label}
          </text>
          <text
            x={node.x + nodeWidth / 2}
            y={node.y + 38}
            fontSize="10"
            fill={isHovered ? '#3b82f6' : '#bfdbfe'}
            textAnchor="middle"
          >
            {node.sublabel}
          </text>
          {isHovered && (
            <foreignObject x={node.x} y={node.y + nodeHeight + 10} width="180" height="100">
              <div style={styles.diagramTooltip}>{node.description}</div>
            </foreignObject>
          )}
        </g>
      );
    }
    
    if (node.type === 'lifecycle') {
      return (
        <g 
          key={node.id}
          onMouseEnter={() => setHoveredNode(node.id)}
          onMouseLeave={() => setHoveredNode(null)}
          style={{ cursor: 'pointer' }}
        >
          <rect
            x={node.x}
            y={node.y}
            width={nodeWidth}
            height={nodeHeight}
            fill={isHovered ? '#fef3c7' : '#fbbf24'}
            stroke={isHovered ? '#f59e0b' : '#d97706'}
            strokeWidth="2"
            rx="8"
          />
          <text
            x={node.x + nodeWidth / 2}
            y={node.y + nodeHeight / 2 + 4}
            fontSize="12"
            fill={isHovered ? '#92400e' : '#ffffff'}
            textAnchor="middle"
            fontWeight="600"
          >
            {node.label}
          </text>
          {isHovered && (
            <foreignObject x={node.x - 20} y={node.y + nodeHeight + 10} width="200" height="100">
              <div style={styles.diagramTooltip}>{node.description}</div>
            </foreignObject>
          )}
        </g>
      );
    }
    
    if (node.type === 'effect') {
      return (
        <g 
          key={node.id}
          onMouseEnter={() => setHoveredNode(node.id)}
          onMouseLeave={() => setHoveredNode(null)}
          style={{ cursor: 'pointer' }}
        >
          <rect
            x={node.x}
            y={node.y}
            width={nodeWidth - 20}
            height={nodeHeight - 10}
            fill={isHovered ? '#dcfce7' : '#22c55e'}
            stroke={isHovered ? '#22c55e' : '#16a34a'}
            strokeWidth="2"
            rx="8"
          />
          <text
            x={node.x + (nodeWidth - 20) / 2}
            y={node.y + (nodeHeight - 10) / 2 + 4}
            fontSize="11"
            fill={isHovered ? '#166534' : '#ffffff'}
            textAnchor="middle"
            fontWeight="600"
          >
            {node.label}
          </text>
          {isHovered && (
            <foreignObject x={node.x - 20} y={node.y + nodeHeight} width="180" height="80">
              <div style={styles.diagramTooltip}>{node.description}</div>
            </foreignObject>
          )}
        </g>
      );
    }
    
    return null;
  };

  if (states.length === 0) {
    return (
      <div style={styles.emptyDiagram}>
        <p>📭 분석된 상태(useState)가 없습니다.</p>
        <p style={{ fontSize: '13px', color: '#9ca3af' }}>
          useState를 사용하는 React 컴포넌트를 분석하면 상태 다이어그램이 생성됩니다.
        </p>
      </div>
    );
  }

  return (
    <div style={styles.diagramContainer}>
      <svg width={svgWidth} height={svgHeight} style={{ overflow: 'visible' }}>
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1" />
          </marker>
        </defs>
        
        {diagramNodes.filter(n => n.type === 'group').map(renderNode)}
        {diagramEdges.map(renderEdge)}
        {diagramNodes.filter(n => n.type !== 'group').map(renderNode)}
      </svg>
      
      <div style={styles.diagramLegend}>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendDot, background: '#1f2937' }}></div>
          <span>시작/종료</span>
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendDot, background: '#3b82f6' }}></div>
          <span>상태 (useState)</span>
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendDot, background: '#fbbf24' }}></div>
          <span>라이프사이클</span>
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendDot, background: '#22c55e' }}></div>
          <span>Effect (useEffect)</span>
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
    
    const combinedStateAnalysis = {
      states: [],
      transitions: [],
      effects: [],
      renders: [],
    };
    
    validResults.forEach(r => {
      if (r.stateAnalysis) {
        combinedStateAnalysis.states.push(...r.stateAnalysis.states);
        combinedStateAnalysis.transitions.push(...r.stateAnalysis.transitions);
        combinedStateAnalysis.effects.push(...r.stateAnalysis.effects);
        combinedStateAnalysis.renders.push(...r.stateAnalysis.renders);
      }
    });
    
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
      stateAnalysis: combinedStateAnalysis,
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

        <div style={styles.stateDiagramCard}>
          <h3 style={styles.chartTitle}>
            <span style={styles.chartIcon}>🔄</span> 상태 다이어그램 (State Diagram)
          </h3>
          <p style={styles.chartHint}>* 각 노드에 마우스를 올려 상세 설명을 확인하세요. 상태(useState)의 흐름과 라이프사이클을 시각화합니다.</p>
          <StateDiagram 
            stateAnalysis={results.summary.stateAnalysis} 
            components={results.summary.totalComponents}
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