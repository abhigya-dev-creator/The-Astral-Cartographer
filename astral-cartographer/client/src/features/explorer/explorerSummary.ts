import type { ExplorerFileItem, ExplorerSummaryData } from './explorerTypes';

/**
 * Derives an evidence-based contextual summary and badges from AST analysis, file facts,
 * and graph connectivity. Discloses the absence of external AI and never fakes LLM text.
 */
export function generateFileSummary(
  file: ExplorerFileItem,
  sourceCode?: string | null
): ExplorerSummaryData {
  const ext = file.ext.toLowerCase();
  const name = file.name;
  const path = file.path.toLowerCase();
  const badges: string[] = [];

  // 1. Language badge
  let langLabel = 'Plain Text';
  if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) langLabel = 'TypeScript';
  else if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) langLabel = 'JavaScript';
  else if (ext === '.java') langLabel = 'Java';
  else if (ext === '.py') langLabel = 'Python';
  else if (ext === '.go') langLabel = 'Go';
  else if (['.css', '.scss', '.sass', '.less'].includes(ext)) langLabel = 'CSS';
  else if (['.json', '.jsonc'].includes(ext)) langLabel = 'JSON';
  else if (['.md', '.mdx'].includes(ext)) langLabel = 'Markdown';
  else if (['.html', '.htm'].includes(ext)) langLabel = 'HTML';
  else if (['.yaml', '.yml'].includes(ext)) langLabel = 'YAML';

  // 2. Functional classification & badges
  const isReact =
    ['.tsx', '.jsx'].includes(ext) ||
    file.outgoingDeps.some((d) => d.specifier === 'react' || d.specifier.startsWith('react/')) ||
    (sourceCode ? /\b(?:import\s+React|from\s+['"]react['"]|export\s+(?:default\s+)?function\s+[A-Z]|const\s+[A-Z]\w*\s*(?::\s*React\.)?)/.test(sourceCode) : false);

  const isHook = /^use[A-Z]/.test(name) || path.includes('/hooks/');
  const isUI = path.includes('/components/') || path.includes('/ui/') || path.includes('/views/') || path.includes('/layout/');
  const isTest = /(?:test|spec)\.[cm]?[jt]sx?$/.test(name) || path.includes('/__tests__/') || path.includes('/test/');
  const isUtil = path.includes('/utils/') || path.includes('/lib/') || path.includes('/helpers/') || path.includes('/shared/');
  const isRoute = path.includes('/routes/') || path.includes('/api/') || path.includes('/endpoints/') || path.includes('/controllers/');
  const isStore = path.includes('/store') || path.includes('/context') || path.includes('/state');
  const isModel = path.includes('/models/') || path.includes('/schema/') || path.includes('/entities/');
  const isConfig = /(?:config|\.rc|settings|tsconfig|package\.json)/i.test(name);
  const isReusable = file.incomingDeps.length >= 2 || (isUI && !name.includes('Page') && !name.includes('App'));

  if (isReact) {
    badges.push('React Component');
  }
  if (isReusable && (isReact || isUtil || isHook)) {
    badges.push('Reusable');
  }
  if (isUI) {
    badges.push('UI Component');
  }
  if (isHook) {
    badges.push('Custom Hook');
  }
  if (isRoute) {
    badges.push('API Route');
  }
  if (isStore) {
    badges.push('State Management');
  }
  if (isModel) {
    badges.push('Data Model');
  }
  if (isTest) {
    badges.push('Test Suite');
  }
  if (isUtil && !badges.includes('UI Component')) {
    badges.push('Utility');
  }
  if (isConfig) {
    badges.push('Configuration');
  }
  if (ext === '.java') {
    const classCount = file.functions.filter((f) => f.kind === 'class').length;
    if (classCount > 0) badges.push('Java Class');
  }

  // Always include the language badge if not already present
  if (langLabel && !badges.includes(langLabel)) {
    badges.push(langLabel);
  }

  // Determine Role Description
  let role = 'module';
  if (isReact && isUI) role = 'user interface component';
  else if (isReact) role = 'component';
  else if (isHook) role = 'custom React hook';
  else if (isRoute) role = 'API route handler';
  else if (isStore) role = 'state container/context';
  else if (isModel) role = 'data schema/model';
  else if (isTest) role = 'test specification suite';
  else if (isUtil) role = 'utility helper module';
  else if (isConfig) role = 'configuration file';
  else if (ext === '.java') role = 'Java class file';

  // 3. Synthesize honest narrative summary
  const functionCount = file.functions.length;
  const exportNames = file.exports.map((e) => (typeof e === 'string' ? e : e.name)).filter(Boolean);
  const classes = file.functions.filter((f) => f.kind === 'class').map((f) => f.name);
  const localImports = file.outgoingDeps.filter((d) => d.isLocal).length;
  const externalPackages = file.outgoingDeps.filter((d) => d.isExternal).map((d) => d.specifier);
  const uniquePackages = [...new Set(externalPackages)].slice(0, 4);

  const sentences: string[] = [];

  // Sentence 1: Purpose & Identity
  if (isReact) {
    const mainExport = exportNames[0] || name.replace(/\.[^.]+$/, '');
    sentences.push(
      `This ${role} renders the ${mainExport} element in the ${file.folder || 'root'} folder.`
    );
  } else if (classes.length > 0) {
    sentences.push(
      `This ${role} declares class ${classes.slice(0, 2).join(', ')} providing core object structure.`
    );
  } else if (exportNames.length > 0) {
    sentences.push(
      `This ${role} exports ${exportNames.length === 1 ? `\`${exportNames[0]}\`` : `${exportNames.length} definitions (\`${exportNames.slice(0, 3).join('`, `')}\`${exportNames.length > 3 ? '…' : ''})`} in the ${file.folder || 'root'} directory.`
    );
  } else if (file.lines > 0) {
    sentences.push(
      `This ${role} contains ${file.lines.toLocaleString()} lines of ${langLabel} code.`
    );
  } else {
    sentences.push(`This file is located at \`${file.path}\`.`);
  }

  // Sentence 2: Internal definitions & Responsibilities
  const responsibilityParts: string[] = [];
  if (classes.length > 0) {
    responsibilityParts.push(`${classes.length} ${classes.length === 1 ? 'class' : 'classes'}`);
  }
  if (functionCount > 0) {
    const fnOnly = file.functions.filter((f) => f.kind !== 'class');
    if (fnOnly.length > 0) {
      responsibilityParts.push(`${fnOnly.length} ${fnOnly.length === 1 ? 'function' : 'functions'}`);
    }
  }
  if (responsibilityParts.length > 0) {
    sentences.push(`It implements ${responsibilityParts.join(' and ')}.`);
  }

  // Sentence 3: Connectivity & Dependencies
  if (uniquePackages.length > 0 || localImports > 0) {
    const depSummaryParts: string[] = [];
    if (uniquePackages.length > 0) {
      depSummaryParts.push(`external packages (${uniquePackages.map((p) => `\`${p}\``).join(', ')}${externalPackages.length > 4 ? ', etc.' : ''})`);
    }
    if (localImports > 0) {
      depSummaryParts.push(`${localImports} local ${localImports === 1 ? 'module' : 'modules'}`);
    }
    sentences.push(`It integrates with ${depSummaryParts.join(' and ')}.`);
  }

  // Sentence 4: Codebase impact / Inbound usage
  if (file.incomingDeps.length > 0) {
    sentences.push(
      `It is directly imported by ${file.incomingDeps.length} other ${file.incomingDeps.length === 1 ? 'file' : 'files'} across the repository.`
    );
  } else if (file.kind === 'code' && !isTest && !name.includes('index') && !name.includes('App') && !name.includes('main')) {
    sentences.push(`No other local files import this module directly (it may be an entry point or standalone module).`);
  }

  // Sentence 5: Architectural insights (circular dependencies or findings)
  const circularIssue = file.issues.find((i) => i.type === 'circular_dependency');
  if (circularIssue) {
    sentences.push(`⚠️ Note: This module is part of a circular dependency cycle.`);
  }

  const description = sentences.join(' ');

  return {
    title: 'AI Summary',
    description,
    badges: badges.slice(0, 5),
    role,
    isHeuristicOnly: false,
    disclaimer: 'Analysis-derived summary based on AST inspection and repository facts; no external AI service is connected.',
  };
}
