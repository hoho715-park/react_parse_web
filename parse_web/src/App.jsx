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
      },
      // 응집도 분석을 위한 구조
      cohesionAnalysis: {
        components: [], // 각 컴포넌트/클래스의 응집도 정보
      }
    };

    let currentFunction = null;
    const functionDependencies = {};
    const allDefinedFunctions = new Set();
    const functionTypes = {}; // 함수 타입 저장 (component, handler, helper)

    // 응집도 분석을 위한 데이터 구조
    const componentMethods = {}; // 컴포넌트별 내부 메서드
    const methodSharedState = {}; // 메서드별 사용하는 상태/변수
    const methodCalls = {}; // 메서드 간 호출 관계
    let currentComponent = null;

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
          // 응집도 분석: 컴포넌트 등록
          currentComponent = funcName;
          componentMethods[funcName] = [];
        } else if (/^(handle|on)[A-Z]/.test(funcName)) {
          analysis.eventHandlers.push(funcName);
          functionTypes[funcName] = 'handler';
          // 응집도 분석: 현재 컴포넌트의 메서드로 등록
          if (currentComponent && componentMethods[currentComponent]) {
            componentMethods[currentComponent].push(funcName);
            methodSharedState[funcName] = new Set();
            methodCalls[funcName] = new Set();
          }
        } else {
          functionTypes[funcName] = 'helper';
          // 응집도 분석: 현재 컴포넌트의 메서드로 등록
          if (currentComponent && componentMethods[currentComponent]) {
            componentMethods[currentComponent].push(funcName);
            methodSharedState[funcName] = new Set();
            methodCalls[funcName] = new Set();
          }
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
              // 응집도 분석: 컴포넌트 등록
              currentComponent = funcName;
              componentMethods[funcName] = [];
            } else if (/^(handle|on)[A-Z]/.test(funcName)) {
              analysis.eventHandlers.push(funcName);
              functionTypes[funcName] = 'handler';
              // 응집도 분석: 현재 컴포넌트의 메서드로 등록
              if (currentComponent && componentMethods[currentComponent]) {
                componentMethods[currentComponent].push(funcName);
                methodSharedState[funcName] = new Set();
                methodCalls[funcName] = new Set();
              }
            } else {
              functionTypes[funcName] = 'helper';
              // 응집도 분석: 현재 컴포넌트의 메서드로 등록
              if (currentComponent && componentMethods[currentComponent]) {
                componentMethods[currentComponent].push(funcName);
                methodSharedState[funcName] = new Set();
                methodCalls[funcName] = new Set();
              }
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
            // 응집도 분석: 현재 메서드가 사용하는 상태 추적
            if (currentFunction && methodSharedState[currentFunction]) {
              methodSharedState[currentFunction].add(node.id.name);
            }
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
            // 응집도 분석: useState 등의 상태 추적
            if (currentFunction && methodSharedState[currentFunction]) {
              methodSharedState[currentFunction].add(`hook:${calleeName}`);
            }
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

              // 응집도 분석: 메서드 간 호출 관계 추적
              if (methodCalls[currentFunction]) {
                methodCalls[currentFunction].add(calleeName);
              }
            }

            // 응집도 분석: setState 호출 시 상태 공유로 간주
            if (isSetState) {
              if (currentFunction && methodSharedState[currentFunction]) {
                methodSharedState[currentFunction].add(`state:${calleeName}`);
              }
            }
          }
        }
      }

      // 응집도 분석: Identifier를 통한 상태/변수 참조 추적
      if (node.type === 'Identifier' && currentFunction && methodSharedState[currentFunction]) {
        const name = node.name;
        // 상태 변수 참조 패턴 (소문자로 시작하고 일반적인 상태명 패턴)
        if (name && !name.startsWith('set') && /^[a-z]/.test(name)) {
          // 일반적인 키워드 제외
          const keywords = ['true', 'false', 'null', 'undefined', 'this', 'props', 'state', 'e', 'event', 'err', 'error', 'i', 'j', 'k', 'index', 'key', 'value', 'item', 'data', 'result', 'response', 'res', 'req'];
          if (!keywords.includes(name) && name.length > 1) {
            methodSharedState[currentFunction].add(`var:${name}`);
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

    // LCOM4 응집도 계산
    const calculateLCOM4 = (componentName, methods) => {
      if (methods.length === 0) {
        return { lcom4: 1, connectedComponents: [], methodConnections: [] };
      }

      if (methods.length === 1) {
        return {
          lcom4: 1,
          connectedComponents: [[methods[0]]],
          methodConnections: [],
          methods: methods.map(m => ({
            name: m,
            sharedState: Array.from(methodSharedState[m] || []),
            calls: Array.from(methodCalls[m] || [])
          }))
        };
      }

      // 메서드 간 연결 그래프 구축
      const graph = {};
      const methodConnectionsList = [];
      methods.forEach(m => { graph[m] = new Set(); });

      // 같은 상태를 공유하거나 서로 호출하는 메서드 연결
      for (let i = 0; i < methods.length; i++) {
        for (let j = i + 1; j < methods.length; j++) {
          const m1 = methods[i];
          const m2 = methods[j];
          const state1 = methodSharedState[m1] || new Set();
          const state2 = methodSharedState[m2] || new Set();
          const calls1 = methodCalls[m1] || new Set();
          const calls2 = methodCalls[m2] || new Set();

          // 공유 상태 확인
          const sharedState = [...state1].filter(s => state2.has(s));
          const hasSharedState = sharedState.length > 0;

          // 호출 관계 확인
          const callsEachOther = calls1.has(m2) || calls2.has(m1);

          if (hasSharedState || callsEachOther) {
            graph[m1].add(m2);
            graph[m2].add(m1);
            methodConnectionsList.push({
              from: m1,
              to: m2,
              reason: hasSharedState ? 'shared_state' : 'method_call',
              sharedState: sharedState
            });
          }
        }
      }

      // BFS로 연결 요소 찾기
      const visited = new Set();
      const connectedComponents = [];

      methods.forEach(method => {
        if (!visited.has(method)) {
          const component = [];
          const queue = [method];
          visited.add(method);

          while (queue.length > 0) {
            const current = queue.shift();
            component.push(current);

            graph[current].forEach(neighbor => {
              if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
              }
            });
          }
          connectedComponents.push(component);
        }
      });

      return {
        lcom4: connectedComponents.length,
        connectedComponents,
        methodConnections: methodConnectionsList,
        methods: methods.map(m => ({
          name: m,
          sharedState: Array.from(methodSharedState[m] || []),
          calls: Array.from(methodCalls[m] || [])
        }))
      };
    };

    // 각 컴포넌트의 응집도 계산
    Object.entries(componentMethods).forEach(([componentName, methods]) => {
      const cohesionData = calculateLCOM4(componentName, methods);
      analysis.cohesionAnalysis.components.push({
        name: componentName,
        type: functionTypes[componentName] || 'component',
        methodCount: methods.length,
        ...cohesionData
      });
    });

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

// 리팩토링 프롬프트 생성 함수
const generateRefactoringPrompt = (results, projectName = 'React Project') => {
  if (!results || !results.summary) return '';

  const { summary, files } = results;

  // 문제가 있는 파일 식별 (품질 점수 70 미만)
  const problematicFiles = files.filter(f => !f.error && f.qualityScore < 70);

  // 각 지표별 문제 분석
  const issues = [];
  const refactoringGuidelines = [];

  // 1. 복잡도 분석
  const highComplexityFiles = files.filter(f => !f.error && f.metrics?.cyclomaticComplexity > 10);
  if (highComplexityFiles.length > 0 || summary.avgCyclomaticComplexity > 8) {
    issues.push({
      metric: '순환 복잡도 (Cyclomatic Complexity)',
      value: summary.avgCyclomaticComplexity,
      threshold: 10,
      status: 'high',
      reason: `평균 순환 복잡도가 ${summary.avgCyclomaticComplexity}로, 조건문과 반복문이 과도하게 중첩되어 있습니다.`,
      affectedFiles: highComplexityFiles.map(f => ({
        name: f.filename,
        value: f.metrics.cyclomaticComplexity,
        functions: f.functions?.slice(0, 5) || []
      }))
    });
    refactoringGuidelines.push('복잡한 조건문을 별도 함수로 추출');
    refactoringGuidelines.push('중첩된 if문을 early return 패턴으로 변경');
    refactoringGuidelines.push('switch문이 긴 경우 전략 패턴 또는 객체 매핑 고려');
  }

  // 2. 파일 크기 분석
  const largeFiles = files.filter(f => !f.error && f.loc > 300);
  if (largeFiles.length > 0) {
    issues.push({
      metric: '파일 크기 (Lines of Code)',
      value: summary.totalLOC,
      threshold: 300,
      status: largeFiles.some(f => f.loc > 500) ? 'critical' : 'warning',
      reason: `${largeFiles.length}개 파일이 300줄을 초과하여 단일 책임 원칙(SRP)을 위반할 가능성이 높습니다.`,
      affectedFiles: largeFiles.map(f => ({
        name: f.filename,
        value: f.loc,
        components: f.components || []
      }))
    });
    refactoringGuidelines.push('하나의 파일에 여러 컴포넌트가 있다면 별도 파일로 분리');
    refactoringGuidelines.push('유틸리티 함수를 별도 모듈로 추출');
  }

  // 3. 이벤트 핸들러 분석
  const heavyHandlerFiles = files.filter(f => !f.error && (f.eventHandlers?.length || 0) > 5);
  if (summary.totalEventHandlers > 10 || heavyHandlerFiles.length > 0) {
    issues.push({
      metric: '이벤트 핸들러 집중도',
      value: summary.totalEventHandlers,
      threshold: 10,
      status: 'warning',
      reason: `이벤트 핸들러가 ${summary.totalEventHandlers}개로, 컴포넌트가 너무 많은 상호작용을 담당합니다.`,
      affectedFiles: heavyHandlerFiles.map(f => ({
        name: f.filename,
        value: f.eventHandlers.length,
        handlers: f.eventHandlers
      }))
    });
    refactoringGuidelines.push('이벤트 핸들러 내 비즈니스 로직을 커스텀 훅으로 추출');
    refactoringGuidelines.push('복잡한 핸들러는 useCallback으로 감싸고 의존성 최소화');
  }

  // 4. 유지보수 지수 분석
  const lowMIFiles = files.filter(f => !f.error && (f.metrics?.maintainabilityIndex || 100) < 50);
  if (summary.avgMaintainabilityIndex < 60 || lowMIFiles.length > 0) {
    issues.push({
      metric: '유지보수 지수 (Maintainability Index)',
      value: summary.avgMaintainabilityIndex,
      threshold: 60,
      status: summary.avgMaintainabilityIndex < 40 ? 'critical' : 'warning',
      reason: `평균 유지보수 지수가 ${summary.avgMaintainabilityIndex}로, 코드 이해와 수정이 어렵습니다.`,
      affectedFiles: lowMIFiles.map(f => ({
        name: f.filename,
        value: f.metrics.maintainabilityIndex
      }))
    });
    refactoringGuidelines.push('긴 함수를 의미 단위로 분리');
    refactoringGuidelines.push('매직 넘버를 명명된 상수로 변경');
    refactoringGuidelines.push('주석이 필요한 복잡한 로직은 함수명으로 의도 표현');
  }

  // 5. 응집도 분석 (LCOM4)
  const lowCohesionComponents = summary.cohesionAnalysis?.components?.filter(c => c.lcom4 >= 3) || [];
  if (lowCohesionComponents.length > 0) {
    issues.push({
      metric: '응집도 (LCOM4)',
      value: lowCohesionComponents.length,
      threshold: 0,
      status: 'warning',
      reason: `${lowCohesionComponents.length}개 컴포넌트의 응집도가 낮아 여러 책임이 혼재되어 있습니다.`,
      affectedFiles: lowCohesionComponents.map(c => ({
        name: c.name,
        value: c.lcom4,
        methods: c.methods?.map(m => m.name) || []
      }))
    });
    refactoringGuidelines.push('관련 없는 메서드들을 별도 컴포넌트나 훅으로 분리');
    refactoringGuidelines.push('상태와 관련 로직을 커스텀 훅으로 추출');
  }

  // 6. 보안 이슈 분석
  const securityIssueFiles = files.filter(f => !f.error && (f.issues?.length || 0) > 0);
  if (summary.totalIssues > 0) {
    issues.push({
      metric: '보안 이슈',
      value: summary.totalIssues,
      threshold: 0,
      status: 'critical',
      reason: `${summary.totalIssues}개의 잠재적 보안 취약점이 발견되었습니다.`,
      affectedFiles: securityIssueFiles.map(f => ({
        name: f.filename,
        issues: f.issues
      }))
    });
    refactoringGuidelines.push('dangerouslySetInnerHTML 사용 시 DOMPurify로 새니타이징');
    refactoringGuidelines.push('eval() 사용을 안전한 대안으로 교체');
  }

  // 문제가 없으면 빈 문자열 반환
  if (issues.length === 0) {
    return '';
  }

  // 프롬프트 생성
  let prompt = `당신은 코드 품질 개선 전용 리팩토링 AI입니다.

## 안전 제약 조건 (반드시 준수)
- 기능 변경 금지: 모든 기존 기능이 동일하게 동작해야 합니다
- 외부 API/인터페이스 변경 금지: props, 함수 시그니처, export 유지
- 동작 동일성 100% 유지: 리팩토링 전후 동작이 완전히 동일해야 함
- 구조적 리팩토링만 허용: 코드 구조 개선만 수행

## 프로젝트 정보
- 프로젝트명: ${projectName}
- 전체 코드 품질 점수: ${summary.avgQualityScore}/100점
- 분석된 파일 수: ${summary.totalFiles}개
- 총 코드 라인: ${summary.totalLOC}줄

## 발견된 품질 문제

`;

  issues.forEach((issue, index) => {
    prompt += `### ${index + 1}. ${issue.metric}
- 현재 값: ${issue.value}
- 기준값: ${issue.threshold}
- 상태: ${issue.status === 'critical' ? '심각' : issue.status === 'high' ? '높음' : '주의'}
- 문제 요약: ${issue.reason}

영향받는 파일/컴포넌트:
`;
    issue.affectedFiles.forEach(file => {
      prompt += `- ${file.name}`;
      if (file.value !== undefined) prompt += ` (값: ${file.value})`;
      if (file.functions?.length > 0) prompt += `\n  함수: ${file.functions.join(', ')}`;
      if (file.handlers?.length > 0) prompt += `\n  핸들러: ${file.handlers.join(', ')}`;
      if (file.methods?.length > 0) prompt += `\n  메서드: ${file.methods.join(', ')}`;
      if (file.issues?.length > 0) prompt += `\n  이슈: ${file.issues.map(i => i.message).join(', ')}`;
      prompt += '\n';
    });
    prompt += '\n';
  });

  prompt += `## 적용해야 할 리팩토링 지침
`;
  [...new Set(refactoringGuidelines)].forEach((guideline, index) => {
    prompt += `${index + 1}. ${guideline}\n`;
  });

  prompt += `
## 출력 형식 (반드시 준수)
- 수정된 전체 코드만 출력하세요
- 설명 문구 출력 금지
- 코드 블록 외 텍스트 출력 금지
- 각 파일은 파일명 주석으로 구분: // filename.jsx

## 리팩토링 대상 코드
아래에 리팩토링이 필요한 코드를 붙여넣으세요:

\`\`\`jsx
// 여기에 코드를 붙여넣으세요
\`\`\`
`;

  return prompt;
};

// 코드 스니펫 추출 함수 (선택된 파일의 주요 문제 부분)
const extractCodeSnippet = (file, maxLines = 50) => {
  // 실제 구현에서는 파일 내용을 기반으로 문제 부분을 추출
  // 현재는 파일 정보만 반환
  return {
    filename: file.filename,
    summary: {
      loc: file.loc,
      functions: file.functions?.slice(0, 10) || [],
      eventHandlers: file.eventHandlers || [],
      components: file.components || [],
      complexity: file.metrics?.cyclomaticComplexity || 0
    }
  };
};

const CircularGauge = ({ score }) => {
  const [animatedScore, setAnimatedScore] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  // 점수 애니메이션
  useState(() => {
    setIsVisible(true);
    const duration = 1500;
    const steps = 60;
    const increment = score / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= score) {
        setAnimatedScore(score);
        clearInterval(timer);
      } else {
        setAnimatedScore(Math.round(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  });

  const radius = 85;
  const strokeWidth = 12;
  const circumference = 2 * Math.PI * radius;
  const totalArc = circumference * 0.75; // 270도 호
  const progress = (animatedScore / 100) * totalArc;
  const remaining = totalArc - progress;

  // 품질 스케일 데이터 (낮은 품질 → 높은 품질: CRITICAL → VERY LOW)
  // 색상: 빨강 → 주황 → 노랑 → 초록 → 파랑
  const qualityLevels = [
    { label: 'CRITICAL', color: '#ef4444', range: [0, 19], message: '즉각적인 리팩토링이 필요합니다.' },
    { label: 'HIGH', color: '#f97316', range: [20, 39], message: '유지보수를 위해 개선이 권장됩니다.' },
    { label: 'MEDIUM', color: '#eab308', range: [40, 59], message: '일부 개선이 필요한 코드 품질입니다.' },
    { label: 'LOW', color: '#22c55e', range: [60, 79], message: '코드 품질이 안정적인 상태입니다.' },
    { label: 'VERY LOW', color: '#3b82f6', range: [80, 100], message: '전반적으로 코드 품질이 매우 우수합니다.' },
  ];

  // 점수에 해당하는 품질 레벨 찾기
  const getCurrentLevel = (score) => {
    for (const level of qualityLevels) {
      if (score >= level.range[0] && score <= level.range[1]) {
        return level;
      }
    }
    return qualityLevels[0];
  };

  const currentLevel = getCurrentLevel(score);

  // 점수를 퍼센트 위치로 변환 (0점 = 0%, 100점 = 100%)
  const pointerPosition = score;

  return (
    <div style={styles.gaugeWrapper}>
      {/* 원형 게이지 섹션 */}
      <div style={{
        ...styles.premiumGaugeContainer,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(10px)',
      }}>
        <svg width="160" height="160" viewBox="0 0 220 220" style={{ position: 'relative', zIndex: 1 }}>
          <defs>
            <filter id="gaugeShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={currentLevel.color} floodOpacity="0.25"/>
            </filter>
          </defs>

          {/* 잔여 영역 (회색 트랙) - 전체 호 */}
          <path
            d="M 110 195 A 85 85 0 1 1 110 25"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeOpacity={0.5}
          />

          {/* 점수 바 (채워진 영역) */}
          <path
            d="M 110 195 A 85 85 0 1 1 110 25"
            fill="none"
            stroke={currentLevel.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${progress} ${circumference}`}
            filter="url(#gaugeShadow)"
            style={{ transition: 'stroke-dasharray 1.5s cubic-bezier(0.4, 0, 0.2, 1)' }}
          />
        </svg>

        {/* 중앙 점수 표시 */}
        <div style={styles.gaugeScoreCenter}>
          <span style={{
            ...styles.premiumGaugeNumber,
            color: currentLevel.color,
          }}>
            {animatedScore}
          </span>
          <span style={{
            ...styles.premiumGaugeMax,
            color: currentLevel.color,
            opacity: 0.6,
          }}>/100</span>
        </div>
      </div>

      {/* 품질 수준 인디케이터 */}
      <div style={styles.riskMeterContainer}>
        <div style={styles.riskMeterBar}>
          {qualityLevels.map((level, index) => (
            <div
              key={level.label}
              style={{
                ...styles.riskMeterSegment,
                background: level.color,
                borderRadius: index === 0 ? '4px 0 0 4px' : index === qualityLevels.length - 1 ? '0 4px 4px 0' : '0',
              }}
            />
          ))}
          {/* 포인터 */}
          <div style={{
            ...styles.riskMeterPointer,
            left: `${pointerPosition}%`,
          }}>
            <div style={{
              ...styles.riskMeterArrow,
              borderTopColor: currentLevel.color,
            }} />
            <div style={{
              ...styles.riskMeterPointerLabel,
              background: currentLevel.color,
            }}>
              {animatedScore}
            </div>
          </div>
        </div>
        <div style={styles.riskMeterLabels}>
          {qualityLevels.map((level) => (
            <span
              key={level.label}
              style={{
                ...styles.riskMeterLabel,
                color: level.label === currentLevel.label ? currentLevel.color : '#9ca3af',
                fontWeight: level.label === currentLevel.label ? '700' : '500',
              }}
            >
              {level.label}
            </span>
          ))}
        </div>

        {/* 한 줄 평 */}
        <div style={{
          ...styles.qualitySummaryText,
          color: currentLevel.color,
        }}>
          {currentLevel.message}
        </div>
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
            <h4 style={styles.modalSubtitle}>📈 점수 해석 (위험 수준)</h4>
            <div style={styles.scoreGuide}>
              <div style={styles.scoreRow}><span style={{...styles.scoreDot, background: '#3b82f6'}}></span> 80-100점 (VERY LOW): 매우 우수한 코드 품질</div>
              <div style={styles.scoreRow}><span style={{...styles.scoreDot, background: '#22c55e'}}></span> 60-79점 (LOW): 안정적인 코드 품질</div>
              <div style={styles.scoreRow}><span style={{...styles.scoreDot, background: '#eab308'}}></span> 40-59점 (MEDIUM): 일부 개선 필요</div>
              <div style={styles.scoreRow}><span style={{...styles.scoreDot, background: '#f97316'}}></span> 20-39점 (HIGH): 개선 권장</div>
              <div style={styles.scoreRow}><span style={{...styles.scoreDot, background: '#ef4444'}}></span> 0-19점 (CRITICAL): 즉시 리팩토링 필요</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const PremiumMetricCard = ({ item, index }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [animatedValue, setAnimatedValue] = useState(0);

  // 값 애니메이션
  useState(() => {
    const duration = 1000;
    const steps = 40;
    const increment = item.value / steps;
    let current = 0;
    const delay = index * 150;
    setTimeout(() => {
      const timer = setInterval(() => {
        current += increment;
        if (current >= item.value) {
          setAnimatedValue(item.value);
          clearInterval(timer);
        } else {
          setAnimatedValue(Math.round(current));
        }
      }, duration / steps);
    }, delay);
  });

  // 지표별 상세 설정 (쉬운 설명 + 해석 + 가이드 중심 문구)
  const metricConfig = {
    '함수 복잡도': {
      icon: '🔄',
      simpleDesc: '함수 안에 조건문과 반복문이 얼마나 복잡하게 얽혀 있는지를 나타냅니다.',
      interpretation: '점수가 낮을수록 코드 흐름을 이해하고 수정하기 어렵습니다.',
      tooltipProblem: '복잡도가 높으면 버그 발생 가능성이 높아지고, 새로운 기능 추가 시 예상치 못한 오류가 생길 수 있습니다.',
      statusText: (v) => v >= 70
        ? '코드 흐름이 명확하고 이해하기 쉽습니다'
        : v >= 40
          ? '일부 함수의 로직을 단순화하면 가독성이 향상됩니다'
          : '함수를 작은 단위로 분리하면 유지보수가 훨씬 쉬워집니다',
      gradient: ['#ec4899', '#f472b6'],
    },
    '변수 관리': {
      icon: '📦',
      simpleDesc: '변수가 선언되고 사용되는 방식이 얼마나 깔끔한지를 평가합니다.',
      interpretation: '점수가 높을수록 변수 역할이 명확하고 관리가 쉽습니다.',
      tooltipProblem: '변수 관리가 부실하면 어떤 값이 어디서 변경되는지 추적하기 어렵고, 의도치 않은 값 변경으로 버그가 발생할 수 있습니다.',
      statusText: (v) => v >= 70
        ? '변수 구조가 체계적으로 관리되고 있습니다'
        : v >= 40
          ? '사용하지 않는 변수를 정리하면 코드가 더 깔끔해집니다'
          : '변수 범위와 네이밍을 개선하면 코드 이해도가 높아집니다',
      gradient: ['#f59e0b', '#fbbf24'],
    },
    '이벤트 핸들러': {
      icon: '🎯',
      simpleDesc: '하나의 이벤트가 얼마나 많은 일을 처리하고 있는지를 나타냅니다.',
      interpretation: '점수가 낮으면 이벤트 로직을 분리하는 것이 좋습니다.',
      tooltipProblem: '핸들러가 너무 많은 일을 하면 테스트가 어렵고, 한 부분 수정이 다른 기능에 영향을 줄 수 있습니다.',
      statusText: (v) => v >= 70
        ? '이벤트 처리 로직이 적절하게 분리되어 있습니다'
        : v >= 40
          ? '일부 핸들러의 책임을 분리하면 테스트가 쉬워집니다'
          : '핸들러를 더 작은 함수로 나누면 관리가 편해집니다',
      gradient: ['#8b5cf6', '#a78bfa'],
    },
    '유지보수 지수': {
      icon: '🛠️',
      simpleDesc: '코드를 수정하고 확장하기 쉬운지를 종합적으로 평가한 지표입니다.',
      interpretation: '점수가 높을수록 장기적인 유지보수가 용이합니다.',
      tooltipProblem: '유지보수 지수가 낮으면 간단한 수정에도 많은 시간이 들고, 새로운 팀원이 코드를 이해하는 데 어려움을 겪습니다.',
      statusText: (v) => v >= 70
        ? '코드 구조가 확장과 수정에 유연합니다'
        : v >= 40
          ? '구조 개선을 통해 향후 작업 효율을 높일 수 있습니다'
          : '점진적인 리팩토링으로 유지보수성을 개선해 보세요',
      gradient: ['#3b82f6', '#60a5fa'],
    },
  };

  const config = metricConfig[item.name] || {
    icon: '📊',
    simpleDesc: '지표 설명',
    interpretation: '해석 정보',
    tooltipProblem: '문제 설명',
    statusText: () => '상태 확인 중',
    gradient: ['#6b7280', '#9ca3af'],
  };

  // 점수에 따른 색상 (0-40: 빨강, 40-70: 주황/노랑, 70-100: 초록/파랑)
  const getScoreColor = (value) => {
    if (value >= 70) return '#22c55e';
    if (value >= 40) return '#f59e0b';
    return '#ef4444';
  };

  const getStatusLevel = (value) => {
    if (value >= 70) return { label: '양호', bg: '#f0fdf4', border: '#bbf7d0' };
    if (value >= 40) return { label: '주의', bg: '#fffbeb', border: '#fde68a' };
    return { label: '개선 필요', bg: '#fef2f2', border: '#fecaca' };
  };

  const scoreColor = getScoreColor(item.value);
  const statusLevel = getStatusLevel(item.value);

  return (
    <div
      style={{
        ...styles.metricCardContainer,
        transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: isHovered
          ? '0 8px 30px rgba(0, 0, 0, 0.1)'
          : '0 2px 12px rgba(0, 0, 0, 0.04)',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 상단: 아이콘 + 지표명 + 점수 */}
      <div style={styles.metricCardTop}>
        <div style={styles.metricCardTitleRow}>
          <div style={styles.metricIconBox}>
            <span style={styles.metricIconText}>{config.icon}</span>
          </div>
          <div style={styles.metricTitleGroup}>
            <span style={styles.metricCardTitle}>{item.name}</span>
            <div style={styles.metricInfoBtnWrapper}>
              <button
                style={styles.metricInfoBtn}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
              >
                ?
              </button>
              {showTooltip && (
                <div style={styles.metricTooltipBox}>
                  <div style={styles.metricTooltipTitle}>이 지표가 낮으면?</div>
                  <div style={styles.metricTooltipContent}>{config.tooltipProblem}</div>
                </div>
              )}
            </div>
          </div>
          <div style={styles.metricScoreBox}>
            <span style={{ ...styles.metricScoreNum, color: scoreColor }}>
              {Math.round(animatedValue)}
            </span>
            <span style={styles.metricScoreUnit}>/100</span>
          </div>
        </div>

      </div>

      {/* 설명 영역 */}
      <div style={styles.metricDescSection}>
        <p style={styles.metricSimpleDesc}>{config.simpleDesc}</p>
        <p style={styles.metricInterpretation}>{config.interpretation}</p>
      </div>

      {/* 프로그레스 바 */}
      <div style={styles.metricProgressSection}>
        <div style={styles.metricProgressTrack}>
          <div
            style={{
              ...styles.metricProgressFill,
              width: `${animatedValue}%`,
              background: `linear-gradient(90deg, ${config.gradient[0]}, ${config.gradient[1]})`,
            }}
          />
        </div>
        <div style={styles.metricProgressLabels}>
          <span style={styles.metricProgressLabel}>0</span>
          <span style={{ ...styles.metricProgressLabel, color: '#f59e0b' }}>40</span>
          <span style={{ ...styles.metricProgressLabel, color: '#22c55e' }}>70</span>
          <span style={styles.metricProgressLabel}>100</span>
        </div>
      </div>

      {/* 상태 요약 */}
      <div style={{
        ...styles.metricStatusBox,
        background: statusLevel.bg,
        borderColor: statusLevel.border,
      }}>
        <span style={{ ...styles.metricStatusLabel, color: scoreColor }}>
          {statusLevel.label}
        </span>
        <span style={styles.metricStatusText}>
          {config.statusText(item.value)}
        </span>
      </div>
    </div>
  );
};

const CustomRadarTooltip = ({ active, payload }) => {
  const metricDetails = {
    'LOC': { fullName: 'Lines of Code', description: '코드의 총 줄 수', ideal: '적정 수준' },
    'Cyclomatic': { fullName: 'Cyclomatic Complexity', description: '순환 복잡도', ideal: '10 이하 권장' },
    'CBO': { fullName: 'Coupling Between Objects', description: '객체 간 결합도', ideal: '낮을수록 좋음' },
    'WMC': { fullName: 'Weighted Methods', description: '메서드 복잡도 총합', ideal: '적정 수준' },
    'MI': { fullName: 'Maintainability Index', description: '유지보수 지수', ideal: '65 이상 권장' },
  };

  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const details = metricDetails[data.subject] || {};
    const value = Math.round(data.A);
    const status = value >= 70 ? '양호' : value >= 40 ? '주의' : '위험';
    const statusColor = value >= 70 ? '#10b981' : value >= 40 ? '#f59e0b' : '#ef4444';

    return (
      <div style={styles.premiumRadarTooltip}>
        <div style={styles.radarTooltipHeader}>
          <span style={styles.radarTooltipTitle}>{details.fullName || data.subject}</span>
          <span style={{
            ...styles.radarTooltipStatus,
            background: statusColor + '20',
            color: statusColor,
          }}>{status}</span>
        </div>
        <div style={styles.radarTooltipDesc}>{details.description}</div>
        <div style={styles.radarTooltipValue}>
          <span style={styles.radarTooltipNumber}>{value}</span>
          <span style={styles.radarTooltipMax}>/100</span>
        </div>
        <div style={styles.radarTooltipIdeal}>
          💡 {details.ideal}
        </div>
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
// Fan-in / Fan-out 다이어그램 (모든 함수 포함)
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
          JavaScript/React 코드를 분석하면 Fan-in/Fan-out 다이어그램이 생성됩니다.
        </p>
      </div>
    );
  }

  // 각 노드의 연결 수 계산 (Fan-in / Fan-out)
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

  // 노드 위치 계산 - 개선된 레이아웃
  const svgWidth = 900;
  const svgHeight = Math.max(550, nodeList.length * 80);
  const diagramOffsetY = 60; // 상단 여백 확보
  const centerX = svgWidth / 2;
  const centerY = (svgHeight / 2) + diagramOffsetY;

  // 연결이 많은 노드를 중앙에 배치
  const sortedNodes = [...nodeList].sort((a, b) =>
    nodeConnections[b].total - nodeConnections[a].total
  );

  const nodePositions = {};
  const baseNodeWidth = 140;
  const baseNodeHeight = 50;

  // 개선된 원형 레이아웃 - 간격 증가
  sortedNodes.forEach((node, index) => {
    if (index === 0 && sortedNodes.length > 1) {
      // 가장 연결이 많은 노드는 중앙에 (상단 여백 적용)
      nodePositions[node] = { x: centerX, y: centerY };
    } else if (sortedNodes.length === 1) {
      // 노드가 1개면 중앙에
      nodePositions[node] = { x: centerX, y: centerY };
    } else {
      // 나머지는 원형으로 배치 - 간격 증가
      const adjustedIndex = index - 1;
      const nodesPerLayer = 5; // 레이어당 노드 수 감소로 간격 증가
      const layer = Math.floor(adjustedIndex / nodesPerLayer) + 1;
      const posInLayer = adjustedIndex % nodesPerLayer;
      const nodesInThisLayer = Math.min(nodesPerLayer, sortedNodes.length - 1 - (layer - 1) * nodesPerLayer);
      const angle = (posInLayer / nodesInThisLayer) * 2 * Math.PI - Math.PI / 2;
      const radius = 180 + layer * 140; // 반경 증가

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
          icon: 'react',
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
    const scale = Math.min(1.3, 1 + connections * 0.06);
    return { width: baseNodeWidth * scale, height: baseNodeHeight * scale };
  };

  // 화살표 경로 계산 - 곡선 개선
  const getEdgePath = (from, to, edgeIndex, totalEdgesBetween) => {
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

    // 시작점과 끝점 (노드 테두리에서 충분히 떨어지게)
    const startX = fromPos.x + nx * (fromSize.width / 2 + 8);
    const startY = fromPos.y + ny * (fromSize.height / 2 + 8);
    const endX = toPos.x - nx * (toSize.width / 2 + 18);
    const endY = toPos.y - ny * (toSize.height / 2 + 18);

    // 곡선 제어점 - 더 부드러운 곡선
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;

    // 곡선 오프셋 계산 (거리에 비례)
    const curveOffset = Math.min(50, dist * 0.15);
    const perpX = -ny * curveOffset;
    const perpY = nx * curveOffset;

    return {
      path: `M ${startX} ${startY} Q ${midX + perpX} ${midY + perpY} ${endX} ${endY}`,
      labelX: midX + perpX * 0.7,
      labelY: midY + perpY * 0.7,
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
      path: `M ${x} ${y} C ${x + 70} ${y - 60} ${x + 70} ${y + 60} ${x} ${y + size.height}`,
      labelX: x + 75,
      labelY: y + 15
    };
  };

  const renderEdge = (dep, idx) => {
    const isSelfLoop = dep.from === dep.to;
    const edgeData = isSelfLoop
      ? getSelfLoopPath(dep.from)
      : getEdgePath(dep.from, dep.to);

    if (!edgeData) return null;

    const isHovered = hoveredEdge === idx;
    const strokeWidth = Math.min(3.5, 1.5 + dep.count * 0.4);

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
            r="13"
            fill={isHovered ? '#6366f1' : '#ffffff'}
            stroke={isHovered ? '#4f46e5' : '#94a3b8'}
            strokeWidth="2"
          />
          <text
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="10"
            fontWeight="700"
            fill={isHovered ? '#ffffff' : '#475569'}
          >
            {dep.count}
          </text>
        </g>
        {/* 호버 툴팁 */}
        {isHovered && (
          <foreignObject
            x={edgeData.labelX + 20}
            y={edgeData.labelY - 35}
            width="1"
            height="1"
            style={{ overflow: 'visible' }}
          >
            <div style={styles.edgeTooltip}>
              <div style={styles.edgeTooltipRow}>
                <strong>{dep.from}</strong>
                <span style={styles.edgeTooltipArrow}>→</span>
                <strong>{dep.to}</strong>
              </div>
              <div style={styles.edgeTooltipInfo}>
                호출 횟수: <span style={styles.edgeTooltipCount}>{dep.count}회</span>
              </div>
              <div style={styles.edgeTooltipMeta}>
                Fan-out: {dep.from} | Fan-in: {dep.to}
              </div>
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
          rx="12"
          fill="rgba(0,0,0,0.08)"
        />
        {/* 노드 배경 */}
        <rect
          x={-size.width / 2}
          y={-size.height / 2}
          width={size.width}
          height={size.height}
          rx="12"
          fill={isHovered ? style.stroke : style.fill}
          stroke={style.stroke}
          strokeWidth={isHovered ? 3 : 2}
          style={{ transition: 'all 0.2s ease' }}
        />
        {/* 아이콘 */}
        {style.icon === 'react' ? (
          <image
            href="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg"
            x={-size.width / 2 + 6}
            y={-9}
            width="18"
            height="18"
          />
        ) : (
          <text
            x={-size.width / 2 + 14}
            y={0}
            fontSize="14"
            dominantBaseline="middle"
          >
            {style.icon}
          </text>
        )}
        {/* 함수 이름 */}
        <text
          x={8}
          y={-4}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="12"
          fontWeight="600"
          fill={isHovered ? '#ffffff' : style.text}
        >
          {node.length > 12 ? node.slice(0, 10) + '...' : node}
        </text>
        {/* 타입 라벨 */}
        <text
          x={8}
          y={size.height / 2 - 12}
          textAnchor="middle"
          fontSize="9"
          fill={isHovered ? 'rgba(255,255,255,0.8)' : style.stroke}
        >
          {style.label}
        </text>
        {/* Fan-in 뱃지 (좌상단 - 파란색) */}
        {conn && conn.in > 0 && (
          <g transform={`translate(${-size.width / 2 + 8}, ${-size.height / 2 - 8})`}>
            <circle r="11" fill="#3b82f6" stroke="#ffffff" strokeWidth="2" />
            <text
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="9"
              fontWeight="bold"
              fill="#ffffff"
            >
              {conn.in}
            </text>
          </g>
        )}
        {/* Fan-out 뱃지 (우상단 - 주황색) */}
        {conn && conn.out > 0 && (
          <g transform={`translate(${size.width / 2 - 8}, ${-size.height / 2 - 8})`}>
            <circle r="11" fill="#f59e0b" stroke="#ffffff" strokeWidth="2" />
            <text
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="9"
              fontWeight="bold"
              fill="#ffffff"
            >
              {conn.out}
            </text>
          </g>
        )}
        {/* 호버 툴팁 */}
        {isHovered && (
          <foreignObject
            x={size.width / 2 + 10}
            y={-55}
            width="1"
            height="1"
            style={{ overflow: 'visible' }}
          >
            <div style={styles.nodeTooltip}>
              <div style={styles.nodeTooltipHeader}>{node}</div>
              <div style={styles.nodeTooltipType}>타입: {style.label}</div>
              <div style={styles.nodeTooltipStats}>
                <div style={styles.nodeTooltipFanIn}>
                  <span style={styles.fanInIcon}>▶</span>
                  Fan-in (호출됨): {conn?.in || 0}회
                </div>
                <div style={styles.nodeTooltipFanOut}>
                  <span style={styles.fanOutIcon}>◀</span>
                  Fan-out (호출함): {conn?.out || 0}회
                </div>
              </div>
            </div>
          </foreignObject>
        )}
      </g>
    );
  };

  // Fan-in / Fan-out 통계 계산
  const maxFanIn = Math.max(...nodeList.map(n => nodeConnections[n]?.in || 0));
  const maxFanOut = Math.max(...nodeList.map(n => nodeConnections[n]?.out || 0));
  const highFanInNode = nodeList.find(n => nodeConnections[n]?.in === maxFanIn) || '-';
  const highFanOutNode = nodeList.find(n => nodeConnections[n]?.out === maxFanOut) || '-';

  return (
    <div style={styles.diagramContainer}>
      {/* Fan-in / Fan-out 개념 설명 영역 */}
      <div style={styles.fanInOutExplanation}>
        <div style={styles.explanationHeader}>
          <span style={styles.explanationIcon}>📖</span>
          <span style={styles.explanationTitle}>Fan-in / Fan-out 개념 이해하기</span>
        </div>
        <div style={styles.explanationContent}>
          <div style={styles.explanationItem}>
            <div style={styles.explanationBadge}>
              <span style={{ ...styles.explanationDot, background: '#3b82f6' }}></span>
              <strong>Fan-in</strong>
            </div>
            <p style={styles.explanationText}>
              하나의 함수로 유입되는 호출의 수입니다.<br/>
              <span style={styles.highlightText}>Fan-in이 높을수록 재사용성이 높은 함수</span>입니다.
            </p>
            <div style={styles.realLifeExample}>
              <span style={styles.exampleLabel}>🏦 실생활 예시</span>
              <p style={styles.exampleText}>
                은행의 공용 창구처럼, 여러 고객이 하나의 창구를 이용하는 상황과 같습니다.
                많은 곳에서 호출되는 핵심 기능일수록 Fan-in이 높아집니다.
              </p>
            </div>
          </div>
          <div style={styles.explanationItem}>
            <div style={styles.explanationBadge}>
              <span style={{ ...styles.explanationDot, background: '#f59e0b' }}></span>
              <strong>Fan-out</strong>
            </div>
            <p style={styles.explanationText}>
              하나의 함수에서 호출하는 다른 함수의 수입니다.<br/>
              <span style={styles.highlightText}>Fan-out이 높을수록 복잡도가 높고 변경 영향 범위가 큽니다.</span>
            </p>
            <div style={styles.realLifeExample}>
              <span style={styles.exampleLabel}>👔 실생활 예시</span>
              <p style={styles.exampleText}>
                팀장이 여러 팀원에게 동시에 업무를 지시하는 상황과 같습니다.
                지시 대상이 많을수록 관리가 복잡해지고, 변경 시 영향 범위가 넓어집니다.
              </p>
            </div>
          </div>
        </div>
        <div style={styles.explanationTip}>
          💡 <strong>Tip:</strong> 노드 좌상단 파란 뱃지 = Fan-in, 우상단 주황 뱃지 = Fan-out
        </div>
      </div>

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
        <div style={styles.legendSection}>
          <span style={styles.legendSectionTitle}>노드 타입</span>
          <div style={styles.legendItems}>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendBox, background: '#dbeafe', border: '2px solid #3b82f6' }}></div>
              <span style={styles.legendItemText}>
                <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg" alt="React" style={styles.legendReactIcon} />
                Component
              </span>
            </div>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendBox, background: '#fef3c7', border: '2px solid #f59e0b' }}></div>
              <span>🎯 Handler</span>
            </div>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendBox, background: '#dcfce7', border: '2px solid #22c55e' }}></div>
              <span>🔧 Helper</span>
            </div>
          </div>
        </div>
        <div style={styles.legendDivider}></div>
        <div style={styles.legendSection}>
          <span style={styles.legendSectionTitle}>뱃지</span>
          <div style={styles.legendItems}>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendCircle, background: '#3b82f6' }}></div>
              <span>Fan-in (좌상단)</span>
            </div>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendCircle, background: '#f59e0b' }}></div>
              <span>Fan-out (우상단)</span>
            </div>
          </div>
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
          <span style={{...styles.statValue, color: '#3b82f6'}}>
            {maxFanIn}
          </span>
          <span style={styles.statLabel}>최대 Fan-in</span>
          <span style={styles.statSubLabel}>{highFanInNode}</span>
        </div>
        <div style={styles.statItem}>
          <span style={{...styles.statValue, color: '#f59e0b'}}>
            {maxFanOut}
          </span>
          <span style={styles.statLabel}>최대 Fan-out</span>
          <span style={styles.statSubLabel}>{highFanOutNode}</span>
        </div>
      </div>
    </div>
  );
};

// ============================================
// 응집도(Cohesion) 다이어그램 - LCOM4 기반
// ============================================
const CohesionDiagram = ({ cohesionAnalysis }) => {
  const [hoveredMethod, setHoveredMethod] = useState(null);
  const [hoveredConnection, setHoveredConnection] = useState(null);
  const [selectedComponent, setSelectedComponent] = useState(null);

  const { components } = cohesionAnalysis;

  if (!components || components.length === 0) {
    return (
      <div style={styles.emptyDiagram}>
        <p>📭 분석된 컴포넌트가 없습니다.</p>
        <p style={{ fontSize: '13px', color: '#9ca3af' }}>
          React 컴포넌트를 분석하면 응집도 다이어그램이 생성됩니다.
        </p>
      </div>
    );
  }

  // 색상 팔레트 (연결 요소별 다른 색상)
  const componentColors = [
    { fill: '#dbeafe', stroke: '#3b82f6', text: '#1e40af' },
    { fill: '#dcfce7', stroke: '#22c55e', text: '#166534' },
    { fill: '#fef3c7', stroke: '#f59e0b', text: '#92400e' },
    { fill: '#fce7f3', stroke: '#ec4899', text: '#9d174d' },
    { fill: '#e0e7ff', stroke: '#6366f1', text: '#4338ca' },
    { fill: '#f3e8ff', stroke: '#a855f7', text: '#7e22ce' },
  ];

  // LCOM4 값에 따른 컴포넌트 배경색
  const getLCOM4Color = (lcom4) => {
    if (lcom4 === 1) return { bg: '#dcfce7', border: '#22c55e', text: '#166534', label: '높은 응집도' };
    if (lcom4 === 2) return { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', label: '보통 응집도' };
    if (lcom4 === 3) return { bg: '#fed7aa', border: '#f97316', text: '#9a3412', label: '낮은 응집도' };
    return { bg: '#fee2e2', border: '#ef4444', text: '#991b1b', label: '매우 낮은 응집도' };
  };

  const displayComponent = selectedComponent
    ? components.find(c => c.name === selectedComponent)
    : components[0];

  if (!displayComponent) return null;

  const { name, methodCount, lcom4, connectedComponents, methodConnections, methods } = displayComponent;
  const lcom4Style = getLCOM4Color(lcom4);

  // SVG 크기 계산
  const svgWidth = 800;
  const svgHeight = Math.max(450, (methods?.length || 0) * 60 + 150);
  const centerX = svgWidth / 2;
  const centerY = svgHeight / 2 + 30;

  // 메서드 위치 계산 (연결 요소별로 그룹화)
  const methodPositions = {};
  let totalMethodsPlaced = 0;

  connectedComponents?.forEach((group, groupIndex) => {
    const groupSize = group.length;
    const angleOffset = (groupIndex * Math.PI * 2) / (connectedComponents.length || 1);
    const groupRadius = 120 + groupIndex * 30;

    group.forEach((method, methodIndex) => {
      const angle = angleOffset + (methodIndex / groupSize) * (Math.PI * 2 / (connectedComponents.length || 1)) - Math.PI / 2;
      const radius = connectedComponents.length === 1
        ? 140 + methodIndex * 20
        : groupRadius + methodIndex * 25;

      methodPositions[method] = {
        x: centerX + radius * Math.cos(angle + methodIndex * 0.3),
        y: centerY + radius * Math.sin(angle + methodIndex * 0.3),
        groupIndex,
        color: componentColors[groupIndex % componentColors.length]
      };
      totalMethodsPlaced++;
    });
  });

  // 연결선 렌더링
  const renderConnection = (conn, idx) => {
    const fromPos = methodPositions[conn.from];
    const toPos = methodPositions[conn.to];

    if (!fromPos || !toPos) return null;

    const isHovered = hoveredConnection === idx;
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const midX = (fromPos.x + toPos.x) / 2;
    const midY = (fromPos.y + toPos.y) / 2;

    // 곡선 오프셋
    const dist = Math.sqrt(dx * dx + dy * dy);
    const perpX = (-dy / dist) * 20;
    const perpY = (dx / dist) * 20;

    const color = conn.reason === 'shared_state' ? '#3b82f6' : '#22c55e';

    return (
      <g
        key={idx}
        onMouseEnter={() => setHoveredConnection(idx)}
        onMouseLeave={() => setHoveredConnection(null)}
        style={{ cursor: 'pointer' }}
      >
        <path
          d={`M ${fromPos.x} ${fromPos.y} Q ${midX + perpX} ${midY + perpY} ${toPos.x} ${toPos.y}`}
          fill="none"
          stroke={isHovered ? '#6366f1' : color}
          strokeWidth={isHovered ? 3 : 2}
          strokeDasharray={conn.reason === 'shared_state' ? 'none' : '5,5'}
          opacity={isHovered ? 1 : 0.6}
          style={{ transition: 'all 0.2s ease' }}
        />
        {/* 연결 타입 표시 */}
        {isHovered && (
          <foreignObject
            x={midX + perpX - 80}
            y={midY + perpY - 40}
            width="1"
            height="1"
            style={{ overflow: 'visible' }}
          >
            <div style={styles.cohesionTooltip}>
              <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                {conn.from} ↔ {conn.to}
              </div>
              <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                {conn.reason === 'shared_state' ? '🔗 공유 상태' : '📞 호출 관계'}
              </div>
              {conn.sharedState?.length > 0 && (
                <div style={{ fontSize: '10px', color: '#60a5fa', marginTop: '4px' }}>
                  공유: {conn.sharedState.slice(0, 3).join(', ')}
                </div>
              )}
            </div>
          </foreignObject>
        )}
      </g>
    );
  };

  // 메서드 노드 렌더링
  const renderMethodNode = (method) => {
    const pos = methodPositions[method.name];
    if (!pos) return null;

    const isHovered = hoveredMethod === method.name;
    const nodeWidth = 110;
    const nodeHeight = 36;

    return (
      <g
        key={method.name}
        onMouseEnter={() => setHoveredMethod(method.name)}
        onMouseLeave={() => setHoveredMethod(null)}
        style={{ cursor: 'pointer' }}
        transform={`translate(${pos.x}, ${pos.y})`}
      >
        {/* 노드 그림자 */}
        <rect
          x={-nodeWidth / 2 + 2}
          y={-nodeHeight / 2 + 2}
          width={nodeWidth}
          height={nodeHeight}
          rx="8"
          fill="rgba(0,0,0,0.08)"
        />
        {/* 노드 배경 */}
        <rect
          x={-nodeWidth / 2}
          y={-nodeHeight / 2}
          width={nodeWidth}
          height={nodeHeight}
          rx="8"
          fill={isHovered ? pos.color.stroke : pos.color.fill}
          stroke={pos.color.stroke}
          strokeWidth={isHovered ? 3 : 2}
          style={{ transition: 'all 0.2s ease' }}
        />
        {/* 메서드 이름 */}
        <text
          x={0}
          y={0}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="11"
          fontWeight="600"
          fill={isHovered ? '#ffffff' : pos.color.text}
        >
          {method.name.length > 12 ? method.name.slice(0, 10) + '...' : method.name}
        </text>
        {/* 호버 툴팁 */}
        {isHovered && (
          <foreignObject
            x={nodeWidth / 2 + 10}
            y={-50}
            width="1"
            height="1"
            style={{ overflow: 'visible' }}
          >
            <div style={styles.cohesionTooltip}>
              <div style={{ fontWeight: '600', marginBottom: '6px' }}>{method.name}</div>
              {method.sharedState?.length > 0 && (
                <div style={{ fontSize: '11px', marginBottom: '4px' }}>
                  <span style={{ color: '#60a5fa' }}>사용 상태:</span>
                  <div style={{ color: '#d1d5db', fontSize: '10px' }}>
                    {method.sharedState.slice(0, 4).map(s => s.replace(/^(var:|state:|hook:)/, '')).join(', ')}
                  </div>
                </div>
              )}
              {method.calls?.length > 0 && (
                <div style={{ fontSize: '11px' }}>
                  <span style={{ color: '#34d399' }}>호출 함수:</span>
                  <div style={{ color: '#d1d5db', fontSize: '10px' }}>
                    {method.calls.slice(0, 3).join(', ')}
                  </div>
                </div>
              )}
            </div>
          </foreignObject>
        )}
      </g>
    );
  };

  return (
    <div style={styles.cohesionContainer}>
      {/* 응집도 설명 영역 */}
      <div style={styles.cohesionExplanation}>
        <div style={styles.explanationHeader}>
          <span style={styles.explanationIcon}>🧩</span>
          <span style={styles.explanationTitle}>응집도(Cohesion) 이해하기</span>
        </div>
        <div style={styles.cohesionExplanationContent}>
          <div style={styles.cohesionExplanationItem}>
            <p style={styles.explanationText}>
              <strong>응집도</strong>는 한 클래스(컴포넌트)가 <span style={styles.highlightText}>하나의 책임에 얼마나 집중</span>되어 있는지를 나타냅니다.
            </p>
          </div>
          <div style={styles.cohesionExplanationItem}>
            <p style={styles.explanationText}>
              <strong>LCOM4</strong>: 내부 메서드 그래프의 연결 요소 개수입니다.<br/>
              <span style={styles.highlightText}>값이 클수록 여러 책임이 섞여 있어 리팩토링이 필요</span>할 수 있습니다.
            </p>
          </div>
        </div>
        <div style={styles.cohesionLegendRow}>
          <div style={styles.cohesionLegendItem}>
            <span style={{ ...styles.cohesionLegendDot, background: '#22c55e' }}></span>
            <span>LCOM4 = 1: 이상적 (높은 응집도)</span>
          </div>
          <div style={styles.cohesionLegendItem}>
            <span style={{ ...styles.cohesionLegendDot, background: '#f59e0b' }}></span>
            <span>LCOM4 = 2: 보통</span>
          </div>
          <div style={styles.cohesionLegendItem}>
            <span style={{ ...styles.cohesionLegendDot, background: '#ef4444' }}></span>
            <span>LCOM4 ≥ 3: 리팩토링 권장</span>
          </div>
        </div>
      </div>

      {/* 컴포넌트 선택 탭 */}
      {components.length > 1 && (
        <div style={styles.cohesionTabs}>
          {components.map((comp) => {
            const style = getLCOM4Color(comp.lcom4);
            return (
              <button
                key={comp.name}
                style={{
                  ...styles.cohesionTab,
                  background: selectedComponent === comp.name || (!selectedComponent && comp === components[0])
                    ? style.bg
                    : '#f3f4f6',
                  borderColor: selectedComponent === comp.name || (!selectedComponent && comp === components[0])
                    ? style.border
                    : '#e5e7eb',
                  color: style.text,
                }}
                onClick={() => setSelectedComponent(comp.name)}
              >
                {comp.name}
                <span style={styles.cohesionTabBadge}>
                  LCOM4: {comp.lcom4}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 선택된 컴포넌트 정보 헤더 */}
      <div style={{
        ...styles.cohesionHeader,
        background: lcom4Style.bg,
        borderColor: lcom4Style.border,
      }}>
        <div style={styles.cohesionHeaderLeft}>
          <span style={{ ...styles.cohesionComponentName, color: lcom4Style.text }}>
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg" alt="React" style={styles.cohesionReactIcon} />
            {name}
          </span>
          <span style={styles.cohesionMethodCount}>
            {methodCount}개 메서드
          </span>
        </div>
        <div style={styles.cohesionHeaderRight}>
          <div style={{
            ...styles.lcom4Badge,
            background: lcom4Style.border,
          }}>
            <span style={styles.lcom4Value}>LCOM4: {lcom4}</span>
          </div>
          <span style={{ ...styles.lcom4Label, color: lcom4Style.text }}>
            {lcom4Style.label}
          </span>
        </div>
      </div>

      {/* 다이어그램 */}
      {methods && methods.length > 0 ? (
        <svg width={svgWidth} height={svgHeight} style={{ overflow: 'visible' }}>
          {/* 연결 요소별 영역 표시 (배경) */}
          {connectedComponents?.map((group, groupIndex) => {
            if (group.length < 2) return null;

            const groupPositions = group.map(m => methodPositions[m]).filter(Boolean);
            if (groupPositions.length < 2) return null;

            const minX = Math.min(...groupPositions.map(p => p.x)) - 70;
            const maxX = Math.max(...groupPositions.map(p => p.x)) + 70;
            const minY = Math.min(...groupPositions.map(p => p.y)) - 40;
            const maxY = Math.max(...groupPositions.map(p => p.y)) + 40;

            const color = componentColors[groupIndex % componentColors.length];

            return (
              <rect
                key={`group-${groupIndex}`}
                x={minX}
                y={minY}
                width={maxX - minX}
                height={maxY - minY}
                rx="16"
                fill={color.fill}
                fillOpacity="0.3"
                stroke={color.stroke}
                strokeWidth="2"
                strokeDasharray="8,4"
              />
            );
          })}

          {/* 연결선 렌더링 */}
          {methodConnections?.map(renderConnection)}

          {/* 메서드 노드 렌더링 */}
          {methods?.map(renderMethodNode)}

          {/* 연결 요소 라벨 */}
          {connectedComponents?.map((group, groupIndex) => {
            if (group.length === 0) return null;

            const firstPos = methodPositions[group[0]];
            if (!firstPos) return null;

            const color = componentColors[groupIndex % componentColors.length];

            return (
              <text
                key={`label-${groupIndex}`}
                x={firstPos.x}
                y={firstPos.y - 55}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill={color.text}
              >
                그룹 {groupIndex + 1} ({group.length}개)
              </text>
            );
          })}
        </svg>
      ) : (
        <div style={styles.noMethodsMessage}>
          <p>이 컴포넌트에는 분석 가능한 내부 메서드가 없습니다.</p>
          <p style={{ fontSize: '12px', color: '#9ca3af' }}>
            이벤트 핸들러나 헬퍼 함수가 컴포넌트 내부에 정의되어 있어야 응집도 분석이 가능합니다.
          </p>
        </div>
      )}

      {/* 범례 */}
      <div style={styles.cohesionDiagramLegend}>
        <div style={styles.legendSection}>
          <span style={styles.legendSectionTitle}>연결 유형</span>
          <div style={styles.legendItems}>
            <div style={styles.legendItem}>
              <svg width="30" height="10">
                <line x1="0" y1="5" x2="30" y2="5" stroke="#3b82f6" strokeWidth="2" />
              </svg>
              <span>공유 상태</span>
            </div>
            <div style={styles.legendItem}>
              <svg width="30" height="10">
                <line x1="0" y1="5" x2="30" y2="5" stroke="#22c55e" strokeWidth="2" strokeDasharray="5,5" />
              </svg>
              <span>호출 관계</span>
            </div>
          </div>
        </div>
        <div style={styles.legendDivider}></div>
        <div style={styles.legendSection}>
          <span style={styles.legendSectionTitle}>연결 요소 (그룹)</span>
          <div style={styles.legendItems}>
            {componentColors.slice(0, 4).map((color, i) => (
              <div key={i} style={styles.legendItem}>
                <div style={{ ...styles.legendBox, background: color.fill, border: `2px solid ${color.stroke}` }}></div>
                <span>그룹 {i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 통계 요약 */}
      <div style={styles.cohesionStats}>
        <div style={styles.statItem}>
          <span style={styles.statValue}>{components.length}</span>
          <span style={styles.statLabel}>분석된 컴포넌트</span>
        </div>
        <div style={styles.statItem}>
          <span style={{ ...styles.statValue, color: '#22c55e' }}>
            {components.filter(c => c.lcom4 === 1).length}
          </span>
          <span style={styles.statLabel}>높은 응집도</span>
        </div>
        <div style={styles.statItem}>
          <span style={{ ...styles.statValue, color: '#f59e0b' }}>
            {components.filter(c => c.lcom4 === 2).length}
          </span>
          <span style={styles.statLabel}>보통 응집도</span>
        </div>
        <div style={styles.statItem}>
          <span style={{ ...styles.statValue, color: '#ef4444' }}>
            {components.filter(c => c.lcom4 >= 3).length}
          </span>
          <span style={styles.statLabel}>리팩토링 권장</span>
        </div>
      </div>
    </div>
  );
};

// 리팩토링 프롬프트 패널 컴포넌트
const RefactoringPromptPanel = ({ results, projectName = 'React Project' }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState('');

  const handleGeneratePrompt = () => {
    const prompt = generateRefactoringPrompt(results, projectName);
    setGeneratedPrompt(prompt);
    setIsExpanded(true);
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // 폴백: textarea를 사용한 복사
      const textarea = document.createElement('textarea');
      textarea.value = generatedPrompt;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setIsExpanded(false);
    setGeneratedPrompt('');
  };

  // 문제가 있는지 확인
  const hasIssues = results?.summary?.avgQualityScore < 70 ||
    results?.summary?.avgCyclomaticComplexity > 8 ||
    results?.summary?.totalIssues > 0 ||
    results?.summary?.avgMaintainabilityIndex < 60 ||
    results?.files?.some(f => !f.error && f.qualityScore < 70);

  if (!hasIssues) {
    return (
      <div style={styles.refactoringPanelContainer}>
        <div style={styles.refactoringNoIssues}>
          <span style={styles.refactoringNoIssuesIcon}>✨</span>
          <div>
            <h4 style={styles.refactoringNoIssuesTitle}>코드 품질이 양호합니다</h4>
            <p style={styles.refactoringNoIssuesText}>
              현재 분석 결과에서 심각한 품질 문제가 발견되지 않았습니다.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.refactoringPanelContainer}>
      {/* 헤더 영역 */}
      <div style={styles.refactoringHeader}>
        <div style={styles.refactoringHeaderLeft}>
          <span style={styles.refactoringIcon}>🤖</span>
          <div>
            <h3 style={styles.refactoringTitle}>AI 리팩토링 프롬프트 생성</h3>
            <p style={styles.refactoringSubtitle}>
              분석 결과를 기반으로 Claude, GPT 등 AI에게 전달할 리팩토링 지시문을 생성합니다
            </p>
          </div>
        </div>
        {!isExpanded && (
          <button style={styles.refactoringGenerateBtn} onClick={handleGeneratePrompt}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v18M3 12h18" />
            </svg>
            프롬프트 생성하기
          </button>
        )}
      </div>

      {/* 안내 배지 */}
      {!isExpanded && (
        <div style={styles.refactoringBadges}>
          <span style={styles.refactoringBadge}>
            <span style={styles.badgeIcon}>🎯</span>
            분석 결과 기반
          </span>
          <span style={styles.refactoringBadge}>
            <span style={styles.badgeIcon}>🔒</span>
            기능 변경 없음
          </span>
          <span style={styles.refactoringBadge}>
            <span style={styles.badgeIcon}>📋</span>
            복사하여 AI에 전달
          </span>
        </div>
      )}

      {/* 프롬프트 미리보기 패널 */}
      {isExpanded && generatedPrompt && (
        <div style={styles.refactoringPromptArea}>
          <div style={styles.refactoringPromptHeader}>
            <span style={styles.refactoringPromptLabel}>생성된 프롬프트</span>
            <div style={styles.refactoringPromptActions}>
              <button
                style={{
                  ...styles.refactoringCopyBtn,
                  ...(copied ? styles.refactoringCopyBtnCopied : {})
                }}
                onClick={handleCopyPrompt}
              >
                {copied ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    복사됨!
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    프롬프트 복사
                  </>
                )}
              </button>
              <button style={styles.refactoringCloseBtn} onClick={handleClose}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                닫기
              </button>
            </div>
          </div>
          <div style={styles.refactoringPromptContent}>
            <pre style={styles.refactoringPromptText}>{generatedPrompt}</pre>
          </div>
          <div style={styles.refactoringPromptFooter}>
            <span style={styles.refactoringPromptHint}>
              💡 이 프롬프트를 복사하여 Claude, GPT 등 AI 도구에 붙여넣고, 리팩토링할 코드를 함께 전달하세요.
            </span>
          </div>
        </div>
      )}
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
      // 응집도 분석 통합
      cohesionAnalysis: {
        components: validResults.flatMap(r => r.cohesionAnalysis?.components || [])
      },
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
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg" alt="React" style={styles.logoIcon} />
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
            <span style={styles.badge}>
              📦 ZIP
            </span>
            <span style={styles.badge}>
              <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg" alt="JSX" style={styles.badgeIcon} />
              JSX
            </span>
            <span style={styles.badge}>
              <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/typescript/typescript-original.svg" alt="TSX" style={styles.badgeIcon} />
              TSX
            </span>
            <span style={styles.badge}>
              <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/javascript/javascript-original.svg" alt="JS/TS" style={styles.badgeIcon} />
              JS/TS
            </span>
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
            <img
              src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg"
              alt="React"
              style={styles.spinnerReactIcon}
            />
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

        <div style={styles.premiumDashboardGrid}>
          {/* 코드 품질 점수 카드 */}
          <div style={styles.premiumScoreCard}>
            <div style={styles.premiumCardHeader}>
              <div style={styles.premiumCardTitleRow}>
                <h3 style={styles.premiumCardTitle}>
                  <span style={styles.premiumCardIcon}>🎯</span>
                  코드 품질 점수
                </h3>
                <button style={styles.premiumInfoButton} onClick={() => setShowQualityInfo(true)}>
                  <span>계산 방법</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                    <path d="M12 17h.01"/>
                  </svg>
                </button>
              </div>
              <p style={styles.premiumCardSubtitle}>
                종합적인 코드 품질을 100점 만점으로 평가합니다
              </p>
            </div>
            <CircularGauge score={results.summary.avgQualityScore} />
          </div>

        </div>

        {/* 품질 지표 분석 섹션 (별도 풀 와이드) */}
        <div style={styles.metricsAnalysisSection}>
          <div style={styles.metricsAnalysisHeader}>
            <div>
              <h3 style={styles.metricsAnalysisTitle}>
                <span style={styles.premiumCardIcon}>📊</span>
                품질 지표 분석
              </h3>
              <p style={styles.metricsAnalysisSubtitle}>
                각 지표가 무엇을 의미하는지, 현재 상태가 어떤지 이해해 보세요
              </p>
            </div>
            <div style={styles.metricsLegend}>
              <span style={styles.metricsLegendItem}>
                <span style={{ ...styles.metricsLegendDot, background: '#22c55e' }}></span>
                70+ 양호
              </span>
              <span style={styles.metricsLegendItem}>
                <span style={{ ...styles.metricsLegendDot, background: '#f59e0b' }}></span>
                40-69 주의
              </span>
              <span style={styles.metricsLegendItem}>
                <span style={{ ...styles.metricsLegendDot, background: '#ef4444' }}></span>
                0-39 개선 필요
              </span>
            </div>
          </div>
          <div style={styles.metricsCardsGrid}>
            {qualityBarData.map((item, index) => (
              <PremiumMetricCard key={index} item={item} index={index} />
            ))}
          </div>
        </div>

        <div style={styles.premiumRadarCard}>
          <div style={styles.premiumRadarHeader}>
            <div style={styles.premiumRadarTitleSection}>
              <h3 style={styles.premiumCardTitle}>
                <span style={styles.premiumCardIcon}>📡</span>
                확장 메트릭 레이더
              </h3>
              <p style={styles.premiumCardSubtitle}>
                5가지 핵심 지표를 다차원으로 분석합니다
              </p>
            </div>
            <div style={styles.radarSummaryBox}>
              <div style={styles.radarSummaryIcon}>💡</div>
              <div style={styles.radarSummaryText}>
                {(() => {
                  const avgScore = radarData.reduce((sum, d) => sum + d.A, 0) / radarData.length;
                  if (avgScore >= 70) return '전체적으로 균형 잡힌 코드 구조입니다. 현재 품질을 유지하세요.';
                  if (avgScore >= 50) return '일부 지표에서 개선이 필요합니다. 낮은 영역을 집중 개선하세요.';
                  return '여러 지표에서 개선이 시급합니다. 우선순위를 정해 리팩토링하세요.';
                })()}
              </div>
            </div>
          </div>

          <div style={styles.premiumRadarContent}>
            <div style={styles.premiumRadarChartWrapper}>
              <ResponsiveContainer width="100%" height={380}>
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                  <defs>
                    <linearGradient id="radarGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.8}/>
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                    </linearGradient>
                  </defs>
                  <PolarGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <PolarAngleAxis
                    dataKey="subject"
                    tick={<CustomAxisTick />}
                  />
                  <PolarRadiusAxis
                    angle={90}
                    domain={[0, 100]}
                    tick={{ fill: '#9ca3af', fontSize: 10 }}
                    axisLine={false}
                    tickCount={5}
                  />
                  <Radar
                    name="메트릭"
                    dataKey="A"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#radarGradient)"
                    fillOpacity={0.4}
                  />
                  <Tooltip content={<CustomRadarTooltip />} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Fan-in / Fan-out 다이어그램 */}
        <div style={styles.stateDiagramCard}>
          <h3 style={styles.chartTitle}>
            <span style={styles.chartIcon}>🔗</span> Fan-in / Fan-out 다이어그램
          </h3>
          <p style={styles.chartHint}>
            * 각 노드와 화살표에 마우스를 올려 상세 정보를 확인하세요.
            화살표는 A → B (A가 B를 호출)를 의미하며, 숫자는 호출 횟수입니다.
          </p>
          <DependencyDiagram
            dependencyAnalysis={results.summary.dependencyAnalysis}
          />
        </div>

        {/* 응집도(Cohesion) 다이어그램 */}
        <div style={styles.cohesionCard}>
          <h3 style={styles.chartTitle}>
            <span style={styles.chartIcon}>🧩</span> 응집도(Cohesion) 다이어그램
          </h3>
          <p style={styles.chartHint}>
            * 컴포넌트 내부 메서드 간의 관계를 분석하여 LCOM4 기반 응집도를 시각화합니다.
            연결 요소가 많을수록 여러 책임이 섞여 있어 리팩토링을 고려해보세요.
          </p>
          <CohesionDiagram
            cohesionAnalysis={results.summary.cohesionAnalysis}
          />
        </div>

        {/* AI 리팩토링 프롬프트 생성 섹션 */}
        <RefactoringPromptPanel
          results={results}
          projectName="React Project"
        />

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
    width: '36px',
    height: '36px',
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
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  badgeIcon: {
    width: '18px',
    height: '18px',
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
  spinnerReactIcon: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '32px',
    height: '32px',
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
  cohesionCard: {
    maxWidth: '1200px',
    margin: '0 auto 24px',
    padding: '24px',
    background: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
    border: '1px solid #f3f4f6',
    overflow: 'auto',
  },
  cohesionContainer: {
    padding: '20px',
    minWidth: '800px',
  },
  cohesionExplanation: {
    background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)',
    border: '1px solid #e9d5ff',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '24px',
  },
  cohesionExplanationContent: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '16px',
    marginBottom: '16px',
  },
  cohesionExplanationItem: {
    background: '#ffffff',
    borderRadius: '8px',
    padding: '14px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  cohesionLegendRow: {
    display: 'flex',
    gap: '20px',
    flexWrap: 'wrap',
    background: '#fefce8',
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid #fef08a',
  },
  cohesionLegendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#64748b',
  },
  cohesionLegendDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  cohesionTabs: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
    flexWrap: 'wrap',
  },
  cohesionTab: {
    padding: '10px 16px',
    borderRadius: '10px',
    border: '2px solid',
    background: '#f3f4f6',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    transition: 'all 0.2s ease',
  },
  cohesionTabBadge: {
    fontSize: '11px',
    fontWeight: '600',
    padding: '2px 8px',
    borderRadius: '10px',
    background: 'rgba(0,0,0,0.1)',
  },
  cohesionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderRadius: '12px',
    border: '2px solid',
    marginBottom: '20px',
  },
  cohesionHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  cohesionComponentName: {
    fontSize: '18px',
    fontWeight: '700',
  },
  cohesionMethodCount: {
    fontSize: '13px',
    color: '#6b7280',
    background: '#f3f4f6',
    padding: '4px 10px',
    borderRadius: '12px',
  },
  cohesionHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  lcom4Badge: {
    padding: '8px 16px',
    borderRadius: '20px',
    color: '#ffffff',
    fontWeight: '700',
  },
  lcom4Value: {
    fontSize: '14px',
  },
  lcom4Label: {
    fontSize: '13px',
    fontWeight: '600',
  },
  cohesionTooltip: {
    background: '#1f2937',
    color: '#ffffff',
    padding: '12px 16px',
    borderRadius: '10px',
    fontSize: '12px',
    lineHeight: '1.5',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
    whiteSpace: 'nowrap',
    minWidth: '160px',
    maxWidth: '280px',
  },
  noMethodsMessage: {
    textAlign: 'center',
    padding: '60px 40px',
    color: '#6b7280',
    background: '#f9fafb',
    borderRadius: '12px',
    border: '1px dashed #d1d5db',
  },
  cohesionDiagramLegend: {
    display: 'flex',
    gap: '32px',
    marginTop: '24px',
    paddingTop: '20px',
    borderTop: '1px solid #e5e7eb',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  cohesionStats: {
    display: 'flex',
    gap: '32px',
    marginTop: '20px',
    paddingTop: '16px',
    borderTop: '1px solid #e5e7eb',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  diagramContainer: {
    padding: '20px',
    minWidth: '900px',
  },
  fanInOutExplanation: {
    background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '24px',
  },
  explanationHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '16px',
  },
  explanationIcon: {
    fontSize: '20px',
  },
  explanationTitle: {
    fontSize: '15px',
    fontWeight: '600',
    color: '#1e293b',
  },
  explanationContent: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '16px',
    marginBottom: '12px',
  },
  explanationItem: {
    background: '#ffffff',
    borderRadius: '8px',
    padding: '14px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  explanationBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
    fontSize: '14px',
    color: '#334155',
  },
  explanationDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
  },
  explanationText: {
    fontSize: '13px',
    color: '#64748b',
    lineHeight: '1.6',
    margin: '0 0 12px 0',
  },
  highlightText: {
    color: '#475569',
    fontWeight: '500',
  },
  realLifeExample: {
    background: '#f8fafc',
    borderRadius: '6px',
    padding: '10px 12px',
    borderLeft: '3px solid #cbd5e1',
  },
  exampleLabel: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#64748b',
    display: 'block',
    marginBottom: '4px',
  },
  exampleText: {
    fontSize: '12px',
    color: '#64748b',
    lineHeight: '1.5',
    margin: 0,
  },
  explanationTip: {
    fontSize: '12px',
    color: '#64748b',
    background: '#fefce8',
    padding: '10px 14px',
    borderRadius: '6px',
    border: '1px solid #fef08a',
  },
  diagramLegend: {
    display: 'flex',
    gap: '32px',
    marginTop: '24px',
    paddingTop: '20px',
    borderTop: '1px solid #e5e7eb',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  legendSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  legendSectionTitle: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  legendItems: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
  },
  legendDivider: {
    width: '1px',
    background: '#e5e7eb',
    alignSelf: 'stretch',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#6b7280',
  },
  legendItemText: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  legendReactIcon: {
    width: '14px',
    height: '14px',
  },
  cohesionReactIcon: {
    width: '18px',
    height: '18px',
    marginRight: '4px',
    verticalAlign: 'middle',
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
  edgeTooltip: {
    background: '#1f2937',
    color: '#ffffff',
    padding: '12px 16px',
    borderRadius: '10px',
    fontSize: '12px',
    lineHeight: '1.6',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
    whiteSpace: 'nowrap',
    minWidth: '180px',
    maxWidth: '280px',
  },
  edgeTooltipRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '8px',
    fontSize: '13px',
  },
  edgeTooltipArrow: {
    color: '#6366f1',
    fontWeight: '600',
  },
  edgeTooltipInfo: {
    marginBottom: '6px',
    color: '#e5e7eb',
  },
  edgeTooltipCount: {
    color: '#a5b4fc',
    fontWeight: '600',
  },
  edgeTooltipMeta: {
    fontSize: '10px',
    color: '#9ca3af',
    paddingTop: '6px',
    borderTop: '1px solid #374151',
  },
  nodeTooltip: {
    background: '#1f2937',
    color: '#ffffff',
    padding: '14px 16px',
    borderRadius: '10px',
    fontSize: '12px',
    lineHeight: '1.5',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
    whiteSpace: 'nowrap',
    minWidth: '200px',
    maxWidth: '300px',
  },
  nodeTooltipHeader: {
    fontSize: '14px',
    fontWeight: '600',
    marginBottom: '6px',
    paddingBottom: '6px',
    borderBottom: '1px solid #374151',
  },
  nodeTooltipType: {
    color: '#d1d5db',
    marginBottom: '10px',
  },
  nodeTooltipStats: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  nodeTooltipFanIn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: '#93c5fd',
  },
  nodeTooltipFanOut: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: '#fcd34d',
  },
  fanInIcon: {
    color: '#3b82f6',
    fontWeight: '600',
  },
  fanOutIcon: {
    color: '#f59e0b',
    fontWeight: '600',
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
  statSubLabel: {
    fontSize: '10px',
    color: '#9ca3af',
    marginTop: '2px',
    maxWidth: '80px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
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
  // Premium Dashboard Styles
  premiumDashboardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
    gap: '24px',
    maxWidth: '1200px',
    margin: '0 auto 32px',
  },
  premiumScoreCard: {
    background: 'linear-gradient(145deg, #ffffff 0%, #fafbff 100%)',
    borderRadius: '20px',
    padding: '20px 24px',
    boxShadow: '0 4px 24px rgba(99, 102, 241, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)',
    border: '1px solid rgba(99, 102, 241, 0.1)',
    transition: 'all 0.3s ease',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    minHeight: '320px',
  },
  premiumMetricsCard: {
    background: 'linear-gradient(145deg, #ffffff 0%, #fafbff 100%)',
    borderRadius: '20px',
    padding: '28px',
    boxShadow: '0 4px 24px rgba(99, 102, 241, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)',
    border: '1px solid rgba(99, 102, 241, 0.1)',
    transition: 'all 0.3s ease',
  },
  premiumCardHeader: {
    marginBottom: '4px',
  },
  premiumCardTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  premiumCardTitle: {
    fontSize: '17px',
    fontWeight: '700',
    color: '#1f2937',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  premiumCardIcon: {
    fontSize: '20px',
  },
  premiumCardSubtitle: {
    fontSize: '13px',
    color: '#6b7280',
    margin: 0,
    lineHeight: '1.5',
  },
  premiumInfoButton: {
    padding: '6px 14px',
    background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
    color: '#4b5563',
    border: 'none',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  premiumMetricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '16px',
  },
  gaugeWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: '0',
  },
  premiumGaugeContainer: {
    position: 'relative',
    width: '160px',
    height: '160px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 0.5s ease, transform 0.5s ease',
  },
  gaugeScoreCenter: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center',
  },
  premiumGaugeNumber: {
    fontSize: '38px',
    fontWeight: '800',
    display: 'block',
    lineHeight: '1',
    letterSpacing: '-2px',
    transition: 'color 0.3s ease',
  },
  premiumGaugeMax: {
    fontSize: '13px',
    color: '#9ca3af',
    display: 'block',
    marginTop: '2px',
    fontWeight: '600',
    transition: 'color 0.3s ease',
  },
  // Risk Meter 스타일
  riskMeterContainer: {
    width: '100%',
    maxWidth: '260px',
    marginTop: '12px',
  },
  riskMeterBar: {
    position: 'relative',
    display: 'flex',
    height: '12px',
    borderRadius: '6px',
    overflow: 'visible',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  riskMeterSegment: {
    flex: 1,
    height: '100%',
  },
  riskMeterPointer: {
    position: 'absolute',
    top: '-8px',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    transition: 'left 1.5s cubic-bezier(0.4, 0, 0.2, 1)',
    zIndex: 10,
  },
  riskMeterArrow: {
    width: 0,
    height: 0,
    borderLeft: '6px solid transparent',
    borderRight: '6px solid transparent',
    borderTop: '8px solid #1f2937',
  },
  riskMeterPointerLabel: {
    position: 'absolute',
    top: '-28px',
    padding: '3px 8px',
    borderRadius: '4px',
    color: '#ffffff',
    fontSize: '11px',
    fontWeight: '700',
    whiteSpace: 'nowrap',
  },
  riskMeterLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '8px',
    padding: '0 2px',
  },
  riskMeterLabel: {
    fontSize: '9px',
    fontWeight: '500',
    textAlign: 'center',
    flex: 1,
    transition: 'all 0.3s ease',
  },
  qualitySummaryText: {
    marginTop: '14px',
    fontSize: '13px',
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: '1.4',
    transition: 'color 0.3s ease',
  },
  // 품질 지표 카드 스타일 (재설계)
  metricCardContainer: {
    background: '#ffffff',
    borderRadius: '16px',
    padding: '20px',
    border: '1px solid #e5e7eb',
    transition: 'all 0.2s ease',
    position: 'relative',
  },
  metricCardTop: {
    position: 'relative',
    marginBottom: '14px',
  },
  metricCardTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  metricIconBox: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  metricIconText: {
    fontSize: '20px',
  },
  metricTitleGroup: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  metricCardTitle: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1f2937',
  },
  metricInfoBtn: {
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    border: '1px solid #d1d5db',
    background: '#f9fafb',
    color: '#6b7280',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  },
  metricScoreBox: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '2px',
  },
  metricScoreNum: {
    fontSize: '28px',
    fontWeight: '800',
    letterSpacing: '-1px',
    lineHeight: '1',
  },
  metricScoreUnit: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#9ca3af',
  },
  metricInfoBtnWrapper: {
    position: 'relative',
    display: 'inline-block',
  },
  metricTooltipBox: {
    position: 'absolute',
    top: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginTop: '8px',
    background: '#1f2937',
    color: '#ffffff',
    padding: '12px 14px',
    borderRadius: '10px',
    fontSize: '12px',
    lineHeight: '1.5',
    width: '260px',
    zIndex: 9999,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
    pointerEvents: 'none',
  },
  metricTooltipTitle: {
    fontWeight: '600',
    marginBottom: '6px',
    color: '#fbbf24',
  },
  metricTooltipContent: {
    color: '#e5e7eb',
  },
  metricDescSection: {
    marginBottom: '14px',
    paddingBottom: '14px',
    borderBottom: '1px solid #f3f4f6',
  },
  metricSimpleDesc: {
    fontSize: '13px',
    color: '#4b5563',
    lineHeight: '1.5',
    margin: '0 0 6px 0',
  },
  metricInterpretation: {
    fontSize: '12px',
    color: '#9ca3af',
    lineHeight: '1.4',
    margin: 0,
    fontStyle: 'italic',
  },
  metricProgressSection: {
    marginBottom: '14px',
  },
  metricProgressTrack: {
    width: '100%',
    height: '8px',
    background: '#f1f5f9',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '6px',
  },
  metricProgressFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  metricProgressLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0 2px',
  },
  metricProgressLabel: {
    fontSize: '10px',
    color: '#9ca3af',
    fontWeight: '500',
  },
  metricStatusBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid',
  },
  metricStatusLabel: {
    fontSize: '12px',
    fontWeight: '700',
    flexShrink: 0,
  },
  metricStatusText: {
    fontSize: '12px',
    color: '#4b5563',
    lineHeight: '1.4',
  },
  // 품질 지표 분석 섹션 스타일
  metricsAnalysisSection: {
    maxWidth: '1200px',
    margin: '0 auto 32px',
    background: 'linear-gradient(145deg, #ffffff 0%, #fafbff 100%)',
    borderRadius: '20px',
    padding: '28px',
    boxShadow: '0 4px 24px rgba(99, 102, 241, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)',
    border: '1px solid rgba(99, 102, 241, 0.1)',
  },
  metricsAnalysisHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '24px',
    flexWrap: 'wrap',
    gap: '16px',
  },
  metricsAnalysisTitle: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#1f2937',
    margin: '0 0 6px 0',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  metricsAnalysisSubtitle: {
    fontSize: '13px',
    color: '#6b7280',
    margin: 0,
  },
  metricsLegend: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
  },
  metricsLegendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#6b7280',
    fontWeight: '500',
  },
  metricsLegendDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  metricsCardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '20px',
  },
  // Premium Radar Card Styles
  premiumRadarCard: {
    maxWidth: '1200px',
    margin: '0 auto 32px',
    background: 'linear-gradient(145deg, #ffffff 0%, #fafbff 100%)',
    borderRadius: '20px',
    padding: '28px',
    boxShadow: '0 4px 24px rgba(99, 102, 241, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)',
    border: '1px solid rgba(99, 102, 241, 0.1)',
    overflow: 'visible',
  },
  premiumRadarHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '20px',
    flexWrap: 'wrap',
    gap: '16px',
  },
  premiumRadarTitleSection: {
    flex: 1,
    minWidth: '200px',
  },
  radarSummaryBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    background: 'linear-gradient(135deg, #fef3c7 0%, #fef9c3 100%)',
    padding: '14px 18px',
    borderRadius: '12px',
    border: '1px solid #fcd34d',
    maxWidth: '320px',
  },
  radarSummaryIcon: {
    fontSize: '20px',
    flexShrink: 0,
  },
  radarSummaryText: {
    fontSize: '13px',
    color: '#92400e',
    lineHeight: '1.5',
    fontWeight: '500',
  },
  premiumRadarContent: {
    display: 'flex',
    justifyContent: 'center',
  },
  premiumRadarChartWrapper: {
    width: '100%',
    maxWidth: '500px',
    padding: '10px',
    overflow: 'visible',
  },
  premiumRadarTooltip: {
    background: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
    color: '#ffffff',
    padding: '16px 18px',
    borderRadius: '12px',
    fontSize: '13px',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    minWidth: '200px',
  },
  radarTooltipHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
    paddingBottom: '10px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
  },
  radarTooltipIcon: {
    fontSize: '18px',
  },
  radarTooltipTitle: {
    fontSize: '15px',
    fontWeight: '700',
    margin: 0,
  },
  radarTooltipScore: {
    marginBottom: '10px',
  },
  radarTooltipScoreValue: {
    fontSize: '32px',
    fontWeight: '800',
    letterSpacing: '-1px',
  },
  radarTooltipScoreUnit: {
    fontSize: '14px',
    color: '#9ca3af',
    marginLeft: '4px',
  },
  radarTooltipDescription: {
    fontSize: '12px',
    color: '#d1d5db',
    lineHeight: '1.5',
    margin: 0,
  },
  // 리팩토링 프롬프트 패널 스타일
  refactoringPanelContainer: {
    maxWidth: '1200px',
    margin: '0 auto 32px',
    background: 'linear-gradient(145deg, #fefce8 0%, #fef9c3 100%)',
    borderRadius: '20px',
    padding: '24px 28px',
    boxShadow: '0 4px 24px rgba(234, 179, 8, 0.15), 0 1px 3px rgba(0, 0, 0, 0.04)',
    border: '1px solid rgba(234, 179, 8, 0.3)',
  },
  refactoringHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: '16px',
  },
  refactoringHeaderLeft: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
  },
  refactoringIcon: {
    fontSize: '32px',
    lineHeight: '1',
  },
  refactoringTitle: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#92400e',
    margin: '0 0 4px 0',
  },
  refactoringSubtitle: {
    fontSize: '13px',
    color: '#a16207',
    margin: 0,
    lineHeight: '1.5',
  },
  refactoringGenerateBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)',
  },
  refactoringBadges: {
    display: 'flex',
    gap: '12px',
    marginTop: '16px',
    flexWrap: 'wrap',
  },
  refactoringBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    background: 'rgba(255, 255, 255, 0.7)',
    borderRadius: '20px',
    fontSize: '12px',
    color: '#92400e',
    fontWeight: '500',
    border: '1px solid rgba(234, 179, 8, 0.3)',
  },
  refactoringPromptArea: {
    marginTop: '20px',
    background: '#ffffff',
    borderRadius: '16px',
    border: '1px solid #e5e7eb',
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
  },
  refactoringPromptHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 20px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
  },
  refactoringPromptLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
  },
  refactoringPromptActions: {
    display: 'flex',
    gap: '8px',
  },
  refactoringCopyBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 16px',
    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  refactoringCopyBtnCopied: {
    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
  },
  refactoringCloseBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    background: '#f3f4f6',
    color: '#6b7280',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  refactoringPromptContent: {
    maxHeight: '400px',
    overflow: 'auto',
    padding: '20px',
    background: '#1f2937',
  },
  refactoringPromptText: {
    margin: 0,
    fontFamily: "'Fira Code', 'Consolas', monospace",
    fontSize: '13px',
    lineHeight: '1.6',
    color: '#e5e7eb',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  refactoringPromptFooter: {
    padding: '14px 20px',
    background: '#f0fdf4',
    borderTop: '1px solid #bbf7d0',
  },
  refactoringPromptHint: {
    fontSize: '13px',
    color: '#166534',
    lineHeight: '1.5',
  },
  refactoringNoIssues: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '8px 0',
  },
  refactoringNoIssuesIcon: {
    fontSize: '28px',
  },
  refactoringNoIssuesTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#166534',
    margin: '0 0 4px 0',
  },
  refactoringNoIssuesText: {
    fontSize: '13px',
    color: '#15803d',
    margin: 0,
  },
};

export default App;