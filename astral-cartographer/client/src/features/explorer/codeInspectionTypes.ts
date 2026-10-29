import type { CodeIssue, CodeIssueCategory, CodeIssueSeverity } from '../../lib/api';

export interface CategoryMeta {
  label: string;
  color: string;
  bg: string;
  border: string;
}

export const CATEGORY_METAS: Record<CodeIssueCategory, CategoryMeta> = {
  security: {
    label: 'Security',
    color: '#FF717A',
    bg: 'rgba(255, 113, 122, 0.12)',
    border: 'rgba(255, 113, 122, 0.3)',
  },
  logical_error: {
    label: 'Logic Error',
    color: '#FFAD66',
    bg: 'rgba(255, 173, 102, 0.12)',
    border: 'rgba(255, 173, 102, 0.3)',
  },
  null_undefined: {
    label: 'Null / Undefined',
    color: '#FFD166',
    bg: 'rgba(255, 209, 102, 0.12)',
    border: 'rgba(255, 209, 102, 0.3)',
  },
  division_by_zero: {
    label: 'Math / Div 0',
    color: '#FF717A',
    bg: 'rgba(255, 113, 122, 0.12)',
    border: 'rgba(255, 113, 122, 0.3)',
  },
  suspicious_loop: {
    label: 'Loop Condition',
    color: '#F472B6',
    bg: 'rgba(244, 114, 182, 0.12)',
    border: 'rgba(244, 114, 182, 0.3)',
  },
  unused_or_unreachable: {
    label: 'Dead Code / Unused',
    color: '#A7B4CC',
    bg: 'rgba(167, 180, 204, 0.12)',
    border: 'rgba(167, 180, 204, 0.3)',
  },
  resource_management: {
    label: 'Resource Leak',
    color: '#C084FC',
    bg: 'rgba(192, 132, 252, 0.12)',
    border: 'rgba(192, 132, 252, 0.3)',
  },
  ai_detected: {
    label: 'AI Inferred',
    color: '#8B78FF',
    bg: 'rgba(139, 120, 255, 0.14)',
    border: 'rgba(139, 120, 255, 0.35)',
  },
};

export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_METAS).map(([k, v]) => [k, v.label])
);

export interface SeverityMeta {
  label: string;
  color: string;
  icon: string;
}

export const SEVERITY_METAS: Record<CodeIssueSeverity, SeverityMeta> = {
  error: {
    label: 'Error',
    color: '#FF717A',
    icon: '🔴',
  },
  warning: {
    label: 'Warning',
    color: '#FFAD66',
    icon: '🟡',
  },
  info: {
    label: 'Info',
    color: '#38BDF8',
    icon: '🔵',
  },
};
